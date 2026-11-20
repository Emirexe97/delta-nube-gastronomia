#!/usr/bin/env node
import { createRequire } from "node:module";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const yaml = require("js-yaml");
const updaterRequire = createRequire(require.resolve("electron-updater"));
const { parseDn } = updaterRequire("builder-util-runtime");
const execFile = promisify(execFileCb);
const STABLE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function publisherNames(metadata) {
  const parsed = yaml.load(metadata);
  if (typeof parsed?.publisherName === "string") return [parsed.publisherName];
  if (Array.isArray(parsed?.publisherName) && parsed.publisherName.every((x) => typeof x === "string")) return parsed.publisherName;
  return [];
}
function samePublisherSet(actual, expected) {
  return actual.length > 0 && actual.length === expected.length && actual.every((x) => expected.includes(x)) && expected.every((x) => actual.includes(x));
}
function safeArtifactName(name) {
  if (typeof name !== "string" || !name || path.isAbsolute(name) || name.includes("\\") || name.includes("/") || /[:<>"|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name) || name === "." || name === "..") throw new Error(`Nombre de artefacto no seguro en latest.yml: ${String(name)}`);
  return name;
}
export function signatureMatches(publishers, subject) {
  let actual;
  try { actual = parseDn(subject); } catch { return false; }
  for (const name of publishers) {
    let expected;
    try { expected = parseDn(name); } catch { continue; }
    if (expected.size) {
      if ([...expected.keys()].every((key) => expected.get(key) === actual.get(key))) return true;
    } else if (name === actual.get("CN")) return true;
  }
  return false;
}
export function validateMetadata(config, manifest, configText, artifactDirectory) {
  if (!config || config.enabled !== true) throw new Error("La configuración debe tener enabled: true.");
  if (config.target !== "win32-x64") throw new Error("El target debe ser exactamente win32-x64.");
  let feed;
  try { feed = new URL(config.feedUrl); } catch { throw new Error("feedUrl debe ser una URL HTTPS válida."); }
  if (feed.protocol !== "https:" || feed.username || feed.password || feed.search || feed.hash) throw new Error("feedUrl requiere HTTPS y no admite credenciales, query string ni fragmento.");
  const expected = config.windowsPublisherNames;
  if (!Array.isArray(expected) || !expected.length || expected.some((x) => typeof x !== "string" || !x.trim())) throw new Error("Configure windowsPublisherNames con el nombre exacto del editor Authenticode.");
  const appConfig = yaml.load(configText);
  if (!samePublisherSet(publisherNames(configText), expected)) throw new Error("El editor de app-update.yml no coincide exactamente con windowsPublisherNames.");
  if (appConfig?.provider !== "generic" || typeof appConfig.url !== "string" || new URL(appConfig.url).href !== feed.href) throw new Error("El proveedor/URL de app-update.yml no coincide con el feedUrl configurado.");
  const data = yaml.load(manifest);
  if (!data || typeof data !== "object" || typeof data.version !== "string" || !STABLE.test(data.version)) throw new Error("latest.yml debe declarar una versión SemVer estable (X.Y.Z), sin prerelease.");
  if (!Array.isArray(data.files) || !data.files.length) throw new Error("latest.yml no contiene files válidos.");
  let exe = false, blockmap = false;
  const names = new Set();
  for (const item of data.files) {
    if (!item || typeof item !== "object") throw new Error("Entrada inválida en files de latest.yml.");
    const name = safeArtifactName(item.url);
    const key = name.toLowerCase(); if (names.has(key)) throw new Error(`Artefacto duplicado en latest.yml: ${name}.`); names.add(key);
    if (!Number.isSafeInteger(item.size) || item.size <= 0 || typeof item.sha512 !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(item.sha512) || Buffer.from(item.sha512, "base64").length !== 64) throw new Error(`Faltan size/sha512 válidos para ${name}.`);
    if (/\.exe$/i.test(name)) { exe = true; blockmap = true; }
    if (/\.blockmap$/i.test(name)) blockmap = true;
  }
  if (!exe || !blockmap) throw new Error("latest.yml debe referenciar instalador .exe y .blockmap.");
  return data.files;
}
export async function verifyArtifacts(configPath, artifactDirectory, deps = {}) {
  const configRaw = await (deps.readFile ?? readFile)(configPath, "utf8");
  const config = JSON.parse(configRaw);
  if (!config || config.enabled !== true) throw new Error("La configuración debe tener enabled: true.");
  if (config.target !== "win32-x64") throw new Error("El target debe ser exactamente win32-x64.");
  let feed;
  try { feed = new URL(config.feedUrl); } catch { throw new Error("feedUrl debe ser una URL HTTPS válida."); }
  if (feed.protocol !== "https:" || feed.username || feed.password || feed.search || feed.hash) throw new Error("feedUrl requiere HTTPS y no admite credenciales, query string ni fragmento.");
  if (!Array.isArray(config.windowsPublisherNames) || !config.windowsPublisherNames.length || config.windowsPublisherNames.some((x) => typeof x !== "string" || !x.trim())) throw new Error("Configure windowsPublisherNames con el nombre exacto del editor Authenticode.");
  const manifestPath = path.join(artifactDirectory, "latest.yml");
  const configTextPath = path.join(artifactDirectory, "win-unpacked", "resources", "app-update.yml");
  const [manifest, appUpdate] = [await (deps.readFile ?? readFile)(manifestPath, "utf8"), await (deps.readFile ?? readFile)(configTextPath, "utf8")];
  const files = validateMetadata(config, manifest, appUpdate, artifactDirectory);
  const version = yaml.load(manifest).version;
  const root = await (deps.realpath ?? realpath)(artifactDirectory);
  const required = [...files];
  for (const item of files) if (/\.exe$/i.test(item.url) && !files.some((f) => f.url.toLowerCase() === `${item.url}.blockmap`.toLowerCase())) required.push({ url: `${item.url}.blockmap`, size: Number.isSafeInteger(item.blockMapSize) ? item.blockMapSize : null, blockmap: true });
  for (const item of required) {
    const name = safeArtifactName(item.url);
    const resolved = await (deps.realpath ?? realpath)(path.join(artifactDirectory, name));
    if (!resolved.startsWith(root + path.sep)) throw new Error(`Artefacto fuera del directorio permitido: ${name}`);
    const bytes = await (deps.readFile ?? readFile)(resolved);
    if (item.size !== null && bytes.length !== item.size) throw new Error(`Tamaño incorrecto para ${name}: esperado ${item.size}, recibido ${bytes.length}.`);
    if (item.blockmap && bytes.length === 0) throw new Error(`El blockmap está vacío: ${name}.`);
    if (!item.blockmap) {
      const digest = await (deps.sha512 ?? (async (b) => (await import("node:crypto")).createHash("sha512").update(b).digest("base64")))(bytes);
      if (digest !== item.sha512) throw new Error(`SHA-512 incorrecto para ${name}.`);
    }
    if (/\.exe$/i.test(name)) {
      const verify = deps.verifySignature ?? verifyAuthenticode;
      const signature = await verify(resolved);
      if (!signature.valid || !signatureMatches(config.windowsPublisherNames, signature.subject)) throw new Error(`Firma Authenticode inválida o editor no esperado en ${name}; esperado: ${config.windowsPublisherNames.join(", ")}.`);
    }
  }
  return { version, files: files.length };
}
export async function verifyAuthenticode(file, exec = execFile) {
  const ps = "$s=Get-AuthenticodeSignature -LiteralPath $env:UPDATE_PREFLIGHT_FILE; [pscustomobject]@{Status=[string]$s.Status;Subject=$s.SignerCertificate.Subject;Path=$s.Path} | ConvertTo-Json -Compress";
  try {
    const { stdout } = await exec("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", ps], { windowsHide: true, env: { ...process.env, PSModulePath: "", UPDATE_PREFLIGHT_FILE: file } });
    const result = JSON.parse(stdout);
    return { valid: result.Status === "Valid" && path.resolve(result.Path).toLowerCase() === path.resolve(file).toLowerCase() && typeof result.Subject === "string", subject: result.Subject ?? "" };
  } catch { return { valid: false, subject: "" }; }
}
function args(argv) {
  const values = {};
  for (let i=0;i<argv.length;i++) {
    if (argv[i] !== "--config" && argv[i] !== "--artifacts") throw new Error(`Opción desconocida: ${argv[i]}`);
    const key=argv[i].slice(2); if (!argv[i+1] || values[key]) throw new Error(`Falta valor único para --${key}.`); values[key]=argv[++i];
  }
  if (!values.config || !values.artifacts) throw new Error("Uso: node scripts/verify-windows-update.mjs --config PATH --artifacts DIRECTORY");
  return values;
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try { const a=args(process.argv.slice(2)); const result=await verifyArtifacts(path.resolve(a.config), path.resolve(a.artifacts)); console.log(`Preflight local aprobado para ${result.version} (${result.files} archivos). Esto NO activa el updater ni verifica alojamiento HTTPS o una actualización N→N+1 real.`); }
  catch (e) { console.error(`Preflight Windows fallido: ${e.message}\nAcción: complete la configuración y vuelva a ejecutar el comando; el preflight no modifica archivos ni publica artefactos.`); process.exitCode=1; }
}
