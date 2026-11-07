import { readFile, realpath } from 'node:fs/promises';
import { relative, isAbsolute, sep, resolve } from 'node:path';
import { createPublicKey } from 'node:crypto';
import { isIP } from 'node:net';

export function requirePublicHttpsOrigin(value, name) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${name} debe ser un origen HTTPS exacto.`); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.origin !== value || isIP(host) || !host.includes('.') || ['localhost', '127.0.0.1', '[::1]'].includes(host) || ['.localhost', '.local', '.test', '.invalid'].some((suffix) => host.endsWith(suffix)))
    throw new Error(`${name} debe ser un origen HTTPS DNS público exacto, no una IP ni un nombre local.`);
  return url.origin;
}

export function validateHostedPilotConfig(config) {
  const required = ['licenseOrigin', 'publicKey', 'accountEmail', 'accountPassword', 'ordersOrigin', 'storeId', 'receiveToken', 'installationId'];
  if (!config || typeof config !== 'object' || required.some((key) => typeof config[key] !== 'string' || !config[key].trim()))
    throw new Error(`Configuración incompleta. Campos requeridos: ${required.join(', ')}.`);
  const licenseOrigin = requirePublicHttpsOrigin(config.licenseOrigin, 'licenseOrigin');
  const ordersOrigin = requirePublicHttpsOrigin(config.ordersOrigin, 'ordersOrigin');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(config.storeId)) throw new Error('storeId inválido.');
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(config.receiveToken)) throw new Error('receiveToken inválido.');
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(config.installationId)) throw new Error('installationId inválido.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.accountEmail) || config.accountEmail.length > 254) throw new Error('accountEmail inválido.');
  if (config.accountPassword.length < 15 || config.accountPassword.length > 128 || Buffer.byteLength(config.accountPassword, 'utf8') > 512) throw new Error('accountPassword debe cumplir los límites del servicio de licencias (15-128 caracteres, hasta 512 bytes UTF-8).');
  try {
    if (createPublicKey(config.publicKey).asymmetricKeyType !== 'ed25519') throw new Error();
  } catch { throw new Error('publicKey debe ser una clave pública Ed25519 válida.'); }
  return { ...config, licenseOrigin, ordersOrigin };
}

export async function loadHostedPilotConfig(configPath, repositoryRoot) {
  if (!isAbsolute(configPath)) throw new Error('La ruta de configuración debe ser absoluta.');
  const rootReal = await realpath(repositoryRoot);
  const configReal = await realpath(resolve(configPath));
  const fromRoot = relative(rootReal, configReal);
  if (isAbsolute(fromRoot) || fromRoot === '' || (fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`)))
    throw new Error('El archivo JSON privado debe estar fuera del repositorio.');
  return validateHostedPilotConfig(JSON.parse(await readFile(configReal, 'utf8')));
}
