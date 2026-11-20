import type { CategoryDto, ProductDto } from "@gastronomy/contracts";

export const MAX_CSV_BYTES = 1024 * 1024;
export const MAX_IMPORT_ROWS = 500;
export const CSV_HEADERS = ["codigo", "nombre", "categoria", "precio_principal"] as const;
export function decodeCatalogCsvBytes(bytes: ArrayBuffer): string {
  if (bytes.byteLength > MAX_CSV_BYTES) throw new Error("El archivo supera el máximo de 1 MiB.");
  // File.text() silently replaces invalid UTF-8, potentially corrupting names
  // and required codes from legacy Excel exports. Reject instead of guessing.
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
export type ImportRow = { code: string; name: string; categoryId: string; basePriceMinor: number };
export type CsvRowResult = { line: number; values: string[]; data: ImportRow | null; errors: string[] };
export type CsvPreview = { rows: CsvRowResult[]; errors: string[]; delimiter: ";" | "," };

function records(text: string, delimiter: string): { values: string[]; line: number; malformed?: string; blank?: boolean }[] {
  const out: { values: string[]; line: number; malformed?: string; blank?: boolean }[] = [];
  let values: string[] = [], field = "", quoted = false, line = 1, rowLine = 1, afterQuote = false, touched = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; afterQuote = true; }
      else { field += c; if (c === "\n") line++; }
    } else if (c === '"' && field === "" && !afterQuote) { quoted = true; touched = true; }
    else if (c === '"') return [...out, { values: [...values, field], line: rowLine, malformed: "Comilla dentro de un campo sin comillas" }];
    else if (c === delimiter) { values.push(field); field = ""; afterQuote = false; touched = true; }
    else if (c === "\r" || c === "\n") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      values.push(field); field = "";
      // Do not allocate records for empty lines. Keep at most the header plus
      // 501 data rows: that last row proves overflow without retaining the file.
      if (touched) out.push({ values, line: rowLine, blank: false });
      if (out.length >= MAX_IMPORT_ROWS + 2) return out;
      values = []; afterQuote = false; touched = false; line++; rowLine = line;
    } else if (afterQuote && c !== " " && c !== "\t") { return [...out, { values: [...values, field], line: rowLine, malformed: "Texto inesperado después de comillas" }]; }
    else if (!afterQuote) { field += c; touched = true; }
  }
  if (quoted) out.push({ values: [...values, field], line: rowLine, malformed: "Comillas sin cerrar", blank: false });
  else if (touched || field !== "" || values.length) { values.push(field); out.push({ values, line: rowLine, blank: false }); }
  return out;
}
function key(value: string) { return value.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es"); }
function codeKey(value: string) { return value.trim().normalize("NFC").toLocaleLowerCase("en-US"); }

export function parseCatalogCsv(text: string, categories: CategoryDto[], products: ProductDto[]): CsvPreview {
  const bytes = new TextEncoder().encode(text).length;
  const clean = text.replace(/^\uFEFF/, "");
  const first = clean.split(/\r?\n/, 1)[0] ?? "";
  const delimiter: ";" | "," = (first.match(/;/g)?.length ?? 0) >= (first.match(/,/g)?.length ?? 0) ? ";" : ",";
  if (bytes > MAX_CSV_BYTES) return { rows: [], errors: ["El archivo supera el máximo de 1 MiB."], delimiter };
  const parsed = records(clean, delimiter).filter((r) => !r.blank || r.malformed);
  if (!parsed.length) return { rows: [], errors: ["El archivo está vacío."], delimiter };
  const errors: string[] = [];
  const header = parsed.shift()!;
  if (parsed.length === 0) errors.push("El archivo no contiene filas de productos.");
  if (header.malformed) errors.push(`Encabezado: ${header.malformed}.`);
  const normalized = header.values.map(key);
  const headerErrors: string[] = [];
  normalized.forEach((h) => { if (!CSV_HEADERS.includes(h as typeof CSV_HEADERS[number])) headerErrors.push(`Columna desconocida: ${h || "(vacía)"}`); });
  CSV_HEADERS.forEach((h) => { if (!normalized.includes(h)) headerErrors.push(`Falta la columna ${h}`); });
  const counts = new Map<string, number>(); normalized.forEach((h) => counts.set(h, (counts.get(h) ?? 0) + 1));
  [...counts].filter(([, n]) => n > 1).forEach(([h]) => headerErrors.push(`Columna duplicada: ${h}`));
  if (headerErrors.length) return { rows: [], errors: headerErrors, delimiter };
  const indices = CSV_HEADERS.map((h) => normalized.indexOf(h));
  const active = categories.filter((c) => c.active);
  const existing = new Set(products.map((p) => p.code).filter((x): x is string => Boolean(x)).map(codeKey));
  const seen = new Set<string>();
  const dataRows = parsed.slice(0, MAX_IMPORT_ROWS);
  if (parsed.length > MAX_IMPORT_ROWS) errors.push(`Máximo ${MAX_IMPORT_ROWS} filas por importación; hay al menos ${parsed.length}.`);
  const rows = dataRows.map((record): CsvRowResult => {
    const rowErrors: string[] = [];
    if (record.malformed) rowErrors.push(record.malformed);
    if (record.values.length !== header.values.length) rowErrors.push("Cantidad de celdas incompleta o adicional.");
    const values = indices.map((i) => record.values[i] ?? "");
    const cleaned = values.map((v) => v.trim());
    const code = cleaned[0] ?? "", name = cleaned[1] ?? "", category = cleaned[2] ?? "", price = cleaned[3] ?? "";
    if (!code) rowErrors.push("Código obligatorio.");
    else if (code.length > 64) rowErrors.push("El código no puede superar 64 caracteres.");
    else { const ck = codeKey(code); if (seen.has(ck) || existing.has(ck)) rowErrors.push("Código duplicado en archivo o catálogo."); seen.add(ck); }
    if (!name) rowErrors.push("Nombre obligatorio.");
    else if (name.length > 200) rowErrors.push("El nombre no puede superar 200 caracteres.");
    if (category.length > 128) rowErrors.push("La categoría no puede superar 128 caracteres.");
    const matches = active.filter((c) => key(c.name) === key(category));
    if (!category || matches.length !== 1) rowErrors.push(!category ? "Categoría obligatoria." : matches.length ? "La categoría coincide con más de una categoría activa." : "Categoría activa no encontrada.");
    let basePriceMinor: number | null = null;
    if (/^(?:0|[1-9]\d*)(?:[,.]\d{1,2})?$/.test(price)) {
      const amount = Number(price.replace(",", "."));
      if (Number.isSafeInteger(Math.round(amount * 100)) && Math.round(amount * 100) <= 99_999_999_999) basePriceMinor = Math.round(amount * 100);
    }
    if (basePriceMinor === null) rowErrors.push("Precio inválido: usá decimal sin separador de miles y hasta 2 decimales.");
    return { line: record.line, values, data: rowErrors.length ? null : { code, name, categoryId: matches[0]!.id, basePriceMinor: basePriceMinor! }, errors: rowErrors };
  });
  return { rows, errors, delimiter };
}

export const CSV_TEMPLATE = "\uFEFFcodigo;nombre;categoria;precio_principal\r\n";
