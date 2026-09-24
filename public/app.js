import { api, setUnauthorizedHandler } from './js/api.js';
import { busy, drinksLabel, field, fill, h, lsGet, lsSet, qtyLabel, toast, uuid } from './js/dom.js';
import { clearAll, getAllEntries, getTrips, kvGet, kvSet, outboxCount, putTrip } from './js/store.js';
import { clearListeners, emit, onChange, state, VERSION } from './js/state.js';
import { forceResync, resetSyncStatus, startSync, syncNow, updatePill } from './js/sync.js';
import { emptyState, layout, segmented } from './js/ui.js';
import { drinkCount, renderTrip } from './js/trip.js';
import { renderStats } from './js/stats.js';
import { renderTripSettings } from './js/tripsettings.js';

const root = document.getElementById('app');
let cleanup = null;

function sessionGet(k) {
  try { return sessionStorage.getItem(k); } catch { return null; }
}
function sessionSet(k, v) {
  try { if (v == null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch { /* blocked */ }
}

function route() {
  if (typeof cleanup === 'function') cleanup();
  cleanup = null;
  clearListeners();
  const hash = location.hash || '#/trips';
  const parts = hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  if (!state.me) {
    if (parts[0] === 'join' && parts[1]) sessionSet('td-join', parts[1]);
    if (parts[0] !== 'login') { location.replace('#/login'); return; }
    renderLogin();
    return;
  }
  switch (parts[0]) {
    case 'login': location.replace('#/trips'); return;
    case 'trip':
      if (parts[2] === 'stats') cleanup = renderStats(root, parts[1]);
      else if (parts[2] === 'settings') cleanup = renderTripSettings(root, parts[1]);
      else cleanup = renderTrip(root, parts[1]);
      return;
    case 'join': renderJoin(parts[1] || ''); return;
    case 'settings': cleanup = renderSettings(); return;
    default:
      if (hash !== '#/trips') { location.replace('#/trips'); return; }
      cleanup = renderTrips();
  }
}

async function setMe(user) {
  const prev = await kvGet('me');
  if (prev && prev.id !== user.id) await clearAll();
  state.me = user;
  await kvSet('me', user);
  state.trips = await getTrips();
}

function afterLogin() {
  resetSyncStatus();
  const join = sessionGet('td-join');
  sessionSet('td-join', null);
  const target = join ? `#/join/${join}` : '#/trips';
  if (location.hash === target) route();
  else location.hash = target;
  startSync();
}

// ---------- Login / register ----------
async function renderLogin() {
  let mode = 'login';
  const err = h('p', { class: 'form-error', role: 'alert' });
  const form = h('form', { class: 'card form auth-form', novalidate: true });
  const body = h('div', { class: 'auth' },
    h('div', { class: 'hero' }, h('div', { class: 'hero-icon', 'aria-hidden': 'true' }, '🍻'),
      h('h1', null, 'Drunkify'), h('p', { class: 'muted' }, 'Log drinks with friends. Works offline.')),
    segmented([['login', 'Log in'], ['register', 'Create account']], mode, (v) => { mode = v; draw(); }, 'Account'),
    form);
  fill(root, h('main', { class: 'content' }, body));

  if (!state.config) {
    try { state.config = await api('GET', '/api/config'); } catch { /* offline */ }
  }

  function draw() {
    err.textContent = '';
    const reg = mode === 'register';
    const user = h('input', { name: 'username', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', required: true, minlength: '3', maxlength: '32', pattern: '[A-Za-z0-9_.\\-]+' });
    const pass = h('input', { name: 'password', type: 'password', autocomplete: reg ? 'new-password' : 'current-password', required: true, minlength: '6' });
    const display = reg && h('input', { name: 'display_name', autocomplete: 'nickname', required: true, maxlength: '40' });
    const code = reg && state.config?.registration_code_required && h('input', { name: 'registration_code', autocomplete: 'off', required: true });
    const submit = h('button', { type: 'submit', class: 'btn primary block' }, reg ? 'Create account' : 'Log in');
    fill(form,
      field('Username', user, reg && '3–32 characters: letters, numbers, _ . -'),
      reg && field('Display name', display),
      field('Password', pass, reg && 'At least 6 characters'),
      code && field('Registration code', code),
      err, submit);
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      err.textContent = '';
      const username = user.value.trim();
      if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) { err.textContent = 'Username must be 3–32 characters (letters, numbers, _ . -)'; return; }
      if (pass.value.length < 6) { err.textContent = 'Password must be at least 6 characters'; return; }
      const payload = { username, password: pass.value };
      if (reg) {
        payload.display_name = display.value.trim();
        if (!payload.display_name) { err.textContent = 'Display name is required'; return; }
        if (code) payload.registration_code = code.value.trim();
      }
      try {
        const res = await busy(submit, api('POST', reg ? '/api/auth/register' : '/api/auth/login', payload));
        await setMe(res.user);
        afterLogin();
      } catch (e) {
        err.textContent = e.message;
      }
    };
  }
  draw();
}

// ---------- Trips list ----------
function renderTrips() {
  const list = h('div', { class: 'trip-list' });
  const archived = h('div', { class: 'archived-wrap' });
  const gear = h('a', { class: 'icon-btn', href: '#/settings', 'aria-label': 'Settings' }, '⚙');

  const nameIn = h('input', { name: 'name', placeholder: 'e.g. Prague 2026', maxlength: '60', required: true, autocomplete: 'off' });
  const createBtn = h('button', { type: 'submit', class: 'btn primary' }, 'Create');
  const create = h('form', {
    class: 'card form', novalidate: true,
    onsubmit: async (ev) => {
      ev.preventDefault();
      const name = nameIn.value.trim();
      if (!name) return toast('Give the trip a name', { kind: 'error' });
      try {
        const res = await busy(createBtn, api('POST', '/api/trips', { id: uuid(), name }));
        await putTrip(res.trip);
        state.trips = await getTrips();
        location.hash = `#/trip/${res.trip.id}`;
        syncNow();
      } catch (e) {
        toast(e.message, { kind: 'error' });
      }
    },
  }, h('h2', null, 'New trip'), field('Name', nameIn), createBtn);

  const codeIn = h('input', { name: 'code', placeholder: 'ABCD2345', maxlength: '64', autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false', class: 'mono' });
  const join = h('form', {
    class: 'card form', novalidate: true,
    onsubmit: (ev) => {
      ev.preventDefault();
      let code = codeIn.value.trim();
      const m = code.match(/#\/join\/([A-Za-z0-9]+)/);
      if (m) code = m[1];
      code = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (code.length < 4) return toast('Enter an invite code or link', { kind: 'error' });
      location.hash = `#/join/${code}`;
    },
  }, h('h2', null, 'Join a trip'), h('div', { class: 'row' }, codeIn, h('button', { type: 'submit', class: 'btn' }, 'Join')));

  layout(root, { title: 'Drunkify', action: gear, body: [list, archived, create, join] });

  async function refresh() {
    const entries = await getAllEntries();
    const trips = [...state.trips].sort((a, b) => (b.created_at > a.created_at ? 1 : -1));
    const card = (t) => {
      const mine = entries.filter((e) => e.trip_id === t.id && e.user_id === state.me.id);
      return h('a', { class: 'trip-card', href: `#/trip/${t.id}` },
        h('span', { class: 'tc-name' }, t.name),
        h('span', { class: 'tc-meta' }, `${t.members.length} ${t.members.length === 1 ? 'member' : 'members'}`),
        h('span', { class: 'tc-mine' }, `You: ${drinksLabel(drinkCount(mine))}`));
    };
    const active = trips.filter((t) => !t.archived);
    const arch = trips.filter((t) => t.archived);
    fill(list, ...(active.length ? active.map(card) : [emptyState('🧳', 'No active trips. Create one or join with an invite code.')]));
    fill(archived, ...(arch.length ? [h('details', { class: 'archived' }, h('summary', null, `Archived (${arch.length})`), h('div', { class: 'trip-list' }, arch.map(card)))] : []));
  }
  refresh();
  return onChange(refresh);
}

// ---------- Join ----------
async function renderJoin(code) {
  const main = layout(root, { title: 'Join trip', back: '#/trips', body: h('p', { class: 'muted center' }, 'Loading invite…') });
  try {
    const { trip } = await api('GET', `/api/invite/${encodeURIComponent(code)}`);
    if (state.trips.some((t) => t.id === trip.id)) { location.replace(`#/trip/${trip.id}`); return; }
    const btn = h('button', {
      type: 'button', class: 'btn primary block',
      onclick: async () => {
        try {
          const res = await busy(btn, api('POST', '/api/trips/join', { invite_code: code }));
          await putTrip(res.trip);
          state.trips = await getTrips();
          location.replace(`#/trip/${res.trip.id}`);
          syncNow();
        } catch (e) {
          toast(e.message, { kind: 'error' });
        }
      },
    }, 'Join trip');
    fill(main, h('section', { class: 'card center' },
      h('div', { class: 'hero-icon', 'aria-hidden': 'true' }, '🧳'),
      h('h2', null, trip.name),
      h('p', { class: 'muted' }, `${trip.member_count} ${trip.member_count === 1 ? 'member' : 'members'}`),
      btn));
  } catch (e) {
    fill(main, emptyState('🔗', e.status === 404 ? 'This invite code is invalid or has been rotated.' : e.message,
      h('a', { class: 'btn', href: '#/trips' }, 'Back to trips')));
  }
}

// ---------- User settings ----------
function applyTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

function renderSettings() {
  const me = state.me;
  const nameIn = h('input', { name: 'display_name', value: me.display_name, maxlength: '40', required: true });
  const saveBtn = h('button', { type: 'submit', class: 'btn primary' }, 'Save');
  const profile = h('form', {
    class: 'card form', novalidate: true,
    onsubmit: async (ev) => {
      ev.preventDefault();
      const display_name = nameIn.value.trim();
      if (!display_name) return toast('Display name is required', { kind: 'error' });
      try {
        const res = await busy(saveBtn, api('PATCH', '/api/me', { display_name }));
        await setMe(res.user);
        toast('Profile saved');
        emit();
        syncNow();
      } catch (e) {
        toast(e.message, { kind: 'error' });
      }
    },
  }, h('h2', null, 'Profile'), h('p', { class: 'muted' }, `@${me.username}`), field('Display name', nameIn), saveBtn);

  const theme = h('section', { class: 'card' }, h('h2', null, 'Theme'),
    segmented([['system', 'System'], ['light', 'Light'], ['dark', 'Dark']], lsGet('td-theme', 'system'),
      (v) => { lsSet('td-theme', v); applyTheme(v); }, 'Theme'));

  const curPw = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const newPw = h('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: '6' });
  const pwBtn = h('button', { type: 'submit', class: 'btn' }, 'Change password');
  const pw = h('form', {
    class: 'card form', novalidate: true,
    onsubmit: async (ev) => {
      ev.preventDefault();
      if (newPw.value.length < 6) return toast('New password must be at least 6 characters', { kind: 'error' });
      try {
        await busy(pwBtn, api('POST', '/api/me/password', { current_password: curPw.value, new_password: newPw.value }));
        curPw.value = newPw.value = '';
        toast('Password changed');
      } catch (e) {
        toast(e.message, { kind: 'error' });
      }
    },
  }, h('h2', null, 'Password'), field('Current password', curPw), field('New password', newPw), pwBtn);

  const dataInfo = h('p', { class: 'muted' });
  const data = h('section', { class: 'card' }, h('h2', null, 'Data & sync'), dataInfo,
    h('div', { class: 'btn-col' },
      h('button', {
        type: 'button', class: 'btn',
        onclick: async (ev) => {
          if (!confirm('Re-download all trip data from the server? Unsynced drinks are kept.')) return;
          await busy(ev.currentTarget, forceResync());
          toast('Resync started');
          info();
        },
      }, 'Force full resync'),
      h('button', {
        type: 'button', class: 'btn danger',
        onclick: async () => {
          const n = await outboxCount();
          const msg = n
            ? `You have ${n} drink change(s) not yet synced. Logging out now will lose them. Log out anyway?`
            : 'Log out? Local data on this device will be cleared.';
          if (!confirm(msg)) return;
          try { await api('POST', '/api/auth/logout'); } catch { /* offline logout still clears locally */ }
          await clearAll();
          state.me = null;
          state.trips = [];
          location.hash = '#/login';
        },
      }, 'Log out')));

  async function info() {
    const n = await outboxCount();
    dataInfo.textContent = `${n} pending change(s).`;
  }
  info();

  layout(root, {
    title: 'Settings', back: '#/trips',
    body: [profile, theme, pw, data, h('p', { class: 'muted small center' }, `Drunkify v${VERSION}`)],
  });
  return onChange(info);
}

// ---------- Service worker ----------
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  // First install claims the page too; only an update (page already controlled) should reload.
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !hadController) return;
    reloading = true;
    location.reload();
  });
  const prompt = (w) => toast('Update available', {
    action: 'Reload', ms: 0,
    onAction: () => w.postMessage({ type: 'skipWaiting' }),
  });
  navigator.serviceWorker.register('sw.js').then((reg) => {
    if (reg.waiting && navigator.serviceWorker.controller) prompt(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) prompt(w);
      });
    });
    setInterval(() => reg.update().catch(() => {}), 3600e3);
  }).catch(() => {});
}

// ---------- Boot ----------
async function boot() {
  applyTheme(lsGet('td-theme', 'system'));
  registerSW();
  setUnauthorizedHandler(() => {
    if (!state.me) return;
    const join = location.hash.match(/^#\/join\/([^/]+)/);
    if (join) sessionSet('td-join', decodeURIComponent(join[1]));
    state.me = null;
    toast('Session expired — please log in again. Your unsynced drinks are kept.', { ms: 7000 });
    location.hash = '#/login';
  });
  window.addEventListener('hashchange', route);
  try {
    const [me, trips] = await Promise.all([kvGet('me'), getTrips()]);
    state.trips = trips;
    if (me) {
      state.me = me;
      route();
      startSync();
      api('GET', '/api/me').then(async (res) => {
        if (res?.user && JSON.stringify(res.user) !== JSON.stringify(state.me)) {
          await setMe(res.user);
          route();
          syncNow();
        }
      }).catch(() => {});
      return;
    }
  } catch {
    toast('Local storage is unavailable; offline mode is disabled.', { kind: 'error' });
  }
  try {
    const res = await api('GET', '/api/me');
    await setMe(res.user);
    route();
    startSync();
  } catch {
    route();
  }
  updatePill();
}

boot();
