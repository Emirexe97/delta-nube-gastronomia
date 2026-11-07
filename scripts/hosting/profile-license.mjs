import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { randomBytes, generateKeyPairSync } from "node:crypto";
import { performance } from "node:perf_hooks";
import { createLicenseServer } from "../../apps/licensing-service/dist/server.js";
import { devicePublicKeyFingerprint, signDeviceProof } from "../../packages/licensing/dist/index.js";

// Local-only benchmark. Creates an isolated temp SQLite DB and ephemeral keys;
// it never reads deployment secrets or connects to any remote service.
const tempRoot = resolve(tmpdir());
const dir = mkdtempSync(join(tempRoot, "license-profile-"));
const admin = randomBytes(40).toString("base64url");
const privateKey = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const app = createLicenseServer({ dbPath: join(dir, "profile.sqlite"), adminToken: admin, privateKey, rateLimit: 1000 });
await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${app.server.address().port}`;
const password = "local-profile-password-long-2026";
const installation = (n) => `profile-install-${String(n).padStart(4, "0")}`;
const pem = (key) => key.export({ type: "spki", format: "pem" }).toString();
const privPem = (key) => key.export({ type: "pkcs8", format: "pem" }).toString();
const post = async (path, data, auth = false) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${admin}` } : {}) }, body: JSON.stringify(data) });
const rss = () => process.memoryUsage().rss;
const rssStart = rss();
let peakRss = rssStart;
const sampler = setInterval(() => { peakRss = Math.max(peakRss, rss()); }, 20);
const cpuStart = process.cpuUsage();
const wallStart = performance.now();
const results = [];
try {
  const n = Number(process.argv[2] ?? 16);
  if (!Number.isSafeInteger(n) || n < 10 || n > 100) throw new Error("usage: node scripts/hosting/profile-license.mjs [accounts 10..100]");
  const accounts = [];
  for (let i = 0; i < n; i++) {
    const licenseRes = await post("/admin/licenses", { businessName: `Synthetic ${i}`, paidThrough: new Date(Date.now() + 30 * 86400000).toISOString() }, true);
    const license = await licenseRes.json();
    if (licenseRes.status !== 201) throw new Error(`fixture license failed: ${licenseRes.status}`);
    const email = `profile${i}@example.test`;
    const accountRes = await post("/admin/accounts", { email, password, licenseId: license.license.id }, true);
    if (accountRes.status !== 201) throw new Error(`fixture account failed: ${accountRes.status}`);
    const pair = generateKeyPairSync("ed25519");
    const publicKey = pem(pair.publicKey), install = installation(i);
    const fingerprint = devicePublicKeyFingerprint(publicKey);
    const chRes = await post("/v2/devices/challenge", { installationId: install, publicKey, purpose: "lease" });
    const challenge = await chRes.json();
    if (chRes.status !== 200) throw new Error(`fixture challenge failed: ${chRes.status}`);
    const proof = { purpose: "lease", challengeId: challenge.challengeId, nonce: challenge.nonce, installationId: install, keyFingerprint: fingerprint };
    accounts.push({ email, publicKey, install, challengeId: challenge.challengeId, signature: signDeviceProof(proof, privPem(pair.privateKey)) });
  }
  async function runBatch(size) {
    const batch = accounts.splice(0, size);
    const t0 = performance.now(), c0 = process.cpuUsage();
    const responses = await Promise.all(batch.map((a) => post("/v2/accounts/activate", { email: a.email, password, installationId: a.install, publicKey: a.publicKey, challengeId: a.challengeId, signature: a.signature })));
    const elapsed = performance.now() - t0, cpu = process.cpuUsage(c0);
    const statuses = await Promise.all(responses.map(async (r) => ({ status: r.status, body: await r.json() })));
    results.push({ concurrency: size, wall_ms: +elapsed.toFixed(1), cpu_ms: +((cpu.user + cpu.system) / 1000).toFixed(1), statuses: statuses.map((x) => x.status) });
    if (statuses.some((x) => x.status !== 200)) throw new Error(`activation batch failed: ${statuses.map((x) => x.status).join(",")}`);
  }
  await runBatch(1);
  await runBatch(4);
  // Hold four KDF jobs open with unique valid proofs; an additional valid request
  // must receive 429 while all four accountHashSlots are occupied.
  const hold = accounts.splice(0, 5);
  const reqs = hold.map((a) => post("/v2/accounts/activate", { email: a.email, password, installationId: a.install, publicKey: a.publicKey, challengeId: a.challengeId, signature: a.signature }));
  const responses = await Promise.all(reqs);
  const drained = await Promise.all(responses.map(async (r) => ({ status: r.status, body: await r.text() })));
  const statuses = drained.map((r) => r.status);
  results.push({ concurrency: 5, overload_statuses: statuses });
  if (!statuses.includes(429) || statuses.filter((s) => s === 200).length !== 4) throw new Error(`expected four 200 and one 429; got ${statuses}`);
  const cpu = process.cpuUsage(cpuStart);
  console.log(JSON.stringify({ node: process.version, platform: process.platform, rss_start_mib: +(rssStart / 1048576).toFixed(1), rss_peak_sampled_mib: +(peakRss / 1048576).toFixed(1), rss_peak_delta_mib: +((peakRss - rssStart) / 1048576).toFixed(1), process_resource_maxrss_native: process.resourceUsage().maxRSS, cpu_total_ms: +((cpu.user + cpu.system) / 1000).toFixed(1), wall_total_ms: +(performance.now() - wallStart).toFixed(1), batches: results, caveat: "RSS is whole-process sampled at 20ms; process.resourceUsage().maxRSS is reported in native platform units. scrypt maxmem is a per-operation upper bound, not preallocated memory. Synthetic loopback workload; host/container placement and enforced resource limits must be recorded separately." }, null, 2));
} finally {
  clearInterval(sampler);
  app.close();
  const resolvedDir = resolve(dir);
  if (dirname(resolvedDir) !== tempRoot || !basename(resolvedDir).startsWith("license-profile-"))
    throw new Error(`Refusing unsafe temporary directory cleanup: ${resolvedDir}`);
  rmSync(resolvedDir, { recursive: true, force: true });
}
