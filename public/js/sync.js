import { api } from './api.js';
import { h, toast } from './dom.js';
import { applySync, getTrips, kvGet, outboxCount, outboxList, resetForResync, saveEntry } from './store.js';
import { emit, state } from './state.js';

let running = false;
let again = false;
let fails = 0;
let retryTimer = null;
let debounceTimer = null;
let status = 'ok';
let started = false;
let resetPending = false;
let current = Promise.resolve();

export const pill = h('button', { type: 'button', class: 'pill', 'aria-live': 'polite', title: 'Sync now', onclick: () => syncNow() }, 'Synced');

export async function updatePill() {
  let n = 0;
  try { n = await outboxCount(); } catch { /* db unavailable */ }
  let text = 'Synced';
  let cls = 'ok';
  if (!navigator.onLine) { text = n ? `Offline · ${n} pending` : 'Offline'; cls = 'off'; }
  else if (running) { text = 'Syncing…'; cls = 'busy'; }
  else if (status === 'error') { text = n ? `Sync error · ${n} pending` : 'Sync error'; cls = 'err'; }
  else if (status === 'auth') { text = 'Signed out'; cls = 'err'; }
  else if (n) { text = `${n} pending`; cls = 'busy'; }
  pill.textContent = text;
  pill.className = `pill ${cls}`;
}

export function scheduleSync(ms = 400) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(syncNow, ms);
}

export function syncNow() {
  if (!state.me) return Promise.resolve();
  if (running) { again = true; return current; }
  current = runSync();
  return current;
}

async function applyPendingReset() {
  if (!resetPending) return false;
  resetPending = false;
  await resetForResync();
  return true;
}

// The reset runs inside the sync loop so an in-flight response cannot write stale cursors back afterwards.
export async function forceResync() {
  resetPending = true;
  if (running) { again = true; await current; }
  if (!running && await applyPendingReset()) emit();
  await syncNow();
}

async function runSync() {
  clearTimeout(retryTimer);
  if (!navigator.onLine) { updatePill(); return; }
  running = true;
  updatePill();
  let changed = false;
  try {
    for (let i = 0; i < 50; i++) {
      if (await applyPendingReset()) changed = true;
      const changes = await outboxList(500);
      const trip_cursors = (await kvGet('trip_cursors')) || {};
      const known = (await getTrips()).map((t) => t.id);
      const res = await api('POST', '/api/sync', { trip_cursors, changes });
      const r = await applySync(res, changes, known);
      changed ||= r.changed;
      if (res.rejected?.length) {
        const why = [...new Set(res.rejected.map((x) => x.reason))].join(', ');
        toast(`${res.rejected.length} change(s) rejected by server: ${why}`, { kind: 'error', ms: 7000 });
      }
      if (!res.more && !r.refetch && changes.length < 500 && !resetPending) break;
    }
    status = 'ok';
    fails = 0;
    state.trips = await getTrips();
    if (changed) emit();
  } catch (e) {
    status = e.status === 401 ? 'auth' : 'error';
    if (e.status !== 401) {
      fails++;
      retryTimer = setTimeout(syncNow, Math.min(120000, 2000 * 2 ** (fails - 1)) * (0.8 + Math.random() * 0.4));
    }
  } finally {
    running = false;
    updatePill();
    if (again) { again = false; syncNow(); }
  }
}

export async function writeEntry(entry) {
  const { server_seq: _seq, ...e } = entry;
  await saveEntry(e);
  emit();
  updatePill();
  scheduleSync();
}

export function startSync() {
  syncNow();
  if (started) return;
  started = true;
  window.addEventListener('online', () => { fails = 0; syncNow(); });
  window.addEventListener('offline', updatePill);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
  setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 30000);
}

export function resetSyncStatus() {
  status = 'ok';
  fails = 0;
  updatePill();
}
