// Windows-only, user-authorized QA. Never use these installers for distribution.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import { once } from "node:events";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, realpath, stat, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:https";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

assert.equal(process.platform, "win32");
assert.equal(process.arch, "x64");
assert.deepEqual(process.argv.slice(2), ["--isolated-install"], "Explicit QA installation opt-in required");
const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const shell = join(root, "apps", "desktop-shell");
const require = createRequire(join(root, "package.json"));
const { _electron } = require("@playwright/test");
const { signLease } = await import(pathToFileURL(join(root, "packages/licensing/dist/index.js")));
const corepack = join(dirname(process.execPath), "node_modules/corepack/dist/corepack.js");
assert.ok(existsSync(corepack));
const temp = await realpath(tmpdir());
const lab = await mkdtemp(join(temp, "dn-win-qa-"));
const nonce = randomBytes(4).toString("hex");
const identity = `DeltaNubeQA-${nonce}`;
const appId = `com.deltanube.qa.${nonce}`;
const guid = randomUUID();
const profile = join(lab, "profile");
const installed = join(lab, identity);
const exe = join(installed, `${identity}.exe`);
const stage = join(shell, ".test-tmp", identity);
const versions = ["98.0.1", "98.0.2"];
const prefix = "/qa/windows/x64/";
const output = (version) => join(lab, "installers", version);
const setupFile = (version) => join(output(version), `${identity}-Setup-${version}.exe`);
const reportPath = join(lab, "resultado.json");
const observations = { identity, appId, guid, lab, installed, profile, versions, installers: {} };
console.log("LAB", lab);
await mkdir(stage, { recursive: true });
await mkdir(profile);
assert.equal(await realpath(lab), lab);
assert.ok(installed.startsWith(lab + sep));
assert.ok(!existsSync(installed));

function safeEnv() {
  const denied = /^(?:GASTRONOMY_|CSC_|WIN_CSC_|GH_TOKEN$|GITHUB_TOKEN$|NODE_OPTIONS$|NODE_TLS_REJECT_UNAUTHORIZED$|NODE_EXTRA_CA_CERTS$|ELECTRON_RUN_AS_NODE$|ELECTRON_BUILDER_|DEBUG$)/i;
  return {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !denied.test(key))),
    CSC_IDENTITY_AUTO_DISCOVERY: "false",
  };
}

function exactReplace(source, from, to) {
  assert.equal(source.split(from).length, 2, `Expected one isolated-copy anchor: ${from.slice(0, 100)}`);
  return source.replace(from, () => to);
}

async function patch(relative, change) {
  const path = join(stage, "src", relative);
  await writeFile(path, change((await readFile(path, "utf8")).replace(/\r\n/g, "\n")));
}

