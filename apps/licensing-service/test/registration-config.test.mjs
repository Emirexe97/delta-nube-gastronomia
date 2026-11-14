import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRegistrationMailer } from "../dist/registration-mail.js";
import { downloadsFromEnv } from "../dist/public-account-http.js";

test("SMTP is operator-configured, requires TLS and never enables file/URL reads or credential logging", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "trial-mail-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "password.txt");
  await writeFile(file, "test-only-smtp-password");
  const env = {
    REGISTRATION_SMTP_HOST: "smtp.example.test",
    REGISTRATION_SMTP_USER: "demo",
    REGISTRATION_SMTP_PASSWORD_FILE: file,
    REGISTRATION_MAIL_FROM: "registro@example.test",
  };
  let options, message;
  const factory = (opts) => {
    options = opts;
    return {
      sendMail: async (value) => {
        message = value;
        return { accepted: [value.to], rejected: [] };
      },
    };
  };
  const send = createRegistrationMailer(env, factory);
  assert.equal(options.port, 465);
  assert.equal(options.secure, true);
  assert.equal(options.requireTLS, true);
  assert.equal(options.tls.rejectUnauthorized, true);
  assert.equal(options.disableFileAccess, true);
  assert.equal(options.disableUrlAccess, true);
  assert.equal(options.logger, false);
  assert.equal(options.debug, false);
  await send({
    to: "customer@example.test",
    subject: "Verify",
    text: "A fictitious verification link",
  });
  assert.equal(message.from.address, env.REGISTRATION_MAIL_FROM);
  createRegistrationMailer({ ...env, REGISTRATION_SMTP_PORT: "587" }, factory);
  assert.equal(options.secure, false);
  assert.equal(options.requireTLS, true);
  assert.throws(() => createRegistrationMailer({}, factory), /Configure/);
  assert.throws(
    () =>
      createRegistrationMailer(
        { ...env, REGISTRATION_SMTP_PORT: "25" },
        factory,
      ),
    /Configure/,
  );
  assert.throws(
    () =>
      createRegistrationMailer(
        { ...env, REGISTRATION_MAIL_FROM: "a@test.com\r\nBcc: thief@test.com" },
        factory,
      ),
    /Configure/,
  );
  const rejected = createRegistrationMailer(env, () => ({
    sendMail: async () => ({
      accepted: [],
      rejected: ["customer@example.test"],
    }),
  }));
  await assert.rejects(
    rejected({
      to: "customer@example.test",
      subject: "Verify",
      text: "fictitious",
    }),
    /mail_unavailable/,
  );
});

test("download configuration has no invented defaults and refuses insecure or credential-bearing URLs", () => {
  assert.deepEqual(downloadsFromEnv({}), {});
  const config = downloadsFromEnv({
    PUBLIC_DOWNLOAD_WINDOWS: "https://downloads.example.test/pos.exe",
    PUBLIC_DOWNLOAD_MAC_ARM64: "https://downloads.example.test/pos-arm64.dmg",
  });
  assert.equal(config.windows.url, "https://downloads.example.test/pos.exe");
  assert.equal(config.macX64, undefined);
  for (const url of [
    "http://example.test/a.exe",
    "https://user:password@example.test/a.exe",
    "file:///tmp/a.exe",
    "https://example.test/a.exe#token",
  ])
    assert.throws(() => downloadsFromEnv({ PUBLIC_DOWNLOAD_WINDOWS: url }));
});
