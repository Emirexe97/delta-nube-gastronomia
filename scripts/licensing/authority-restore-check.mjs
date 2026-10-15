import { readFile, writeFile, mkdir } from "node:fs/promises";
import {
  createHash,
  createPublicKey,
  randomUUID,
  sign,
  verify,
} from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createRequire } from "node:module";

const allowed = new Set([
  "licensing-data/",
  "licensing-data/licenses.sqlite",
  "licensing-data/licenses.sqlite-wal",
  "licensing-data/licenses.sqlite-shm",
  "licensing-secrets/",
  "licensing-secrets/private-key.pem",
  "licensing-secrets/public-key.pem",
  "licensing-secrets/admin-token",
  "licensing-secrets/panel-password.hash",
]);
const chunks = [];
let bytes = 0;
for await (const chunk of process.stdin) {
  bytes += chunk.length;
  if (bytes > 64 * 1024 * 1024) throw new Error("Archive exceeds safety bound");
  chunks.push(chunk);
}
const archive = Buffer.concat(chunks);
const seen = new Set();
const files = new Set();
for (let offset = 0; offset + 512 <= archive.length;) {
  const header = archive.subarray(offset, offset + 512);
  if (header.every((byte) => byte === 0)) break;
  const field = (a, b) =>
    header.subarray(a, b).toString("utf8").replace(/\0.*$/s, "");
  const name = field(0, 100);
  if (!allowed.has(name) || seen.has(name) || field(345, 500))
    throw new Error("Unexpected archive member");
  seen.add(name);
  const checksum = Number.parseInt(field(148, 156).trim(), 8);
  let actual = 0;
  for (let i = 0; i < 512; i++) actual += i >= 148 && i < 156 ? 32 : header[i];
  if (checksum !== actual) throw new Error("Invalid archive header");
  const sizeText = field(124, 136).trim();
  if (!/^[0-7]+$/.test(sizeText)) throw new Error("Invalid archive size");
  const size = Number.parseInt(sizeText, 8);
  const type = header[156];
  const directory = type === 53;
  if (!directory && type !== 0 && type !== 48)
    throw new Error("Links and extended headers are forbidden");
  if (
    directory !== name.endsWith("/") ||
    (directory && size !== 0) ||
    offset + 512 + size > archive.length
  )
    throw new Error("Invalid archive member");
  const target = "/restore/" + name;
  if (directory) await mkdir(target, { recursive: true, mode: 0o700 });
  else {
    await mkdir(target.slice(0, target.lastIndexOf("/")), {
      recursive: true,
      mode: 0o700,
    });
    await writeFile(
      target,
      archive.subarray(offset + 512, offset + 512 + size),
      { mode: 0o600, flag: "wx" },
    );
    files.add(name);
  }
  offset += 512 + Math.ceil(size / 512) * 512;
}
for (const name of [
  "licensing-data/licenses.sqlite",
  "licensing-secrets/private-key.pem",
  "licensing-secrets/public-key.pem",
  "licensing-secrets/admin-token",
]) {
  if (!files.has(name)) throw new Error("Incomplete authority archive");
}
archive.fill(0);
for (const chunk of chunks) chunk.fill(0);
if (files.has("licensing-secrets/panel-password.hash")) {
  const panelHash = (
    await readFile("/restore/licensing-secrets/panel-password.hash", "utf8")
  ).trim();
  if (!/^scrypt\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{86}$/.test(panelHash))
    throw new Error("Recovered panel password hash is malformed");
}
const privateKey = await readFile(
  "/restore/licensing-secrets/private-key.pem",
  "utf8",
);
const publicKey = await readFile(
  "/restore/licensing-secrets/public-key.pem",
  "utf8",
);
const derived = createPublicKey(privateKey)
  .export({ type: "spki", format: "pem" })
  .toString();
if (
  derived !== publicKey ||
  !verify(
    null,
    Buffer.from("recovery-check"),
    publicKey,
    sign(null, Buffer.from("recovery-check"), privateKey),
  )
)
  throw new Error("Recovered key pair mismatch");
const db = new DatabaseSync("/restore/licensing-data/licenses.sqlite");
if (db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok")
  throw new Error("Recovered database integrity failed");
const rows = db
  .prepare("SELECT id, installation_id, revision, paid_through FROM licenses")
  .all();
const renewals = db.prepare("SELECT count(*) AS n FROM renewals").get().n;
db.close();
const { createLicenseServer } =
  await import("/app/apps/licensing-service/dist/server.js");
const require = createRequire("/app/apps/licensing-service/package.json");
const { verifyLease } = require("@gastronomy/licensing");
const adminToken = (
  await readFile("/restore/licensing-secrets/admin-token", "utf8")
).trim();
const service = createLicenseServer({
  dbPath: "/restore/licensing-data/licenses.sqlite",
  privateKey,
  adminToken,
});
await new Promise((resolve) => service.server.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + service.server.address().port;
const post = async (path, body, admin = false) => {
  const response = await fetch(base + path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(admin ? { authorization: "Bearer " + adminToken } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("Recovered authority operation failed");
  return response.json();
};
try {
  const now = Date.now();
  const created = await post(
    "/admin/licenses",
    {
      businessName: "RECOVERY CHECK ONLY IN TMPFS",
      paidThrough: new Date(now + 86400000).toISOString(),
    },
    true,
  );
  const installationId = randomUUID();
  const activated = await post("/v1/activate", {
    code: created.activationCode,
    installationId,
  });
  verifyLease(activated.token, publicKey, installationId);
  await post(
    "/admin/licenses/" + created.license.id + "/renew",
    {
      paidThrough: new Date(now + 2 * 86400000).toISOString(),
      reason: "Restore validation in tmpfs",
      idempotencyKey: randomUUID(),
    },
    true,
  );
  const refreshed = await post("/v1/verify", {
    token: activated.token,
    installationId,
  });
  if (verifyLease(refreshed.token, publicKey, installationId).revision !== 2)
    throw new Error("Recovered renewal failed");
  console.log(
    JSON.stringify({
      status: "validated",
      production_changed: false,
      sqlite_integrity: "ok",
      key_pair_valid: true,
      recovered_license_count: rows.length,
      recovered_renewal_count: renewals,
      activation_verify_renewal: true,
      public_key_sha256: createHash("sha256").update(publicKey).digest("hex"),
      storage: "isolated Docker tmpfs",
      network: "none",
    }),
  );
} finally {
  service.close();
}
