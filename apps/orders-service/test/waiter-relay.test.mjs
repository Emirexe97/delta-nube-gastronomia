import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { request } from "node:http";
import { createOrdersServer } from "../dist/server.js";

const token = () => randomBytes(32).toString("base64url");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const call = (
  port,
  path,
  { method = "GET", body, auth, origin, terminal, challenge, cashSession, cookie } = {},
) =>
  new Promise((resolveCall, reject) => {
    const data =
      body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path,
        method,
        headers: {
          connection: "close",
          host: `127.0.0.1:${port}`,
          ...(data
            ? {
                "content-type": "application/json",
                "content-length": data.length,
              }
            : {}),
          ...(auth ? { authorization: `Bearer ${auth}` } : {}),
          ...(cookie ? { cookie } : {}),
          ...(terminal ? { "x-pos-installation": "terminal1" } : {}),
          ...(challenge ? { "x-waiter-challenge": challenge } : {}),
          ...(cashSession !== undefined ? { "x-pos-cash-session": cashSession } : {}),
          ...(origin ? { origin } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (x) => chunks.push(x));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString();
          let json = {};
          try {
            json = JSON.parse(text || "{}");
          } catch {}
          resolveCall({
            status: res.statusCode,
            headers: res.headers,
            json,
            text,
          });
        });
      },
    );
    req.on("error", (e) => reject(new Error(`${path}: ${e.message}`)));
    if (data) req.write(data);
    req.end();
  });

