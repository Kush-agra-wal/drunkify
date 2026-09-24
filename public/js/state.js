export const VERSION = '1.3.0';

export const state = { me: null, trips: [], config: null };

const listeners = new Set();
export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function emit() {
  for (const fn of [...listeners]) fn();
}
export function clearListeners() {
  listeners.clear();
}

export const tripById = (id) => state.trips.find((t) => t.id === id) || null;

export const gramsAlcohol = (e) => (e.volume_ml && e.abv ? e.volume_ml * (e.abv / 100) * 0.789 * e.quantity : 0);
