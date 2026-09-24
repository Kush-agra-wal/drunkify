import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { Client, makeEntry, startServer } from './helpers.js';

describe('trips', () => {
  let srv;
  before(async () => {
    srv = await startServer();
  });
  after(async () => {
    await srv.stop();
  });

  async function setup() {
    const owner = new Client(srv.url);
    const member = new Client(srv.url);
    const outsider = new Client(srv.url);
    await owner.register();
    await member.register();
    await outsider.register();
    const trip = await owner.createTrip('Prague 2026');
    return { owner, member, outsider, trip };
  }

  test('create trip returns full trip object; creator is owner and member', async () => {
    const { owner, trip } = await setup();
    assert.deepEqual(Object.keys(trip).sort(), ['archived', 'created_at', 'id', 'invite_code', 'members', 'name', 'owner_id', 'updated_at']);
    assert.equal(trip.owner_id, owner.user.id);
    assert.equal(trip.archived, false);
    assert.match(trip.invite_code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
    assert.deepEqual(trip.members, [{ id: owner.user.id, display_name: owner.user.display_name, username: owner.user.username }]);
    const list = await owner.get('/api/trips');
    assert.equal(list.json.trips.length, 1);
    assert.equal(list.json.trips[0].id, trip.id);
  });

  test('create trip validation and idempotent client id', async () => {
    const c = new Client(srv.url);
    await c.register();
    assert.equal((await c.post('/api/trips', { name: '' })).status, 400);
    assert.equal((await c.post('/api/trips', { name: 'x'.repeat(61) })).status, 400);
    assert.equal((await c.post('/api/trips', { id: 'not-a-uuid', name: 'Ok' })).status, 400);
    const id = randomUUID();
    const first = await c.post('/api/trips', { id, name: 'Lisbon' });
    assert.equal(first.status, 201);
    assert.equal(first.json.trip.id, id);
    const retry = await c.post('/api/trips', { id, name: 'Lisbon' });
    assert.equal(retry.status, 200);
    assert.equal(retry.json.trip.invite_code, first.json.trip.invite_code);
    const other = new Client(srv.url);
    await other.register();
    assert.equal((await other.post('/api/trips', { id, name: 'Steal' })).status, 409);
  });

  test('trips listed newest first', async () => {
    const c = new Client(srv.url);
    await c.register();
    const a = await c.createTrip('A');
    await new Promise((r) => setTimeout(r, 5));
    const b = await c.createTrip('B');
    const list = (await c.get('/api/trips')).json.trips.map((t) => t.id);
    assert.deepEqual(list, [b.id, a.id]);
  });

  test('invite preview and join (case-insensitive, idempotent)', async () => {
    const { owner, member, trip } = await setup();
    const preview = await member.get(`/api/invite/${trip.invite_code.toLowerCase()}`);
    assert.equal(preview.status, 200);
    assert.deepEqual(preview.json, { trip: { id: trip.id, name: 'Prague 2026', member_count: 1 } });
    assert.equal((await new Client(srv.url).get(`/api/invite/${trip.invite_code}`)).status, 401);
    assert.equal((await member.get('/api/invite/ZZZZZZZZ')).status, 404);

    const joined = await member.join(` ${trip.invite_code.toLowerCase()} `);
    assert.equal(joined.members.length, 2);
    const again = await member.join(trip.invite_code);
    assert.equal(again.members.length, 2);
    assert.equal((await member.post('/api/trips/join', { invite_code: 'NOPE2345' })).status, 404);
    assert.equal((await member.get(`/api/trips/${trip.id}`)).status, 200);
    assert.equal((await owner.get(`/api/trips/${trip.id}`)).json.trip.members.length, 2);
  });

  test('non-members get 404; non-owners get 403', async () => {
    const { owner, member, outsider, trip } = await setup();
    await member.join(trip.invite_code);
    assert.equal((await outsider.get(`/api/trips/${trip.id}`)).status, 404);
    assert.equal((await outsider.patch(`/api/trips/${trip.id}`, { name: 'x' })).status, 404);
    assert.equal((await outsider.get(`/api/trips/${trip.id}/export.csv`)).status, 404);
    assert.equal((await member.patch(`/api/trips/${trip.id}`, { name: 'Hacked' })).status, 403);
    assert.equal((await member.del(`/api/trips/${trip.id}`)).status, 403);
    assert.equal((await member.post(`/api/trips/${trip.id}/invite/rotate`)).status, 403);
    assert.equal((await member.del(`/api/trips/${trip.id}/members/${owner.user.id}`)).status, 403);
    assert.equal((await owner.get(`/api/trips/${randomUUID()}`)).status, 404);
  });

  test('owner can patch name/archived', async () => {
    const { owner, trip } = await setup();
    const p = await owner.patch(`/api/trips/${trip.id}`, { name: 'Prague!', archived: true });
    assert.equal(p.status, 200);
    assert.equal(p.json.trip.name, 'Prague!');
    assert.equal(p.json.trip.archived, true);
    assert.ok(p.json.trip.updated_at >= trip.updated_at);
    assert.equal((await owner.patch(`/api/trips/${trip.id}`, { archived: 'yes' })).status, 400);
  });

  test('rotate invite code invalidates the old one', async () => {
    const { owner, member, trip } = await setup();
    const r = await owner.post(`/api/trips/${trip.id}/invite/rotate`);
    assert.equal(r.status, 200);
    assert.notEqual(r.json.trip.invite_code, trip.invite_code);
    assert.equal((await member.post('/api/trips/join', { invite_code: trip.invite_code })).status, 404);
    await member.join(r.json.trip.invite_code);
  });

  test('leave: member leaves; owner blocked while others remain; last owner leave deletes trip', async () => {
    const { owner, member, trip } = await setup();
    await member.join(trip.invite_code);
    const blocked = await owner.post(`/api/trips/${trip.id}/leave`);
    assert.equal(blocked.status, 400);
    assert.ok(blocked.json.error);
    assert.deepEqual((await member.post(`/api/trips/${trip.id}/leave`)).json, { ok: true });
    assert.equal((await member.get(`/api/trips/${trip.id}`)).status, 404);
    assert.equal((await member.post(`/api/trips/${trip.id}/leave`)).status, 404);
    assert.equal((await owner.get(`/api/trips/${trip.id}`)).json.trip.members.length, 1);
    assert.equal((await owner.post(`/api/trips/${trip.id}/leave`)).status, 200);
    assert.equal((await owner.get(`/api/trips/${trip.id}`)).status, 404);
    assert.equal((await owner.get(`/api/invite/${trip.invite_code}`)).status, 404);
  });

  test('owner removes a member', async () => {
    const { owner, member, outsider, trip } = await setup();
    await member.join(trip.invite_code);
    assert.equal((await owner.del(`/api/trips/${trip.id}/members/${owner.user.id}`)).status, 400);
    assert.equal((await owner.del(`/api/trips/${trip.id}/members/${outsider.user.id}`)).status, 404);
    const r = await owner.del(`/api/trips/${trip.id}/members/${member.user.id}`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.trip.members.map((m) => m.id), [owner.user.id]);
    assert.equal((await member.get(`/api/trips/${trip.id}`)).status, 404);
    const s = await member.sync({ trip_cursors: {}, changes: [makeEntry(trip.id)] });
    assert.deepEqual(s.json.rejected.map((x) => x.reason), ['not_member']);
    assert.notEqual(r.json.trip.invite_code, trip.invite_code, 'invite code rotated on removal');
    assert.equal((await member.post('/api/trips/join', { invite_code: trip.invite_code })).status, 404);
  });

  test('owner deletes trip with its entries', async () => {
    const { owner, member, trip } = await setup();
    await member.join(trip.invite_code);
    const s = await member.sync({ trip_cursors: {}, changes: [makeEntry(trip.id)] });
    assert.equal(s.json.applied.length, 1);
    assert.deepEqual((await owner.del(`/api/trips/${trip.id}`)).json, { ok: true });
    const after = await member.sync({ trip_cursors: { [trip.id]: 0 }, changes: [] });
    assert.deepEqual(after.json.trips, []);
    assert.deepEqual(after.json.entries, []);
    assert.deepEqual(after.json.trip_cursors, {});
  });

  test('CSV export of non-deleted entries with display names', async () => {
    const { owner, member, trip } = await setup();
    await member.patch('/api/me', { display_name: 'Member, "M"' });
    await member.join(trip.invite_code);
    const e1 = makeEntry(trip.id, { name: 'Kozel', quantity: 2, consumed_at: '2026-06-01T20:00:00.000Z', note: 'line1\nline2' });
    const e2 = makeEntry(trip.id, { name: 'Deleted one', deleted: true, consumed_at: '2026-06-01T21:00:00.000Z' });
    const e3 = makeEntry(trip.id, { category: 'soft', name: '=HYPERLINK("x")', volume_ml: null, abv: null, consumed_at: '2026-06-01T22:00:00.000Z' });
    await member.sync({ trip_cursors: {}, changes: [e1, e2] });
    await owner.sync({ trip_cursors: {}, changes: [e3] });
    const res = await owner.get(`/api/trips/${trip.id}/export.csv`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^text\/csv/);
    assert.match(res.headers.get('content-disposition'), /attachment; filename="Prague-2026-drinks\.csv"/);
    const text = res.text.replace(/^﻿/, '');
    const lines = text.trimEnd().split('\r\n');
    assert.equal(lines[0], 'consumed_at,member,username,category,name,volume_ml,abv,quantity,note');
    assert.equal(lines.length, 3);
    assert.ok(text.includes(`2026-06-01T20:00:00.000Z,"Member, ""M""",${member.user.username},beer,Kozel,500,4.4,2,"line1\nline2"`));
    assert.ok(!text.includes('Deleted one'));
    assert.ok(text.includes(`,soft,"'=HYPERLINK(""x"")",,,1,\r\n`));
  });
});
