import { describe, expect, it } from "vitest";
import type { ProductDto } from "@gastronomy/contracts";
import { buildCatalogProductGroups } from "./catalog-page";
import {
  buildFilteredCatalogGroups,
  hasKnownCost,
  type CatalogFilters,
  type ProductCost,
} from "./catalog-filters";

const product = (id: string, extra: Partial<ProductDto> = {}): ProductDto => ({
  id,
  name: id,
  code: null,
  categoryId: "cat-a",
  categoryName: "A",
  parentProductId: null,
  stockMinor: 0,
  stockTargetMinor: null,
  stockMinMinor: null,
  stockCriticalMinor: null,
  active: true,
  imageDataUrl: null,
  sortOrder: 0,
  prices: [],
  ...extra,
});
const defaults: CatalogFilters = {
  categoryId: "",
  status: "all",
  cost: "all",
  stock: "all",
};

describe("catalog filters", () => {
  it("conserva búsqueda, agrupación y expansión originales sin filtros adicionales", () => {
    const items = [
      product("p", { name: "Base" }),
      product("v", { name: "Chica", parentProductId: "p" }),
      product("v2", { name: "Base grande", parentProductId: "p" }),
      product("solo"),
    ];
    const shape = (groups: ReturnType<typeof buildCatalogProductGroups>) =>
      groups.map((group) => ({
        parent: group.parent.id,
        variants: group.variants.map((item) => item.id),
        expand: group.hasMatchingVariant,
      }));
    for (const query of ["", "base", "chica", "solo", "inexistente"]) {
      expect(shape(buildFilteredCatalogGroups(items, query, defaults))).toEqual(
        shape(buildCatalogProductGroups(items, query)),
      );
    }
  });
  it("combina categoría, estado, costo y stock, considerando cero como costo conocido", () => {
    const items = [
      product("zero", { stockMinor: 500, stockMinMinor: 1000 }),
      product("no-cost", { active: false, stockMinor: null }),
      product("other-category", { categoryId: "cat-b" }),
    ];
    const costs = new Map<string, ProductCost>([
      ["zero", { source: "MANUAL", unitCostMinor: 0 }],
    ]);
    const groups = buildFilteredCatalogGroups(
      items,
      "",
      {
        ...defaults,
        categoryId: "cat-a",
        status: "active",
        cost: "with",
        stock: "low",
      },
      costs,
    );
    expect(groups.flatMap((g) => g.matchingIds)).toEqual(["zero"]);
    expect(hasKnownCost({ source: "MANUAL", unitCostMinor: 0 })).toBe(true);
    expect(hasKnownCost({ source: "UNKNOWN", unitCostMinor: null })).toBe(
      false,
    );
    expect(hasKnownCost(undefined)).toBe(false);
  });

  it("admite stock nulo sólo en sin control y cero como sin existencias", () => {
    const items = [product("zero"), product("null", { stockMinor: null })];
    expect(
      buildFilteredCatalogGroups(items, "", {
        ...defaults,
        stock: "out",
      }).flatMap((g) => g.matchingIds),
    ).toEqual(["zero"]);
    expect(
      buildFilteredCatalogGroups(items, "", {
        ...defaults,
        stock: "untracked",
      }).flatMap((g) => g.matchingIds),
    ).toEqual(["null"]);
  });

  it("no confunde la ausencia de una fila de costos con un costo desconocido", () => {
    const items = [product("missing"), product("unknown")];
    const costs = new Map<string, ProductCost>([
      ["unknown", { source: "UNKNOWN", unitCostMinor: null }],
    ]);
    expect(
      buildFilteredCatalogGroups(
        items,
        "",
        { ...defaults, cost: "without" },
        costs,
      ).flatMap((g) => g.matchingIds),
    ).toEqual(["unknown"]);
  });

  it("mantiene padre sólo como contexto si la variante es la coincidencia, sin contar/seleccionar el padre", () => {
    const parent = product("parent", { name: "Base", stockMinor: null });
    const variant = product("variant", {
      name: "Hija",
      parentProductId: "parent",
      stockMinor: 0,
    });
    const groups = buildFilteredCatalogGroups([parent, variant], "", {
      ...defaults,
      stock: "out",
    });
    expect(groups).toHaveLength(1);
    expect(groups[0]?.parent.id).toBe("parent");
    expect(groups[0]?.hasMatchingVariant).toBe(true);
    expect(groups[0]?.matchingIds).toEqual(["variant"]);
  });

  it("filtra por query sin perder contexto de coincidencia real", () => {
    const groups = buildFilteredCatalogGroups(
      [
        product("p", { name: "Base" }),
        product("v", { name: "Chica", parentProductId: "p" }),
      ],
      "chica",
      defaults,
    );
    expect(groups[0]?.matchingIds).toEqual(["v"]);
  });
});
