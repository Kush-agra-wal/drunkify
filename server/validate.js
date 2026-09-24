import { CATEGORY_SET } from './categories.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-](\d{2}):?(\d{2})))?$/;

export const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export const isUsername = (v) => typeof v === 'string' && USERNAME_RE.test(v);
export const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);
export const isPassword = (v) => typeof v === 'string' && v.length >= 6 && v.length <= 1024;

// Date-only, or date-time with a timezone designator; calendar fields must be real (no Feb 30 rollover).
export function isIsoDate(v) {
  if (typeof v !== 'string' || v.length > 40) return false;
  const m = ISO_DATE_RE.exec(v);
  if (!m || Number.isNaN(Date.parse(v))) return false;
  const [y, mo, d, hh = 0, mi = 0, ss = 0, oh = 0, om = 0] = m.slice(1).map((x) => Number(x ?? 0));
  const day = new Date(Date.UTC(y, mo - 1, d));
  if (day.getUTCFullYear() !== y || day.getUTCMonth() !== mo - 1 || day.getUTCDate() !== d) return false;
  return hh <= 23 && mi <= 59 && ss <= 59 && oh <= 23 && om <= 59;
}

export function trimmedString(v, min, max) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s.length >= min && s.length <= max ? s : null;
}

export function requireBody(body) {
  if (!isObject(body)) throw new HttpError(400, 'Expected a JSON object body');
  return body;
}

export function displayName(v) {
  const s = trimmedString(v, 1, 40);
  if (s === null) throw new HttpError(400, 'Display name must be 1–40 characters');
  return s;
}

export function tripName(v) {
  const s = trimmedString(v, 1, 60);
  if (s === null) throw new HttpError(400, 'Trip name must be 1–60 characters');
  return s;
}

function optionalNumber(v, check) {
  if (v === null || v === undefined) return { ok: true, value: null };
  if (typeof v !== 'number' || !Number.isFinite(v) || !check(v)) return { ok: false };
  return { ok: true, value: v };
}

export function validateEntry(c) {
  if (!isObject(c)) return { reason: 'invalid_entry' };
  if (!isUuid(c.id)) return { reason: 'invalid_id' };
  if (typeof c.trip_id !== 'string' || c.trip_id.length === 0 || c.trip_id.length > 64) return { reason: 'invalid_trip_id' };
  if (!CATEGORY_SET.has(c.category)) return { reason: 'invalid_category' };
  const name = trimmedString(c.name, 1, 60);
  if (name === null) return { reason: 'invalid_name' };
  if (typeof c.quantity !== 'number' || !Number.isFinite(c.quantity) || c.quantity <= 0 || c.quantity > 100) return { reason: 'invalid_quantity' };
  const volume = optionalNumber(c.volume_ml, (v) => v > 0 && v <= 5000);
  if (!volume.ok) return { reason: 'invalid_volume_ml' };
  const abv = optionalNumber(c.abv, (v) => v >= 0 && v <= 100);
  if (!abv.ok) return { reason: 'invalid_abv' };
  if (!isIsoDate(c.consumed_at)) return { reason: 'invalid_consumed_at' };
  const note = c.note === null || c.note === undefined ? '' : c.note;
  if (typeof note !== 'string' || note.length > 280) return { reason: 'invalid_note' };
  if (!Number.isSafeInteger(c.updated_at) || c.updated_at < 0) return { reason: 'invalid_updated_at' };
  const deleted = c.deleted === undefined ? false : c.deleted;
  if (typeof deleted !== 'boolean' && deleted !== 0 && deleted !== 1) return { reason: 'invalid_deleted' };
  return {
    entry: {
      id: c.id,
      trip_id: c.trip_id,
      category: c.category,
      name,
      volume_ml: volume.value,
      abv: abv.value,
      quantity: c.quantity,
      consumed_at: c.consumed_at,
      note,
      updated_at: c.updated_at,
      deleted: deleted ? 1 : 0,
    },
  };
}
