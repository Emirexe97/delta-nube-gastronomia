export interface ImportProductRow {
  code: string;
  name: string;
  categoryId: string;
  basePriceMinor: number;
}

export interface ImportProductsInput {
  idempotencyKey: string;
  rows: ImportProductRow[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ownKeys = (value: object, expected: string[]) =>
  Object.keys(value).length === expected.length && Object.keys(value).every((key) => expected.includes(key));

/** Validate untrusted import data and return canonical trimmed rows (code casing is preserved). */
export function normalizeImportProductsInput(input: unknown): ImportProductsInput {
  if (!input || typeof input !== "object" || Array.isArray(input) || !ownKeys(input, ["idempotencyKey", "rows"]))
    throw new Error("La solicitud de importación no es válida.");
  const value = input as Record<string, unknown>;
  if (typeof value.idempotencyKey !== "string" || !UUID.test(value.idempotencyKey))
    throw new Error("La clave de importación no es válida.");
  if (!Array.isArray(value.rows) || value.rows.length < 1 || value.rows.length > 500)
    throw new Error("La importación debe contener entre 1 y 500 productos.");
  if (JSON.stringify(input).length * 2 > 1024 * 1024)
    throw new Error("El contenido de la importación supera 1 MiB.");
  const seen = new Set<string>();
  const rows = value.rows.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || !ownKeys(entry, ["code", "name", "categoryId", "basePriceMinor"]))
      throw new Error("Una fila de importación contiene campos inválidos.");
    const row = entry as Record<string, unknown>;
    const code = typeof row.code === "string" ? row.code.trim() : "";
    const name = typeof row.name === "string" ? row.name.trim() : "";
    const categoryId = typeof row.categoryId === "string" ? row.categoryId.trim() : "";
    if (!code || code.length > 64 || !name || name.length > 200 || !categoryId || categoryId.length > 128)
      throw new Error("El código, nombre o categoría de un producto no es válido.");
    if (!Number.isSafeInteger(row.basePriceMinor) || (row.basePriceMinor as number) < 0 || (row.basePriceMinor as number) > 99_999_999_999)
      throw new Error("El precio de un producto no es válido.");
    const normalizedCode = code.normalize("NFC").toLocaleLowerCase("en-US");
    if (seen.has(normalizedCode)) throw new Error(`El código ${code} está repetido en la importación.`);
    seen.add(normalizedCode);
    return { code, name, categoryId, basePriceMinor: row.basePriceMinor as number };
  });
  return { idempotencyKey: value.idempotencyKey, rows };
}
