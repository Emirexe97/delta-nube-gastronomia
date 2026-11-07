#!/usr/bin/env node
// Bounded desktop pilot against an explicitly authorized hosted licensing + waiter service.
// Does not provision accounts, create a hosted store, publish catalogs, or deploy anything.
import { mkdtemp, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, isAbsolute } from 'node:path';
import { _electron as electron } from '@playwright/test';
import { loadHostedPilotConfig } from './hosted-pilot-config.mjs';

const root = resolve(import.meta.dirname, '..');
const configArg = process.argv.slice(2).find((value) => value.startsWith('--config='))?.slice('--config='.length);
if (!configArg || !isAbsolute(configArg)) throw new Error('Uso: node scripts/hosted-pilot.mjs --config=<ruta absoluta a JSON privado fuera del repositorio>');
const config = await loadHostedPilotConfig(configArg, root);
const { licenseOrigin, ordersOrigin } = config;

// Dedicated fresh profile: no existing account profile or in-flight pilot is stopped or reused.
const profile = await mkdtemp(join(tmpdir(), 'gastronomy-local-pilot-hosted-'));
const privateWrite = async (path, value) => { await writeFile(path, value, { mode: 0o600 }); await chmod(path, 0o600).catch(() => {}); };
await privateWrite(join(profile, 'local-license-config.json'), JSON.stringify({ serverUrl: licenseOrigin, publicKey: config.publicKey }, null, 2));
await privateWrite(join(profile, 'license-state.json'), JSON.stringify({ schema: 1, installationId: config.installationId, token: null, lastTrustedTime: 0, maxSeenWallClock: Date.now(), lastVerifiedAt: null, revision: 0 }));

// Strip inherited endpoints. Every explicitly configured network destination is a supplied HTTPS origin.
const childEnv = { ...process.env };
for (const key of Object.keys(childEnv)) if (key.startsWith('GASTRONOMY_')) delete childEnv[key];
Object.assign(childEnv, {
  GASTRONOMY_LOCAL_PILOT: '1',
  GASTRONOMY_HOSTED_PILOT_ORIGIN: licenseOrigin,
  GASTRONOMY_WEB_PROVISION_URL: ordersOrigin,
  GASTRONOMY_WEB_ORDERS_URL: ordersOrigin,
  GASTRONOMY_WEB_ORDERS_STORE_ID: config.storeId,
  GASTRONOMY_WEB_ORDERS_TOKEN: config.receiveToken,
  GASTRONOMY_WAITER_PUBLIC_URL: ordersOrigin,
});

