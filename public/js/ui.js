import { fill, h } from './dom.js';
import { pill } from './sync.js';

export function layout(root, { title, back, action, body, tripId, active }) {
  const top = h('header', { class: 'topbar' },
    back ? h('a', { class: 'icon-btn', href: back, 'aria-label': 'Back' }, '‹') : h('span', { class: 'logo', 'aria-hidden': 'true' }, '🍻'),
    h('h1', { class: 'title' }, title),
    pill,
    action);
  const main = h('main', { class: `content${tripId ? ' with-nav' : ''}` }, body);
  fill(root, top, main, tripId && bottomNav(tripId, active));
  window.scrollTo(0, 0);
  return main;
}

function bottomNav(id, active) {
  const item = (key, href, icon, label) =>
    h('a', { href, class: `nav-item${active === key ? ' active' : ''}`, 'aria-current': active === key ? 'page' : null },
      h('span', { class: 'nav-icon', 'aria-hidden': 'true' }, icon), h('span', null, label));
  return h('nav', { class: 'bottom-nav', 'aria-label': 'Trip' },
    item('log', `#/trip/${id}`, '🍺', 'Log'),
    item('stats', `#/trip/${id}/stats`, '📊', 'Stats'),
    item('settings', `#/trip/${id}/settings`, '🧳', 'Trip'));
}

export function emptyState(icon, text, extra) {
  return h('div', { class: 'empty' }, h('div', { class: 'empty-icon', 'aria-hidden': 'true' }, icon), h('p', null, text), extra);
}

export function segmented(options, value, onPick, label) {
  const wrap = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label });
  for (const [v, text] of options) {
    wrap.append(h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(v === value), class: v === value ? 'on' : '',
      onclick: () => {
        for (const b of wrap.children) { b.classList.toggle('on', b.dataset.v === v); b.setAttribute('aria-checked', String(b.dataset.v === v)); }
        onPick(v);
      },
      dataset: { v },
    }, text));
  }
  return wrap;
}
