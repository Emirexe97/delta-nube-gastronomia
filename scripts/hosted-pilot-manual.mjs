#!/usr/bin/env node
// Starts an isolated hosted pilot without driving the UI. The operator uses CUA.
import { mkdtemp, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, isAbsolute } from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(join(root, 'apps/desktop-shell/package.json'));
export function buildBootstrapSource({ profile, mainPath }) {
  return `
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const profile = ${JSON.stringify(profile)};
const capture = path.join(profile, 'simulated-printer.jsonl');
app.setName('PILOTO ALOJADO - datos ficticios');
app.setPath('userData', profile);
const patch = (contents) => {
  if (!contents || contents.__hostedPilotPrinterPatched) return;
  contents.__hostedPilotPrinterPatched = true;
  contents.getPrintersAsync = async () => [{ name: 'PILOTO-SIMULADA', displayName: 'Impresora simulada (no imprime)', description: 'Captura local', status: 0, isDefault: true, options: {} }];
  contents.print = (options, callback) => {
    let called = false;
    const done = (ok, message) => { if (called) return; called = true; if (typeof callback === 'function') callback(ok, message); };
    void Promise.resolve().then(() => contents.executeJavaScript('document.body.innerText')).then((text) => {
      fs.appendFileSync(capture, JSON.stringify({ at: new Date().toISOString(), options, text }) + '\\n', { mode: 0o600 });
      done(true, 'Captura simulada; no se envió a impresora.');
    }).catch(() => done(false, 'Falló la captura simulada; no se envió a impresora.'));
  };
};
const brand = (window) => { window.setTitle('PILOTO ALOJADO - datos ficticios'); window.webContents.on('page-title-updated', (event) => event.preventDefault()); patch(window.webContents); };
BrowserWindow.getAllWindows().forEach(brand);
app.on('browser-window-created', (_event, window) => brand(window));
require(${JSON.stringify(mainPath)});
`;
}

export async function runHostedPilotManual(argv = process.argv.slice(2)) {
const configArg = argv.find((value) => value.startsWith('--config='))?.slice('--config='.length);
if (!configArg || !isAbsolute(configArg)) throw new Error('Uso: node scripts/hosted-pilot-manual.mjs --config=<ruta absoluta a JSON privado fuera del repositorio>');
const { loadHostedPilotConfig } = await import('./hosted-pilot-config.mjs');
const config = await loadHostedPilotConfig(configArg, root);
const profile = await mkdtemp(join(tmpdir(), 'gastronomy-local-pilot-hosted-'));
const privateWrite = async (path, value) => { await writeFile(path, value, { mode: 0o600 }); await chmod(path, 0o600).catch(() => {}); };
await privateWrite(join(profile, 'local-license-config.json'), JSON.stringify({ serverUrl: config.licenseOrigin, publicKey: config.publicKey }, null, 2));
await privateWrite(join(profile, 'license-state.json'), JSON.stringify({ schema: 1, installationId: config.installationId, token: null, lastTrustedTime: 0, maxSeenWallClock: Date.now(), lastVerifiedAt: null, revision: 0 }));

// Bootstrap is outside the repository and runs before Electron main, so every
// BrowserWindow's printer APIs are simulated before any window can print.
const bootstrap = join(profile, 'hosted-pilot-bootstrap.cjs');
await privateWrite(bootstrap, buildBootstrapSource({ profile, mainPath: join(root, 'apps/desktop-shell/dist/main.js') }));

const env = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('GASTRONOMY_')) delete env[key];
Object.assign(env, {
  GASTRONOMY_LOCAL_PILOT: '1',
  GASTRONOMY_HOSTED_PILOT_ORIGIN: config.licenseOrigin,
  GASTRONOMY_WEB_PROVISION_URL: config.ordersOrigin,
  GASTRONOMY_WEB_ORDERS_URL: config.ordersOrigin,
  GASTRONOMY_WEB_ORDERS_STORE_ID: config.storeId,
  GASTRONOMY_WEB_ORDERS_TOKEN: config.receiveToken,
  GASTRONOMY_WAITER_PUBLIC_URL: config.ordersOrigin,
});
const electronExe = require('electron');
// An explicit JS entrypoint lets the bootstrap patch APIs before loading main.
const child = spawn(electronExe, [bootstrap], { cwd: root, env, stdio: 'inherit', windowsHide: false });
child.once('spawn', () => {
  console.log(`Piloto alojado aislado iniciado. Perfil: ${profile}`);
  console.log(`Licencias: ${config.licenseOrigin}; Mozo: ${config.ordersOrigin}. Usá la UI manualmente; cuenta/contraseña sólo se ingresan en la aplicación.`);
  console.log(`Impresión simulada únicamente; evidencia: ${join(profile, 'simulated-printer.jsonl')}. Catálogo web deshabilitado.`);
});
child.once('error', (error) => { console.error(`No se pudo iniciar Electron: ${error.message}`); process.exitCode = 1; });
const stop = () => { if (!child.killed) child.kill(); };
process.once('SIGINT', stop); process.once('SIGTERM', stop);
child.once('exit', (code, signal) => process.exitCode = code ?? (signal ? 1 : 0));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await runHostedPilotManual();
}
