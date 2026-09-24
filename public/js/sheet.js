import { CATEGORY, findType } from '../catalog.js';
import { field, fill, h, haptic, num, openSheet, parseNum, qtyLabel, toast, toLocalInput, uuid } from './dom.js';
import { gramsAlcohol, state } from './state.js';
import { kvGet, kvSet } from './store.js';
import { writeEntry } from './sync.js';

const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const tplKey = (t) => `${t.category}|${t.name.toLowerCase()}|${t.volume_ml ?? ''}`;

export const toTemplate = (e) => ({
  category: e.category, name: e.name, volume_ml: e.volume_ml, abv: e.abv,
});

export async function getPrefs() {
  const [recents, favorites, custom] = await Promise.all([kvGet('recents'), kvGet('favorites'), kvGet('custom_names')]);
  return { recents: recents || [], favorites: favorites || [], custom: custom || {} };
}

export async function isFavorite(t) {
  const { favorites } = await getPrefs();
  return favorites.some((f) => tplKey(f) === tplKey(t));
}

export async function toggleFavorite(t) {
  const { favorites } = await getPrefs();
  const k = tplKey(t);
  const has = favorites.some((f) => tplKey(f) === k);
  const next = has ? favorites.filter((f) => tplKey(f) !== k) : [toTemplate(t), ...favorites].slice(0, 20);
  await kvSet('favorites', next);
  return !has;
}

async function remember(e) {
  const { recents, custom } = await getPrefs();
  const t = toTemplate(e);
  const k = tplKey(t);
  await kvSet('recents', [t, ...recents.filter((r) => tplKey(r) !== k)].slice(0, 12));
  if (!findType(e.category, e.name)) {
    const list = custom[e.category] || [];
    custom[e.category] = [e.name, ...list.filter((n) => n.toLowerCase() !== e.name.toLowerCase())].slice(0, 10);
    await kvSet('custom_names', custom);
  }
}

function bump(prev) {
  return Math.max(Date.now(), (prev?.updated_at || 0) + 1);
}

export async function logEntry(trip, data) {
  const e = {
    id: uuid(), trip_id: trip.id, user_id: state.me.id, category: data.category, name: data.name,
    volume_ml: data.volume_ml ?? null, abv: data.abv ?? null, quantity: data.quantity ?? 1,
    consumed_at: data.consumed_at || new Date().toISOString(), note: data.note || '', updated_at: Date.now(), deleted: false,
  };
  await writeEntry(e);
  await remember(e);
  haptic();
  toast(`Logged ${qtyLabel(e.quantity)} × ${e.name}`, {
    action: 'Undo',
    onAction: () => writeEntry({ ...e, deleted: true, updated_at: bump(e) }),
  });
  return e;
}

let sheetActive = false;
export async function openLogSheet(trip, opts = {}) {
  if (sheetActive) return;
  sheetActive = true;
  try {
    await buildLogSheet(trip, opts, () => { sheetActive = false; });
  } catch (e) {
    sheetActive = false;
    throw e;
  }
}

