import { CATEGORIES } from '../catalog.js';
import { dayKey, dayLabel, drinksLabel, fill, h, num, qtyLabel } from './dom.js';
import { onChange, state, tripById } from './state.js';
import { getEntries } from './store.js';
import { drinkCount, stdDrinks } from './trip.js';
import { emptyState, layout } from './ui.js';

export function renderStats(root, id) {
  const trip = tripById(id);
  if (!trip) { location.hash = '#/trips'; return null; }
  const main = layout(root, { title: `${trip.name} · Stats`, back: '#/trips', tripId: id, active: 'stats', body: [] });
  async function refresh() {
    const t = tripById(id);
    if (!t) return;
    fill(main, ...build(t, await getEntries(id)));
  }
  refresh();
  return onChange(refresh);
}

function build(trip, entries) {
  if (!entries.length) return [emptyState('📊', 'No drinks logged yet — stats will appear here.')];
  const mine = entries.filter((e) => e.user_id === state.me.id);

  const members = new Map(trip.members.map((m) => [m.id, { name: m.display_name, list: [] }]));
  for (const e of entries) {
    if (!members.has(e.user_id)) members.set(e.user_id, { name: 'Former member', list: [] });
    members.get(e.user_id).list.push(e);
  }
  const board = [...members.entries()].map(([uid, m]) => ({ uid, name: m.name, drinks: drinkCount(m.list), std: stdDrinks(m.list) }))
    .sort((a, b) => b.drinks - a.drinks || b.std - a.std);

  const byCat = CATEGORIES.map((c) => {
    const list = entries.filter((e) => e.category === c.key);
    return { label: `${c.emoji} ${c.label}`, qty: list.reduce((s, e) => s + e.quantity, 0), std: stdDrinks(list) };
  }).filter((r) => r.qty > 0).sort((a, b) => b.qty - a.qty);

  const days = new Map();
  for (const e of entries) {
    const k = dayKey(e.consumed_at);
    if (!days.has(k)) days.set(k, []);
    days.get(k).push(e);
  }
  const byDay = [...days.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, list]) => ({ label: dayLabel(k), qty: drinkCount(list), std: stdDrinks(list) }));

  const medals = ['🥇', '🥈', '🥉'];
  return [
    h('section', { class: 'card' },
      h('h2', null, 'Trip totals'),
      h('div', { class: 'stat-row' },
        tile('Drinks', qtyLabel(drinkCount(entries))),
        tile('Std drinks', num(stdDrinks(entries)))),
      h('p', { class: 'you-total' }, 'You: ', h('strong', null, drinksLabel(drinkCount(mine))), ` · ${num(stdDrinks(mine))} std`)),
    h('section', { class: 'card' },
      h('h2', null, 'Leaderboard'),
      h('ol', { class: 'board' }, board.map((r, i) => h('li', { class: r.uid === state.me.id ? 'me' : '' },
        h('span', { class: 'rank' }, medals[i] || `${i + 1}`),
        h('span', { class: 'b-name' }, r.name, r.uid === state.me.id ? ' (you)' : ''),
        h('span', { class: 'b-vals' },
          h('span', null, `${qtyLabel(r.drinks)} 🍺`),
          h('span', null, `${num(r.std)} std`)))))),
    h('section', { class: 'card' }, h('h2', null, 'By category'), bars(byCat)),
    h('section', { class: 'card' }, h('h2', null, 'By day'), bars(byDay)),
    h('p', { class: 'muted small' }, 'Std drink = 10 g alcohol (ml × ABV × 0.789), estimate only.'),
  ];
}

const tile = (label, value) => h('div', { class: 'stat' }, h('span', { class: 'stat-val' }, value), h('span', { class: 'stat-label' }, label));

function bars(rows) {
  const max = Math.max(1, ...rows.map((r) => r.qty));
  return h('ul', { class: 'bars' }, rows.map((r) => h('li', null,
    h('div', { class: 'bar-top' }, h('span', null, r.label), h('span', { class: 'muted' }, `${qtyLabel(r.qty)} · ${num(r.std)} std`)),
    h('div', { class: 'bar' }, h('span', { style: `width:${Math.max(2, (r.qty / max) * 100).toFixed(1)}%` })))));
}
