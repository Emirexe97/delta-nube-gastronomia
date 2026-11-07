import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { generateKeyPairSync, createHash, randomBytes } from 'node:crypto';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile, stat } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const builder = join(repo, 'scripts/hosting/package.mjs');
const entry = join(repo, 'scripts/hosting/app.js');
const hash = value => createHash('sha256').update(value).digest('hex');
const fixtures = [];

async function setup(kind, config) {
  const temp = await mkdtemp(join(tmpdir(), 'dng-hosting-test-'));
  fixtures.push(temp);
  const home = join(temp, 'home'); await mkdir(home);
  const out = join(temp, 'package');
  const b = spawn(process.execPath, [builder, `--kind=${kind}`, `--out=${out}`], { cwd: repo, stdio: 'pipe' });
  const [stdout, buildStderr] = await Promise.all([new Promise(r => { let s=''; b.stdout.on('data',d=>s+=d); b.stdout.on('end',()=>r(s)); }), new Promise(r => { let s=''; b.stderr.on('data',d=>s+=d); b.stderr.on('end',()=>r(s)); })]);
  const code = await new Promise(r => b.on('close', r));
  assert.equal(code, 0, `${stdout}${buildStderr}`);
  const root = join(out, `hosting-${kind}-pilot`);
  const scope = join(root, 'node_modules', '@gastronomy'); await mkdir(scope, { recursive: true });
  await cp(join(root, 'vendor/licensing'), join(scope, 'licensing'), { recursive: true });
  await cp(join(root, 'vendor/web-orders'), join(scope, 'web-orders'), { recursive: true });
  if (kind === 'waiter') {
    await cp(join(root, 'vendor/ui'), join(scope, 'ui'), { recursive: true });
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    assert.equal(manifest.dependencies['@gastronomy/ui'], 'file:vendor/ui');
  }
  if (config !== undefined) {
    const dir = join(home, `.deltanube-gastronomy-hosting-${kind}-pilot-v1`); await mkdir(dir, { mode: 0o700 });
    await writeFile(join(dir, 'config.json'), JSON.stringify(config), { mode: 0o600 });
  }
  const port = await freePort();
  const child = spawn(process.execPath, [join(root, 'app.js')], { cwd: root, env: { ...process.env, USERPROFILE: home, HOME: home, HOSTING_PILOT_KIND: kind, PORT: String(port) }, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = ''; child.stderr.on('data', d => stderr += String(d));
  return { temp, home, root, port, child, get stderrText() { return stderr; } };
}
async function freePort() {
  const { createServer } = await import('node:net'); const server = createServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const port = server.address().port;
  await new Promise(r => server.close(r)); return port;
}
async function request(port, path, child) {
  let lastError;
  for (let i = 0; i < 50; i++) {
    try { return await fetch(`http://127.0.0.1:${port}${path}`); } catch (e) { lastError = e; await delay(100); }
  }
  throw new Error(`Service did not start on ${port}: ${child?.exitCode}; ${child?.stderrText ?? ''}; ${lastError}`);
}
function rawRequest(port, path, host) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, headers: { host } }, res => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject); req.end();
  });
}
async function stop(child) {
  if (child.exitCode === null) { child.kill('SIGTERM'); await Promise.race([new Promise(r => child.once('exit', r)), delay(3000)]); if (child.exitCode === null) child.kill('SIGKILL'); }
}
test.after(async () => {
  for (const dir of fixtures) {
    const rel = relative(resolve(tmpdir()), resolve(dir));
    if (!isAbsolute(dir) || rel.startsWith(`..${sep}`) || rel === '..' || !/^[\/]?dng-hosting-test-/.test(rel)) throw new Error(`Refusing unsafe test cleanup: ${dir}`);
    await rm(dir, { recursive: true, force: true });
  }
});

test('missing config stays health-only and fail-closed', async () => {
  const x = await setup('waiter');
  try {
    const r = await request(x.port, '/health', x.child); assert.equal(r.status, 503); assert.equal((await r.json()).error, 'configuration_required');
    assert.equal((await fetch(`http://127.0.0.1:${x.port}/v1/waiter/pair`)).status, 503);
    assert.equal(await exists(join(x.home, '.deltanube-gastronomy-hosting-waiter-pilot-v1', 'orders.sqlite')), false);
  } finally { await stop(x.child); }
});

