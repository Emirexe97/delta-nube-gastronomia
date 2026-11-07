import test from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error Node test runner loads .ts directly
import { createWaiterRelay, waiterRelayConfig } from "./waiter-relay.ts";

const env = {
  GASTRONOMY_WEB_ORDERS_URL: "https://pedidos.example",
  GASTRONOMY_WEB_ORDERS_STORE_ID: "local",
  GASTRONOMY_WEB_ORDERS_TOKEN: "a".repeat(52),
};
const cfg = waiterRelayConfig(env, "terminal-a")!;

test("explicit mobile HTTPS ingress changes only QR origin, never terminal credentials destination", async () => {
  const transport = "http://127.0.0.1:8098";
  const settings = { ...env, GASTRONOMY_WEB_ORDERS_URL: transport, GASTRONOMY_WAITER_PUBLIC_URL: "https://192.168.18.69:8443" };
  const config = waiterRelayConfig(settings, "terminal-a")!;
  const challengeId = "q".repeat(43);
  const relay = createWaiterRelay({ config: () => config, process: async () => null, fetch: async (input) => {
    assert.equal(new URL(String(input)).origin, transport);
    return Response.json({ challengeId, inviteUrl: "https://attacker.example/", expiresAt: new Date(Date.now() + 120000).toISOString() });
  } });
  const qr = new URL((await relay.invite(challengeId)).url);
  assert.equal(qr.origin, "https://192.168.18.69:8443");
  assert.equal(qr.pathname, "/waiter");
  assert.equal(new URLSearchParams(qr.hash.slice(1)).get("challenge"), challengeId);
  assert.ok(!qr.href.includes(config.token));
  for (const invalid of ["http://192.168.1.2", "https://user:secret@example.test", "https://example.test/path", "https://example.test?token=secret"]) {
    assert.equal(waiterRelayConfig({ ...settings, GASTRONOMY_WAITER_PUBLIC_URL: invalid }, "terminal-a"), null);
  }
});

test("credentials only go to an explicitly configured TLS origin; QR uses a fragment, never the receive key or relay-provided host", async () => {
  for (const s of [
    "http://shop.example",
    "https://pass@shop.example",
    "https://shop.example/x",
    "https://shop.example?url=z",
  ]) {
    assert.equal(
      waiterRelayConfig({ ...env, GASTRONOMY_WEB_ORDERS_URL: s }, "terminal-a"),
      null,
    );
  }
  assert.equal(waiterRelayConfig(env), null);
  const challenge = "q".repeat(43),
    calls: string[] = [];
  const relay = createWaiterRelay({
    config: () => cfg,
    process: async () => null,
    fetch: async (input, init) => {
      calls.push(String(input));
      assert.equal(
        new Headers(init?.headers).get("x-pos-installation"),
        "terminal-a",
      );
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer " + env.GASTRONOMY_WEB_ORDERS_TOKEN,
      );
      return Response.json({
        challengeId: challenge,
        inviteUrl: "https://evil.example",
        expiresAt: new Date(Date.now() + 120000).toISOString(),
      });
    },
  });
  await relay.tick();
  assert.equal(calls.length, 0);
  const qr = await relay.invite(challenge);
  const u = new URL(qr.url);
  assert.equal(u.origin, cfg.origin);
  assert.equal(u.pathname, "/waiter");
  assert.equal(u.search, "");
  assert.equal(
    new URLSearchParams(u.hash.slice(1)).get("challenge"),
    challenge,
  );
  assert.ok(!qr.url.includes(cfg.token));
});
test("lost terminal ACK does not execute twice; obsolete requests and closed worker do not run", async () => {
  let n = 1_000_000,
    runs = 0,
    acks = 0,
    polls = 0;
  const req = {
    requestId: "test-request-01",
    kind: "rpc",
    method: "waiter.submitBatch",
    params: {},
    expiresAt: n + 60000,
  };
  const worker = createWaiterRelay({
    config: () => cfg,
    now: () => n,
    process: async () => ({ sequence: ++runs }),
    fetch: async (input, init) => {
      if (String(input).endsWith("/response")) {
        acks++;
        assert.equal(JSON.parse(String(init?.body)).result.sequence, 1);
        if (acks === 1) throw Error("dropped ACK");
        return Response.json({ ok: true });
      }
      polls++;
      return Response.json({
        requests: [
          { ...req, requestId: "already-expired", expiresAt: n - 1 },
          req,
        ],
      });
    },
  });
  worker.wake();
  await worker.tick();
  assert.equal(runs, 1);
  assert.ok(worker.connectionError());
  n += 5000;
  await worker.tick();
  assert.equal(runs, 1);
  assert.equal(acks, 2);
  assert.equal(worker.connectionError(), null);
  worker.reset();
  await worker.tick();
  assert.equal(polls, 2);
});

test("cash-aware worker serves long shifts and restarts, then reports closure without constant idle polling", async () => {
  let n = 1_000_000;
  let cash: string | null = "cash-shift-a";
  const headers: Array<string | null> = [];
  const worker = createWaiterRelay({
    config: () => cfg,
    cashSessionId: () => cash,
    now: () => n,
    process: async () => null,
    fetch: async (_input, init) => {
      headers.push(new Headers(init?.headers).get("x-pos-cash-session"));
      return Response.json({ requests: [] });
    },
  });
  // No QR/wake is needed after an ordinary PC restart with an open shift.
  await worker.tick();
  n += 13 * 60 * 60_000;
  await worker.tick();
  assert.deepEqual(headers, ["cash-shift-a", "cash-shift-a"]);
  cash = null;
  await worker.tick();
  assert.equal(headers.at(-1), "");
  n += 120_001;
  await worker.tick();
  assert.equal(headers.length, 3);
});
