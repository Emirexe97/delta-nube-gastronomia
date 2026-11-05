import { DatabaseSync } from "node:sqlite";
import { isAbsolute } from "node:path";

/** Private operator-only branding mode control; never mounted on HTTP or merchant IPC. */
export function setTenantDesignMode(
  dbPath: string,
  storeId: string,
  mode: "STANDARD" | "CUSTOM",
  templateKey?: string,
): void {
  if (!isAbsolute(dbPath) || !/^[A-Za-z0-9_-]{1,64}$/.test(storeId))
    throw new Error("Invalid arguments");
  if (mode === "CUSTOM" && templateKey !== "midnight-market-v1")
    throw new Error(
      "CUSTOM requires the bundled template key midnight-market-v1",
    );
  if (mode === "STANDARD" && templateKey)
    throw new Error("STANDARD does not accept a template key");
  const db = new DatabaseSync(dbPath);
  try {
    const result = db
      .prepare(
        "UPDATE tenant_sites SET design_mode=?,template_key=? WHERE store_id=?",
      )
      .run(mode, templateKey ?? null, storeId);
    if (Number(result.changes) !== 1) throw new Error("Tenant not found");
  } finally {
    db.close();
  }
}

if (process.argv[1]?.endsWith("tenant-registry.js")) {
  const [, , dbPath, storeId, mode, templateKey] = process.argv;
  if (!dbPath || !storeId || (mode !== "STANDARD" && mode !== "CUSTOM"))
    throw new Error(
      "Usage: node tenant-registry.js <absolute-db-path> <store-id> <STANDARD|CUSTOM> [template-key]",
    );
  setTenantDesignMode(dbPath, storeId, mode, templateKey);
}
