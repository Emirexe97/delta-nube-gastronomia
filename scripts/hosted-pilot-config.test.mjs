import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { loadHostedPilotConfig, validateHostedPilotConfig } from './hosted-pilot-config.mjs';

const publicKey = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString();
const valid = () => ({
  licenseOrigin: 'https://license.pilot-hostinger.example.com', publicKey,
  accountEmail: 'pilot@example.com', accountPassword: 'fictitious pilot password',
  ordersOrigin: 'https://orders.pilot-hostinger.example.com', storeId: 'pilot_store',
  receiveToken: 'r'.repeat(52), installationId: 'pilot-installation-0001',
});

test('accepts exact HTTPS public DNS origins and valid private pilot fields', () => {
  const value = validateHostedPilotConfig(valid());
  assert.equal(value.licenseOrigin, 'https://license.pilot-hostinger.example.com');
  assert.equal(value.ordersOrigin, 'https://orders.pilot-hostinger.example.com');
});

test('rejects HTTP, loopback/private IPs, local names, paths, userinfo, query, and fragments', () => {
  const invalidOrigins = [
    'http://license.example.com', 'https://localhost', 'https://localhost.example.test',
    'https://127.0.0.1', 'https://192.168.1.20', 'https://10.0.0.7', 'https://host.local',
    'https://service.test', 'https://license.example.com/path', 'https://user:pass@license.example.com',
    'https://license.example.com/?secret=x', 'https://license.example.com/#fragment',
  ];
  for (const origin of invalidOrigins) {
    assert.throws(() => validateHostedPilotConfig({ ...valid(), licenseOrigin: origin }), undefined, origin);
    assert.throws(() => validateHostedPilotConfig({ ...valid(), ordersOrigin: origin }), undefined, origin);
  }
});

test('rejects invalid Ed25519 keys and passwords outside service limits', () => {
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'pem' }).toString();
  assert.throws(() => validateHostedPilotConfig({ ...valid(), publicKey: rsa }), /Ed25519/);
  assert.throws(() => validateHostedPilotConfig({ ...valid(), accountPassword: 'short' }), /15-128/);
  assert.throws(() => validateHostedPilotConfig({ ...valid(), accountPassword: 'p'.repeat(129) }), /15-128/);
  assert.throws(() => validateHostedPilotConfig({ ...valid(), accountPassword: 'é'.repeat(128) + 'a' }), /512 bytes/);
});

test('requires an absolute private config path outside the repository', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'hosted-pilot-config-test-'));
  const repository = join(temp, 'repo'); const privateDir = join(temp, 'private');
  await mkdir(repository); await mkdir(privateDir);
  const inside = join(repository, 'secrets.json'); const outside = join(privateDir, 'secrets.json');
  try {
    await writeFile(inside, JSON.stringify(valid())); await writeFile(outside, JSON.stringify(valid()));
    await assert.rejects(loadHostedPilotConfig(inside, repository), /fuera del repositorio/);
    assert.deepEqual(await loadHostedPilotConfig(outside, repository), validateHostedPilotConfig(valid()));
    await assert.rejects(loadHostedPilotConfig('relative-secrets.json', repository), /absoluta/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
