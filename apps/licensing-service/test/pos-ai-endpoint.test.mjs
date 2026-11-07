import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { createLicenseServer } from "../dist/server.js";
import {
  devicePublicKeyFingerprint,
  signDeviceProof,
} from "@gastronomy/licensing";

test("POS AI endpoint authenticates approved device, consumes challenge, and charges once", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "pos-ai-endpoint-"));
  const db = new DatabaseSync(join(dir, "db.sqlite"));
  const pair = generateKeyPairSync("ed25519");
  const privateKey = pair.privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString();
  const publicKey = pair.publicKey
    .export({ type: "spki", format: "pem" })
    .toString();
  const fingerprint = devicePublicKeyFingerprint(publicKey);
  const installationId = "install-pos-ai-01";
  let calls = 0;
  const app = createLicenseServer(
    {
      dbPath: join(dir, "db.sqlite"),
      adminToken: randomBytes(40).toString("base64url"),
      privateKey,
      posAi: {
        apiKey: "test-secret",
        fetchImpl: async () => {
          calls++;
          return {
            ok: true,
            json: async () => ({
              candidates: [{ content: { parts: [{ text: "cash-status" }] } }],
            }),
          };
        },
      },
    },
    db,
  );
  t.after(() => {
    app.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const future = new Date(Date.now() + 86_400_000).toISOString();
  db.prepare(
    "INSERT INTO licenses(id,business_name,paid_through,revision,status,activation_hash,installation_id,created_at) VALUES(?,?,?,1,'ACTIVE',?,?,?)",
  ).run(
    "license-pos-ai-01",
    "POS Test",
    future,
    "hash-pos-ai-01",
    installationId,
    new Date().toISOString(),
  );
  db.prepare(
    "INSERT INTO device_requests(id,installation_id,business_name,key_fingerprint,public_key,status,license_id,created_at,updated_at) VALUES(?,?,?, ?,?,'APPROVED',?,?,?)",
  ).run(
    "device-pos-ai-01",
    installationId,
    "POS Test",
    fingerprint,
    publicKey,
    "license-pos-ai-01",
    new Date().toISOString(),
    new Date().toISOString(),
  );
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const post = (path, body) =>
    fetch(base + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  async function makeRequest(actorId, requestId, prompt = "estado de caja") {
    const challengeResponse = await post("/v2/devices/challenge", {
      installationId,
      publicKey,
      purpose: "lease",
    });
    assert.equal(challengeResponse.status, 200);
    const challenge = await challengeResponse.json();
    const proof = {
      purpose: "pos-ai",
      challengeId: challenge.challengeId,
      nonce: challenge.nonce,
      installationId,
      keyFingerprint: fingerprint,
      actorId,
      requestId,
      prompt,
    };
    return {
      challengeId: challenge.challengeId,
      body: {
        ...proof,
        publicKey,
        signature: signDeviceProof(proof, privateKey),
      },
    };
  }
  const first = await makeRequest("operator-1", "request-pos-ai-001");
  const ok = await post("/v2/pos/ai", first.body);
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).questionId, "cash-status");
  assert.equal(calls, 1);
  const replay = await post("/v2/pos/ai", first.body);
  assert.equal(replay.status, 401);
  assert.equal(calls, 1);
  const duplicate = await makeRequest("operator-1", "request-pos-ai-001");
  const duplicateResponse = await post("/v2/pos/ai", duplicate.body);
  assert.equal(duplicateResponse.status, 409);
  assert.equal((await duplicateResponse.json()).error, "duplicate");
  assert.equal(calls, 1);
  const otherUser = await makeRequest("operator-2", "request-pos-ai-002");
  const bad = { ...otherUser.body, signature: first.body.signature };
  assert.equal((await post("/v2/pos/ai", bad)).status, 401);
  assert.equal(calls, 1);
  const dayParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const day = `${dayParts.find((x) => x.type === "year").value}-${dayParts.find((x) => x.type === "month").value}-${dayParts.find((x) => x.type === "day").value}`;
  const now = new Date().toISOString();
  for (let i = 0; i < 20; i++)
    db.prepare(
      "INSERT INTO pos_ai_quota_requests(merchant_id,user_id,request_id,day,created_at,status) VALUES(?,?,?,?,?,'allowed')",
    ).run("license-pos-ai-01", "operator-full", `quota-full-${i}`, day, now);
  const full = await makeRequest("operator-full", "request-pos-ai-full");
  const fullResponse = await post("/v2/pos/ai", full.body);
  assert.equal(fullResponse.status, 429);
  assert.equal((await fullResponse.json()).error, "user_daily_limit");
  assert.equal(calls, 1);
  db.prepare(
    "UPDATE licenses SET status='SUSPENDED' WHERE id='license-pos-ai-01'",
  ).run();
  const suspended = await makeRequest("operator-3", "request-pos-ai-suspended");
  assert.equal((await post("/v2/pos/ai", suspended.body)).status, 401);
  assert.equal(calls, 1);
});

test("POS AI returns unavailable when server has no Gemini credential", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "pos-ai-unconfigured-"));
  const pair = generateKeyPairSync("ed25519");
  const app = createLicenseServer({
    dbPath: join(dir, "db.sqlite"),
    adminToken: randomBytes(40).toString("base64url"),
    privateKey: pair.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString(),
  });
  t.after(() => {
    app.close();
    rmSync(dir, { recursive: true, force: true });
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const response = await fetch(
    `http://127.0.0.1:${app.server.address().port}/v2/pos/ai`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    },
  );
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "unavailable");
});
