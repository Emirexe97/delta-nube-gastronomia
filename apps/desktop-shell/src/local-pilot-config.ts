import { realpath, readFile } from "node:fs/promises";
import { join, relative, isAbsolute, sep } from "node:path";
import { tmpdir } from "node:os";
import { createPublicKey } from "node:crypto";

/** An isolated development-only authority; never overrides a packaged installation. */
export async function localPilotLicenseOptions(input: {
  enabled?: string; hostedOrigin?: string; isPackaged: boolean; userDataPath: string;
}) {
  if (input.isPackaged || input.enabled !== "1") return {};
  const temp = await realpath(tmpdir());
  const profile = await realpath(input.userDataPath);
  const path = relative(temp, profile);
  if (isAbsolute(path) || path.startsWith("..") || path.includes(sep) || !/^gastronomy-local-pilot-[a-zA-Z0-9_-]+$/.test(path))
    throw new Error("La prueba local requiere un perfil temporal separado del negocio.");
  const config = JSON.parse(await readFile(join(profile, "local-license-config.json"), "utf8")) as { serverUrl?: unknown; publicKey?: unknown };
  if (typeof config.serverUrl !== "string" || typeof config.publicKey !== "string") throw new Error("Configuración de prueba local inválida.");
  const url = new URL(config.serverUrl);
  const hosted = input.hostedOrigin !== undefined;
  if (hosted) {
    const allowed = new URL(input.hostedOrigin!);
    if (allowed.protocol !== "https:" || allowed.username || allowed.password || allowed.search || allowed.hash || allowed.pathname !== "/" || allowed.origin !== input.hostedOrigin || ["localhost", "127.0.0.1", "[::1]"].includes(allowed.hostname) || url.origin !== allowed.origin || url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/")
      throw new Error("El piloto alojado requiere el origen HTTPS explícito y coincidente.");
  } else if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("La autoridad de prueba debe estar en esta PC, con su propia clave pública.");
  }
  if (createPublicKey(config.publicKey).asymmetricKeyType !== "ed25519")
    throw new Error("La autoridad de prueba debe estar en esta PC, con su propia clave pública.");
  return { config: { serverUrl: url.origin, publicKey: config.publicKey }, enforceLicense: true, ...(!hosted ? { allowLoopbackHttp: true } : {}) };
}
