// Explicit operator-only public smoke. Never run from ordinary unit/E2E suites.
// Creates one tagged technical license, not a customer or payment, and writes
// only sanitized evidence. No private keys, admin secrets, codes or tokens log.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { _electron as electron, expect } from "@playwright/test";
import {
  verifyLease,
  leaseAccess,
} from "../../packages/licensing/dist/index.js";

if (process.platform !== "win32" || process.argv[2] !== "--run-public-pilot") {
  console.error("Operator opt-in required on Windows: --run-public-pilot");
  process.exit(2);
}
const root = process.cwd();
const serverUrl = "https://gastronomia.deltanubeweb.com";
const config = JSON.parse(
  await readFile(
    join(root, "apps/desktop-shell/licensing-config.json"),
    "utf8",
  ),
);
assert.equal(config.serverUrl, serverUrl);
const run = promisify(execFile);
let app;
let profile;
let step = "preflight";
const checks = {};
let licenseId;
const admin = async (path, payload) => {
  const source = `const {readFile}=require('node:fs/promises');(async()=>{const token=(await readFile('/run/credentials/admin-token','utf8')).trim();const r=await fetch('http://127.0.0.1:8097'+${JSON.stringify(path)},{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(${JSON.stringify(payload)}),signal:AbortSignal.timeout(5000)});if(!r.ok)process.exit(2);process.stdout.write(JSON.stringify(await r.json()));})().catch(()=>process.exit(2));`;
  // Public payload travels over stdin; only the fixed SSH command is in argv.
  const { spawn } = await import("node:child_process");
  return new Promise((resolveAdmin, reject) => {
    const child = spawn(
      "ssh.exe",
      [
        "-T",
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=yes",
        "-o",
        "ConnectTimeout=15",
        "deploy@145.223.121.144",
        "docker exec -i gastronomy_licensing-api-1 node",
      ],
      { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
    );
    const chunks = [];
    let size = 0;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Administrative operation timed out"));
    }, 20000);
    child.on("error", () => {
      clearTimeout(timer);
      reject(new Error("Administrative operation unavailable"));
    });
    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > 16384) {
        child.kill();
        reject(new Error("Administrative response exceeds safety bound"));
      } else chunks.push(chunk);
    });
    child.stderr.on("data", () => {});
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0)
        return reject(new Error("Administrative operation failed"));
      try {
        resolveAdmin(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("Invalid administrative response"));
      }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(source);
  });
};
try {
  const health = await fetch(serverUrl + "/health", {
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(health.status, 200);
  checks.https = true;
  profile = await mkdtemp(join(tmpdir(), "gastronomy-public-pilot-"));
  const output = join(profile, "package");
  step = "temporary packaged fixture";
  await run(
    process.execPath,
    [
      join(dirname(process.execPath), "node_modules/corepack/dist/corepack.js"),
      "pnpm",
      "--filter",
      "@gastronomy/desktop-shell",
      "exec",
      "electron-builder",
      "--win",
      "dir",
      "--x64",
      "--publish",
      "never",
      "-c.asar=false",
      "-c.directories.output=" + output,
    ],
    { cwd: root, timeout: 120000, maxBuffer: 1024 * 1024, windowsHide: true },
  );
  const build = join(output, "win-unpacked");
  const appDirectory = join(build, "resources/app");
  assert.deepEqual(
    JSON.parse(
      await readFile(join(appDirectory, "licensing-config.json"), "utf8"),
    ),
    config,
  );
  const exe = join(build, "GastronomyPublicPilot.exe");
  await rename(join(build, "Delta Nube Gastronomía.exe"), exe);
  const userData = join(profile, "isolated-user-data");
  app = await electron.launch({
    executablePath: exe,
    cwd: build,
    args: ["--user-data-dir=" + userData],
    env: { ...process.env },
    dumpio: false,
  });
  assert.equal(await app.evaluate(({ app }) => app.isPackaged), true);
  assert.equal(
    resolve(await app.evaluate(({ app }) => app.getPath("userData"))),
    resolve(userData),
  );
  assert.equal(
    resolve(await app.evaluate(({ app }) => app.getAppPath())),
    resolve(appDirectory),
  );
  checks.true_packaged = true;
  const page = await app.firstWindow();
  await expect(page.getByText("Delta Nube", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Configuración", exact: true }).click();
  await page.getByRole("button", { name: "Licencia", exact: true }).click();
  const panel = page.locator("#settings-license");
  await expect(
    panel.getByText("Pendiente de activación", { exact: true }),
  ).toBeVisible();
  const status0 = await page.evaluate(() =>
    window.gastronomy.getLicenseStatus(),
  );
  assert.equal(status0.state, "UNACTIVATED");
  step = "public activation";
  const created = await admin("/admin/licenses", {
    businessName: "PILOTO TECNICO — NO CLIENTE — " + new Date().toISOString(),
    paidThrough: new Date(Date.now() - 3 * 86400000 + 45000).toISOString(),
  });
  licenseId = created.license.id;
  await panel
    .getByPlaceholder("Código de activación")
    .fill(created.activationCode);
  await panel
    .getByRole("button", { name: "Activar licencia", exact: true })
    .click();
  await expect(
    panel.getByText("Período de gracia", { exact: true }),
  ).toBeVisible();
  created.activationCode = null;
  await expect(panel.getByPlaceholder("Código de activación")).toHaveCount(0);
  const grace = await page.evaluate(() => window.gastronomy.getLicenseStatus());
  assert.equal(grace.state, "GRACE");
  checks.activation_ui_public = true;
  const localState = JSON.parse(
    await readFile(join(userData, "license-state.json"), "utf8"),
  );
  const signed = verifyLease(
    localState.token,
    config.publicKey,
    status0.installationId,
  );
  assert.equal(signed.licenseId, licenseId);
  assert.equal(leaseAccess(signed, Date.now()), "GRACE");
  checks.signature_real_public_key = true;
  const wrongInstallation = await fetch(serverUrl + "/v1/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: localState.token,
      installationId: randomUUID(),
    }),
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(wrongInstallation.status, 401);
  checks.other_installation_denied = true;
  localState.token = null;
  const cash = await page.evaluate(() =>
    window.gastronomy.openCashSession({
      openingAmountMinor: 0,
      note: "Public pilot isolated profile",
    }),
  );
  const before = await page.evaluate(() => window.gastronomy.bootstrap());
  step = "real expiry and write block";
  while (Date.now() < Date.parse(grace.graceUntil)) await delay(300);
  assert.equal(
    (await page.evaluate(() => window.gastronomy.getLicenseStatus())).state,
    "EXPIRED",
  );
  await assert.rejects(
    page.evaluate(
      (id) =>
        window.gastronomy.registerCashMovement({
          cashSessionId: id,
          type: "INCOME",
          amountMinor: 100,
          reason: "Must be blocked",
          idempotencyKey: "public_pilot_blocked_001",
        }),
      cash.id,
    ),
    /licencia/i,
  );
  assert.deepEqual(
    (await page.evaluate(() => window.gastronomy.bootstrap())).cashSession,
    before.cashSession,
  );
  checks.expired_write_denied_without_mutation = true;
  step = "manual public renewal";
  const paidThrough = new Date(Date.now() + 20 * 86400000).toISOString();
  const payload = {
    paidThrough,
    reason: "PILOTO TECNICO sin cobro — prueba autorizada",
    idempotencyKey: "public-pilot-" + randomUUID(),
  };
  await admin("/admin/licenses/" + licenseId + "/renew", payload);
  const replay = await admin(
    "/admin/licenses/" + licenseId + "/renew",
    payload,
  );
  assert.equal(replay.idempotent, true);
  await panel
    .getByRole("button", { name: "Verificar licencia", exact: true })
    .click();
  await expect(panel.getByText("Activa", { exact: true })).toBeVisible();
  assert.equal(
    (await page.evaluate(() => window.gastronomy.getLicenseStatus()))
      .paidThrough,
    paidThrough,
  );
  checks.renewal_ui_public_and_idempotent = true;
  await page.evaluate(
    (id) =>
      window.gastronomy.registerCashMovement({
        cashSessionId: id,
        type: "INCOME",
        amountMinor: 100,
        reason: "Allowed in isolated pilot",
        idempotencyKey: "public_pilot_allowed_001",
      }),
    cash.id,
  );
  assert.equal(
    (await page.evaluate(() => window.gastronomy.bootstrap())).cashSession
      .expectedAmountMinor,
    before.cashSession.expectedAmountMinor + 100,
  );
  checks.operating_after_renewal = true;
  const receipt = {
    status: "passed",
    executed_utc: new Date().toISOString(),
    licenseId,
    tagged_technical_license: true,
    no_customer_or_payment_created: true,
    checks,
    note: "Temporary packaged Windows fixture and POS profile removed; technical license remains bound to disposable installation, no real payment.",
  };
  await mkdir(join(root, ".licensing-local"), { recursive: true });
  await writeFile(
    join(root, ".licensing-local/public-pilot-receipt.json"),
    JSON.stringify(receipt, null, 2),
  );
  console.log(JSON.stringify(receipt));
} catch {
  console.error(
    JSON.stringify({
      status: "failed",
      step,
      licenseId: licenseId ?? null,
      checks,
      secret_details_suppressed: true,
    }),
  );
  process.exitCode = 1;
} finally {
  await app
    ?.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().forEach((window) => window.destroy()),
    )
    .catch(() => {});
  await app?.close().catch(() => {});
  if (profile) {
    assert.ok(
      resolve(profile).startsWith(
        resolve(tmpdir()) + sep + "gastronomy-public-pilot-",
      ),
    );
    await rm(profile, { recursive: true, force: true });
  }
}