async function buildLogSheet(trip, { category, entry }, onClose) {
  const editing = !!entry;
  const cat = CATEGORY[entry?.category || category] || CATEGORY.other;
  const prefs = await getPrefs();
  const lastSame = prefs.recents.find((r) => r.category === cat.key);
  const custom = prefs.custom[cat.key] || [];

  const init = entry || {
    name: lastSame?.name || cat.types[0][0],
    volume_ml: lastSame?.volume_ml ?? findType(cat.key, lastSame?.name || cat.types[0][0])?.ml ?? cat.ml,
    abv: lastSame?.abv ?? findType(cat.key, lastSame?.name || cat.types[0][0])?.abv ?? cat.abv,
    quantity: 1,
    consumed_at: new Date().toISOString(),
    note: '',
  };

  const yours = [...new Set([init.name, ...custom].filter((n) => n && !cat.types.some((t) => t[0].toLowerCase() === n.toLowerCase())))];
  const popular = cat.types.map((t) => t[0]);
  const options = [...yours, ...popular];
  // Editing keeps the entry's exact spelling; a new log snaps to the matching option ignoring case.
  if (!editing && init.name) init.name = options.find((n) => n.toLowerCase() === init.name.toLowerCase()) ?? init.name;

  const listId = `type-list-${uuid()}`;
  const nameInput = h('input', {
    type: 'search', id: 'f-type', role: 'combobox', value: init.name, maxlength: '60', autocomplete: 'off', enterkeyhint: 'done',
    placeholder: 'Search or type a drink', 'aria-label': 'Type', 'aria-autocomplete': 'list', 'aria-controls': listId, 'aria-expanded': 'false',
  });
  const list = h('ul', { id: listId, class: 'type-list', role: 'listbox', hidden: true });
  let shown = [];
  let active = -1;
  let applied = init.name;

  function rank(n, q) {
    const s = norm(n);
    if (s.startsWith(q)) return 0;
    if (s.includes(` ${q}`)) return 1;
    return s.includes(q) ? 2 : -1;
  }

  function renderList() {
    const q = norm(nameInput.value);
    const exact = options.some((n) => norm(n) === q);
    const pick = (arr) => (!q || exact ? arr : arr.map((n) => [n, rank(n, q)]).filter(([, r]) => r >= 0).sort((a, b) => a[1] - b[1]).map(([n]) => n));
    const groups = [['Your drinks', pick(yours)], ['Popular', pick(popular)]].filter(([, arr]) => arr.length);
    const typed = nameInput.value.trim();
    shown = groups.flatMap(([, arr]) => arr);
    if (typed && !exact) shown.push(typed);
    active = Math.min(active, shown.length - 1);
    let i = 0;
    const row = (n, label) => {
      const idx = i++;
      return h('li', {
        role: 'option', id: `${listId}-${idx}`, class: idx === active ? 'on' : null, 'aria-selected': String(idx === active),
        onpointerdown: (ev) => ev.preventDefault(), onclick: () => choose(n),
      }, label ?? n);
    };
    fill(list,
      groups.map(([title, arr]) => [h('li', { class: 'type-group', role: 'presentation' }, title), arr.map((n) => row(n))]),
      typed && !exact && row(typed, `＋ Use “${typed}”`),
      !shown.length && h('li', { class: 'type-empty', role: 'presentation' }, 'Type a name to add your own'));
    nameInput.setAttribute('aria-activedescendant', active >= 0 ? `${listId}-${active}` : '');
    list.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  }

  function openList() {
    list.hidden = false;
    nameInput.setAttribute('aria-expanded', 'true');
    renderList();
  }

  function closeList() {
    list.hidden = true;
    active = -1;
    nameInput.setAttribute('aria-expanded', 'false');
  }

  function applyDefaults(n) {
    if (n === applied) return;
    applied = n;
    const t = findType(cat.key, n);
    if (!t) return;
    abvInput.value = t.abv;
    if (t.ml) mlInput.value = t.ml;
    sync();
  }

  function choose(n) {
    nameInput.value = n;
    applyDefaults(currentName());
    closeList();
    nameInput.blur();
  }

  nameInput.addEventListener('focus', () => {
    openList();
    nameInput.select();
    setTimeout(() => nameInput.scrollIntoView({ block: 'start', behavior: 'smooth' }), 250);
  });
  nameInput.addEventListener('input', () => { active = nameInput.value.trim() ? 0 : -1; openList(); });
  nameInput.addEventListener('blur', () => { closeList(); applyDefaults(currentName()); });
  nameInput.addEventListener('keydown', (ev) => {
    if (list.hidden) return;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      active = (active + (ev.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length;
      renderList();
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      choose(shown[active] ?? nameInput.value.trim());
    } else if (ev.key === 'Escape') {
      ev.stopPropagation();
      closeList();
    }
  });

  const mlInput = h('input', { type: 'number', inputmode: 'numeric', min: '1', max: '5000', step: 'any', value: init.volume_ml ?? '', 'aria-label': 'Custom size in ml', placeholder: 'ml' });
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Size' },
    cat.sizes.map(([ml, label]) => h('button', { type: 'button', class: 'chip', dataset: { ml }, onclick: () => { mlInput.value = ml; sync(); } }, label)));

  const abvInput = h('input', { type: 'number', inputmode: 'decimal', min: '0', max: '100', step: '0.1', value: init.abv ?? '', 'aria-label': 'ABV percent' });
  let qty = init.quantity;
  const qtyOut = h('output', { class: 'qty-val', 'aria-live': 'polite' });
  const minus = h('button', { type: 'button', class: 'step', 'aria-label': 'Decrease quantity', onclick: () => { qty = qty > 1 ? qty - 1 : 0.5; sync(); } }, '−');
  const plus = h('button', { type: 'button', class: 'step', 'aria-label': 'Increase quantity', onclick: () => { qty = qty < 1 ? 1 : Math.min(100, qty + 1); sync(); } }, '+');
  const half = h('button', { type: 'button', class: 'step half', 'aria-label': 'Toggle half', onclick: () => { qty = qty % 1 ? qty - 0.5 : Math.min(100, qty + 0.5); if (qty <= 0) qty = 0.5; sync(); } }, '½');

  const stdOut = h('div', { class: 'calc muted', 'aria-live': 'polite' });
  const timeInput = h('input', { type: 'datetime-local', value: toLocalInput(new Date(init.consumed_at)), 'aria-label': 'Time' });
  const noteInput = h('textarea', { maxlength: '280', rows: '2', placeholder: 'Optional note', 'aria-label': 'Note' });
  noteInput.value = init.note || '';
  const errOut = h('p', { class: 'form-error', role: 'alert' });

  function currentName() {
    const typed = nameInput.value.trim();
    return options.find((n) => n.toLowerCase() === typed.toLowerCase()) ?? typed;
  }

  function sync() {
    const ml = parseNum(mlInput.value);
    for (const c of chips.children) c.classList.toggle('on', Number(c.dataset.ml) === ml);
    qtyOut.textContent = qtyLabel(qty);
    minus.disabled = qty <= 0.5;
    const g = gramsAlcohol({ volume_ml: ml, abv: parseNum(abvInput.value), quantity: qty });
    fill(stdOut, g ? `≈ ${num(g / 10)} std drinks` : null);
  }

  for (const el of [mlInput, abvInput]) el.addEventListener('input', sync);

  const formId = `log-form-${uuid()}`;
  const save = h('button', { type: 'submit', class: 'btn primary block', form: formId }, editing ? 'Save changes' : 'Log drink');
  const del = editing && h('button', {
    type: 'button', class: 'btn danger',
    onclick: async () => {
      const tomb = { ...entry, deleted: true, updated_at: bump(entry) };
      await writeEntry(tomb);
      close();
      toast(`Deleted ${entry.name}`, { action: 'Undo', onAction: () => writeEntry({ ...entry, deleted: false, updated_at: bump(tomb) }) });
    },
  }, 'Delete');

  const form = h('form', { id: formId, class: 'log-form', novalidate: true, onsubmit: onSubmit },
    h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'f-type' }, 'Type'), nameInput, list),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Size'), chips,
      h('div', { class: 'row' }, h('label', { class: 'inline' }, mlInput, h('span', null, 'ml')),
        h('label', { class: 'inline' }, abvInput, h('span', null, '% ABV')))),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Quantity'),
      h('div', { class: 'stepper' }, minus, qtyOut, plus, half)),
    stdOut,
    field('Time', timeInput),
    field('Note', noteInput),
    errOut);

  const close = openSheet(`${cat.emoji} ${editing ? 'Edit' : cat.label}`, form, { footer: [del, save], onClose });
  sync();

  async function onSubmit(ev) {
    ev.preventDefault();
    const name = currentName();
    const ml = parseNum(mlInput.value);
    const abv = parseNum(abvInput.value);
    const t = timeInput.value ? new Date(timeInput.value) : new Date();
    const err = !name ? 'Enter a drink name'
      : name.length > 60 ? 'Name is too long (max 60)'
        : Number.isNaN(ml) || (ml != null && (ml <= 0 || ml > 5000)) ? 'Size must be between 1 and 5000 ml'
          : Number.isNaN(abv) || (abv != null && (abv < 0 || abv > 100)) ? 'ABV must be 0–100'
            : Number.isNaN(t.getTime()) ? 'Invalid time' : '';
    if (err) { errOut.textContent = err; return; }
    const data = {
      category: cat.key, name, volume_ml: ml, abv, quantity: qty,
      consumed_at: t.toISOString(), note: noteInput.value.trim().slice(0, 280),
    };
    close();
    if (editing) {
      const prev = entry;
      const next = { ...entry, ...data, updated_at: bump(entry) };
      await writeEntry(next);
      await remember(next);
      haptic();
      toast('Saved', { action: 'Undo', onAction: () => writeEntry({ ...prev, updated_at: bump(next) }) });
    } else {
      await logEntry(trip, data);
    }
  }
}