async function command(name, args, cwd = root) {
  const target = join(lab, `${name}.log`);
  const log = createWriteStream(target);
  console.log("RUN", name);
  const child = spawn(process.execPath, [corepack, "pnpm", ...args], {
    cwd, shell: false, windowsHide: true, env: safeEnv(), stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  const [status] = await once(child, "close");
  log.end();
  await once(log, "close");
  assert.equal(status, 0, `See ${target}`);
}

async function installerHash(path, algorithm) {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

const updateKeys = generateKeyPairSync("ed25519");
const licenseKeys = generateKeyPairSync("ed25519");
const pem = ({ publicKey }) => publicKey.export({ type: "spki", format: "pem" });
const certPath = join(lab, "ephemeral-ca.pem");
const tlsKeyPath = join(lab, "ephemeral-tls-key.pem");
const openssl = "C:/Program Files/Git/usr/bin/openssl.exe";
await run(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256", "-days", "2",
  "-subj", `/CN=${identity} loopback only`, "-addext", "subjectAltName=IP:127.0.0.1",
  "-out", certPath, "-keyout", tlsKeyPath], { windowsHide: true });
const ca = await readFile(certPath);
const tlsKey = await readFile(tlsKeyPath);
await unlink(tlsKeyPath);
const requests = [];
let release;
const server = createServer({ key: tlsKey, cert: ca }, (req, res) => {
  const url = req.url ?? "";
  requests.push({ method: req.method, path: url });
  if (req.method === "GET" && release && url === prefix + "release.json") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(release.manifest);
  } else if (req.method === "GET" && release && url === prefix + release.asset) {
    res.writeHead(200, { "Content-Length": release.size, "Content-Type": "application/octet-stream" });
    const input = createReadStream(setupFile(versions[1]));
    res.on("close", () => input.destroy());
    input.on("error", () => res.destroy());
    input.pipe(res);
  } else if (url.startsWith("/v1/")) {
    // License must stay usable offline from the persisted signed lease; no renewal.
    req.resume();
    res.writeHead(503).end();
  } else {
    res.writeHead(404).end();
  }
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const origin = `https://127.0.0.1:${server.address().port}`;
const feed = origin + prefix;
let app;

try {
  const initialVersion = JSON.parse(await readFile(join(shell, "package.json"), "utf8")).version;
  assert.equal(JSON.parse(await readFile(join(shell, "updates-config.json"), "utf8")).enabled, false);
  await cp(join(shell, "src"), join(stage, "src"), { recursive: true, errorOnExist: true, force: false });
  await patch("windows-signed-update.ts", (s) =>
    exactReplace(s, 'const APP_ID = "com.deltanube.gastronomy";', `const APP_ID = ${JSON.stringify(appId)};`));
  await patch("update-runtime.ts", (s) => {
    s = exactReplace(s, 'import type { KeyObject } from "node:crypto";', 'import { createPublicKey, type KeyObject } from "node:crypto";');
    s = exactReplace(s, 'import { WindowsSignedUpdateAdapter } from "./windows-signed-update-adapter.ts";',
      'import { WindowsSignedUpdateAdapter, requestWindowsUpdate } from "./windows-signed-update-adapter.ts";');
    s = exactReplace(s, '"https://actualizaciones.deltanubeweb.com/gastronomia/windows/x64/"', JSON.stringify(feed));
    s = exactReplace(s, 'const windowsUpdateKeys: ReadonlyMap<string, KeyObject> = new Map();',
      `const windowsUpdateKeys: ReadonlyMap<string, KeyObject> = new Map([["qa",createPublicKey(${JSON.stringify(pem(updateKeys))})]]);`);
    return exactReplace(s, "launch: launchVerifiedWindowsInstaller,",
      `launch: launchVerifiedWindowsInstaller, request: (url, signal) => requestWindowsUpdate(url, signal, Buffer.from(${JSON.stringify(ca.toString("base64"))}, "base64")),`);
  });
  await patch("main.ts", (s) => {
    s = exactReplace(s, "let mainWindow: BrowserWindow | null = null;", `
const labRoot = ${JSON.stringify(lab)};
const labProfile = ${JSON.stringify(profile)};
if (!app.isPackaged || resolve(process.execPath).toLowerCase() !== ${JSON.stringify(exe.toLowerCase())}) {
  throw new Error("QA executable may only run in its own isolated installation");
}
app.setPath("userData", labProfile);
app.commandLine.appendSwitch("disable-background-networking");
app.commandLine.appendSwitch("host-resolver-rules", "MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1");
for (const key of Object.keys(process.env)) if (/^GASTRONOMY_/i.test(key)) delete process.env[key];
process.env.GASTRONOMY_WEB_PROVISION_URL = "";
process.env.GASTRONOMY_WAITER_PROVISION_URL = "";
const labFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
  if (url.origin !== ${JSON.stringify(origin)}) return Promise.reject(new Error("QA refuses a non-loopback service"));
  return labFetch(input, { ...init, redirect: "error" });
};
let mainWindow: BrowserWindow | null = null;`);
    s = exactReplace(s, "const pilotLicenseOptions = await localPilotLicenseOptions", `backgroundE2e = true;
    const pilotLicenseOptions = await localPilotLicenseOptions`);
    return exactReplace(s, "    await createWindow();\n    if (updater.getStatus().state", `    await createWindow();
    const labState = services().appService.bootstrap();
    const labLicense = await licensing.getStatus();
    await writeFile(join(labRoot, "boot-" + app.getVersion() + ".json"), JSON.stringify({
      version: app.getVersion(), packaged: app.isPackaged, exe: process.execPath,
      profile: app.getPath("userData"), updated: process.argv.includes("--updated"),
      catalog: labState.products.map(({id, name, code}) => ({id, name, code})),
      cashSession: labState.cashSession && { id: labState.cashSession.id, status: labState.cashSession.status },
      cashHistory: services().appService.listCashSessionHistory().map(({session}) => ({id: session.id, status: session.status, countedAmountMinor: session.countedAmountMinor})),
      license: { state: labLicense.state, canOperate: labLicense.canOperate, installationId: labLicense.installationId,
        businessName: labLicense.businessName, paidThrough: labLicense.paidThrough },
    }));
    const quitTimer = setInterval(() => {
      if (existsSync(join(labRoot, "qa-quit"))) { clearInterval(quitTimer); app.quit(); }
    }, 300);
    quitTimer.unref();
    if (updater.getStatus().state`);
  });
  const bundle = join(stage, "dist");
  const tsupConfig = join(stage, "qa-tsup.cjs");
  await writeFile(tsupConfig, `module.exports = {entry: ${JSON.stringify(Object.fromEntries(["main", "preload", "print-preview-preload"].map((f) => [f, join(stage, "src", f + ".ts").replaceAll("\\", "/")])))},
    outDir: ${JSON.stringify(bundle)}, format:["cjs"], platform:"node", target:"node20", sourcemap:false, clean:false,
    noExternal:[/^@gastronomy\\//,/^qrcode(?:\\/.*)?$/], external:["electron","better-sqlite3-multiple-ciphers"]};`);
  await command("bundle", ["exec", "tsup", "--config", tsupConfig], shell);
  const configDir = join(stage, "fixture-config");
  await mkdir(configDir);
  await writeFile(join(configDir, "updates-config.json"), JSON.stringify({
    enabled: true, target: "win32-x64", mode: "windows-ed25519-v1", feedUrl: feed,
  }));
  await writeFile(join(configDir, "licensing-config.json"), JSON.stringify({
    serverUrl: origin, publicKey: pem(licenseKeys),
  }));
  // Same assisted NSIS template, private test-only macro to suppress the wizard.
  // The application still launches the installer with its genuine update flags.
  const nsisInclude = join(stage, "qa-silent.nsh");
  await writeFile(nsisInclude, `!macro customInit\r\n  SetSilent silent\r\n!macroend\r\n`, "ascii");
  const base = JSON.parse(await readFile(join(shell, "package.json"), "utf8")).build;
  for (const version of versions) {
    const config = join(stage, `builder-${version}.json`);
    await writeFile(config, JSON.stringify({
      ...base, appId, productName: identity,
      executableName: identity, forceCodeSigning: false,
      directories: { output: output(version) },
      extraMetadata: { name: identity.toLowerCase(), version },
      files: ["package.json", "node_modules/**/*",
        { from: bundle, to: "dist" },
        { from: join(shell, "renderer"), to: "renderer" },
        { from: configDir, to: "." },
        "!**/*.{sqlite,sqlite-shm,sqlite-wal,dnbak}", "!**/.env{,.*}", "!**/licensing-secrets{,/**/*}",
      ],
      npmRebuild: false,
      nsis: {
        ...base.nsis, guid, oneClick: false, perMachine: false, allowElevation: false,
        artifactName: `${identity}-Setup-${version}.exe`, include: nsisInclude,
        createDesktopShortcut: false, createStartMenuShortcut: false, runAfterFinish: true,
      },
      win: { ...base.win, signExecutable: false },
    }));
    await command(`nsis-${version}`, ["exec", "electron-builder", "--config", config,
      "--win", "nsis", "--x64", "--publish", "never"], shell);
    const path = setupFile(version);
    observations.installers[version] = { path, size: (await stat(path)).size, sha256: await installerHash(path, "sha256") };
    console.log("INSTALLER", path);
    await writeFile(reportPath, JSON.stringify(observations, null, 2));
  }
  assert.notEqual(observations.installers[versions[0]].sha256, observations.installers[versions[1]].sha256);
  assert.equal(JSON.parse(await readFile(join(shell, "package.json"), "utf8")).version, initialVersion);
  assert.equal(JSON.parse(await readFile(join(shell, "updates-config.json"), "utf8")).enabled, false);

  const installedRegistry = async (hive) => {
    for (const architecture of ["64", "32"]) {
      try {
        const { stdout } = await run("reg.exe", ["query", `${hive}\\Software\\${guid}`, "/v", "InstallLocation", `/reg:${architecture}`], { windowsHide: true });
        const path = /InstallLocation\s+REG_SZ\s+(.+)/i.exec(stdout)?.[1]?.trim();
        if (path) return path;
      } catch (error) {
        if (error.code !== 1) throw error;
      }
    }
    return null;
  };
  assert.equal(await installedRegistry("HKLM"), null);
  assert.equal(await installedRegistry("HKCU"), null);
  assert.ok(!existsSync(installed));
  const starter = spawn(setupFile(versions[0]), ["/S", "/currentuser", `/D=${installed}`], {
    shell: false, windowsHide: true, env: safeEnv(), stdio: "ignore",
  });
  assert.deepEqual(await once(starter, "close"), [0, null]);
  assert.equal(resolve(await installedRegistry("HKCU")), installed);
  assert.equal(await installedRegistry("HKLM"), null);
  assert.ok(existsSync(exe));
  console.log("INSTALLED_INITIAL", exe);

  const licenseId = randomUUID();
  const installationId = randomUUID();
  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  const paidThrough = iso(now + 20 * 86_400_000);
  const businessName = "Licencia local QA — no comercial";
  const token = signLease({
    schema: 1, product: "delta-nube-gastronomia", licenseId, installationId,
    businessName, issuedAt: iso(now), paidThrough, graceUntil: iso(now + 23 * 86_400_000),
    revision: 1, status: "ACTIVE",
  }, licenseKeys.privateKey.export({ type: "pkcs8", format: "pem" }).toString());
  const licenseFile = join(profile, "license-state.json");
  await writeFile(licenseFile, JSON.stringify({
    schema: 1, installationId, token, lastTrustedTime: now,
    maxSeenWallClock: now, lastVerifiedAt: iso(now), revision: 1,
  }), { flag: "wx" });
  // If Chromium cannot attach within the budget, fail rather than weakening controls.
  app = await _electron.launch({ executablePath: exe, cwd: installed, env: safeEnv(), timeout: 45_000 });
  const page = await app.firstWindow();
  await page.waitForFunction(() => typeof window.gastronomy?.bootstrap === "function");
  const first = await app.evaluate(({ app }) => ({ version: app.getVersion(),
    packaged: app.isPackaged, profile: app.getPath("userData"), exe: app.getPath("exe") }));
  assert.deepEqual(first, { version: versions[0], packaged: true, profile, exe });
  const seeded = await page.evaluate(async () => {
    const api = window.gastronomy;
    if (await api.isInitialAdminPinSetupRequired()) {
      await api.setInitialAdminPin({ currentPin: "1234", newPin: "769283" });
    }
    const license = await api.getLicenseStatus();
    const category = await api.createCategory({ name: "Categoría marcada QA", stockControlEnabled: false });
    const product = await api.createProduct({
      categoryId: category.id, code: "QA-N-N1", name: "Producto persistente QA", stockControlEnabled: false,
      prices: [{ priceListCode: "SALON", amountMinor: 1234 }, { priceListCode: "DELIVERY", amountMinor: 1400 }, { priceListCode: "TAKEAWAY", amountMinor: 1400 }],
    });
    await api.openCashSession({ openingAmountMinor: 1234, note: "Cierre de prueba QA" });
    return { license, product: { id: product.id, name: product.name, code: product.code } };
  });
  assert.equal(seeded.license.state, "ACTIVE");
  assert.equal(seeded.license.installationId, installationId);
  assert.ok(seeded.license.canOperate && seeded.product.id);
  const bytes = observations.installers[versions[1]].size;
  const sha512 = await installerHash(setupFile(versions[1]), "sha512");
  const asset = `versions/${versions[1]}/${identity}-Setup-${versions[1]}.exe`;
  const wholeSeconds = (ms) => iso(ms).replace(/\.\d{3}Z$/, "Z");
  const payload = Buffer.from(JSON.stringify({
    appId, platform: "win32", arch: "x64", channel: "stable", version: versions[1], sequence: 1,
    issuedAt: wholeSeconds(Date.now()), expiresAt: wholeSeconds(Date.now() + 60 * 60_000),
    minVerifierVersion: 1, artifactPath: asset, artifactSize: bytes, artifactSha512: sha512,
  }));
  const signature = sign(null, Buffer.concat([Buffer.from("DeltaNubeGastronomia-Update-v1\0"), payload]), updateKeys.privateKey);
  const manifest = JSON.stringify({ format: 1, keyId: "qa", payload: payload.toString("base64"), signature: signature.toString("base64") });
  release = { asset, size: bytes, manifest };

  // Only the native confirmation response is controlled. All IPC admission,
  // hashing, Win32 process creation and the NSIS replacement run unchanged.
  await app.evaluate(({ dialog }) => {
    globalThis.qaDialogs = { response: 0, calls: 0, valid: false };
    dialog.showMessageBox = async (_window, options) => {
      const d = globalThis.qaDialogs;
      d.calls++;
      d.valid = options.defaultId === 0 && options.cancelId === 0 && options.message.includes("98.0.2");
      return { response: d.response, checkboxChecked: false };
    };
  });
  await page.evaluate(() => window.gastronomy.checkAppUpdate());
  let status;
  for (let attempt = 0; attempt < 480; attempt++) {
    status = await page.evaluate(() => window.gastronomy.getAppUpdateStatus());
    if (["READY", "ERROR"].includes(status.state)) break;
    await sleep(250);
  }
  assert.ok(status);
  assert.equal(status.state, "READY", JSON.stringify(status));
  assert.equal(status.availableVersion, versions[1]);
  await assert.rejects(page.evaluate(() => window.gastronomy.installAppUpdate()), /Cerrá la caja/);
  assert.equal(await app.evaluate(() => globalThis.qaDialogs.calls), 0);
  const closed = await page.evaluate(async () => {
    const result = await window.gastronomy.closeCashSession({ countedAmountMinor: 1234, closingFloatAmountMinor: 0 });
    return { id: result.id, status: result.status, countedAmountMinor: result.countedAmountMinor };
  });
  assert.equal(closed.status, "CLOSED");
  const before = await page.evaluate(async () => {
    const { cashSession } = await window.gastronomy.bootstrap();
    return cashSession && { id: cashSession.id, status: cashSession.status };
  });
  assert.notEqual(before?.status, "OPEN");
  assert.equal((await page.evaluate(() => window.gastronomy.installAppUpdate())).state, "READY");
  assert.equal(await app.evaluate(() => globalThis.qaDialogs.calls), 1);
  assert.equal(await app.evaluate(() => globalThis.qaDialogs.valid), true);
  assert.ok(!existsSync(join(lab, `boot-${versions[1]}.json`)));
  await app.evaluate(() => { globalThis.qaDialogs.response = 1; });
  console.log("CONFIRMED_UPDATE", versions[0], "->", versions[1], "bytes", bytes);
  const exited = new Promise((done) => app.once("close", done));
  const updateRequest = page.evaluate(() => window.gastronomy.installAppUpdate());
  updateRequest.catch(() => {}); // Electron may close IPC before it returns.
  const observation = join(lab, `boot-${versions[1]}.json`);
  for (let attempt = 0; !existsSync(observation) && attempt < 480; attempt++) await sleep(250);
  if (!existsSync(observation)) {
    const result = await Promise.race([updateRequest.catch(() => null), sleep(1000, null)]);
    assert.fail(`The new installed app did not boot. Install IPC result: ${JSON.stringify(result)}`);
  }
  await Promise.race([exited, sleep(5000)]);
  const after = JSON.parse(await readFile(observation, "utf8"));
  assert.equal(after.version, versions[1]);
  assert.equal(after.packaged, true);
  assert.equal(after.updated, true);
  assert.equal(resolve(after.exe), exe);
  assert.equal(after.profile, profile);
  assert.deepEqual(after.catalog.find((it) => it.id === seeded.product.id), seeded.product);
  assert.deepEqual(after.cashSession, before);
  assert.deepEqual(after.cashHistory.find((it) => it.id === closed.id), closed);
  assert.deepEqual(after.license, { state: "ACTIVE", canOperate: true, installationId, businessName, paidThrough });
  const persisted = JSON.parse(await readFile(licenseFile, "utf8"));
  assert.equal(persisted.token, token);
  assert.equal(persisted.installationId, installationId);
  assert.equal(resolve(await installedRegistry("HKCU")), installed);
  assert.equal(await installedRegistry("HKLM"), null);
  assert.equal(requests.filter(({ path }) => path === prefix + asset).length, 1);
  assert.ok(requests.every(({ path }) => path.startsWith(prefix) || path.startsWith("/v1/")));
  Object.assign(observations, {
    result: "PASS", before: { ...first, product: seeded.product, cashSession: before, closedShift: closed, license: "ACTIVE" },
    after, unchangedSignedLicense: true, afterConfirmationOnly: true,
    readyAfterCancellation: true, rejectedWithCashOpen: true, download: { bytes, sha512 }, requests,
  });
  await writeFile(reportPath, JSON.stringify(observations, null, 2));
  console.log("PASS", reportPath);
} catch (error) {
  observations.result = "FAIL";
  observations.error = String(error);
  observations.requests = requests;
  await writeFile(reportPath, JSON.stringify(observations, null, 2));
  throw error;
} finally {
  await writeFile(join(lab, "qa-quit"), "", { flag: "wx" }).catch(() => {});
  await app?.close().catch(() => {});
  await new Promise((done) => { server.close(done); server.closeAllConnections(); });
}
