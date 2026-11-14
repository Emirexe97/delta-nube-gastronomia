import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const read = (name) => readFile(path.join(root, name), 'utf8');
test('public pages expose accessible Argentina Spanish registration, recovery and download routes', async () => {
 const [reg, reset, downloads] = await Promise.all(['registro/index.html','recuperar/index.html','descargas/index.html'].map(read));
 for (const html of [reg,reset,downloads]) { assert.match(html, /lang="es-AR"/); assert.match(html, /public-assets\/account\.css/); assert.match(html, /public-assets\/account\.js/); assert.match(html, /role="status"/); assert.match(html, /\/registro\//); assert.match(html, /\/recuperar\//); assert.match(html, /\/descargas\//); assert.doesNotMatch(html, /<script(?![^>]*src=)|<style\b/i); }
 assert.match(reg, /gratis 30 días/); assert.match(reg, /30 días corridos desde tu primer ingreso exitoso/); assert.match(reg, /Sin tarjeta/);
 assert.match(reset, /Restablecer contraseña/); assert.match(downloads, /Descargas disponibles/);
});
test('account client follows JSON API contracts and avoids persistent token storage or HTML injection', async () => {
 const js = await read('public-assets/account.js');
 for (const fragment of ['registration/start','registration/complete','password-reset/start','password-reset/complete','/public/api/config','businessName','token','textContent','429','503']) assert.ok(js.includes(fragment), `expected ${fragment}`);
 assert.doesNotMatch(js, /localStorage|sessionStorage|innerHTML/);
});
test('staging copies public site into dist/public', async () => { const stage = await readFile(path.join(root, '../scripts/stage-panel.mjs'), 'utf8'); assert.match(stage, /publicSource/); assert.match(stage, /dist\/public/); });
