import { describe, expect, it } from "vitest";
import type { ProductDto } from "@gastronomy/contracts";
import {
  buildProductSearchIndex,
  searchProductIndex,
} from "./order-editor-search";

const product = (
  id: string,
  name: string,
  code: string | null,
  extra: Partial<ProductDto> = {},
) =>
  ({
    id,
    name,
    code,
    categoryId: "cat",
    categoryName: "Pizzas",
    sortOrder: 0,
    active: true,
    prices: [],
    stockMinor: null,
    stockTargetMinor: null,
    stockMinMinor: null,
    stockCriticalMinor: null,
    imageDataUrl: null,
    ...extra,
  }) as ProductDto;

describe("order editor product search index", () => {
  it("searches active variants and treats orphans as base products", () => {
    const products = [
      product("base-1", "Pizza Muzzarella", "P01"),
      product("variant-1", "Pizza Muzzarella - Grande", "P01G", {
        parentProductId: "base-1",
      }),
      product("base-2", "Pizza Especial", "P02"),
      product("orphan", "Pizza Fantasma", "PF", { parentProductId: "missing" }),
    ];
    const index = buildProductSearchIndex(products);
    expect(index.map((entry) => entry.product.id)).toEqual([
      "base-1",
      "base-2",
      "orphan",
    ]);
    expect(searchProductIndex(index, "P01G").map((item) => item.id)).toEqual([
      "base-1",
    ]);
    expect(
      searchProductIndex(index, "fantasma").map((item) => item.id),
    ).toEqual(["orphan"]);
    expect(searchProductIndex(index, "").map((item) => item.id)).toEqual([
      "base-1",
      "base-2",
      "orphan",
    ]);
  });

  it("preserves exact-code precedence, category filters, accents, and excludes inactive options", () => {
    const index = buildProductSearchIndex([
      product("prefix", "Cafetera", "CAF10"),
      product("base", "Postre", "B1"),
      product("variant", "Café con leche", "CAF", {parentProductId: "base"}),
      product("hidden", "Agotado", "OLD", {parentProductId: "base", active: false}),
      product("other", "Café", "CAF1", {categoryId: "other"}),
    ]);
    expect(searchProductIndex(index, "caf", "cat").map(p => p.id)).toEqual(["base", "prefix"]);
    expect(searchProductIndex(index, "postre cafe").map(p => p.id)).toEqual(["base"]);
    expect(searchProductIndex(index, "agotado")).toEqual([]);
    expect(searchProductIndex(index, "", "other").map(p => p.id)).toEqual(["other"]);
  });

  it("handles a 3000-product catalog without changing result semantics", () => {
    const products = Array.from({ length: 3000 }, (_, index) =>
      product(
        `p-${index}`,
        index === 2999 ? "Hamburguesa Completa" : `Producto ${index}`,
        `C${index}`,
      ),
    );
    products.push(
      product("v-2999", "Hamburguesa Completa XL", "C2999XL", {
        parentProductId: "p-2999",
      }),
    );
    const index = buildProductSearchIndex(products);
    expect(index).toHaveLength(3000);
    expect(searchProductIndex(index, "C2999XL").map((item) => item.id)).toEqual(
      ["p-2999"],
    );
    expect(
      searchProductIndex(index, "hamburguesa").map((item) => item.id),
    ).toEqual(["p-2999"]);
  });
});
