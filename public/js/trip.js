import { CATEGORIES, CATEGORY, isAlcoholic } from '../catalog.js';
import { dayKey, dayLabel, drinksLabel, fill, h, lsGet, lsSet, num, qtyLabel, timeLabel } from './dom.js';
import { gramsAlcohol, onChange, state, tripById } from './state.js';
import { getEntries } from './store.js';
import { getPrefs, logEntry, openLogSheet, toTemplate, toggleFavorite } from './sheet.js';
import { emptyState, layout, segmented } from './ui.js';

export function renderTrip(root, id) {
  const trip = tripById(id);
  if (!trip) return notFound(root);
  const quick = h('section', { class: 'quick', 'aria-label': 'Quick add' });
  const summary = h('section', { class: 'summary', 'aria-label': 'Your day' });
  const feed = h('section', { class: 'feed', 'aria-label': 'Drinks' });
  let filter = lsGet('td-filter', 'all');

  const grid = h('div', { class: 'cat-grid' }, CATEGORIES.map((c) =>
    h('button', { type: 'button', class: `cat cat-${c.key}`, onclick: () => openLogSheet(tripById(id) || trip, { category: c.key }) },
      h('span', { class: 'cat-emoji', 'aria-hidden': 'true' }, c.emoji), h('span', { class: 'cat-label' }, c.label))));

  const banner = h('p', { class: 'banner', hidden: !trip.archived }, 'This trip is archived. You can still log and edit drinks.');
  layout(root, {
    title: trip.name, back: '#/trips', tripId: id, active: 'log',
    body: [
      banner,
      quick, grid, summary,
      h('div', { class: 'feed-head' }, h('h2', null, 'Drinks'),
        segmented([['mine', 'Mine'], ['all', 'Everyone']], filter, (v) => { filter = v; lsSet('td-filter', v); refresh(); }, 'Filter')),
      feed,
    ],
  });

  async function refresh() {
    const t = tripById(id);
    if (!t) { location.hash = '#/trips'; return; }
    const title = root.querySelector('.topbar .title');
    if (title && title.textContent !== t.name) title.textContent = t.name;
    banner.hidden = !t.archived;
    const [entries, prefs] = await Promise.all([getEntries(id), getPrefs()]);
    entries.sort((a, b) => b.consumed_at.localeCompare(a.consumed_at) || b.updated_at - a.updated_at);
    const mine = entries.filter((e) => e.user_id === state.me.id);
    renderQuick(quick, t, mine, prefs, refresh);
    renderSummary(summary, mine);
    renderFeed(feed, t, filter === 'mine' ? mine : entries);
  }
  refresh();
  return onChange(refresh);
}

function notFound(root) {
  layout(root, { title: 'Trip', back: '#/trips', body: emptyState('🧭', 'Trip not found. It may still be syncing, or you are no longer a member.', h('a', { class: 'btn', href: '#/trips' }, 'All trips')) });
  return onChange(() => { const m = location.hash.match(/^#\/trip\/([^/]+)/); if (m && tripById(m[1])) window.dispatchEvent(new HashChangeEvent('hashchange')); });
}

function renderQuick(el, trip, mine, prefs, refresh) {
  const last = mine[0];
  const favKeys = new Set(prefs.favorites.map((f) => `${f.category}|${f.name}|${f.volume_ml}`));
  const items = [...prefs.favorites.map((f) => ({ ...f, fav: true })),
    ...prefs.recents.filter((r) => !favKeys.has(`${r.category}|${r.name}|${r.volume_ml}`))].slice(0, 16);
  fill(el,
    last && h('button', {
      type: 'button', class: 'btn repeat',
      onclick: () => logEntry(trip, { ...toTemplate(last), quantity: last.quantity }),
    }, `↻ Repeat last · ${CATEGORY[last.category]?.emoji || ''} ${last.name}`),
    items.length ? h('div', { class: 'recents', role: 'list', 'aria-label': 'Recent drinks' }, items.map((t) =>
      h('div', { class: `recent${t.fav ? ' fav' : ''}`, role: 'listitem' },
        h('button', {
          type: 'button', class: 'recent-main', title: 'Log again',
          onclick: () => logEntry(trip, t),
        },
        h('span', { 'aria-hidden': 'true' }, CATEGORY[t.category]?.emoji || '🍶'),
        h('span', { class: 'recent-name' }, t.name),
        h('span', { class: 'recent-meta' }, t.volume_ml ? `${num(t.volume_ml, 0)} ml` : '')),
        h('button', {
          type: 'button', class: 'star', 'aria-pressed': String(!!t.fav), 'aria-label': t.fav ? `Unfavourite ${t.name}` : `Favourite ${t.name}`,
          onclick: async () => { await toggleFavorite(t); refresh(); },
        }, t.fav ? '★' : '☆')))) : null,
  );
  el.hidden = !last && !items.length;
}

function renderSummary(el, mine) {
  const today = dayKey(new Date());
  const td = mine.filter((e) => dayKey(e.consumed_at) === today);
  fill(el, h('div', { class: 'stat-row' },
    stat('Drinks today', qtyLabel(drinkCount(td))),
    stat('Std drinks', num(stdDrinks(td)))));
}

const stat = (label, value) => h('div', { class: 'stat' }, h('span', { class: 'stat-val' }, value), h('span', { class: 'stat-label' }, label));

export const drinkCount = (list) => list.filter(isAlcoholic).reduce((s, e) => s + e.quantity, 0);
export const stdDrinks = (list) => list.reduce((s, e) => s + gramsAlcohol(e), 0) / 10;

function renderFeed(el, trip, entries) {
  if (!entries.length) {
    fill(el, emptyState('🥂', 'No drinks yet. Tap a category above to log one.'));
    return;
  }
  const names = new Map(trip.members.map((m) => [m.id, m.display_name]));
  const days = new Map();
  for (const e of entries) {
    const k = dayKey(e.consumed_at);
    if (!days.has(k)) days.set(k, []);
    days.get(k).push(e);
  }
  const out = [];
  for (const [k, list] of days) {
    out.push(h('div', { class: 'day' },
      h('h3', { class: 'day-head' }, h('span', null, dayLabel(k)),
        h('span', { class: 'day-sub' }, `${drinksLabel(drinkCount(list))} · ${num(stdDrinks(list))} std`)),
      h('ul', { class: 'entries' }, list.map((e) => entryRow(e, trip, names)))));
  }
  fill(el, ...out);
}

function entryRow(e, trip, names) {
  const own = e.user_id === state.me.id;
  const body = [
    h('span', { class: 'e-emoji', 'aria-hidden': 'true' }, CATEGORY[e.category]?.emoji || '🍶'),
    h('span', { class: 'e-main' },
      h('span', { class: 'e-name' }, `${e.quantity !== 1 ? `${qtyLabel(e.quantity)} × ` : ''}${e.name}`),
      h('span', { class: 'e-meta' }, [
        own ? 'You' : names.get(e.user_id) || 'Former member',
        timeLabel(e.consumed_at),
        e.volume_ml && `${num(e.volume_ml, 0)} ml`,
        e.abv && `${num(e.abv)}%`,
      ].filter(Boolean).join(' · ')),
      e.note && h('span', { class: 'e-note' }, e.note)),
  ];
  return h('li', null, own
    ? h('button', { type: 'button', class: 'entry own', title: 'Edit', onclick: () => openLogSheet(tripById(trip.id) || trip, { entry: e }) }, body)
    : h('div', { class: 'entry' }, body));
}
