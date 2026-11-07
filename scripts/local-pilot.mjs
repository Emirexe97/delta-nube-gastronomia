#!/usr/bin/env node
import { mkdtemp, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import http from 'node:http';
import https from 'node:https';
import { createLicenseServer } from '../apps/licensing-service/dist/server.js';
import { createOrdersServer } from '../apps/orders-service/dist/server.js';
import { _electron as electron } from '@playwright/test';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const value = (name) => args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
const businessName = value('--business') ?? 'Comercio ficticio - piloto local';
const waiterUrl = value('--waiter-url');
const lanIp = value('--lan-ip');
// Never accept secrets on the command line: they can be exposed by process listings.
const email = `piloto-${randomBytes(6).toString('hex')}@example.test`;
const password = randomBytes(24).toString('base64url');
if (waiterUrl) {
  const url = new URL(waiterUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new Error('--waiter-url debe ser una URL HTTPS pública sin credenciales ni query.');
}
const privateIpv4 = (ip) => /^(10\.(?:\d{1,3}\.){2}\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.(?:\d{1,3}\.)\d{1,3}|192\.168\.(?:\d{1,3}\.)\d{1,3})$/.test(ip);
if (lanIp) {
  const localAddresses = Object.values(networkInterfaces()).flat().filter((item) => item?.family === 'IPv4' && !item.internal).map((item) => item.address);
  if (!privateIpv4(lanIp) || !localAddresses.includes(lanIp)) throw new Error('--lan-ip debe ser una IP IPv4 RFC1918 asignada a esta PC.');
}
if (lanIp && waiterUrl) throw new Error('Usá --lan-ip o --waiter-url, no ambos.');
const profile = await mkdtemp(join(tmpdir(), 'gastronomy-local-pilot-'));
const installationId = randomUUID();
const authority = generateKeyPairSync('ed25519');
const publicKey = authority.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const privateKey = authority.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const adminToken = randomBytes(32).toString('base64url');
const license = createLicenseServer({
  dbPath: join(profile, 'license-authority.sqlite'), adminToken, privateKey,
});
const listen = (server, host = '127.0.0.1') => new Promise((resolveListen, reject) => {
  server.once('error', reject);
  server.listen(0, host, () => {
    server.off('error', reject);
    resolveListen(server.address().port);
  });
});
const licensePort = await listen(license.server);
const licenseUrl = `http://127.0.0.1:${licensePort}`;
const headers = { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' };
async function adminPost(path, body) {
  const response = await fetch(`${licenseUrl}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(`Licensing ${path}: HTTP ${response.status} (${data.error ?? 'error'})`);
  return data;
}
const { license: newLicense } = await adminPost('/admin/licenses', {
  businessName, paidThrough: new Date(Date.now() + 365 * 86400_000).toISOString(),
});
await adminPost('/admin/accounts', { licenseId: newLicense.id, email, password });
const configPath = join(profile, 'local-license-config.json');
await writeFile(configPath, JSON.stringify({ serverUrl: licenseUrl, publicKey }, null, 2), { mode: 0o600 });
await chmod(configPath, 0o600).catch(() => {});
await writeFile(join(profile, 'CUENTA_LOCAL.txt'), `Cuenta ficticia de piloto local\nCorreo: ${email}\nContraseña: ${password}\nLicencia: ${newLicense.id}\n\nNo reutilizar estas credenciales. Autoridad y claves efímeras: al cerrar, la cuenta no podrá reactivarse.\n`, { mode: 0o600 });
await chmod(join(profile, 'CUENTA_LOCAL.txt'), 0o600).catch(() => {});
await writeFile(join(profile, 'license-state.json'), JSON.stringify({ schema: 1, installationId, token: null, lastTrustedTime: 0, maxSeenWallClock: Date.now(), lastVerifiedAt: null, revision: 0 }), { mode: 0o600 });

const tokenHash = (token) => createHash('sha256').update(token).digest('hex');
const receiveToken = randomBytes(32).toString('base64url');
const siteToken = randomBytes(32).toString('base64url');
const orderDb = join(profile, 'orders.sqlite');
const orderConfig = {
  dbPath: orderDb,
  stores: [{ id: 'piloto-local', receiveInstallationId: installationId, whatsappNumber: '5491100000000', receiveTokenHash: tokenHash(receiveToken), sites: [{ id: 'demo', submitTokenHash: tokenHash(siteToken) }] }],
  waiterPublicBaseUrl: waiterUrl ?? (lanIp ? `https://${lanIp}:8443/` : 'http://127.0.0.1:8098/'),
};
const orders = createOrdersServer(orderConfig);
// Keep the business service on loopback. In LAN mode a separate loopback bridge preserves the phone-facing Host.
const ordersPort = await new Promise((resolveListen, reject) => {
  orders.server.once('error', reject);
  orders.server.listen(lanIp ? 0 : 8098, '127.0.0.1', () => {
    orders.server.off('error', reject);
    resolveListen(orders.server.address().port);
  });
});
const ordersUrl = 'http://127.0.0.1:8098';
let localOrdersBridge;
if (lanIp) {
  localOrdersBridge = http.createServer((req, res) => {
    const requestPath = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    const host = requestPath.startsWith('/v1/waiter/') ? `${lanIp}:8443` : '127.0.0.1:8098';
    const headers = { ...req.headers, host };
    delete headers.origin;
    const upstream = http.request({ hostname: '127.0.0.1', port: ordersPort, path: req.url, method: req.method, headers }, (response) => {
      res.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(res);
    });
    upstream.setTimeout(8_000, () => upstream.destroy(new Error('upstream timeout')));
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.pipe(upstream);
  });
  await new Promise((resolveListen, reject) => {
    localOrdersBridge.once('error', reject);
    localOrdersBridge.listen(8098, '127.0.0.1', () => { localOrdersBridge.off('error', reject); resolveListen(); });
  });
}

// Optional same-Wi-Fi entry point: a self-signed certificate only, never installed/trusted globally.
let lanProxy;
let lanCertPath;
if (lanIp) {
  lanCertPath = join(profile, 'waiter-lan-cert.pem');
  const lanKeyPath = join(profile, 'waiter-lan-key.pem');
  const certEnv = { ...process.env, PILOT_LAN_IP: lanIp, PILOT_CERT_PATH: lanCertPath, PILOT_KEY_PATH: lanKeyPath };
  const powershell = String.raw`$rsa=[System.Security.Cryptography.RSA]::Create(2048); $req=[System.Security.Cryptography.X509Certificates.CertificateRequest]::new(('CN='+$env:PILOT_LAN_IP),$rsa,[System.Security.Cryptography.HashAlgorithmName]::SHA256,[System.Security.Cryptography.RSASignaturePadding]::Pkcs1); $san=[System.Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new(); $san.AddIpAddress([System.Net.IPAddress]::Parse($env:PILOT_LAN_IP)); $req.CertificateExtensions.Add($san.Build()); $cert=$req.CreateSelfSigned([DateTimeOffset]::UtcNow.AddMinutes(-5),[DateTimeOffset]::UtcNow.AddDays(2)); [IO.File]::WriteAllText($env:PILOT_CERT_PATH,$cert.ExportCertificatePem()); [IO.File]::WriteAllText($env:PILOT_KEY_PATH,$rsa.ExportPkcs8PrivateKeyPem())`;
  execFileSync('pwsh.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', powershell], { env: certEnv, stdio: 'ignore' });
  await chmod(lanCertPath, 0o600).catch(() => {});
  await chmod(lanKeyPath, 0o600).catch(() => {});
  const cert = await readFile(lanCertPath);
  const key = await readFile(lanKeyPath);
  const publicHost = `${lanIp}:8443`;
  const allowed = (method, pathname) =>
    ((pathname === '/waiter' || pathname === '/waiter/') && ['GET', 'HEAD'].includes(method)) ||
    (method === 'POST' && ['/v1/waiter/pair', '/v1/waiter/rpc'].includes(pathname)) ||
    (method === 'GET' && (/^\/v1\/waiter\/pair\/[0-9a-f-]{36}$/.test(pathname) || /^\/v1\/waiter\/requests\/[0-9a-f-]{36}$/.test(pathname)));
  lanProxy = https.createServer({ key, cert }, (req, res) => {
    let pathname;
    try { pathname = new URL(req.url ?? '/', `https://${publicHost}`).pathname; } catch { res.writeHead(400).end(); return; }
    if (req.headers.host?.toLowerCase() !== publicHost.toLowerCase() || !allowed(req.method ?? 'GET', pathname)) { res.writeHead(404, { 'cache-control': 'no-store' }).end(); return; }
    const upstream = http.request({ hostname: '127.0.0.1', port: ordersPort, path: req.url, method: req.method, headers: { ...req.headers, host: publicHost } }, (response) => {
      res.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(res);
    });
    req.setTimeout(8_000, () => req.destroy());
    upstream.setTimeout(8_000, () => upstream.destroy(new Error('upstream timeout')));
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.pipe(upstream);
  });
  await new Promise((resolveListen, reject) => {
    lanProxy.once('error', reject);
    lanProxy.listen(8443, lanIp, () => { lanProxy.off('error', reject); resolveListen(); });
  });
  const lanRequest = (path) => new Promise((resolveResponse, reject) => {
    const request = https.get({ hostname: lanIp, port: 8443, path, ca: cert, rejectUnauthorized: true }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolveResponse({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    request.on('error', reject);
  });
  const smokePage = await lanRequest('/waiter');
  const smokeAdmin = await lanRequest('/health');
  const smokeTerminal = await lanRequest('/v1/waiter/terminal/requests');
  if (smokePage.status !== 200 || !smokePage.body.includes('<html') || smokeAdmin.status !== 404 || smokeTerminal.status !== 404) throw new Error('HTTPS local proxy smoke test failed.');
}

// Drop inherited application endpoints/settings; the child gets only this pilot's loopback services.
const childEnv = { ...process.env };
for (const key of Object.keys(childEnv)) if (key.startsWith('GASTRONOMY_')) delete childEnv[key];
Object.assign(childEnv, {
  GASTRONOMY_LOCAL_PILOT: '1',
  GASTRONOMY_WEB_PROVISION_URL: ordersUrl,
  GASTRONOMY_WEB_ORDERS_URL: ordersUrl,
  GASTRONOMY_WEB_ORDERS_STORE_ID: 'piloto-local',
  GASTRONOMY_WEB_ORDERS_TOKEN: receiveToken,
  ...((lanIp || waiterUrl) ? { GASTRONOMY_WAITER_PUBLIC_URL: lanIp ? `https://${lanIp}:8443/` : waiterUrl } : {}),
});
let app;
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  try { await app?.close(); } catch {}
  if (lanProxy?.listening) await new Promise((done) => lanProxy.close(done));
  if (localOrdersBridge?.listening) await new Promise((done) => localOrdersBridge.close(done));
  await orders.close().catch(() => {});
  license.close();
}
process.once('SIGINT', () => void shutdown().finally(() => process.exit(0)));
process.once('SIGTERM', () => void shutdown().finally(() => process.exit(0)));
try {
  app = await electron.launch({ args: ['apps/desktop-shell', `--user-data-dir=${profile}`], cwd: root, env: childEnv });
  const page = await app.firstWindow();
  // Keep printing inert by default. Patch every later hidden print window too, and capture rendered content.
  await app.evaluate(({ app: electronApp, BrowserWindow }, profileDir) => {
    const fs = process.getBuiltinModule('node:fs');
    const path = process.getBuiltinModule('node:path');
    const capture = path.join(profileDir, 'simulated-printer.jsonl');
    const patch = (contents) => {
      if (!contents || contents.__pilotPrinterPatched) return;
      contents.__pilotPrinterPatched = true;
      contents.getPrintersAsync = async () => [{ name: 'PILOTO-SIMULADA', displayName: 'Impresora simulada (no imprime)', description: 'Captura local en simulated-printer.jsonl', status: 0, isDefault: true, options: {} }];
      contents.print = (options, callback) => {
        void contents.executeJavaScript('document.body.innerText').then((text) => {
          fs.appendFileSync(capture, JSON.stringify({ at: new Date().toISOString(), options, text }) + '\n', { mode: 0o600 });
          if (typeof callback === 'function') callback(true, 'Captura local simulada; no se envió a impresora.');
        }, () => { if (typeof callback === 'function') callback(false, 'No se pudo capturar la impresión local.'); });
      };
    };
    const brand = (window) => {
      window.setTitle('PRUEBA LOCAL - datos ficticios');
      window.webContents.on('page-title-updated', (event) => { event.preventDefault(); });
      patch(window.webContents);
    };
    BrowserWindow.getAllWindows().forEach(brand);
    electronApp.on('browser-window-created', (_event, window) => brand(window));
  }, profile);
  console.log(`Piloto local iniciado. Perfil aislado: ${profile}`);
  console.log(`Servicios: licencia ${licenseUrl}; pedidos ${ordersUrl} (solo loopback).`);
  console.log(`Cuenta de prueba: ${join(profile, 'CUENTA_LOCAL.txt')} (no se muestran secretos en consola).`);
  console.log(lanIp ? `Mozo HTTPS en Wi-Fi local: https://${lanIp}:8443/ (certificado autofirmado exclusivo de este piloto; no lo instales ni lo confíes en el sistema).` : waiterUrl ? `URL Mozo configurada: ${waiterUrl}` : 'Mozo disponible solo en esta PC; el teléfono no podrá abrir el QR sin --lan-ip o --waiter-url HTTPS previamente preparado.');
  console.log('Impresión simulada; no se imprime en papel. Cerrá Electron para detener los servicios.');
  if (args.includes('--check-only')) {
    if (lanIp) console.log('Smoke check HTTPS: /waiter responde; /health y /v1/waiter/terminal/requests están denegados.');
    await shutdown();
    process.exit(0);
  }
  if (args.includes('--auto-login')) {
    await page.getByRole('link', { name: 'Configuración', exact: true }).click();
    await page.getByRole('button', { name: 'Licencia', exact: true }).click();
    await page.getByLabel('Correo de la cuenta').fill(email);
    await page.getByLabel('Contraseña de la cuenta').fill(password);
    await page.getByRole('button', { name: 'Ingresar y activar este equipo', exact: true }).click();
  }
  // Poll the resolved IPC result; an async browser predicate can be treated as a truthy Promise.
  const activationDeadline = args.includes('--auto-login') ? Date.now() + 30_000 : Infinity;
  for (;;) {
    const status = await page.evaluate(() => window.gastronomy.getLicenseStatus());
    if (status.state === 'ACTIVE' && status.canOperate) break;
    if (Date.now() >= activationDeadline) throw new Error(`No se activó la cuenta de prueba: ${await page.locator('#settings-license [role="alert"]').textContent().catch(() => status.message)}`);
    await new Promise((done) => setTimeout(done, 300));
  }
  const seeded = await page.evaluate(async () => {
    const api = window.gastronomy;
    const data = await api.bootstrap();
    await api.openCashSession({ openingAmountMinor: 0 });
    await api.ensureTable({ number: 88 });
    const waiter = await api.createUser({ fullName: 'Mozo piloto', roleCode: 'WAITER', pin: '5731', authorizerPin: '1234' });
    for (const name of ['Plato piloto uno', 'Plato piloto dos']) await api.createProduct({ categoryId: data.categories[0].id, name, prices: [
      { priceListCode: 'SALON', amountMinor: 9900 }, { priceListCode: 'TAKEAWAY', amountMinor: 9900 }, { priceListCode: 'DELIVERY', amountMinor: 9900 },
    ] });
    return { waiterId: waiter.id, waiterName: waiter.fullName, table: 88 };
  });
  console.log(`Licencia activada mediante cuenta; datos de prueba creados: mesa ${seeded.table}, mozo ${seeded.waiterName} (PIN 5731), dos productos ficticios.`);
  await page.reload();
  await page.getByRole('link', { name: 'Configuración' }).click();
  const kitchen = page.getByRole('region', { name: 'Comanda de cocina', exact: true });
  await kitchen.getByLabel('Modo', { exact: false }).selectOption('SYSTEM_DIRECT');
  await kitchen.getByLabel('Impresora', { exact: false }).selectOption('PILOTO-SIMULADA');
  await kitchen.getByRole('button', { name: 'Imprimir prueba' }).click();
  await page.getByRole('button', { name: 'Guardar configuración', exact: true }).click();
  const waiterPanel = page.locator('#settings-waiter');
  await page.getByRole('button', { name: 'Modo Mozo', exact: true }).click().catch(() => {});
  await waiterPanel.locator('select').selectOption(seeded.waiterId);
  await waiterPanel.getByRole('button', { name: 'Generar QR presencial' }).click();
  await waiterPanel.locator('img').waitFor({ state: 'visible' });
  await waiterPanel.locator('img').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(profile, 'ready.png') });
  const readyStatus = await page.evaluate(() => window.gastronomy.getLicenseStatus());
  await writeFile(join(profile, 'pilot-ready.json'), JSON.stringify({ profile, waiterUrl: lanIp ? `https://${lanIp}:8443/waiter` : waiterUrl ?? 'http://127.0.0.1:8098/waiter', table: 88, printer: 'PILOTO-SIMULADA', licenseState: readyStatus.state }, null, 2), { mode: 0o600 });
  console.log(`QR Mozo preparado en Configuración. La impresión de prueba quedó capturada sin imprimir en papel: ${join(profile, 'simulated-printer.jsonl')}.`);
  await app.waitForEvent('close', { timeout: 0 });
} finally {
  await shutdown();
}
