import { api } from './api.js';
import { busy, field, fill, h, toast } from './dom.js';
import { emit, onChange, state, tripById } from './state.js';
import { getTrips, outboxCountFor, putTrip, removeTripLocal } from './store.js';
import { syncNow } from './sync.js';
import { layout } from './ui.js';

export const inviteUrl = (code) => `${location.origin}${location.pathname}#/join/${code}`;

export async function shareInvite(trip) {
  const url = inviteUrl(trip.invite_code);
  try {
    if (navigator.share) {
      await navigator.share({ title: trip.name, text: `Join "${trip.name}" on Drunkify`, url });
      return;
    }
  } catch (e) {
    if (e?.name === 'AbortError') return;
  }
  try {
    await navigator.clipboard.writeText(url);
    toast('Invite link copied');
  } catch {
    window.prompt('Copy this invite link', url);
  }
}

async function saveTrip(t) {
  await putTrip(t);
  state.trips = await getTrips();
  emit();
}

export function renderTripSettings(root, id) {
  const main = layout(root, { title: 'Trip', back: '#/trips', tripId: id, active: 'settings', body: [] });
  let sig = '';
  function refresh() {
    const trip = tripById(id);
    if (!trip) { location.hash = '#/trips'; return; }
    const s = JSON.stringify(trip);
    if (s === sig) return;
    sig = s;
    fill(main, ...build(trip));
  }
  refresh();
  return onChange(refresh);
}

function build(trip) {
  const owner = trip.owner_id === state.me.id;
  const call = async (method, path, body) => {
    try {
      return await api(method, path, body);
    } catch (e) {
      toast(e.message, { kind: 'error' });
      return null;
    }
  };

  const nameInput = h('input', { name: 'name', value: trip.name, maxlength: '60', required: true, disabled: !owner, autocomplete: 'off' });
  const saveBtn = h('button', { type: 'submit', class: 'btn primary' }, 'Save');
  const details = h('form', {
    class: 'card form',
    onsubmit: async (ev) => {
      ev.preventDefault();
      const name = nameInput.value.trim();
      if (!name) return toast('Name is required', { kind: 'error' });
      const res = await busy(saveBtn, call('PATCH', `/api/trips/${trip.id}`, { name }));
      if (res?.trip) { await saveTrip(res.trip); toast('Trip updated'); }
    },
  }, h('h2', null, 'Details'), field('Name', nameInput), owner && saveBtn);

  const link = inviteUrl(trip.invite_code);
  const invite = h('section', { class: 'card' },
    h('h2', null, 'Invite friends'),
    h('p', { class: 'invite-code', 'aria-label': 'Invite code' }, trip.invite_code),
    h('input', { class: 'mono', readOnly: true, value: link, 'aria-label': 'Invite link', onfocus: (e) => e.target.select() }),
    h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn primary', onclick: () => shareInvite(trip) }, 'Share invite'),
      owner && h('button', {
        type: 'button', class: 'btn',
        onclick: async (ev) => {
          if (!confirm('Rotate the invite code? The old link will stop working.')) return;
          const res = await busy(ev.currentTarget, call('POST', `/api/trips/${trip.id}/invite/rotate`));
          if (res?.trip) { await saveTrip(res.trip); toast('New invite code created'); }
        },
      }, 'Rotate code')));

  const members = h('section', { class: 'card' },
    h('h2', null, `Members (${trip.members.length})`),
    h('ul', { class: 'members' }, trip.members.map((m) => h('li', null,
      h('span', { class: 'm-name' }, m.display_name, h('small', null, ` @${m.username}`),
        m.id === trip.owner_id ? h('span', { class: 'tag' }, 'owner') : null),
      owner && m.id !== state.me.id && h('button', {
        type: 'button', class: 'btn small danger-text', 'aria-label': `Remove ${m.display_name}`,
        onclick: async (ev) => {
          if (!confirm(`Remove ${m.display_name} from this trip?`)) return;
          const res = await busy(ev.currentTarget, call('DELETE', `/api/trips/${trip.id}/members/${m.id}`));
          if (res?.trip) { await saveTrip(res.trip); toast(`Removed ${m.display_name}. Invite code rotated.`); syncNow(); }
        },
      }, 'Remove')))));

  const leaveOrDelete = async (btn, method, path, msg, pushFirst) => {
    if (!confirm(msg)) return;
    if (pushFirst) {
      await busy(btn, syncNow());
      const n = await outboxCountFor(trip.id);
      if (n && !confirm(`${n} of your drink change(s) in this trip have not synced yet and will be lost if you leave now. Leave anyway?`)) return;
    }
    const res = await busy(btn, call(method, path));
    if (!res) return;
    await removeTripLocal(trip.id);
    state.trips = await getTrips();
    location.hash = '#/trips';
    emit();
    syncNow();
  };

  const manage = h('section', { class: 'card' },
    h('h2', null, 'Manage'),
    h('div', { class: 'btn-col' },
      h('a', { class: 'btn', href: `/api/trips/${encodeURIComponent(trip.id)}/export.csv`, download: `${trip.name.replace(/[^\w.-]+/g, '_')}.csv` }, '⬇ Export CSV'),
      owner && h('button', {
        type: 'button', class: 'btn',
        onclick: async (ev) => {
          const res = await busy(ev.currentTarget, call('PATCH', `/api/trips/${trip.id}`, { archived: !trip.archived }));
          if (res?.trip) { await saveTrip(res.trip); toast(res.trip.archived ? 'Trip archived' : 'Trip restored'); }
        },
      }, trip.archived ? 'Unarchive trip' : 'Archive trip'),
      h('button', {
        type: 'button', class: 'btn danger-text',
        onclick: (ev) => leaveOrDelete(ev.currentTarget, 'POST', `/api/trips/${trip.id}/leave`, 'Leave this trip? Your drinks stay in the trip for others.', true),
      }, 'Leave trip'),
      owner && h('button', {
        type: 'button', class: 'btn danger',
        onclick: (ev) => leaveOrDelete(ev.currentTarget, 'DELETE', `/api/trips/${trip.id}`, `Delete "${trip.name}" and all its drinks for everyone? This cannot be undone.`),
      }, 'Delete trip')));

  return [details, invite, members, manage];
}
