let dbp;

function open() {
  dbp ||= new Promise((resolve, reject) => {
    const r = indexedDB.open('trip-drinks', 2);
    r.onupgradeneeded = (ev) => {
      if (ev.oldVersion >= 1) { upgradeV1(r.transaction); return; }
      const d = r.result;
      d.createObjectStore('entries', { keyPath: 'id' }).createIndex('trip_id', 'trip_id');
      d.createObjectStore('trips', { keyPath: 'id' });
      d.createObjectStore('outbox', { keyPath: 'id' });
      d.createObjectStore('kv');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbp;
}

// v1 data carried prices, currencies, cached rates and a water category; drop or remap them in place.
function upgradeV1(t) {
  const strip = ({ unit_price: _p, currency: _c, ...e }) => (e.category === 'water' ? { ...e, category: 'soft' } : e);
  for (const name of ['entries', 'outbox', 'trips']) {
    t.objectStore(name).openCursor().onsuccess = (ev) => {
      const c = ev.target.result;
      if (c) { c.update(strip(c.value)); c.continue(); }
    };
  }
  const kv = t.objectStore('kv');
  kv.delete('rates');
  kv.delete(IDBKeyRange.bound('last:', 'last:\uffff'));
  for (const k of ['recents', 'favorites']) {
    kv.get(k).onsuccess = (ev) => {
      const l = ev.target.result;
      if (Array.isArray(l)) kv.put(l.filter((x) => x.category !== 'water').map(strip), k);
    };
  }
  kv.get('me').onsuccess = (ev) => {
    const me = ev.target.result;
    if (me && 'default_currency' in me) { delete me.default_currency; kv.put(me, 'me'); }
  };
  kv.get('custom_names').onsuccess = (ev) => {
    const c = ev.target.result;
    if (c && 'water' in c) { delete c.water; kv.put(c, 'custom_names'); }
  };
}

// fn receives the object stores and must only issue requests synchronously or from request callbacks.
async function run(names, mode, fn) {
  const d = await open();
  return new Promise((resolve, reject) => {
    const t = d.transaction(names, mode);
    const box = {};
    fn(...names.map((n) => t.objectStore(n)), box);
    t.oncomplete = () => resolve(box.result);
    t.onerror = t.onabort = () => reject(t.error);
  });
}

const into = (box, r) => { r.onsuccess = () => { box.result = r.result; }; };

export const kvGet = (k) => run(['kv'], 'readonly', (s, box) => into(box, s.get(k)));
export const kvSet = (k, v) => run(['kv'], 'readwrite', (s) => s.put(v, k));
export const kvDel = (k) => run(['kv'], 'readwrite', (s) => s.delete(k));

export const getTrips = () => run(['trips'], 'readonly', (s, box) => into(box, s.getAll())).then((t) => t || []);
export const putTrip = (t) => run(['trips'], 'readwrite', (s) => s.put(t));
export const getEntries = (tripId) =>
  run(['entries'], 'readonly', (s, box) => into(box, s.index('trip_id').getAll(tripId))).then((e) => (e || []).filter((x) => !x.deleted));
export const getAllEntries = () => run(['entries'], 'readonly', (s, box) => into(box, s.getAll())).then((e) => (e || []).filter((x) => !x.deleted));
export const outboxList = (limit = 500) => run(['outbox'], 'readonly', (s, box) => into(box, s.getAll(null, limit))).then((e) => e || []);
export const outboxCount = () => run(['outbox'], 'readonly', (s, box) => into(box, s.count()));
export const outboxCountFor = (tripId) =>
  run(['outbox'], 'readonly', (s, box) => into(box, s.getAll())).then((l) => (l || []).filter((e) => e.trip_id === tripId).length);

export const saveEntry = (e) => run(['entries', 'outbox'], 'readwrite', (es, ob) => { es.put(e); ob.put(e); });

export function removeTripLocal(tripId) {
  return run(['trips', 'entries', 'outbox', 'kv'], 'readwrite', (ts, es, ob, kv) => {
    ts.delete(tripId);
    es.index('trip_id').openKeyCursor(IDBKeyRange.only(tripId)).onsuccess = (ev) => {
      const c = ev.target.result;
      if (c) { es.delete(c.primaryKey); c.continue(); }
    };
    ob.openCursor().onsuccess = (ev) => {
      const c = ev.target.result;
      if (c) { if (c.value.trip_id === tripId) c.delete(); c.continue(); }
    };
    kv.get('trip_cursors').onsuccess = (ev) => {
      const cur = ev.target.result;
      if (cur && tripId in cur) { delete cur[tripId]; kv.put(cur, 'trip_cursors'); }
    };
  });
}

// Applies a /api/sync response. `sent` are the outbox items that were pushed; `known` are the local trip ids
// when the request was built. Only those may be pruned, so trips created/joined mid-request survive a stale response.
export function applySync(res, sent, known) {
  return run(['entries', 'outbox', 'trips', 'kv'], 'readwrite', (es, ob, ts, kv, box) => {
    box.result = { changed: false };
    const sentMap = new Map(sent.map((e) => [e.id, e]));
    const done = [...(res.applied || []), ...(res.rejected || []).map((r) => r.id)].filter((id) => typeof id === 'string');
    for (const id of done) {
      const s = sentMap.get(id);
      ob.get(id).onsuccess = (ev) => {
        const cur = ev.target.result;
        if (cur && (!s || cur.updated_at <= s.updated_at)) ob.delete(id);
      };
    }
    // A rejected change leaves a local copy the server never accepted: drop it (unless edited since) and refetch that trip.
    const cursors = res.trip_cursors ? { ...res.trip_cursors } : null;
    for (const r of res.rejected || []) {
      const s = typeof r.id === 'string' ? sentMap.get(r.id) : null;
      if (!s) continue;
      ob.get(r.id).onsuccess = (ev) => {
        const cur = ev.target.result;
        if (!cur || cur.updated_at <= s.updated_at) es.delete(r.id);
      };
      if (cursors && s.trip_id in cursors) { cursors[s.trip_id] = 0; box.result.refetch = true; }
      box.result.changed = true;
    }
    for (const e of res.entries || []) {
      ob.get(e.id).onsuccess = (ev) => {
        const local = ev.target.result;
        if (local && local.updated_at > e.updated_at) return;
        if (e.deleted) es.delete(e.id);
        else es.put(e);
        box.result.changed = true;
      };
    }
    if (cursors) kv.put(cursors, 'trip_cursors');
    if (Array.isArray(res.trips)) {
      const keep = new Set(res.trips.map((t) => t.id));
      const gone = new Set([...(known || [])].filter((id) => !keep.has(id)));
      ts.getAll().onsuccess = (ev) => {
        const old = ev.target.result;
        const byId = new Map(old.map((t) => [t.id, JSON.stringify(t)]));
        if (res.trips.some((t) => byId.get(t.id) !== JSON.stringify(t)) || old.some((t) => gone.has(t.id))) box.result.changed = true;
        for (const t of old) if (gone.has(t.id)) ts.delete(t.id);
        for (const t of res.trips) ts.put(t);
      };
      if (gone.size) {
        es.openCursor().onsuccess = (ev) => {
          const c = ev.target.result;
          if (c) { if (gone.has(c.value.trip_id)) c.delete(); c.continue(); }
        };
        ob.openCursor().onsuccess = (ev) => {
          const c = ev.target.result;
          if (c) { if (gone.has(c.value.trip_id)) c.delete(); c.continue(); }
        };
        kv.get('trip_cursors').onsuccess = (ev) => {
          const cur = cursors || ev.target.result;
          if (!cur) return;
          for (const id of gone) delete cur[id];
          kv.put(cur, 'trip_cursors');
        };
      }
    }
  });
}

// Drops synced data so the next sync refetches everything; pending outbox items are kept.
export function resetForResync() {
  return run(['entries', 'outbox', 'kv'], 'readwrite', (es, ob, kv) => {
    kv.delete('trip_cursors');
    es.clear();
    ob.getAll().onsuccess = (ev) => { for (const e of ev.target.result) es.put(e); };
  });
}

export function clearAll() {
  const names = ['entries', 'outbox', 'trips', 'kv'];
  return run(names, 'readwrite', (...stores) => { for (const s of stores.slice(0, 4)) s.clear(); });
}
