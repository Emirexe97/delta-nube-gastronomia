import { describe, expect, it } from "vitest";
import type { ProductDto } from "@gastronomy/contracts";
import {
  buildCatalogProductGroups,
  matchesProductQuery,
} from "./catalog-page";

const sampleProducts: ProductDto[] = [
  {
    id: "prod-base-1",
    name: "Pizza Muzzarella",
    code: "PIZ-MUZ",
    categoryId: "cat-pizzas",
    categoryName: "Pizzas",
    parentProductId: null,
    stockMinor: 20000,
    stockTargetMinor: null,
    stockMinMinor: null,
    stockCriticalMinor: null,
    active: true,
    imageDataUrl: null,
    sortOrder: 1,
    prices: [
      { priceListId: "pl-salon", priceListCode: "SALON", amountMinor: 1000000 },
      { priceListId: "pl-takeaway", priceListCode: "TAKEAWAY", amountMinor: 950000 },
      { priceListId: "pl-delivery", priceListCode: "DELIVERY", amountMinor: 950000 },
    ],
  },
  {
    id: "prod-var-1a",
    name: "Pizza Muzzarella Chica",
    code: "PIZ-MUZ-CHIC",
    categoryId: "cat-pizzas",
    categoryName: "Pizzas",
    parentProductId: "prod-base-1",
    stockMinor: 5000,
    stockTargetMinor: null,
    stockMinMinor: null,
    stockCriticalMinor: null,
    active: true,
    imageDataUrl: null,
    sortOrder: 2,
    prices: [
      { priceListId: "pl-salon", priceListCode: "SALON", amountMinor: 600000 },
      { priceListId: "pl-takeaway", priceListCode: "TAKEAWAY", amountMinor: 550000 },
      { priceListId: "pl-delivery", priceListCode: "DELIVERY", amountMinor: 550000 },
    ],
  },
  {
    id: "prod-var-1b",
    name: "Pizza Muzzarella Grande",
    code: "PIZ-MUZ-GRA",
    categoryId: "cat-pizzas",
    categoryName: "Pizzas",
    parentProductId: "prod-base-1",
    stockMinor: 15000,
    stockTargetMinor: null,
    stockMinMinor: null,
    stockCriticalMinor: null,
    active: true,
    imageDataUrl: null,
    sortOrder: 3,
    prices: [
      { priceListId: "pl-salon", priceListCode: "SALON", amountMinor: 1200000 },
      { priceListId: "pl-takeaway", priceListCode: "TAKEAWAY", amountMinor: 1100000 },
      { priceListId: "pl-delivery", priceListCode: "DELIVERY", amountMinor: 1100000 },
    ],
  },
  {
    id: "prod-base-2",
    name: "Empanada de Carne",
    code: "EMP-CAR",
    categoryId: "cat-empanadas",
    categoryName: "Empanadas",
    parentProductId: null,
    stockMinor: null,
    stockTargetMinor: null,
    stockMinMinor: null,
    stockCriticalMinor: null,
    active: true,
    imageDataUrl: null,
    sortOrder: 4,
    prices: [
      { priceListId: "pl-salon", priceListCode: "SALON", amountMinor: 150000 },
      { priceListId: "pl-takeaway", priceListCode: "TAKEAWAY", amountMinor: 140000 },
      { priceListId: "pl-delivery", priceListCode: "DELIVERY", amountMinor: 140000 },
    ],
  },
  {
    id: "prod-orphan-var",
    name: "Variante Huérfana",
    code: "VAR-ORF",
    categoryId: "cat-pizzas",
    categoryName: "Pizzas",
    parentProductId: "non-existent-parent",
    stockMinor: null,
    stockTargetMinor: null,
    stockMinMinor: null,
    stockCriticalMinor: null,
    active: true,
    imageDataUrl: null,
    sortOrder: 5,
    prices: [],
  },
];

describe("Catálogo - Agrupamiento de productos y variantes", () => {
  it("agrupa variantes bajo su producto base y no las duplica en la lista principal", () => {
    const groups = buildCatalogProductGroups(sampleProducts, "");

    expect(groups).toHaveLength(3);

    const pizzaGroup = groups.find((g) => g.parent.id === "prod-base-1");
    expect(pizzaGroup).toBeDefined();
    expect(pizzaGroup?.variants).toHaveLength(2);
    expect(pizzaGroup?.variants.map((v) => v.id)).toEqual([
      "prod-var-1a",
      "prod-var-1b",
    ]);
    expect(pizzaGroup?.hasMatchingVariant).toBe(false);

    const empanadaGroup = groups.find((g) => g.parent.id === "prod-base-2");
    expect(empanadaGroup).toBeDefined();
    expect(empanadaGroup?.variants).toHaveLength(0);

    const orphanGroup = groups.find((g) => g.parent.id === "prod-orphan-var");
    expect(orphanGroup).toBeDefined();
    expect(orphanGroup?.parent.id).toBe("prod-orphan-var");
  });

  it("al buscar por término de variante, incluye al producto padre con hasMatchingVariant: true", () => {
    const groups = buildCatalogProductGroups(sampleProducts, "Chica");

    expect(groups).toHaveLength(1);
    const pizzaGroup = groups[0]!;
    expect(pizzaGroup.parent.id).toBe("prod-base-1");
    expect(pizzaGroup.hasMatchingVariant).toBe(true);
    expect(pizzaGroup.variants).toHaveLength(1);
    expect(pizzaGroup.variants[0]!.id).toBe("prod-var-1a");
  });

  it("al buscar por término del producto padre, incluye al padre y todas sus variantes", () => {
    const groups = buildCatalogProductGroups(sampleProducts, "Muzzarella");

    expect(groups).toHaveLength(1);
    const pizzaGroup = groups[0]!;
    expect(pizzaGroup.parent.id).toBe("prod-base-1");
    expect(pizzaGroup.variants).toHaveLength(2);
  });

  it("al buscar por código SKU de variante, encuentra y resalta al padre", () => {
    const groups = buildCatalogProductGroups(sampleProducts, "PIZ-MUZ-GRA");

    expect(groups).toHaveLength(1);
    const pizzaGroup = groups[0]!;
    expect(pizzaGroup.parent.id).toBe("prod-base-1");
    expect(pizzaGroup.hasMatchingVariant).toBe(true);
    expect(pizzaGroup.variants).toHaveLength(1);
    expect(pizzaGroup.variants[0]!.code).toBe("PIZ-MUZ-GRA");
  });

  it("devuelve lista vacía cuando no hay coincidencias", () => {
    const groups = buildCatalogProductGroups(sampleProducts, "Inexistente XYZ");
    expect(groups).toHaveLength(0);
  });

  it("matchesProductQuery evalúa nombre, código y categoría", () => {
    const prod = sampleProducts[0]!;
    expect(matchesProductQuery(prod, "muzzarella")).toBe(true);
    expect(matchesProductQuery(prod, "piz-muz")).toBe(true);
    expect(matchesProductQuery(prod, "pizzas")).toBe(true);
    expect(matchesProductQuery(prod, "hamburguesa")).toBe(false);
  });
});
