import { describe, expect, it } from "vitest";
import type { OrderDto } from "@gastronomy/contracts";
import { filterClosedTableOrders } from "./closed-tables-history";

const makeOrder = (overrides: Partial<OrderDto>): OrderDto =>
  ({
    id: "ord-1",
    number: 101,
    type: "DINE_IN",
    operationalStatus: "DELIVERED",
    paymentStatus: "PAID",
    lifecycleStatus: "COMPLETED",
    cashSessionCreatedId: "session-1",
    cashSessionPaidId: "session-1",
    tableId: "table-1",
    tableNumber: 1,
    customerId: null,
    customerNameSnapshot: null,
    customerPhoneSnapshot: null,
    deliveryAddressSnapshot: null,
    deliveryAddressNotesSnapshot: null,
    deliveryFeeMinor: 0,
    promisedAt: null,
    scheduled: false,
    waiterUserId: "user-waiter-1",
    waiterName: "Lucas Pérez",
    driverUserId: null,
    driverName: null,
    collectedByDriver: false,
    notes: null,
    subtotalMinor: 2000,
    discountMinor: 0,
    totalMinor: 2000,
    paidMinor: 2000,
    printedAt: null,
    printCount: 0,
    createdAt: "2026-09-17T12:00:00.000Z",
    updatedAt: "2026-09-17T12:30:00.000Z",
    payments: [],
    items: [
      {
        id: "item-1",
        productId: "prod-1",
        productNameSnapshot: "Pizza Fugazzeta",
        quantity: 1,
        unitPriceMinorSnapshot: 2000,
        discountMinorSnapshot: 0,
        notes: null,
        halves: [],
        modifiers: [],
        lineTotalMinor: 2000,
      },
    ],
    ...overrides,
  }) as OrderDto;

describe("filterClosedTableOrders", () => {
  const closedOrder1 = makeOrder({
    id: "ord-1",
    number: 101,
    tableNumber: 1,
    waiterName: "Lucas Pérez",
    operationalStatus: "DELIVERED",
    cashSessionPaidId: "session-1",
    items: [
      {
        id: "it-1",
        productId: "p-1",
        productNameSnapshot: "Pizza Fugazzeta",
        quantity: 1,
        unitPriceMinorSnapshot: 2000,
        discountMinorSnapshot: 0,
        notes: null,
        halves: [],
        modifiers: [],
        lineTotalMinor: 2000,
      },
    ],
  });

  const closedOrder2 = makeOrder({
    id: "ord-2",
    number: 102,
    tableNumber: 4,
    waiterName: "Sofía Martínez",
    operationalStatus: "DELIVERED",
    cashSessionPaidId: "session-1",
    items: [
      {
        id: "it-2",
        productId: "p-2",
        productNameSnapshot: "Cerveza Quilmes 1L",
        quantity: 2,
        unitPriceMinorSnapshot: 1500,
        discountMinorSnapshot: 0,
        notes: null,
        halves: [],
        modifiers: [],
        lineTotalMinor: 3000,
      },
    ],
  });

  const openOrder = makeOrder({
    id: "ord-3",
    number: 103,
    tableNumber: 2,
    operationalStatus: "IN_PREPARATION",
    cashSessionCreatedId: "session-1",
    cashSessionPaidId: null,
  });

  const takeawayOrder = makeOrder({
    id: "ord-4",
    number: 104,
    type: "TAKEAWAY",
    operationalStatus: "DELIVERED",
    cashSessionPaidId: "session-1",
  });

  const otherSessionOrder = makeOrder({
    id: "ord-5",
    number: 105,
    tableNumber: 3,
    operationalStatus: "DELIVERED",
    cashSessionCreatedId: "session-old",
    cashSessionPaidId: "session-old",
  });

  const cancelledTableOrder = makeOrder({
    id: "ord-6",
    number: 106,
    tableNumber: 5,
    waiterName: "Lucas Pérez",
    operationalStatus: "CANCELLED",
    cashSessionCreatedId: "session-1",
    cashSessionPaidId: null,
    items: [
      {
        id: "it-6",
        productId: "p-6",
        productNameSnapshot: "Agua con gas",
        quantity: 1,
        unitPriceMinorSnapshot: 500,
        discountMinorSnapshot: 0,
        notes: null,
        halves: [],
        modifiers: [],
        lineTotalMinor: 500,
      },
    ],
  });

  const orders = [
    closedOrder1,
    closedOrder2,
    openOrder,
    takeawayOrder,
    otherSessionOrder,
    cancelledTableOrder,
  ];

  it("filtra solo mesas cerradas del turno actual", () => {
    const result = filterClosedTableOrders(orders, "session-1");
    expect(result.map((o) => o.id)).toEqual(["ord-1", "ord-2", "ord-6"]);
  });

  it("busca por mozo", () => {
    const result = filterClosedTableOrders(orders, "session-1", "sofía");
    expect(result.map((o) => o.id)).toEqual(["ord-2"]);
  });

  it("busca por número de mesa ('4' o 'mesa 4')", () => {
    const byNumber = filterClosedTableOrders(orders, "session-1", "4");
    expect(byNumber.map((o) => o.id)).toEqual(["ord-2"]);

    const byWord = filterClosedTableOrders(orders, "session-1", "mesa 4");
    expect(byWord.map((o) => o.id)).toEqual(["ord-2"]);
  });

  it("busca por producto vendido", () => {
    const result = filterClosedTableOrders(orders, "session-1", "fugazzeta");
    expect(result.map((o) => o.id)).toEqual(["ord-1"]);

    const cervezas = filterClosedTableOrders(orders, "session-1", "cerveza");
    expect(cervezas.map((o) => o.id)).toEqual(["ord-2"]);
  });

  it("busca por producto vendido en mitades de pizza", () => {
    const halfOrder = makeOrder({
      id: "ord-7",
      number: 107,
      tableNumber: 7,
      operationalStatus: "DELIVERED",
      cashSessionPaidId: "session-1",
      items: [
        {
          id: "it-7",
          productId: null,
          productNameSnapshot: "Mitad y Mitad",
          quantity: 1,
          unitPriceMinorSnapshot: 2500,
          discountMinorSnapshot: 0,
          notes: null,
          halves: [
            {
              productId: "p-nap",
              nameSnapshot: "Napolitana Especial",
              priceMinorSnapshot: 1250,
              position: "FIRST",
            },
            {
              productId: "p-calab",
              nameSnapshot: "Calabresa",
              priceMinorSnapshot: 1250,
              position: "SECOND",
            },
          ],
          modifiers: [],
          lineTotalMinor: 2500,
        },
      ],
    });

    const result = filterClosedTableOrders([halfOrder], "session-1", "calabresa");
    expect(result.map((o) => o.id)).toEqual(["ord-7"]);
  });

  it("busca por número de pedido", () => {
    const result = filterClosedTableOrders(orders, "session-1", "#101");
    expect(result.map((o) => o.id)).toEqual(["ord-1"]);
  });
});
