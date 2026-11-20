import { describe, expect, it } from "vitest";
import { parseCatalogCsv, decodeCatalogCsvBytes, CSV_TEMPLATE } from "./catalog-import-csv";
import type { CategoryDto, ProductDto } from "@gastronomy/contracts";

const categories: CategoryDto[] = [{ id: "cat-1", name: "Bebidas", active: true, sortOrder: 0, stockControlEnabled: true }, { id: "cat-2", name: "Café", active: true, sortOrder: 1, stockControlEnabled: false }, { id: "cat-3", name: "Inactiva", active: false, sortOrder: 2, stockControlEnabled: false }];
const products = [{ code: "OLD" } as ProductDto];
const header = "codigo;nombre;categoria;precio_principal\r\n";

describe("catalog CSV preview", () => {
  it("decodes UTF-8 accents and rejects legacy bytes instead of replacing characters", () => {
    expect(decodeCatalogCsvBytes(Uint8Array.from([0x43, 0x61, 0x66, 0xc3, 0xa9]).buffer)).toBe("Café");
    expect(() => decodeCatalogCsvBytes(Uint8Array.from([0x43, 0x61, 0x66, 0xe9]).buffer)).toThrow();
    expect(() => decodeCatalogCsvBytes(new ArrayBuffer(1024 * 1024 + 1))).toThrow(/1 MiB/);
  });
  it("parses semicolon, BOM, comma decimal and zero price", () => {
    const result = parseCatalogCsv(`\uFEFF${header}A1;Agua;Bebidas;0\r\nA2;Café;Cafe;12,50`, categories, products);
    expect(result.rows.map((r) => r.data)).toEqual([{ code: "A1", name: "Agua", categoryId: "cat-1", basePriceMinor: 0 }, { code: "A2", name: "Café", categoryId: "cat-2", basePriceMinor: 1250 }]);
  });
  it("supports quoted delimiters, embedded newlines and escaped quotes", () => {
    const result = parseCatalogCsv(`${header}A;"Agua; con gas";Bebidas;1.25\r\nB;"Té\n""especial""";Bebidas;2`, categories, []);
    expect(result.rows[0]?.data?.name).toBe("Agua; con gas");
    expect(result.rows[1]?.data?.name).toBe('Té\n"especial"');
    expect(result.rows[1]?.line).toBe(3);
  });
  it("detects ambiguous/missing categories, duplicates, malformed prices and incomplete cells", () => {
    const result = parseCatalogCsv(`${header}OLD;Viejo;Bebidas;1\na;Uno;Bebidas;1.000\na;Dos;Inactiva;2\nx;Sin precio;Bebidas`, categories, products);
    expect(result.rows.map((r) => r.errors.length)).toEqual([1, 1, 2, 2]);
    expect(result.rows[0]?.errors[0]).toContain("duplicado");
  });
  it("rejects unknown and duplicate headers and unclosed quotes", () => {
    expect(parseCatalogCsv("codigo;codigo;nombre;categoria;precio_principal;extra", categories, []).errors.length).toBeGreaterThan(0);
    expect(parseCatalogCsv(`${header}A;"bad;Bebidas;1`, categories, []).rows[0]?.errors[0]).toContain("Comillas");
    expect(parseCatalogCsv(`${header}A;un"quoted;Bebidas;1`, categories, []).rows[0]?.errors[0]).toContain("sin comillas");
  });
  it("keeps empty quoted rows visible and enforces contract limits", () => {
    const emptyRow = parseCatalogCsv(`${header}""`, categories, []);
    expect(emptyRow.rows).toHaveLength(1);
    expect(emptyRow.rows[0]?.errors.length).toBeGreaterThan(0);
    const tooLong = parseCatalogCsv(`${header}${"a".repeat(65)};${"n".repeat(201)};${"c".repeat(129)};1`, categories, []);
    expect(tooLong.rows[0]?.errors.join(" ")).toMatch(/64 caracteres/);
    expect(tooLong.rows[0]?.errors.join(" ")).toMatch(/200 caracteres/);
    expect(tooLong.rows[0]?.errors.join(" ")).toMatch(/128 caracteres/);
    const tooExpensive = parseCatalogCsv(`${header}A;Uno;Bebidas;1000000000.00`, categories, []);
    expect(tooExpensive.rows[0]?.errors.join(" ")).toContain("Precio inválido");
  });
  it("exports a UTF-8 BOM template", () => { expect(CSV_TEMPLATE.charCodeAt(0)).toBe(0xfeff); expect(CSV_TEMPLATE).toContain("precio_principal"); });
  it("bounds retained records on large files and ignores blank lines without hiding quoted empty rows", () => {
    const overflow = parseCatalogCsv(header + "A;Uno;Bebidas;1\n".repeat(20_000), categories, []);
    expect(overflow.rows).toHaveLength(500);
    expect(overflow.errors).toContain("Máximo 500 filas por importación; hay al menos 501.");
    const sparse = parseCatalogCsv(header + "\n".repeat(200_000) + "A;Uno;Bebidas;1", categories, []);
    expect(sparse.errors).toEqual([]);
    expect(sparse.rows).toHaveLength(1);
    expect(sparse.rows[0]?.line).toBe(200_002);
  });
});