let app;
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  try { await app?.close(); } catch {}
}
process.once('SIGINT', () => void shutdown().finally(() => process.exit(0)));
process.once('SIGTERM', () => void shutdown().finally(() => process.exit(0)));
try {
  app = await electron.launch({ args: ['apps/desktop-shell', `--user-data-dir=${profile}`], cwd: root, env: childEnv });
  const page = await app.firstWindow();
  // All current and future windows use simulated printing; no physical printer is called.
  await app.evaluate(({ app: electronApp, BrowserWindow }, profileDir) => {
    const fs = process.getBuiltinModule('node:fs'); const path = process.getBuiltinModule('node:path');
    const capture = path.join(profileDir, 'simulated-printer.jsonl');
    const patch = (contents) => {
      if (!contents || contents.__hostedPilotPrinterPatched) return;
      contents.__hostedPilotPrinterPatched = true;
      contents.getPrintersAsync = async () => [{ name: 'PILOTO-SIMULADA', displayName: 'Impresora simulada (no imprime)', description: 'Captura local', status: 0, isDefault: true, options: {} }];
      contents.print = (options, callback) => {
        void contents.executeJavaScript('document.body.innerText').then((text) => {
          fs.appendFileSync(capture, JSON.stringify({ at: new Date().toISOString(), options, text }) + '\n', { mode: 0o600 });
          if (typeof callback === 'function') callback(true, 'Captura simulada; no se envió a impresora.');
        }, () => { if (typeof callback === 'function') callback(false, 'Falló la captura simulada.'); });
      };
    };
    const brand = (window) => { window.setTitle('PILOTO ALOJADO - datos ficticios'); window.webContents.on('page-title-updated', (event) => event.preventDefault()); patch(window.webContents); };
    BrowserWindow.getAllWindows().forEach(brand);
    electronApp.on('browser-window-created', (_event, window) => brand(window));
  }, profile);
  console.log(`Piloto aislado iniciado. Perfil y evidencia: ${profile}`);
  console.log(`Licencia: ${licenseOrigin}; Mozo/pedidos: ${ordersOrigin}. Se usará la UI real; no se crea cuenta ni tienda.`);
  console.log('Sincronización de catálogo web deshabilitada por el modo hosted pilot. No se muestran secretos en consola.');

  await page.getByRole('link', { name: 'Configuración', exact: true }).click();
  await page.getByRole('button', { name: 'Licencia', exact: true }).click();
  await page.getByLabel('Correo de la cuenta').fill(config.accountEmail);
  await page.getByLabel('Contraseña de la cuenta').fill(config.accountPassword);
  await page.getByRole('button', { name: 'Ingresar y activar este equipo', exact: true }).click();
  const deadline = Date.now() + 30_000;
  let licenseStatus;
  for (;;) {
    licenseStatus = await page.evaluate(() => window.gastronomy.getLicenseStatus());
    if (licenseStatus.state === 'ACTIVE' && licenseStatus.canOperate) break;
    if (Date.now() >= deadline) {
      const message = await page.locator('#settings-license [role="alert"]').textContent().catch(() => licenseStatus.message);
      throw new Error(`La cuenta no se activó. Se aborta sin crear cuenta, tienda ni vinculación alternativa. ${message ?? ''}`);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 300));
  }

  const fixtures = await page.evaluate(async () => {
    const api = window.gastronomy;
    const data = await api.bootstrap();
    if (!data.categories?.[0]?.id) throw new Error('No hay una categoría local para los productos de prueba.');
    await api.openCashSession({ openingAmountMinor: 0 });
    await api.ensureTable({ number: 88 });
    const waiter = await api.createUser({ fullName: 'Mozo piloto', roleCode: 'WAITER', pin: '5731', authorizerPin: '1234' });
    for (const name of ['Producto piloto uno', 'Producto piloto dos']) await api.createProduct({
      categoryId: data.categories[0].id, name,
      prices: ['SALON', 'TAKEAWAY', 'DELIVERY'].map((priceListCode) => ({ priceListCode, amountMinor: 9900 })),
    });
    return { waiterId: waiter.id, waiterName: waiter.fullName };
  });

  await page.reload();
  await page.getByRole('link', { name: 'Configuración' }).click();
  const kitchen = page.getByRole('region', { name: 'Comanda de cocina', exact: true });
  await kitchen.getByLabel('Modo', { exact: false }).selectOption('SYSTEM_DIRECT');
  await kitchen.getByLabel('Impresora', { exact: false }).selectOption('PILOTO-SIMULADA');
  await page.getByRole('button', { name: 'Imprimir prueba' }).click();
  await page.getByRole('button', { name: 'Guardar configuración', exact: true }).click();
  const waiterPanel = page.locator('#settings-waiter');
  await page.getByRole('button', { name: 'Modo Mozo', exact: true }).click().catch(() => {});
  await waiterPanel.locator('select').selectOption(fixtures.waiterId);
  await waiterPanel.getByRole('button', { name: 'Generar QR presencial' }).click();
  await waiterPanel.locator('img').waitFor({ state: 'visible' });
  await waiterPanel.locator('img').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(profile, 'ready.png') });
  await privateWrite(join(profile, 'pilot-ready.json'), JSON.stringify({ profile, licenseOrigin, ordersOrigin, waiterUrl: `${ordersOrigin}/waiter`, table: 88, waiterName: fixtures.waiterName, printer: 'PILOTO-SIMULADA', licenseState: licenseStatus.state }, null, 2));
  console.log(`Datos sólo locales listos: mesa 88, mozo ${fixtures.waiterName} PIN 5731, dos productos ficticios; QR generado.`);
  console.log(`Impresión simulada guardada en ${join(profile, 'simulated-printer.jsonl')}. Perfil conservado; cerrá la ventana para finalizar.`);
  await app.waitForEvent('close', { timeout: 0 });
} finally {
  await shutdown();
}
