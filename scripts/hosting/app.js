import { createServer } from 'node:http';
import { createPrivateKey, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { chmod, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const kind = process.env.HOSTING_PILOT_KIND;
if (!['license', 'waiter'].includes(kind)) throw new Error('HOSTING_PILOT_KIND must be license or waiter');
const dataDir = join(homedir(), `.deltanube-gastronomy-hosting-${kind}-pilot-v1`);
try { if ((await lstat(dataDir)).isSymbolicLink()) throw new Error('data directory symlink not permitted'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
await mkdir(dataDir, { recursive: true, mode: 0o700 });
await chmod(dataDir, 0o700);
const configPath = join(dataDir, 'config.json');
let config;
try {
  if ((await lstat(configPath)).isSymbolicLink()) throw new Error('config symlink not permitted');
  await chmod(configPath, 0o600);
  config = JSON.parse(await readFile(configPath, 'utf8'));
}
catch { config = undefined; }
function origin(value) {
  if (typeof value !== 'string') throw new Error('Invalid origin');
  const u = new URL(value);
  if (u.protocol !== 'https:' || u.origin !== value || u.username || u.password || u.pathname !== '/' || u.search || u.hash) throw new Error('Origin must be exact HTTPS origin');
  return value;
}
function valid(c) {
  if (!c || c.marker !== 'hosting-pilot-v1' || c.kind !== kind) throw new Error('Invalid pilot configuration');
  origin(c.origin);
  if (kind === 'license') {
    if (typeof c.privateKey !== 'string' || createPrivateKey(c.privateKey).asymmetricKeyType !== 'ed25519' || typeof c.adminToken !== 'string' || Buffer.byteLength(c.adminToken) < 32) throw new Error('Invalid license credentials');
    const panel = [c.panelUsername, c.panelPasswordHash].filter(Boolean).length;
    if (panel !== 0 && panel !== 2) throw new Error('Incomplete panel credentials');
    if (panel && (typeof c.panelUsername !== 'string' || typeof c.panelPasswordHash !== 'string')) throw new Error('Invalid panel credentials');
    return;
  }
  if (!Array.isArray(c.stores) || c.stores.length !== 1 || c.webSiteProvisionSecret !== undefined) throw new Error('Waiter pilot requires exactly one store and no provisioning secret');
  const s = c.stores[0];
  if (!s || typeof s.receiveInstallationId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(s.receiveInstallationId) || !Array.isArray(s.sites) || s.sites.length !== 1 || !/^[a-f0-9]{64}$/i.test(s.receiveTokenHash ?? '') || !/^[a-f0-9]{64}$/i.test(s.sites[0]?.submitTokenHash ?? '')) throw new Error('Invalid single-store pilot');
  if (c.stores.some(x => x.isFictitious !== true)) throw new Error('Pilot store must be explicitly fictitious');
}
async function backupLicenseAuthority() {
  const database = join(dataDir, 'licenses.sqlite');
  let dbInfo;
  try { dbInfo = await lstat(database); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (dbInfo.isSymbolicLink() || !dbInfo.isFile()) throw new Error('License database must be a regular file');
  const backupRoot = join(dataDir, 'backups');
  try { if ((await lstat(backupRoot)).isSymbolicLink()) throw new Error('Backup directory symlink not permitted'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(backupRoot, { recursive: true, mode: 0o700 }); await chmod(backupRoot, 0o700);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = join(backupRoot, `${stamp}-${randomBytes(4).toString('hex')}`);
  await mkdir(backupDir, { mode: 0o700 });
  try {
    if ((await lstat(backupDir)).isSymbolicLink()) throw new Error('Backup target symlink not permitted');
    const snapshot = join(backupDir, 'licenses.sqlite');
    const db = new DatabaseSync(database, { readOnly: true });
    try { db.exec(`VACUUM INTO '${snapshot.replace(/'/g, "''")}'`); } finally { db.close(); }
    await chmod(snapshot, 0o600);
    await writeFile(join(backupDir, 'config.json'), await readFile(configPath), { mode: 0o600, flag: 'wx' });
    await chmod(join(backupDir, 'config.json'), 0o600);
  } catch (error) {
    // Preserve evidence but never continue starting the authority after a partial backup.
    throw new Error(`License authority backup failed: ${error.message}`);
  }
}
const bootNonce = randomBytes(12).toString('hex');
if (!config) {
  const server = createServer((req, res) => {
    const health = req.method === 'GET' && req.url === '/health';
    const data = JSON.stringify({ ok: false, error: 'configuration_required', release: 'hosting-pilot-v1', bootNonce });
    res.writeHead(health ? 503 : 503, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(data);
  });
  server.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
} else {
  valid(config);
  let service;
  if (kind === 'license') {
    await backupLicenseAuthority();
    const { createLicenseServer } = await import('./service/dist/server.js');
    service = createLicenseServer({ dbPath: join(dataDir, 'licenses.sqlite'), adminToken: config.adminToken, privateKey: config.privateKey, ...(config.panelUsername ? { panelAuth: { username: config.panelUsername, passwordHash: config.panelPasswordHash, origin: config.origin, secureCookies: true } } : {}) });
  }
  else {
    const stores = config.stores;
    const { createOrdersServer } = await import('./service/dist/server.js');
    const { validateStores } = await import('./service/dist/config.js');
    service = createOrdersServer({ dbPath: join(dataDir, 'orders.sqlite'), stores: validateStores(stores), waiterPublicBaseUrl: config.origin });
  }
  const raw = service.server;
  const bootNonce = randomBytes(12).toString('hex');
  let listener = raw;
  if (kind === 'waiter') {
    const limited = createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify({ ok: true, release: 'hosting-pilot-v1', bootNonce })); return;
      }
      let pathname;
      try {
        const rawUrl = req.url ?? '';
        if (!rawUrl.startsWith('/') || rawUrl.startsWith('//')) throw new Error('bad target');
        const parsed = new URL(rawUrl, 'http://localhost');
        if (parsed.origin !== 'http://localhost') throw new Error('bad target');
        pathname = parsed.pathname;
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' }); res.end('{"error":"bad_request"}'); return;
      }
      if (!['/waiter', '/waiter/'].includes(pathname) && !pathname.startsWith('/v1/waiter/')) {
        res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"error":"not_found"}'); return;
      }
      raw.emit('request', req, res);
    });
    limited.requestTimeout = raw.requestTimeout;
    limited.headersTimeout = raw.headersTimeout;
    limited.keepAliveTimeout = raw.keepAliveTimeout;
    limited.maxConnections = raw.maxConnections;
    limited.on('connection', socket => socket.setTimeout(15_000, () => socket.destroy()));
    // The wrapped service server owns its store lifecycle; forward only permitted requests.
    listener = limited;
  } else {
    const handler = raw.listeners('request').at(-1);
    raw.removeAllListeners('request');
    raw.on('request', (req, res) => {
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        res.end(JSON.stringify({ status: 'ok', release: 'hosting-pilot-v1', bootNonce }));
        return;
      }
      handler(req, res);
    });
  }
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error('PORT must be an integer from 1 to 65535');
  listener.listen(port, '0.0.0.0');
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    const deadline = setTimeout(() => listener.closeAllConnections(), 15_000);
    deadline.unref();
    listener.close(() => { clearTimeout(deadline); void service.close(); });
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
