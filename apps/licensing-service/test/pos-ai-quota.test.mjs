import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPosAiQuota } from "../dist/pos-ai-quota.js";

function setup(start = "2026-11-07T12:00:00.000Z") {
  const db = new DatabaseSync(":memory:");
  let time = Date.parse(start);
  const quota = createPosAiQuota(db, {
    now: () => new Date(time).toISOString(),
  });
  return {
    db,
    quota,
    advance: (ms) => {
      time += ms;
    },
  };
}

test("allows quota and request idempotency without storing prompt text", () => {
  const { db, quota } = setup();
  const request = { merchantId: "m1", userId: "u1", requestId: "r1" };
  assert.deepEqual(quota.reserve(request), {
    allowed: true,
    idempotent: false,
    status: "allowed",
    remaining: { user: 19, merchant: 99 },
    retryAfter: 0,
  });
  assert.deepEqual(quota.reserve(request), {
    allowed: true,
    idempotent: true,
    status: "allowed",
    remaining: { user: 19, merchant: 99 },
    retryAfter: 0,
  });
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM pos_ai_quota_requests").get().n,
    1,
  );
  assert.equal(
    db
      .prepare("PRAGMA table_info(pos_ai_quota_requests)")
      .all()
      .some((c) => /prompt|text|completion/i.test(c.name)),
    false,
  );
  db.close();
});

test("enforces a rolling 60 second cooldown across Buenos Aires midnight", () => {
  const { db, quota, advance } = setup("2026-11-08T02:59:45.000Z"); // 23:59:45 in Buenos Aires
  assert.equal(
    quota.reserve({ merchantId: "m", userId: "u", requestId: "1" }).allowed,
    true,
  );
  advance(30_000); // next BA calendar day, still inside cooldown
  const blocked = quota.reserve({
    merchantId: "m",
    userId: "u",
    requestId: "2",
  });
  assert.equal(blocked.status, "cooldown");
  assert.equal(blocked.retryAfter, 30);
  advance(30_000);
  assert.equal(
    quota.reserve({ merchantId: "m", userId: "u", requestId: "3" }).allowed,
    true,
  );
  db.close();
});

test("does not persist rejections; same request can succeed after daily reset", () => {
  const { db, quota, advance } = setup();
  for (let i = 0; i < 20; i++) {
    assert.equal(
      quota.reserve({ merchantId: "m", userId: "u", requestId: `r${i}` })
        .allowed,
      true,
    );
    advance(60_000);
  }
  const denied = quota.reserve({
    merchantId: "m",
    userId: "u",
    requestId: "limit",
  });
  assert.equal(denied.status, "user_daily_limit");
  assert.equal(denied.remaining.user, 0);
  assert.equal(denied.retryAfter, 14 * 60 * 60 + 40 * 60); // 12:20Z -> midnight BA
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM pos_ai_quota_requests").get().n,
    20,
  );
  assert.equal(
    quota.reserve({ merchantId: "m", userId: "u", requestId: "limit" })
      .idempotent,
    false,
  );
  advance(denied.retryAfter * 1000);
  assert.equal(
    quota.reserve({ merchantId: "m", userId: "u", requestId: "limit" }).allowed,
    true,
  );
  db.close();
});

test("does not retain cooldown rejections and permits retry with the same id", () => {
  const { db, quota, advance } = setup();
  quota.reserve({ merchantId: "m", userId: "u", requestId: "first" });
  assert.equal(
    quota.reserve({ merchantId: "m", userId: "u", requestId: "retry" }).status,
    "cooldown",
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM pos_ai_quota_requests").get().n,
    1,
  );
  advance(60_000);
  assert.equal(
    quota.reserve({ merchantId: "m", userId: "u", requestId: "retry" }).allowed,
    true,
  );
  db.close();
});

test("enforces merchant-wide daily limit across users", () => {
  const { db, quota, advance } = setup();
  for (let i = 0; i < 100; i++) {
    assert.equal(
      quota.reserve({ merchantId: "m", userId: `u${i}`, requestId: `r${i}` })
        .allowed,
      true,
    );
    advance(60_000);
  }
  const denied = quota.reserve({
    merchantId: "m",
    userId: "another",
    requestId: "last",
  });
  assert.equal(denied.status, "merchant_daily_limit");
  assert.equal(denied.remaining.merchant, 0);
  db.close();
});

test("validates identifiers", () => {
  const { db, quota } = setup();
  assert.throws(
    () => quota.reserve({ merchantId: "", userId: "u", requestId: "r" }),
    { code: "invalid_quota_request" },
  );
  db.close();
});

test("reservations are shared across connections and survive reopen, isolated by merchant", () => {
  const directory = mkdtempSync(join(tmpdir(), "pos-ai-quota-"));
  const filename = join(directory, "quota.sqlite");
  const db1 = new DatabaseSync(filename);
  const db2 = new DatabaseSync(filename);
  let now = "2026-11-07T12:00:00.000Z";
  const q1 = createPosAiQuota(db1, { now: () => now });
  const q2 = createPosAiQuota(db2, { now: () => now });
  const req = { merchantId: "m1", userId: "u1", requestId: "same" };
  assert.equal(q1.reserve(req).allowed, true);
  assert.equal(q2.reserve(req).idempotent, true);
  assert.equal(q2.reserve({ ...req, requestId: "next" }).status, "cooldown");
  assert.equal(q2.reserve({ ...req, merchantId: "m2" }).allowed, true);
  db1.close();
  db2.close();

  const reopened = new DatabaseSync(filename);
  const q3 = createPosAiQuota(reopened, { now: () => now });
  assert.equal(q3.reserve(req).idempotent, true);
  assert.equal(q3.reserve({ ...req, requestId: "next" }).status, "cooldown");
  reopened.close();
  rmSync(directory, { recursive: true, force: true });
});
