import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { WaiterRelay } from '../dist/waiter-relay.js';

const token = () => randomBytes(32).toString('base64url');
async function fixture(t) {
  const terminals = [token(), token()];
  let relay;
  const server = createServer((req, res) => {
    relay.handle(req, res, new URL(req.url, `http://${req.headers.host}`).pathname, req.method)
      .catch(e => { res.writeHead(e.status || 500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: e.code || e.message })); });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  relay = new WaiterRelay(key => {
    const i = terminals.indexOf(key);
    return i < 0 ? undefined : { storeId: 'shop', role: 'receive', receiveInstallationId: `terminal${i}` };
  }, origin, '<html></html>');
  t.after(async () => { relay.close(); await new Promise(r => server.close(r)); });
  const call = async (path, { body, auth, terminal, cash, challenge } = {}) => {
    const r = await fetch(origin + '/v1/waiter' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { origin, ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(auth ? { authorization: `Bearer ${auth}` } : {}),
        ...(terminal === undefined ? {} : { 'x-pos-installation': `terminal${terminal}` }),
        ...(cash === undefined ? {} : { 'x-pos-cash-session': cash }),
        ...(challenge ? { 'x-waiter-challenge': challenge } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: r.status, json: await r.json() };
  };
  const respond = (id, terminal, body) => call(`/terminal/requests/${id}/response`, { terminal, auth: terminals[terminal], body });
  const pair = async (result = {}, terminal = 0) => {
    const challenge = token(), sessionToken = token();
    assert.equal((await call('/invitations', { terminal, auth: terminals[terminal], body: { challengeId: challenge } })).status, 201);
    const queued = await call('/pair', { body: { tenantId: 'shop', terminalId: `terminal${terminal}`, challengeId: challenge, pin: '1234' } });
    assert.equal(queued.status, 202);
    assert.equal((await respond(queued.json.requestId, terminal, { result: { sessionToken, expiresAt: null, validUntil: 'CASH_CLOSE', cashSessionId: 'cash1', ...result } })).status, 200);
    const receipt = await call(`/pair/${queued.json.requestId}`, { challenge });
    return { sessionToken, receipt: receipt.json };
  };
  const rpc = (auth) => call('/rpc', { auth, body: { requestId: token(), method: 'waiter.getState', params: {} } });
  const poll = (terminal = 0, cash) => call('/terminal/requests', { terminal, auth: terminals[terminal], cash });
  return { call, pair, rpc, poll, respond };
}

test('cash-close session works after 13 hours; finite legacy session still expires at eight hours', async t => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const f = await fixture(t);
  const cash = await f.pair();
  const legacy = await f.pair({ expiresAt: new Date(now + 24 * 3600_000).toISOString(), validUntil: undefined, cashSessionId: undefined });
  now += 13 * 3600_000;
  assert.equal((await f.rpc(cash.sessionToken)).status, 202);
  assert.equal((await f.rpc(legacy.sessionToken)).status, 401);
});

test('authoritative cash closure is scoped to one terminal, and old or invalid headers cannot prune access', async t => {
  const f = await fixture(t);
  const first = await f.pair(), other = await f.pair({}, 1);
  assert.equal((await f.poll()).status, 200);
  assert.equal((await f.rpc(first.sessionToken)).status, 202);
  assert.equal((await f.poll(0, 'not an id')).status, 400);
  assert.equal((await f.rpc(first.sessionToken)).status, 202);
  await f.poll(0, 'cash1');
  assert.equal((await f.rpc(first.sessionToken)).status, 202);
  await f.poll(0, '');
  assert.equal((await f.rpc(first.sessionToken)).status, 401);
  assert.equal((await f.rpc(other.sessionToken)).status, 202);
  await f.poll(1, 'cash2');
  assert.equal((await f.rpc(other.sessionToken)).status, 401, 'a new shift cannot inherit the previous token');
});

test('ambiguous unbounded pairing never grants access; authoritative revoke invalidates a valid session', async t => {
  const f = await fixture(t);
  for (const result of [
    { validUntil: undefined }, { cashSessionId: undefined }, { cashSessionId: 'bad id' },
    { expiresAt: undefined }, { expiresAt: new Date().toISOString(), validUntil: 'CASH_CLOSE' },
  ]) {
    const paired = await f.pair(result);
    assert.equal(paired.receipt.error.code, 'pair_failed');
    assert.equal((await f.rpc(paired.sessionToken)).status, 401);
  }
  const valid = await f.pair();
  const queued = await f.rpc(valid.sessionToken);
  await f.respond(queued.json.requestId, 0, { error: { code: 'unauthorized' } });
  assert.equal((await f.rpc(valid.sessionToken)).status, 401);
});

test('cash state must confirm the same scope instead of silently downgrading expiry policy', async t => {
  const f = await fixture(t);
  const valid = await f.pair();
  const queued = await f.rpc(valid.sessionToken);
  await f.respond(queued.json.requestId, 0, { result: { expiresAt: null, validUntil: 'CASH_CLOSE', cashSessionId: 'other-cash' } });
  assert.equal((await f.rpc(valid.sessionToken)).status, 401);
});
