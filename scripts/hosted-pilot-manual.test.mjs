import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildBootstrapSource } from './hosted-pilot-manual.mjs';

function harness({ execute = async () => 'receipt', append = () => {} } = {}) {
  const order = [];
  const listeners = {};
  const app = { setName: () => order.push('name'), setPath: (key) => { assert.equal(key, 'userData'); order.push('path'); }, on: (name, fn) => { listeners[name] = fn; } };
  const existing = { setTitle() {}, webContents: { on() {}, executeJavaScript: execute } };
  let mainLoaded = false;
  const source = buildBootstrapSource({ profile: '/tmp/isolated-pilot', mainPath: '/repo/dist/main.js' });
  vm.runInNewContext(source, { require: (id) => {
    if (id === 'electron') return { app, BrowserWindow: { getAllWindows: () => [existing] } };
    if (id === 'node:fs') return { appendFileSync: append };
    if (id === 'node:path') return { join: (...parts) => parts.join('/') };
    if (id === '/repo/dist/main.js') { assert.deepEqual(order, ['name', 'path']); mainLoaded = true; return {}; }
    throw new Error(`unexpected require ${id}`);
  } });
  assert.equal(mainLoaded, true);
  return { app, listeners, existing };
}

test('bootstrap sets isolated userData before main, uses Electron builtin, and patches present and future windows', () => {
  const { listeners, existing } = harness();
  assert.equal(existing.webContents.__hostedPilotPrinterPatched, true);
  assert.equal(typeof existing.webContents.getPrintersAsync, 'function');
  const later = { setTitle() {}, webContents: { on() {}, executeJavaScript: async () => 'later' } };
  listeners['browser-window-created']({}, later);
  assert.equal(later.webContents.__hostedPilotPrinterPatched, true);
});

test('simulated print appends one valid newline-terminated JSON record and reports success', async () => {
  const writes = [];
  const { existing } = harness({ append: (file, line, options) => writes.push({ file, line, options }) });
  const result = await new Promise((resolve) => existing.webContents.print({ silent: true }, (ok, message) => resolve({ ok, message })));
  assert.equal(result.ok, true);
  assert.match(result.message, /no se envió a impresora/);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].file, '/tmp/isolated-pilot/simulated-printer.jsonl');
  assert.equal(writes[0].line.endsWith('\n'), true);
  assert.equal(JSON.parse(writes[0].line).text, 'receipt');
});

test('printer capture failures report false and never call a physical print implementation', async (t) => {
  for (const [name, options] of [['executeJavaScript', { execute: async () => { throw Error('no page'); } }], ['appendFileSync', { append: () => { throw Error('disk'); } }]]) {
    await t.test(name, async () => {
      const { existing } = harness(options);
      const result = await new Promise((resolve) => existing.webContents.print({}, (ok, message) => resolve({ ok, message })));
      assert.equal(result.ok, false);
      assert.match(result.message, /no se envió a impresora/);
    });
  }
});
