#!/usr/bin/env node
import { cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { resolve, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(new URL('../..', import.meta.url)));
function args(argv) {
  const out = {};
  for (const item of argv) {
    const m = /^--(kind|out)=(.+)$/.exec(item);
    if (!m || out[m[1]]) throw new Error('Usage: node scripts/hosting/package.mjs --kind=license|waiter --out=<fresh-directory>');
    out[m[1]] = m[2];
  }
  if (!['license', 'waiter'].includes(out.kind) || !out.out) throw new Error('Usage: node scripts/hosting/package.mjs --kind=license|waiter --out=<fresh-directory>');
  return { kind: out.kind, out: resolve(out.out) };
}
async function exists(path) { try { await stat(path); return true; } catch { return false; } }
async function copyRequired(src, dest) {
  if (!await exists(src)) throw new Error(`Missing compiled input: ${relative(repo, src)}`);
  await cp(src, dest, { recursive: true, errorOnExist: true, force: false });
}
const { kind, out } = args(process.argv.slice(2));
if (out === repo || !relative(repo, out).startsWith(`..${sep}`)) throw new Error('Output must be a fresh directory outside the repository');
try { await stat(out); throw new Error('Output directory already exists; choose a fresh path'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const app = kind === 'license' ? 'licensing-service' : 'orders-service';
const root = join(out, `hosting-${kind}-pilot`);
  await mkdir(root, { recursive: true });
try {
  const svc = join(root, 'service');
  await mkdir(svc);
  await copyRequired(join(repo, 'apps', app, 'dist'), join(svc, 'dist'));
  await copyRequired(join(repo, 'apps', app, 'package.json'), join(svc, 'package.json'));
  const vendors = [['licensing', 'packages/licensing'], ['web-orders', 'packages/web-orders']];
  if (kind === 'waiter') vendors.push(['ui', 'packages/ui']);
  for (const [name, source] of vendors) {
    const dest = join(root, 'vendor', name);
    await mkdir(dest, { recursive: true });
    await copyRequired(join(repo, source, 'dist'), join(dest, 'dist'));
    await copyRequired(join(repo, source, 'package.json'), join(dest, 'package.json'));
  }
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: `dng-hosting-${kind}-pilot`, private: true, type: 'module', engines: { node: '>=22.13' }, main: 'app.js', scripts: { start: 'node app.js' }, dependencies: { express: '^4.21.2', '@gastronomy/licensing': 'file:vendor/licensing', '@gastronomy/web-orders': 'file:vendor/web-orders', ...(kind === 'waiter' ? { '@gastronomy/ui': 'file:vendor/ui' } : {}) } }, null, 2) + '\n');
  await copyRequired(join(fileURLToPath(new URL('.', import.meta.url)), 'app.js'), join(root, 'app.js'));
  await copyRequired(join(fileURLToPath(new URL('.', import.meta.url)), 'README.md'), join(root, 'README.md'));
  console.log(`Created ${root}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