test("waiter relay pairs, queues and returns per-request RPC responses without persisting credentials", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "waiter-relay-"));
  const terminalToken = token(),
    sessionToken = token();
  const net = await import("node:net");
  const probe = net.createServer();
  await new Promise((r) => probe.listen(0, "127.0.0.1", r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  const service = createOrdersServer({
    dbPath: resolve(dir, "orders.sqlite"),
    stores: [
      {
        id: "shop1",
        whatsappNumber: "5491112345678",
        receiveTokenHash: hash(terminalToken),
        receiveInstallationId: "terminal1",
        sites: [{ id: "site", submitTokenHash: hash(token()) }],
      },
    ],
    waiterPublicBaseUrl: `http://127.0.0.1:${port}/`,
  });
  t.after(async () => {
    await service.close();
    await rm(dir, { recursive: true, force: true });
  });
  await new Promise((resolveListen) =>
    service.server.listen(port, "127.0.0.1", resolveListen),
  );
  const origin = `http://127.0.0.1:${port}`;

  const page = await call(port, "/waiter");
  assert.equal(page.status, 200);
  assert.match(page.text, /Comandas/);
  assert.match(page.headers["content-security-policy"], /sha256-/);
  const challengeId = randomBytes(24).toString("base64url");
  const invite = await call(port, "/v1/waiter/invitations", {
    method: "POST",
    auth: terminalToken,
    terminal: true,
    body: { challengeId },
  });
  assert.equal(invite.status, 201);
  assert.match(
    invite.json.inviteUrl,
    /#tenant=shop1&terminal=terminal1&challenge=/,
  );
  assert.equal(
    (
      await call(port, "/v1/waiter/invitations", {
        method: "POST",
        auth: token(),
        body: { challengeId },
      })
    ).status,
    401,
  );

  const paired = await call(port, "/v1/waiter/pair", {
    method: "POST",
    origin,
    body: {
      tenantId: "shop1",
      terminalId: "terminal1",
      challengeId,
      pin: "1234",
    },
  });
  assert.equal(paired.status, 202);
  const terminalQueue = await call(port, "/v1/waiter/terminal/requests", {
    auth: terminalToken,
    terminal: true,
  });
  assert.equal(terminalQueue.json.requests[0].method, "waiter.pair");
  assert.equal(terminalQueue.json.requests[0].params.pin, "1234");
  assert.equal(
    (
      await call(
        port,
        `/v1/waiter/terminal/requests/${terminalQueue.json.requests[0].requestId}/response`,
        {
          method: "POST",
          auth: terminalToken,
          terminal: true,
          body: {
            result: {
              sessionToken,
              expiresAt: new Date(Date.now() + 3600_000).toISOString(),
              waiter: { id: "w1", name: "Ana" },
            },
          },
        },
      )
    ).status,
    200,
  );
  assert.equal(
    (await call(port, `/v1/waiter/pair/${paired.json.requestId}`)).status,
    401,
  );
  assert.equal(
    (
      await call(port, `/v1/waiter/pair/${paired.json.requestId}`, {
        challenge: "incorrect",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await call(port, `/v1/waiter/pair/${paired.json.requestId}`, {
        challenge: challengeId,
      })
    ).json.result.sessionToken,
    sessionToken,
  );
  const businessRequestId = randomBytes(18).toString("base64url");
  const rpcBody = {
    requestId: businessRequestId,
    method: "waiter.submitBatch",
    params: { requestId: businessRequestId, tableId: "t1", lines: [] },
  };
  const rpc = await call(port, "/v1/waiter/rpc", {
    method: "POST",
    auth: sessionToken,
    origin,
    body: rpcBody,
  });
  assert.equal(rpc.status, 202);
  for (const [method, params] of [
    ["waiter.getTable", { tableId: "t1" }],
    ["waiter.reprintTable", { tableId: "t1", orderId: "o1", requestId: "r".repeat(16), scope: "FULL" }],
  ]) {
    const allowed = await call(port, "/v1/waiter/rpc", {
      method: "POST",
      auth: sessionToken,
      origin,
      body: { requestId: randomBytes(18).toString("base64url"), method, params },
    });
    assert.equal(allowed.status, 202, `${method} is in the RPC allowlist`);
  }
  const retry = await call(port, "/v1/waiter/rpc", {
    method: "POST",
    auth: sessionToken,
    origin,
    body: rpcBody,
  });
  assert.equal(retry.json.requestId, rpc.json.requestId);
  assert.equal(
    (
      await call(port, "/v1/waiter/rpc", {
        method: "POST",
        auth: sessionToken,
        origin,
        body: {
          ...rpcBody,
          params: { requestId: "different", tableId: "t2", lines: [] },
        },
      })
    ).status,
    409,
  );
  const queued = (
    await call(port, "/v1/waiter/terminal/requests", {
      auth: terminalToken,
      terminal: true,
    })
  ).json.requests[0];
  assert.equal(queued.sessionId, sessionToken);
  const oversizedMenu = {
    menu: {
      products: Array.from({ length: 5_000 }, (_, i) => ({
        id: String(i),
        name: "product-" + i,
      })),
    },
  };
  assert.equal(
    (
      await call(
        port,
        `/v1/waiter/terminal/requests/${queued.requestId}/response`,
        {
          method: "POST",
          auth: terminalToken,
          terminal: true,
          body: { result: oversizedMenu },
        },
      )
    ).status,
    200,
  );
  assert.deepEqual(
    (
      await call(port, `/v1/waiter/requests/${rpc.json.requestId}`, {
        auth: sessionToken,
      })
    ).json.result,
    oversizedMenu,
  );
  assert.equal(
    (
      await call(port, `/v1/waiter/requests/${rpc.json.requestId}`, {
        auth: token(),
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await call(port, "/v1/waiter/rpc", {
        method: "POST",
        auth: sessionToken,
        origin: "http://attacker.example",
        body: rpcBody,
      })
    ).status,
    403,
  );

  const denied = await call(port, "/v1/waiter/rpc", {
    method: "POST",
    auth: sessionToken,
    origin,
    body: {
      requestId: randomBytes(18).toString("base64url"),
      method: "waiter.getState",
      params: {},
    },
  });
  const revoke = await call(port, "/v1/waiter/rpc", {
    method: "POST",
    auth: sessionToken,
    origin,
    body: {
      requestId: randomBytes(18).toString("base64url"),
      method: "waiter.revoke",
      params: {},
    },
  });
  const terminalWork = (
    await call(port, "/v1/waiter/terminal/requests", {
      auth: terminalToken,
      terminal: true,
    })
  ).json.requests;
  const deniedWork = terminalWork.find(
    (x) => x.requestId === denied.json.requestId,
  );
  const revokeWork = terminalWork.find(
    (x) => x.requestId === revoke.json.requestId,
  );
  assert.equal(
    (
      await call(
        port,
        `/v1/waiter/terminal/requests/${deniedWork.requestId}/response`,
        {
          method: "POST",
          auth: terminalToken,
          terminal: true,
          body: { error: { code: "unauthorized", message: "Session expired" } },
        },
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await call(port, `/v1/waiter/requests/${denied.json.requestId}`, {
        auth: sessionToken,
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await call(
        port,
        `/v1/waiter/terminal/requests/${revokeWork.requestId}/response`,
        {
          method: "POST",
          auth: terminalToken,
          terminal: true,
          body: { result: { revoked: true } },
        },
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await call(port, "/v1/waiter/rpc", {
        method: "POST",
        auth: sessionToken,
        origin,
        body: {
          requestId: randomBytes(18).toString("base64url"),
          method: "waiter.getState",
          params: {},
        },
      })
    ).status,
    401,
  );
});

test("cash-close waiter sessions survive relay restart in SQLite and authenticate through a same-origin HttpOnly cookie", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "waiter-relay-restart-"));
  const dbPath = resolve(dir, "orders.sqlite");
  const terminalToken = token();
  const net = await import("node:net");
  const probe = net.createServer();
  await new Promise((r) => probe.listen(0, "127.0.0.1", r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  const create = () => createOrdersServer({ dbPath, stores: [{ id: "shop1", whatsappNumber: "5491112345678", receiveTokenHash: hash(terminalToken), receiveInstallationId: "terminal1", sites: [{ id: "site", submitTokenHash: hash(token()) }] }], waiterPublicBaseUrl: `http://127.0.0.1:${port}/` });
  let service = create();
  t.after(async () => { await service.close().catch(() => {}); await rm(dir, { recursive: true, force: true }); });
  await new Promise((r) => service.server.listen(port, "127.0.0.1", r));
  const challengeId = token();
  await call(port, "/v1/waiter/invitations", { method: "POST", auth: terminalToken, terminal: true, body: { challengeId } });
  const queuedPair = await call(port, "/v1/waiter/pair", { method: "POST", origin: `http://127.0.0.1:${port}`, body: { tenantId: "shop1", terminalId: "terminal1", challengeId, pin: "1234" } });
  const queue = await call(port, "/v1/waiter/terminal/requests", { auth: terminalToken, terminal: true, cashSession: "cash1" });
  const sessionToken = token();
  await call(port, `/v1/waiter/terminal/requests/${queuedPair.json.requestId}/response`, { method: "POST", auth: terminalToken, terminal: true, body: { result: { sessionToken, expiresAt: null, validUntil: "CASH_CLOSE", cashSessionId: "cash1" } } });
  const paired = await call(port, `/v1/waiter/pair/${queuedPair.json.requestId}`, { challenge: challengeId });
  assert.equal(paired.status, 200);
  assert.match(paired.headers["set-cookie"][0], /^waiter_session=.*; Path=\/v1\/waiter; HttpOnly; SameSite=Strict/);
  assert.equal(paired.json.result.sessionToken, sessionToken);
  assert.equal(queue.status, 200);
  await service.close();
  const { DatabaseSync } = await import("node:sqlite");
  const snapshot = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const rows = snapshot.prepare("SELECT * FROM waiter_relay_sessions").all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].token_hash, hash(sessionToken));
    assert.equal(rows[0].cash_session_id, "cash1");
    assert.ok(!JSON.stringify(rows).includes(sessionToken), "no plaintext bearer in the session record");
  } finally { snapshot.close(); }
  service = create();
  await new Promise((r) => service.server.listen(port, "127.0.0.1", r));
  const cookie = paired.headers["set-cookie"][0].split(";")[0];
  assert.equal((await call(port, `/v1/waiter/requests/00000000-0000-4000-8000-000000000000`, { cookie })).status, 404, "same-origin GET without Origin may authenticate with the cookie");
  assert.equal((await call(port, "/v1/waiter/rpc", { method: "POST", origin: `http://127.0.0.1:${port}`, cookie, body: { requestId: token(), method: "waiter.getState", params: {} } })).status, 202);
  assert.equal((await call(port, "/v1/waiter/rpc", { method: "POST", origin: "http://attacker.example", cookie, body: { requestId: token(), method: "waiter.getState", params: {} } })).status, 403);
  const revoke = await call(port, "/v1/waiter/rpc", { method: "POST", origin: `http://127.0.0.1:${port}`, cookie, body: { requestId: token(), method: "waiter.revoke", params: {} } });
  const work = (await call(port, "/v1/waiter/terminal/requests", { auth: terminalToken, terminal: true })).json.requests.find((x) => x.requestId === revoke.json.requestId);
  assert.ok(work);
  await call(port, `/v1/waiter/terminal/requests/${work.requestId}/response`, { method: "POST", auth: terminalToken, terminal: true, body: { result: { revoked: true } } });
  const revoked = await call(port, `/v1/waiter/requests/${work.requestId}`, { cookie });
  assert.equal(revoked.status, 401);
  assert.match(revoked.headers["set-cookie"][0], /waiter_session=;.*Max-Age=0/);
  const persisted = new DatabaseSync(dbPath, { readOnly: true });
  assert.equal(persisted.prepare("SELECT COUNT(*) AS n FROM waiter_relay_sessions WHERE token_hash=?").get(hash(sessionToken)).n, 0, "revoke deletes the persisted session");
  persisted.close();
});
