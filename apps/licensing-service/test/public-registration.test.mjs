import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  createPublicRegistration,
  PublicRegistrationError,
} from "../dist/public-registration.js";

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE licenses(id TEXT PRIMARY KEY,business_name TEXT NOT NULL,paid_through TEXT NOT NULL,revision INTEGER NOT NULL,status TEXT NOT NULL,activation_hash TEXT NOT NULL UNIQUE,installation_id TEXT UNIQUE,created_at TEXT NOT NULL);
    CREATE TABLE accounts(email TEXT PRIMARY KEY,password_hash TEXT NOT NULL,license_id TEXT NOT NULL UNIQUE REFERENCES licenses(id),status TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);`);
  let time = 1_800_000_000_000;
  const mails = [];
  const api = createPublicRegistration(db, {
    origin: "https://example.test",
    now: () => time,
    sendMail: async (m) => mails.push(m),
  });
  return {
    db,
    api,
    mails,
    advance: (n) => (time += n),
    close: () => db.close(),
  };
}
const pw = "correct-horse-battery-staple";
function token(mail) {
  return new URL(mail.text.match(/https:\/\/[^\s]+/)[0]).hash.slice(
    "#token=".length,
  );
}
test("email-first registration creates no account until verification and token is one-use", async () => {
  const { db, api, mails } = fixture();
  assert.match(await api.startRegistration("new@example.test"), /recibirás/);
  assert.equal(db.prepare("SELECT count(*) n FROM accounts").get().n, 0);
  const t = token(mails[0]);
  assert.equal(
    (
      await api.completeRegistration({
        token: t,
        businessName: "Cafe",
        password: pw,
      })
    ).email,
    "new@example.test",
  );
  assert.equal(
    db
      .prepare(
        "SELECT count(*) n FROM license_trials WHERE started_at IS NULL AND ends_at IS NULL",
      )
      .get().n,
    1,
  );
  assert.equal(
    db.prepare("SELECT paid_through FROM licenses").get().paid_through,
    "1970-01-01T00:00:00.000Z",
  );
  await assert.rejects(
    api.completeRegistration({ token: t, businessName: "Cafe", password: pw }),
    (e) =>
      e instanceof PublicRegistrationError &&
      e.code === "invalid_or_expired_token",
  );
  db.close();
});
test("expiry, resend cooldown and duplicate registration do not replace an account", async () => {
  const { db, api, mails, advance } = fixture();
  await api.startRegistration("a@b.test");
  await api.startRegistration("a@b.test");
  assert.equal(mails.length, 1);
  advance(60_001);
  await api.startRegistration("a@b.test");
  assert.equal(mails.length, 2);
  advance(30 * 60_000);
  await assert.rejects(
    api.completeRegistration({
      token: token(mails[1]),
      businessName: "Cafe",
      password: pw,
    }),
    /invalid_or_expired_token/,
  );
  db.close();
});
test("reset changes only password and does not renew license or alter device state", async () => {
  const { db, api, mails, advance } = fixture();
  await api.startRegistration("a@b.test");
  await api.completeRegistration({
    token: token(mails[0]),
    businessName: "Cafe",
    password: pw,
  });
  const before = db
    .prepare("SELECT paid_through,revision,installation_id FROM licenses")
    .get();
  advance(60_001);
  await api.startReset("a@b.test");
  await api.completeReset({
    token: token(mails[1]),
    password: "a-different-long-password",
  });
  assert.deepEqual(
    db
      .prepare("SELECT paid_through,revision,installation_id FROM licenses")
      .get(),
    before,
  );
  assert.equal(db.prepare("SELECT count(*) n FROM license_trials").get().n, 1);
  db.close();
});

test("duplicate completion never replaces existing account and concurrent token replay is single-use", async () => {
  const { db, api, mails, advance } = fixture();
  await api.startRegistration("same@example.test");
  const first = token(mails[0]);
  await api.completeRegistration({
    token: first,
    businessName: "Original",
    password: pw,
  });
  const before = db
    .prepare("SELECT password_hash,license_id FROM accounts")
    .get();
  advance(60_001);
  await api.startRegistration("same@example.test");
  assert.equal(mails.length, 1, "existing address gets no registration token");
  assert.deepEqual(
    db.prepare("SELECT password_hash,license_id FROM accounts").get(),
    before,
  );
  advance(60_001);
  await api.startRegistration("racer@example.test");
  const race = token(mails[1]);
  const results = await Promise.allSettled([
    api.completeRegistration({
      token: race,
      businessName: "Race",
      password: pw,
    }),
    api.completeRegistration({
      token: race,
      businessName: "Race",
      password: pw,
    }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    db
      .prepare(
        "SELECT count(*) n FROM accounts WHERE email='racer@example.test'",
      )
      .get().n,
    1,
  );
  assert.equal(db.prepare("SELECT count(*) n FROM licenses").get().n, 2);
  db.close();
});

test("expired during hash is rejected; reset invalidates sibling tokens and replay", async () => {
  const { db, api, mails, advance } = fixture();
  await api.startRegistration("expire@example.test");
  const t = token(mails[0]);
  const changing = api.completeRegistration({
    token: t,
    businessName: "Expire",
    password: pw,
  });
  advance(30 * 60_000);
  await assert.rejects(changing, /invalid_or_expired_token/);
  db.close();
});

test("mail failure leaves generic response, removes token, and allows retry", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(
    `CREATE TABLE licenses(id TEXT PRIMARY KEY,business_name TEXT NOT NULL,paid_through TEXT NOT NULL,revision INTEGER NOT NULL,status TEXT NOT NULL,activation_hash TEXT NOT NULL UNIQUE,installation_id TEXT UNIQUE,created_at TEXT NOT NULL); CREATE TABLE accounts(email TEXT PRIMARY KEY,password_hash TEXT NOT NULL,license_id TEXT NOT NULL UNIQUE REFERENCES licenses(id),status TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);`,
  );
  let fail = true;
  const mails = [];
  const api = createPublicRegistration(db, {
    origin: "https://example.test",
    sendMail: async (m) => {
      mails.push(m);
      if (fail) throw Error("private smtp detail");
    },
  });
  const response = await api.startRegistration("x@y.test");
  assert.match(response, /recibirás/);
  assert.equal(
    db.prepare("SELECT count(*) n FROM public_email_tokens").get().n,
    0,
  );
  fail = false;
  await api.startRegistration("x@y.test");
  assert.equal(
    db.prepare("SELECT count(*) n FROM public_email_tokens").get().n,
    1,
  );
  db.close();
});

test("cooldown survives module recreation and reset invalidates sibling tokens", async () => {
  const { db, api, mails, advance } = fixture();
  await api.startRegistration("persist@example.test");
  const again = createPublicRegistration(db, {
    origin: "https://example.test",
    now: () => 1_800_000_000_000,
    sendMail: async (m) => mails.push(m),
  });
  await again.startRegistration("persist@example.test");
  assert.equal(mails.length, 1);
  await api.completeRegistration({
    token: token(mails[0]),
    businessName: "Persist",
    password: pw,
  });
  advance(60_001);
  await api.startReset("persist@example.test");
  const resetToken = token(mails[1]);
  advance(60_001);
  await api.startReset("persist@example.test");
  const sibling = token(mails[2]);
  await api.completeReset({
    token: resetToken,
    password: "another-correct-long-password",
  });
  await assert.rejects(
    api.completeReset({
      token: sibling,
      password: "yet-another-correct-long-password",
    }),
    /invalid_or_expired_token/,
  );
  const before = mails.length;
  await api.startReset("missing@example.test");
  assert.equal(mails.length, before);
  db.close();
});

test("pending-token database cap is enforced", async () => {
  const { db, api } = fixture();
  db.prepare(
    "INSERT INTO public_email_tokens(token_hash,email,purpose,expires_at,created_at) VALUES(?,?,?,?,?)",
  ).run(
    "filler",
    "fill@example.test",
    "REGISTER",
    1_800_000_100_000,
    1_800_000_000_000,
  );
  // Reuse distinct hashes to exercise the persistent row count, not in-memory request counters.
  const insert = db.prepare(
    "INSERT INTO public_email_tokens(token_hash,email,purpose,expires_at,created_at) VALUES(?,?,?,?,?)",
  );
  for (let i = 1; i < 10_000; i++)
    insert.run(
      `filler-${i}`,
      `fill${i}@example.test`,
      "REGISTER",
      1_800_000_100_000,
      1_800_000_000_000,
    );
  await assert.rejects(
    api.startRegistration("new@example.test"),
    (e) =>
      e instanceof PublicRegistrationError &&
      e.code === "temporarily_unavailable",
  );
  db.close();
});
