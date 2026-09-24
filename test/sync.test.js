import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { Client, makeEntry, startServer } from './helpers.js';

describe('sync', () => {
  let srv;
  before(async () => {
    srv = await startServer();
  });
  after(async () => {
    await srv.stop();
  });

  async function setup() {
    const alice = new Client(srv.url);
    const bob = new Client(srv.url);
    await alice.register();
    await bob.register();
    const trip = await alice.createTrip('Bangkok');
    await bob.join(trip.invite_code);
    return { alice, bob, trip };
  }

  test('insert returns applied, entry with server_seq, trips and cursors', async () => {
    const { alice, trip } = await setup();
    const e = makeEntry(trip.id, { user_id: 'spoofed-user' });
    const res = await alice.sync({ trip_cursors: {}, changes: [e] });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.applied, [e.id]);
    assert.deepEqual(res.json.rejected, []);
    assert.equal(res.json.more, false);
    assert.equal(res.json.entries.length, 1);
    const got = res.json.entries[0];
    assert.deepEqual(Object.keys(got).sort(), [
      'abv', 'category', 'consumed_at', 'deleted', 'id', 'name', 'note', 'quantity', 'server_seq', 'trip_id', 'updated_at', 'user_id', 'volume_ml',
    ]);
    assert.equal(got.user_id, alice.user.id, 'user_id forced to session user');
    assert.equal(got.deleted, false);
    assert.equal(got.name, e.name);
    assert.ok(Number.isInteger(got.server_seq) && got.server_seq > 0);
    assert.deepEqual(res.json.trip_cursors, { [trip.id]: got.server_seq });
    assert.deepEqual(res.json.trips.map((t) => t.id), [trip.id]);
    assert.equal(res.json.cursor, undefined);
  });

  test('idempotent retry and last-write-wins', async () => {
    const { alice, bob, trip } = await setup();
    const base = Date.now();
    const e = makeEntry(trip.id, { updated_at: base });
    const first = await alice.sync({ trip_cursors: {}, changes: [e] });
    const cursors = first.json.trip_cursors;
    const seq = first.json.entries[0].server_seq;

    const retry = await alice.sync({ trip_cursors: cursors, changes: [e] });
    assert.deepEqual(retry.json.applied, [e.id]);
    assert.deepEqual(retry.json.entries, [], 'no new server_seq on retry');
    assert.deepEqual(retry.json.trip_cursors, cursors);

    const older = await alice.sync({ trip_cursors: cursors, changes: [{ ...e, name: 'Older edit', updated_at: base - 1000 }] });
    assert.deepEqual(older.json.applied, [e.id]);
    assert.deepEqual(older.json.entries, []);

    const newer = await alice.sync({ trip_cursors: cursors, changes: [{ ...e, name: 'Chang', quantity: 2, updated_at: base + 1000 }] });
    assert.deepEqual(newer.json.applied, [e.id]);
    assert.equal(newer.json.entries.length, 1);
    assert.equal(newer.json.entries[0].name, 'Chang');
    assert.equal(newer.json.entries[0].quantity, 2);
    assert.ok(newer.json.entries[0].server_seq > seq);

    const view = await bob.sync({ trip_cursors: {}, changes: [] });
    assert.equal(view.json.entries.length, 1);
    assert.equal(view.json.entries[0].name, 'Chang');
  });

  test('editing or deleting another user entry is forbidden', async () => {
    const { alice, bob, trip } = await setup();
    const e = makeEntry(trip.id);
    await alice.sync({ trip_cursors: {}, changes: [e] });
    const hijack = await bob.sync({ trip_cursors: {}, changes: [{ ...e, name: 'Mine now', updated_at: e.updated_at + 5000 }] });
    assert.deepEqual(hijack.json.applied, []);
    assert.deepEqual(hijack.json.rejected, [{ id: e.id, reason: 'forbidden' }]);
    const del = await bob.sync({ trip_cursors: {}, changes: [{ ...e, deleted: true, updated_at: e.updated_at + 6000 }] });
    assert.deepEqual(del.json.rejected, [{ id: e.id, reason: 'forbidden' }]);
    assert.equal(hijack.json.entries[0].name, e.name);
    assert.equal(hijack.json.entries[0].user_id, alice.user.id);
  });

  test('non-member changes rejected and non-member trips not returned', async () => {
    const { alice, trip } = await setup();
    await alice.sync({ trip_cursors: {}, changes: [makeEntry(trip.id)] });
    const eve = new Client(srv.url);
    await eve.register();
    const res = await eve.sync({ trip_cursors: { [trip.id]: 0 }, changes: [makeEntry(trip.id), makeEntry(randomUUID())] });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.rejected.map((r) => r.reason), ['not_member', 'not_member']);
    assert.deepEqual(res.json.entries, []);
    assert.deepEqual(res.json.trips, []);
    assert.deepEqual(res.json.trip_cursors, {});
  });

  test('moving an entry to another trip is rejected', async () => {
    const { alice, trip } = await setup();
    const other = await alice.createTrip('Other');
    const e = makeEntry(trip.id);
    await alice.sync({ trip_cursors: {}, changes: [e] });
    const res = await alice.sync({ trip_cursors: {}, changes: [{ ...e, trip_id: other.id, updated_at: e.updated_at + 1 }] });
    assert.deepEqual(res.json.rejected, [{ id: e.id, reason: 'trip_mismatch' }]);
  });

  test('validation rejects bad fields but applies the valid ones', async () => {
    const { alice, trip } = await setup();
    const good = makeEntry(trip.id, { volume_ml: null, abv: null, note: null, quantity: 0.5 });
    const cases = [
      [{ id: 'nope' }, 'invalid_id'],
      [{ category: 'kombucha' }, 'invalid_category'],
      [{ name: '' }, 'invalid_name'],
      [{ name: '   ' }, 'invalid_name'],
      [{ name: 'x'.repeat(61) }, 'invalid_name'],
      [{ quantity: 0 }, 'invalid_quantity'],
      [{ quantity: 101 }, 'invalid_quantity'],
      [{ quantity: '1' }, 'invalid_quantity'],
      [{ volume_ml: 0 }, 'invalid_volume_ml'],
      [{ volume_ml: 5001 }, 'invalid_volume_ml'],
      [{ abv: -1 }, 'invalid_abv'],
      [{ abv: 101 }, 'invalid_abv'],
      [{ category: 'water' }, 'invalid_category'],
      [{ consumed_at: 'yesterday' }, 'invalid_consumed_at'],
      [{ consumed_at: '2026-13-45T99:00' }, 'invalid_consumed_at'],
      [{ consumed_at: '2026-02-30T10:00:00Z' }, 'invalid_consumed_at'],
      [{ consumed_at: '2026-06-01T21:30' }, 'invalid_consumed_at'],
      [{ note: 'n'.repeat(281) }, 'invalid_note'],
      [{ updated_at: 1.5 }, 'invalid_updated_at'],
      [{ updated_at: '123' }, 'invalid_updated_at'],
    ];
    const changes = [good, ...cases.map(([o]) => makeEntry(trip.id, o)), 'garbage'];
    const res = await alice.sync({ trip_cursors: {}, changes });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.applied, [good.id]);
    assert.deepEqual(
      res.json.rejected.map((r) => r.reason),
      [...cases.map(([, reason]) => reason), 'invalid_entry'],
    );
    assert.equal(res.json.rejected[1].id, changes[2].id);
    const stored = res.json.entries.find((x) => x.id === good.id);
    assert.equal(stored.quantity, 0.5);
    assert.equal(stored.volume_ml, null);
    assert.equal(stored.note, '');

    for (const ts of ['2026-06-01T21:30+02:00', '2024-02-29T10:00:00.000Z', '2026-06-01']) {
      const ok = await alice.sync({ trip_cursors: {}, changes: [makeEntry(trip.id, { consumed_at: ts })] });
      assert.equal(ok.json.applied.length, 1, ts);
    }
    for (const cat of ['beer', 'wine', 'cocktail', 'spirit', 'shot', 'cider', 'seltzer', 'soft', 'other']) {
      const r = await alice.sync({ trip_cursors: {}, changes: [makeEntry(trip.id, { category: cat })] });
      assert.equal(r.json.applied.length, 1, cat);
    }
  });

  test('legacy unit_price/currency fields are ignored, not stored or returned', async () => {
    const { alice, bob, trip } = await setup();
    const valid = makeEntry(trip.id, { unit_price: 65, currency: 'CZK' });
    const junk = makeEntry(trip.id, { unit_price: 'free', currency: 'not-a-code' });
    const res = await alice.sync({ trip_cursors: {}, changes: [valid, junk] });
    assert.deepEqual(res.json.applied, [valid.id, junk.id]);
    assert.deepEqual(res.json.rejected, []);
    const seen = (await bob.sync({ trip_cursors: {} })).json.entries;
    assert.equal(seen.length, 2);
    for (const e of [...res.json.entries, ...seen]) assert.ok(!('unit_price' in e) && !('currency' in e));
  });

  test('request-level validation', async () => {
    const { alice, trip } = await setup();
    assert.equal((await alice.sync({ trip_cursors: {}, changes: 'x' })).status, 400);
    assert.equal((await alice.sync({ trip_cursors: [], changes: [] })).status, 400);
    const tooMany = Array.from({ length: 501 }, () => makeEntry(trip.id));
    assert.equal((await alice.sync({ trip_cursors: {}, changes: tooMany })).status, 400);
    const noChanges = await alice.sync({ trip_cursors: { [trip.id]: 'bad' } });
    assert.equal(noChanges.status, 200);
  });

  test('tombstones propagate to other members', async () => {
    const { alice, bob, trip } = await setup();
    const e = makeEntry(trip.id);
    await alice.sync({ trip_cursors: {}, changes: [e] });
    const bobFirst = await bob.sync({ trip_cursors: {}, changes: [] });
    assert.equal(bobFirst.json.entries.length, 1);
    await alice.sync({ trip_cursors: {}, changes: [{ ...e, deleted: true, updated_at: e.updated_at + 10 }] });
    const bobNext = await bob.sync({ trip_cursors: bobFirst.json.trip_cursors, changes: [] });
    assert.equal(bobNext.json.entries.length, 1);
    assert.equal(bobNext.json.entries[0].id, e.id);
    assert.equal(bobNext.json.entries[0].deleted, true);
    const undelete = await alice.sync({ trip_cursors: {}, changes: [{ ...e, deleted: false, updated_at: e.updated_at + 5 }] });
    assert.equal(undelete.json.entries.find((x) => x.id === e.id).deleted, true, 'older undelete ignored');
  });

  test('new member receives full trip history via trip_cursors', async () => {
    const { alice, bob, trip } = await setup();
    const own = await alice.createTrip('Old trip');
    const entries = Array.from({ length: 5 }, () => makeEntry(trip.id));
    await alice.sync({ trip_cursors: {}, changes: entries });
    await bob.sync({ trip_cursors: {}, changes: [makeEntry(trip.id)] });

    const carol = new Client(srv.url);
    await carol.register();
    const ownTrip = await carol.createTrip('Carol solo');
    await carol.sync({ trip_cursors: {}, changes: [makeEntry(ownTrip.id)] });
    await alice.sync({ trip_cursors: {}, changes: [makeEntry(own.id)] });
    const s1 = await carol.sync({ trip_cursors: {}, changes: [] });
    const cursorsBefore = s1.json.trip_cursors;
    assert.deepEqual(Object.keys(cursorsBefore), [ownTrip.id]);

    await carol.join(trip.invite_code);
    const s2 = await carol.sync({ trip_cursors: cursorsBefore, changes: [] });
    assert.equal(s2.json.entries.length, 6, 'all prior entries of the newly joined trip');
    assert.ok(s2.json.entries.every((x) => x.trip_id === trip.id));
    assert.equal(s2.json.trip_cursors[ownTrip.id], cursorsBefore[ownTrip.id]);
    assert.equal(s2.json.trip_cursors[trip.id], Math.max(...s2.json.entries.map((x) => x.server_seq)));
    const seqs = s2.json.entries.map((x) => x.server_seq);
    assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b), 'ordered by server_seq');
    assert.ok(!s2.json.entries.some((x) => x.trip_id === own.id), 'no entries from trips carol is not in');

    await alice.del(`/api/trips/${trip.id}/members/${carol.user.id}`);
    const s3 = await carol.sync({ trip_cursors: s2.json.trip_cursors, changes: [] });
    assert.deepEqual(s3.json.trips.map((t) => t.id), [ownTrip.id]);
    assert.deepEqual(Object.keys(s3.json.trip_cursors), [ownTrip.id]);
  });

  test('legacy single cursor mode still works', async () => {
    const { alice, trip } = await setup();
    const e = makeEntry(trip.id);
    const r1 = await alice.sync({ cursor: 0, changes: [e] });
    assert.equal(r1.json.entries.length, 1);
    assert.equal(r1.json.cursor, r1.json.entries[0].server_seq);
    const r2 = await alice.sync({ cursor: r1.json.cursor, changes: [] });
    assert.deepEqual(r2.json.entries, []);
    assert.equal(r2.json.cursor, r1.json.cursor);
  });

  test('paging: more:true until all entries are fetched', async () => {
    const { alice, bob, trip } = await setup();
    const total = 2600;
    const all = Array.from({ length: total }, (_, i) => makeEntry(trip.id, { name: `Drink ${i}` }));
    for (let i = 0; i < total; i += 500) {
      const r = await alice.sync({ trip_cursors: { [trip.id]: 1e12 }, changes: all.slice(i, i + 500) });
      assert.equal(r.json.applied.length, Math.min(500, total - i));
    }
    const p1 = await bob.sync({ trip_cursors: {}, changes: [] });
    assert.equal(p1.json.entries.length, 2000);
    assert.equal(p1.json.more, true);
    const p2 = await bob.sync({ trip_cursors: p1.json.trip_cursors, changes: [] });
    assert.equal(p2.json.entries.length, total - 2000);
    assert.equal(p2.json.more, false);
    const ids = new Set([...p1.json.entries, ...p2.json.entries].map((x) => x.id));
    assert.equal(ids.size, total);
    const p3 = await bob.sync({ trip_cursors: p2.json.trip_cursors, changes: [] });
    assert.deepEqual(p3.json.entries, []);
    assert.equal(p3.json.more, false);
  });
});
