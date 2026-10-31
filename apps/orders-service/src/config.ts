import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";

export type SiteConfig = { id: string; submitTokenHash: string };
export type StoreConfig = {
  id: string;
  whatsappNumber: string;
  receiveTokenHash: string;
  sites: SiteConfig[];
};
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const HASH = /^[a-fA-F0-9]{64}$/;

export function validateStores(value: unknown): StoreConfig[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 1_000)
    throw new Error("Invalid stores configuration");
  const ids = new Set<string>();
  const hashes = new Set<string>();
  let siteCount = 0;
  const addHash = (hash: unknown) => {
    if (
      typeof hash !== "string" ||
      !HASH.test(hash) ||
      hashes.has(hash.toLowerCase())
    )
      throw new Error("Invalid or duplicate token hash");
    hashes.add(hash.toLowerCase());
  };
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw new Error("Invalid store");
    const store = raw as Record<string, unknown>;
    if (
      typeof store.id !== "string" ||
      !ID.test(store.id) ||
      ids.has(store.id) ||
      typeof store.whatsappNumber !== "string" ||
      !/^\d{8,15}$/.test(store.whatsappNumber) ||
      !Array.isArray(store.sites) ||
      store.sites.length < 1 ||
      store.sites.length > 1_000
    )
      throw new Error("Invalid store configuration");
    ids.add(store.id);
    addHash(store.receiveTokenHash);
    const siteIds = new Set<string>();
    for (const siteRaw of store.sites) {
      if (++siteCount > 10_000) throw new Error("Too many configured sites");
      if (!siteRaw || typeof siteRaw !== "object" || Array.isArray(siteRaw))
        throw new Error("Invalid site");
      const site = siteRaw as Record<string, unknown>;
      if (
        typeof site.id !== "string" ||
        !ID.test(site.id) ||
        siteIds.has(site.id)
      )
        throw new Error("Invalid site configuration");
      siteIds.add(site.id);
      addHash(site.submitTokenHash);
    }
  }
  return (value as StoreConfig[]).map((store) => ({
    id: store.id,
    whatsappNumber: store.whatsappNumber,
    receiveTokenHash: store.receiveTokenHash.toLowerCase(),
    sites: store.sites.map((site) => ({
      id: site.id,
      submitTokenHash: site.submitTokenHash.toLowerCase(),
    })),
  }));
}

export function loadStores(path: string): StoreConfig[] {
  if (!isAbsolute(path))
    throw new Error("WEB_ORDERS_CONFIG_FILE must be absolute");
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error("Unable to read web orders configuration");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Invalid config file");
  return validateStores((parsed as Record<string, unknown>).stores);
}
