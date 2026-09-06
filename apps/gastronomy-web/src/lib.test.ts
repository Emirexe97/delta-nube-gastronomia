import { describe, expect, it } from "vitest";
import type { ProductDto } from "@gastronomy/contracts";
import {
  paidOrdersForSession,
  paymentText,
  salesByChannel,
  parseMoneyInput,
  parseStockInput,
  promisedTiming,
  rankProducts,
} from "./lib";

const paidOrder = (
  id: string,
  type: "DINE_IN" | "TAKEAWAY" | "DELIVERY",
  amount: number,
  method = "Efectivo",
) =>
  ({
    id,
    type,
    paidMinor: amount,
    cashSessionPaidId: "s1",
    lifecycleStatus: "CONFIRMED",
    operationalStatus: "DELIVERED",
    updatedAt: id,
    payments: [
      {
        methodName: method,
        methodCode: method === "Efectivo" ? "CASH" : "TRANSFER",
        amountMinor: amount,
        refundedMinor: 0,
        status: "ACTIVE",
      },
    ],
    number: 1,
  }) as any;

const product = (
  id: string,
  name: string,
  code: string | null,
  categoryName = "Pizzas",
): ProductDto => ({
  id,
  name,
  code,
  categoryId: categoryName,
  categoryName,
  sortOrder: 0,
  active: true,
  prices: [],
  stockMinor: null,
});

describe("rankProducts", () => {
  const products = [
    product("1", "Pizza Especial", "P02"),
    product("2", "Pizza Muzzarella", "P01"),
    product("3", "Empanada Especial", "E01", "Empanadas"),
  ];

  it("prioriza código exacto, prefijo de código y prefijo de nombre", () => {
    expect(rankProducts(products, "P01").map((item) => item.id)).toEqual(["2"]);
    expect(rankProducts(products, "P").map((item) => item.id)).toEqual([
      "1",
      "2",
      "3",
    ]);
    expect(
      rankProducts(products, "pizza especial").map((item) => item.id),
    ).toEqual(["1"]);
  });

  it("busca sin tildes por nombre/categoría y respeta el filtro de categoría", () => {
    expect(rankProducts([product("1", "Jamón", null)], "jamon")[0]?.id).toBe(
      "1",
    );
    expect(
      rankProducts(products, "especial", "Empanadas").map((item) => item.id),
    ).toEqual(["3"]);
  });
});

describe("promisedTiming", () => {
  const now = new Date("2026-08-31T15:00:00.000Z").valueOf();
  it("distingue próximo, inminente y atrasado", () => {
    expect(promisedTiming("2026-08-31T15:30:00.000Z", now)).toEqual({
      label: "Faltan 30 min",
      tone: "green",
    });
    expect(promisedTiming("2026-08-31T15:08:00.000Z", now).tone).toBe("amber");
    expect(promisedTiming("2026-08-31T14:55:00.000Z", now)).toEqual({
      label: "Atrasado 5 min",
      tone: "rose",
    });
  });
});

describe("parseStockInput", () => {
  it("convierte unidades y fracciones a milésimas", () => {
    expect(parseStockInput("10")).toBe(10_000);
    expect(parseStockInput("1,5")).toBe(1_500);
    expect(parseStockInput("0.125")).toBe(125);
  });

  it("rechaza texto, negativos e infinitos", () => {
    expect(parseStockInput("abc")).toBeNull();
    expect(parseStockInput("-1")).toBeNull();
    expect(parseStockInput("Infinity")).toBeNull();
    expect(parseStockInput("1,2345")).toBeNull();
  });
});

describe("parseMoneyInput", () => {
  it("rechaza importes que superan el entero seguro", () => {
    expect(parseMoneyInput("1500,25")).toBe(150_025);
    expect(parseMoneyInput("9999999999999999")).toBeNull();
  });
});

describe("ventas cobradas por caja", () => {
  it("incluye los tres canales y excluye otra caja/cancelados", () => {
    const orders = [
      paidOrder("2026-01-01T00:03:00Z", "DINE_IN", 100),
      paidOrder("2026-01-01T00:02:00Z", "TAKEAWAY", 200, "Transferencia"),
      paidOrder("2026-01-01T00:01:00Z", "DELIVERY", 300),
      { ...paidOrder("old", "DINE_IN", 999), cashSessionPaidId: "old" },
    ];
    expect(
      paidOrdersForSession(orders, { id: "s1" } as any).map((o) => o.type),
    ).toEqual(["DINE_IN", "TAKEAWAY", "DELIVERY"]);
    expect(
      salesByChannel(orders.filter((o) => o.cashSessionPaidId === "s1")),
    ).toEqual({ DINE_IN: 100, TAKEAWAY: 200, DELIVERY: 300 });
    expect(paymentText(orders[1])).toBe("Transferencia");
  });
});
