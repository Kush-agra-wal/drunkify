const PROPS = new Set(['value', 'checked', 'selected', 'disabled', 'hidden', 'textContent', 'required', 'readOnly', 'open', 'multiple']);

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (PROPS.has(k)) el[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, kids);
  return el;
}

function append(el, kids) {
  for (const k of kids) {
    if (k == null || k === false) continue;
    if (Array.isArray(k)) append(el, k);
    else el.append(k instanceof Node ? k : String(k));
  }
}

export function fill(el, ...kids) {
  el.replaceChildren();
  append(el, kids);
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 15) | 64;
  b[8] = (b[8] & 63) | 128;
  const x = [...b].map((n) => n.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

export function toast(msg, { action, onAction, ms = 4500, kind } = {}) {
  const root = document.getElementById('toasts');
  let timer;
  const close = () => {
    clearTimeout(timer);
    t.classList.add('out');
    setTimeout(() => t.remove(), 200);
  };
  const t = h('div', { class: `toast${kind ? ` ${kind}` : ''}`, role: kind === 'error' ? 'alert' : 'status' },
    h('span', { class: 'toast-msg' }, msg),
    action && h('button', { type: 'button', class: 'toast-btn', onclick: () => { close(); onAction?.(); } }, action),
    h('button', { type: 'button', class: 'toast-x', 'aria-label': 'Dismiss', onclick: close }, '×'));
  root.append(t);
  while (root.children.length > 3) root.firstElementChild.remove();
  if (ms) timer = setTimeout(close, ms);
  return close;
}

export function openSheet(title, body, { footer, onClose } = {}) {
  const prevFocus = document.activeElement;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    wrap.classList.add('out');
    document.body.classList.remove('sheet-open');
    setTimeout(() => wrap.remove(), 180);
    onClose?.();
    prevFocus?.focus?.({ preventScroll: true });
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const panel = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabindex: '-1' },
    h('div', { class: 'sheet-head' },
      h('h2', null, title),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onclick: close }, '✕')),
    h('div', { class: 'sheet-body' }, body),
    footer && h('div', { class: 'sheet-foot' }, footer));
  const wrap = h('div', { class: 'sheet-wrap' },
    h('div', { class: 'sheet-backdrop', onclick: close }), panel);
  document.body.append(wrap);
  document.body.classList.add('sheet-open');
  document.addEventListener('keydown', onKey);
  panel.focus({ preventScroll: true });
  return close;
}

export const num = (n, d = 1) => (Math.round(n * 10 ** d) / 10 ** d).toLocaleString(undefined, { maximumFractionDigits: d });

export function qtyLabel(q) {
  const w = Math.floor(q);
  const f = q - w;
  if (Math.abs(f - 0.5) < 1e-9) return w ? `${w}½` : '½';
  return num(q, 2);
}

export const drinksLabel = (q) => `${qtyLabel(q)} ${q === 1 ? 'drink' : 'drinks'}`;

export function parseNum(v) {
  if (v == null) return null;
  const s = String(v).trim().replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

const pad = (n) => String(n).padStart(2, '0');
export function dayKey(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function dayLabel(key) {
  const today = dayKey(new Date());
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (key === today) return 'Today';
  if (key === dayKey(y)) return 'Yesterday';
  const [yy, mm, dd] = key.split('-').map(Number);
  return new Date(yy, mm - 1, dd).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

export const timeLabel = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

export function toLocalInput(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function haptic() {
  try { navigator.vibrate?.(10); } catch { /* unsupported */ }
}

export function lsGet(k, def = null) {
  try { return localStorage.getItem(k) ?? def; } catch { return def; }
}

export function lsSet(k, v) {
  try { localStorage.setItem(k, v); } catch { /* storage blocked */ }
}

export function field(label, input, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input, hint && h('span', { class: 'hint' }, hint));
}

export function busy(btn, p) {
  btn.disabled = true;
  btn.classList.add('loading');
  return Promise.resolve(p).finally(() => { btn.disabled = false; btn.classList.remove('loading'); });
}