test('invalid config fails before opening a listener', async () => {
  const x = await setup('license', { marker: 'wrong', kind: 'license', origin: 'https://pilot.example' });
  try { await new Promise(r => x.child.once('exit', r)); assert.notEqual(x.child.exitCode, 0); }
  finally { await stop(x.child); }
});

test('license mode starts with health marker and preserves its database on restart', async () => {
  const { privateKey } = generateKeyPairSync('ed25519');
  const x = await setup('license', { marker: 'hosting-pilot-v1', kind: 'license', origin: 'https://pilot.example', privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), adminToken: randomBytes(40).toString('hex') });
  try {
    const first = await request(x.port, '/health', x.child); assert.equal(first.status, 200); const health1 = await first.json(); assert.equal(health1.release, 'hosting-pilot-v1');
    const token = JSON.parse(await readFile(join(x.home, '.deltanube-gastronomy-hosting-license-pilot-v1', 'config.json'), 'utf8')).adminToken;
    const created = await fetch(`http://127.0.0.1:${x.port}/admin/licenses`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ businessName: 'Fictitious Pilot Store', paidThrough: '2099-12-31T00:00:00.000Z' }) });
    assert.equal(created.status, 201); const licenseId = (await created.json()).license.id;
    const db = join(x.home, '.deltanube-gastronomy-hosting-license-pilot-v1', 'licenses.sqlite'); assert.equal((await stat(db)).isFile(), true);
    await stop(x.child);
    const port = await freePort(); const child = spawn(process.execPath, [join(x.root, 'app.js')], { cwd: x.root, env: { ...process.env, USERPROFILE: x.home, HOME: x.home, HOSTING_PILOT_KIND: 'license', PORT: String(port) }, stdio: 'ignore' }); x.child = child;
    const health2 = await (await request(port, '/health', child)).json(); assert.notEqual(health1.bootNonce, health2.bootNonce); assert.equal((await stat(db)).isFile(), true);
    const restored = await fetch(`http://127.0.0.1:${port}/admin/licenses`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(restored.status, 200); assert.ok((await restored.json()).licenses.some(license => license.id === licenseId));
    const backupBase = join(x.home, '.deltanube-gastronomy-hosting-license-pilot-v1', 'backups');
    const backups = await readdir(backupBase); assert.equal(backups.length, 1);
    const backupDir = join(backupBase, backups[0]);
    assert.equal((await readFile(join(backupDir, 'config.json'), 'utf8')), await readFile(join(x.home, '.deltanube-gastronomy-hosting-license-pilot-v1', 'config.json'), 'utf8'));
    const backupDb = new DatabaseSync(join(backupDir, 'licenses.sqlite'), { readOnly: true });
    try {
      assert.equal(backupDb.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
      assert.equal(backupDb.prepare('SELECT id FROM licenses WHERE id = ?').get(licenseId).id, licenseId);
    } finally { backupDb.close(); }
  } finally { await stop(x.child); }
});

test('waiter mode is single-store and blocks catalog/order/admin routes', async () => {
  const x = await setup('waiter', { marker: 'hosting-pilot-v1', kind: 'waiter', origin: 'https://pilot.example', stores: [{ id: 'pilot-store', isFictitious: true, whatsappNumber: '541112345678', receiveInstallationId: 'pilot-install', receiveTokenHash: hash('receive-token'), sites: [{ id: 'pilot-site', submitTokenHash: hash('site-token') }] }] });
  try {
    const h = await request(x.port, '/health', x.child); assert.equal(h.status, 200); assert.equal((await h.json()).release, 'hosting-pilot-v1');
    assert.equal((await fetch(`http://127.0.0.1:${x.port}/v1/web-orders`)).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${x.port}/v1/web-catalog`)).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${x.port}/admin/licenses`)).status, 404);
    const page = await rawRequest(x.port, '/waiter', 'pilot.example');
    assert.equal(page.status, 200); assert.match(page.body, /Ingresar como mozo/i);
    assert.match(page.body, /--dn-color-primary: #c2410c/);
    assert.equal((await rawRequest(x.port, '/waiter', 'wrong.example')).status, 403);
    assert.equal((await rawRequest(x.port, 'http://evil.example/v1/waiter/pair', 'pilot.example')).status, 400);
    assert.equal((await rawRequest(x.port, '/health', 'pilot.example')).status, 200);
    const db = join(x.home, '.deltanube-gastronomy-hosting-waiter-pilot-v1', 'orders.sqlite'); assert.equal((await stat(db)).isFile(), true);
  } finally { await stop(x.child); }
});

async function exists(path) { try { await stat(path); return true; } catch { return false; } }
