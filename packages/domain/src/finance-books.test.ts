import test from "node:test";
import assert from "node:assert/strict";
import { buildFinanceBooks, validateFinanceEntry } from "./finance-books";
import type {
  FinanceBookEvent,
  FinanceBookSources,
  FinanceEntryInput,
} from "@gastronomy/contracts";

const sources: FinanceBookSources = {
  purchases: [
    {
      id: "buy-1",
      supplierId: "sup-1",
      supplierName: "Molino",
      occurredAt: "2026-11-02",
      documentNumber: "A-12",
      totalMinor: 10_000_000,
      status: "confirmed",
    },
  ],
  posPayments: [
    {
      id: "pay-1",
      orderId: "order-1",
      orderNumber: 23,
      occurredAt: "2026-11-12",
      amountMinor: 1_000_000,
      method: "card",
      status: "captured",
      alreadySettled: false,
    },
  ],
  theoreticalInventory: [
    { itemId: "flour", name: "Harina", quantity: 25, unit: "kg" },
  ],
  pnlByMonth: {
    "2026-11": {
      salesMinor: 1_500_000,
      costOfGoodsMinor: 400_000,
      payrollMinor: 0,
      operatingExpensesMinor: 500_000,
      netMinor: 600_000,
    },
  },
};
const actor = { actorId: "admin", actorName: "Administración" };
const date = "2026-11-21";
const key = (s: string) => `finance-${s}-key`;
type EntryWithoutPin = FinanceEntryInput extends infer T
  ? T extends { authorizerPin: string }
    ? Omit<T, "authorizerPin">
    : never
  : never;
const add = (events: FinanceBookEvent[], input: EntryWithoutPin) =>
  validateFinanceEntry(
    events,
    { ...input, authorizerPin: "2468" } as FinanceEntryInput,
    actor,
    sources,
    new Date("2026-11-21T15:00:00Z"),
  );
const openCash = (events: FinanceBookEvent[]) =>
  add(events, {
    idempotencyKey: key("cash"),
    kind: "account_open",
    date,
    reason: "Saldo inicial caja",
    account: {
      id: "cash",
      name: "Caja",
      kind: "cash",
      openingBalanceMinor: 20_000_000,
      active: true,
    },
  });

test("registra compra como obligación, liquida pagos parciales y evita duplicar el gasto/stock", () => {
  const events: FinanceBookEvent[] = [];
  events.push(openCash(events));
  events.push(
    add(events, {
      idempotencyKey: key("obligation"),
      kind: "obligation",
      date,
      reason: "Factura de compra",
      obligation: {
        id: "ob-1",
        supplierId: "sup-1",
        supplierName: "Molino",
        description: "Harina",
        documentNumber: "A-12",
        purchaseRef: { type: "purchase", id: "buy-1" },
        incurredAt: "2026-11-02",
        amountMinor: 10_000_000,
      },
    }),
  );
  events.push(
    add(events, {
      idempotencyKey: key("p1"),
      kind: "obligation_payment",
      date,
      reason: "Pago parcial",
      obligationId: "ob-1",
      accountId: "cash",
      amountMinor: 4_000_000,
    }),
  );
  events.push(
    add(events, {
      idempotencyKey: key("p2"),
      kind: "obligation_payment",
      date,
      reason: "Pago final",
      obligationId: "ob-1",
      accountId: "cash",
      amountMinor: 6_000_000,
    }),
  );
  const book = buildFinanceBooks(
    events,
    { from: "2026-11-01", to: "2026-11-30" },
    sources,
  );
  assert.equal(book.obligations[0]!.status, "paid");
  assert.equal(book.obligations[0]!.outstandingMinor, 0);
  assert.equal(book.obligations[0]!.payments.length, 2);
  assert.equal(book.accounts[0]!.balanceMinor, 10_000_000);
  assert.equal(book.obligations[0]!.purchaseRef.id, "buy-1");
});

test("concilia lote de tarjeta por bruto, comisión y depósito neto sin cambiar venta POS", () => {
  const events = [openCash([])];
  events.push(
    add(events, {
      idempotencyKey: key("settlement"),
      kind: "settlement_expected",
      date,
      reason: "Lote tarjeta",
      settlement: {
        id: "lot-1",
        sourceRef: { type: "pos_order", id: "order-1" },
        paymentIds: ["pay-1"],
        accountId: "cash",
        occurredAt: date,
        grossMinor: 1_000_000,
        deductionsMinor: 30_000,
        commissionMinor: 30_000,
        withheldMinor: 0,
        expectedNetMinor: 970_000,
      },
    }),
  );
  events.push(
    add(events, {
      idempotencyKey: key("credit"),
      kind: "settlement_credit",
      date,
      reason: "Depósito recibido",
      settlementId: "lot-1",
      accountId: "cash",
      actualNetMinor: 970_000,
    }),
  );
  events.push(
    add(events, {
      idempotencyKey: key("reconcile"),
      kind: "settlement_reconcile",
      date,
      reason: "Banco conciliado",
      settlementId: "lot-1",
    }),
  );
  const book = buildFinanceBooks(
    events,
    { from: "2026-11-01", to: "2026-11-30" },
    sources,
  );
  assert.equal(book.settlements[0]!.grossMinor, 1_000_000);
  assert.equal(book.settlements[0]!.expectedNetMinor, 970_000);
  assert.equal(book.settlements[0]!.differenceMinor, 0);
  assert.equal(book.settlements[0]!.commissionMinor, 30_000);
  assert.equal(book.settlements[0]!.withheldMinor, 0);
  assert.equal(book.settlements[0]!.status, "reconciled");
  assert.equal(book.accounts[0]!.balanceMinor, 20_970_000);
});

test("rechaza pago excesivo, cobro reutilizado y fecha de cierre antes del fin de mes", () => {
  const events = [openCash([])];
  events.push(
    add(events, {
      idempotencyKey: key("obligation"),
      kind: "obligation",
      date,
      reason: "Factura real",
      obligation: {
        id: "ob-1",
        supplierId: "sup-1",
        supplierName: "Molino",
        description: "Harina",
        purchaseRef: { type: "purchase", id: "buy-1" },
        incurredAt: "2026-11-02",
        amountMinor: 10_000_000,
      },
    }),
  );
  assert.throws(() =>
    add(events, {
      idempotencyKey: key("too-much"),
      kind: "obligation_payment",
      date,
      reason: "Pago excedido",
      obligationId: "ob-1",
      accountId: "cash",
      amountMinor: 10_000_001,
    }),
  );
  const lot = add(events, {
    idempotencyKey: key("lot1"),
    kind: "settlement_expected",
    date,
    reason: "Lote",
    settlement: {
      id: "lot-1",
      sourceRef: { type: "pos_order", id: "order-1" },
      paymentIds: ["pay-1"],
      accountId: "cash",
      occurredAt: date,
      grossMinor: 1_000_000,
      deductionsMinor: 0,
      expectedNetMinor: 1_000_000,
    },
  });
  assert.throws(() =>
    add([...events, lot], {
      idempotencyKey: key("lot2"),
      kind: "settlement_expected",
      date,
      reason: "Duplicado",
      settlement: {
        id: "lot-2",
        sourceRef: { type: "pos_order", id: "order-1" },
        paymentIds: ["pay-1"],
        accountId: "cash",
        occurredAt: date,
        grossMinor: 1_000_000,
        deductionsMinor: 0,
        expectedNetMinor: 1_000_000,
      },
    }),
  );
  assert.throws(() =>
    add(events, {
      idempotencyKey: key("close-early"),
      kind: "month_close",
      date: "2026-11-21",
      reason: "Cierre prematuro",
      month: "2026-11",
    }),
  );
});

test("idempotencia devuelve evento existente sin volver a aplicar un movimiento", () => {
  const first = openCash([]);
  const duplicate = openCash([first]);
  assert.equal(duplicate.id, first.id);
  assert.equal(
    buildFinanceBooks(
      [first, duplicate],
      { from: "2026-11-01", to: "2026-11-30" },
      sources,
    ).accounts.length,
    1,
  );
});

test("calcula consumo real, teórico y merma con la recepción desde el último conteo", () => {
  const previousSources = {
    ...sources,
    theoreticalInventory: [
      { itemId: "flour", quantity: 25, unit: "kg", receivedQuantity: 0 },
    ],
  };
  const first = validateFinanceEntry(
    [],
    {
      idempotencyKey: key("count-one"),
      authorizerPin: "2468",
      kind: "inventory_count",
      date: "2026-11-01",
      reason: "Conteo inicial",
      count: {
        id: "count-1",
        occurredAt: "2026-11-01",
        items: [
          {
            itemId: "flour",
            theoreticalQuantity: 25,
            actualQuantity: 40,
            wasteQuantity: 0,
            unit: "kg",
          },
        ],
      },
    },
    actor,
    previousSources,
    new Date("2026-11-01T12:00:00Z"),
  );
  const currentSources = {
    ...sources,
    theoreticalInventory: [
      { itemId: "flour", quantity: 25, unit: "kg", receivedQuantity: 15 },
    ],
  };
  const second = validateFinanceEntry(
    [first],
    {
      idempotencyKey: key("count-two"),
      authorizerPin: "2468",
      kind: "inventory_count",
      date: "2026-11-21",
      reason: "Conteo con merma",
      count: {
        id: "count-2",
        occurredAt: "2026-11-21",
        items: [
          {
            itemId: "flour",
            theoreticalQuantity: 25,
            actualQuantity: 0,
            wasteQuantity: 100,
            unit: "kg",
          },
        ],
      },
    },
    actor,
    currentSources,
    new Date("2026-11-21T12:00:00Z"),
  );
  assert.equal(second.input.kind, "inventory_count");
  if (second.input.kind !== "inventory_count")
    throw new Error("Se esperaba un conteo.");
  assert.equal(second.input.count.items[0]!.actualUsage, 55);
  assert.equal(second.input.count.items[0]!.theoreticalUsage, 15);
  assert.equal(second.input.count.items[0]!.unexplainedUsage, -60);
});

test("muestra facturas previas vencidas y liquidaciones pendientes fuera del rango seleccionado", () => {
  const extended = {
    ...sources,
    purchases: [
      {
        ...sources.purchases[0]!,
        occurredAt: "2026-10-31T15:30:00.000Z",
        totalMinor: 8_000_000,
      },
    ],
    posPayments: [
      { ...sources.posPayments[0]!, occurredAt: "2026-10-31T14:00:00.000Z" },
    ],
  };
  const cash = openCash([]);
  const open = validateFinanceEntry(
    [cash],
    {
      idempotencyKey: key("prior-obligation"),
      authorizerPin: "2468",
      kind: "obligation",
      date: "2026-10-31",
      reason: "Factura octubre",
      obligation: {
        id: "ob-oct",
        supplierId: "sup-1",
        supplierName: "Molino",
        description: "Harina",
        purchaseRef: { type: "purchase", id: "buy-1" },
        incurredAt: "2026-10-31T15:30:00.000Z",
        dueAt: "2026-11-21",
        amountMinor: 8_000_000,
      },
    },
    actor,
    extended,
    new Date("2026-11-21T12:00:00Z"),
  );
  const pending = validateFinanceEntry(
    [cash, open],
    {
      idempotencyKey: key("prior-settlement"),
      authorizerPin: "2468",
      kind: "settlement_expected",
      date: "2026-12-05",
      reason: "Acreditación prevista",
      settlement: {
        id: "lot-dec",
        sourceRef: { type: "pos_order", id: "order-1" },
        paymentIds: ["pay-1"],
        accountId: "cash",
        occurredAt: "2026-12-05",
        grossMinor: 1_000_000,
        deductionsMinor: 30_000,
        expectedNetMinor: 970_000,
      },
    },
    actor,
    extended,
    new Date("2026-11-21T12:00:00Z"),
  );
  const book = buildFinanceBooks(
    [cash, open, pending],
    { from: "2026-11-01", to: "2026-11-30" },
    extended,
  );
  assert.equal(book.obligations[0]!.incurredAt, "2026-10-31T15:30:00.000Z");
  assert.equal(book.obligations[0]!.outstandingMinor, 8_000_000);
  assert.equal(book.settlements.length, 1);
  assert.equal(book.sources.posPayments[0]!.alreadySettled, true);
});

test("refleja cambios de factura y protege saldo pendiente o crédito a favor", () => {
  const base = [
    openCash([]),
    add([], {
      idempotencyKey: key("obligation"),
      kind: "obligation",
      date,
      reason: "Factura original",
      obligation: {
        id: "ob-1",
        supplierId: "sup-1",
        supplierName: "Molino",
        description: "Harina",
        purchaseRef: { type: "purchase", id: "buy-1" },
        incurredAt: "2026-11-02",
        amountMinor: 10_000_000,
      },
    }),
  ];
  const partial = add(base, {
    idempotencyKey: key("p1"),
    kind: "obligation_payment",
    date,
    reason: "Pago parcial",
    obligationId: "ob-1",
    accountId: "cash",
    amountMinor: 4_000_000,
  });
  const adjustedDown: FinanceBookSources = {
    ...sources,
    purchases: [{ ...sources.purchases[0]!, totalMinor: 3_000_000 }],
  };
  const dueDown = buildFinanceBooks(
    [...base, partial],
    { from: "2026-11-01", to: "2026-11-30" },
    adjustedDown,
  ).obligations[0]!;
  assert.equal(dueDown.amountMinor, 10_000_000);
  assert.equal(dueDown.currentPurchaseAmountMinor, 3_000_000);
  assert.equal(dueDown.outstandingMinor, 0);
  assert.equal(dueDown.creditBalanceMinor, 1_000_000);
  const cancelled: FinanceBookSources = {
    ...adjustedDown,
    purchases: [{ ...adjustedDown.purchases[0]!, status: "cancelled" }],
  };
  const cancelledDue = buildFinanceBooks(
    [...base, partial],
    { from: "2026-11-01", to: "2026-11-30" },
    cancelled,
  ).obligations[0]!;
  assert.equal(cancelledDue.currentPurchaseAmountMinor, 0);
  assert.equal(cancelledDue.creditBalanceMinor, 4_000_000);
  assert.throws(() =>
    validateFinanceEntry(
      [...base, partial],
      {
        idempotencyKey: key("overpay-adjusted"),
        authorizerPin: "2468",
        kind: "obligation_payment",
        date,
        reason: "Pago no válido",
        obligationId: "ob-1",
        accountId: "cash",
        amountMinor: 1,
      },
      actor,
      adjustedDown,
      new Date("2026-11-21T12:00:00Z"),
    ),
  );
  const adjustedUp: FinanceBookSources = {
    ...sources,
    purchases: [{ ...sources.purchases[0]!, totalMinor: 12_000_000 }],
  };
  const dueUp = buildFinanceBooks(
    [...base, partial],
    { from: "2026-11-01", to: "2026-11-30" },
    adjustedUp,
  ).obligations[0]!;
  assert.equal(dueUp.outstandingMinor, 8_000_000);
  const remainder = validateFinanceEntry(
    [...base, partial],
    {
      idempotencyKey: key("adjusted-rest"),
      authorizerPin: "2468",
      kind: "obligation_payment",
      date,
      reason: "Completar compra corregida",
      obligationId: "ob-1",
      accountId: "cash",
      amountMinor: 8_000_000,
    },
    actor,
    adjustedUp,
    new Date("2026-11-21T12:00:00Z"),
  );
  assert.equal(remainder.input.kind, "obligation_payment");
});

test("guarda cierre de octubre con saldo histórico y lo marca ajustado por corrección posterior", () => {
  const octoberSources: FinanceBookSources = {
    ...sources,
    purchases: [
      {
        ...sources.purchases[0]!,
        occurredAt: "2026-10-02",
        totalMinor: 10_000_000,
      },
    ],
    pnlByMonth: {
      "2026-10": {
        salesMinor: 1_000_000,
        costOfGoodsMinor: 250_000,
        payrollMinor: 0,
        operatingExpensesMinor: 400_000,
        netMinor: 350_000,
      },
    },
  };
  const initial = validateFinanceEntry(
    [],
    {
      idempotencyKey: key("oct-account"),
      authorizerPin: "2468",
      kind: "account_open",
      date: "2026-10-01",
      reason: "Apertura octubre",
      account: {
        id: "cash",
        name: "Caja",
        kind: "cash",
        openingBalanceMinor: 1_000_000,
        active: true,
      },
    },
    actor,
    octoberSources,
    new Date("2026-11-21T12:00:00Z"),
  );
  const close = validateFinanceEntry(
    [initial],
    {
      idempotencyKey: key("oct-close"),
      authorizerPin: "2468",
      kind: "month_close",
      date: "2026-10-31",
      reason: "Cierre octubre",
      month: "2026-10",
    },
    actor,
    octoberSources,
    new Date("2026-11-21T12:00:00Z"),
  );
  assert.equal(close.accountBalancesSnapshot?.cash, 1_000_000);
  assert.equal(close.pnlSnapshot?.netMinor, 350_000);
  const correction = validateFinanceEntry(
    [initial, close],
    {
      idempotencyKey: key("oct-adjust"),
      authorizerPin: "2468",
      kind: "adjustment",
      date: "2026-11-10",
      reason: "Factura corregida",
      amountMinor: 50_000,
      targetRef: { type: "purchase", id: "buy-1" },
      accountId: "cash",
    },
    actor,
    octoberSources,
    new Date("2026-11-21T12:00:00Z"),
  );
  const book = buildFinanceBooks(
    [initial, close, correction],
    { from: "2026-10-01", to: "2026-10-31" },
    octoberSources,
  );
  assert.equal(book.monthlyClosures[0]!.accountBalances.cash, 1_000_000);
  assert.equal(book.monthlyClosures[0]!.status, "adjusted");
  assert.equal(book.adjustments[0]!.id, correction.id);
});

test("rechaza fechas futuras de movimientos y cierres, pero permite lote previsto", () => {
  const now = new Date("2026-11-21T12:00:00Z");
  const cash = openCash([]);
  assert.throws(() =>
    validateFinanceEntry(
      [],
      {
        idempotencyKey: key("future-count"),
        authorizerPin: "2468",
        kind: "inventory_count",
        date: "2026-11-22",
        reason: "Conteo futuro",
        count: {
          id: "c",
          occurredAt: "2026-11-22",
          items: [
            {
              itemId: "flour",
              theoreticalQuantity: 25,
              actualQuantity: 25,
              wasteQuantity: 0,
              unit: "kg",
            },
          ],
        },
      },
      actor,
      sources,
      now,
    ),
  );
  assert.throws(() =>
    validateFinanceEntry(
      [],
      {
        idempotencyKey: key("future-close"),
        authorizerPin: "2468",
        kind: "month_close",
        date: "2026-11-30",
        reason: "Cierre futuro",
        month: "2026-11",
      },
      actor,
      sources,
      now,
    ),
  );
  const planned = validateFinanceEntry(
    [cash],
    {
      idempotencyKey: key("future-settlement"),
      authorizerPin: "2468",
      kind: "settlement_expected",
      date: "2026-12-05",
      reason: "Lote previsto",
      settlement: {
        id: "lot-plan",
        sourceRef: { type: "pos_order", id: "order-1" },
        paymentIds: ["pay-1"],
        accountId: "cash",
        occurredAt: "2026-12-05",
        grossMinor: 1_000_000,
        deductionsMinor: 30_000,
        expectedNetMinor: 970_000,
      },
    },
    actor,
    sources,
    now,
  );
  assert.equal(planned.input.date, "2026-12-05");
});

test("rechaza reversa sin saldo y reutilización de clave idempotente con payload distinto", () => {
  const cash = openCash([]);
  const bank = add([cash], {
    idempotencyKey: key("bank"),
    kind: "account_open",
    date,
    reason: "Banco",
    account: {
      id: "bank",
      name: "Banco",
      kind: "bank",
      openingBalanceMinor: 0,
      active: true,
    },
  });
  const transfer = add([cash, bank], {
    idempotencyKey: key("transfer"),
    kind: "transfer",
    date,
    reason: "Acreditar banco",
    fromAccountId: "cash",
    toAccountId: "bank",
    amountMinor: 10_000_000,
  });
  const emptyThird = add([cash, bank, transfer], {
    idempotencyKey: key("third"),
    kind: "account_open",
    date,
    reason: "Tercera cuenta",
    account: {
      id: "third",
      name: "Tercera",
      kind: "wallet",
      openingBalanceMinor: 0,
      active: true,
    },
  });
  const drained = add([cash, bank, transfer, emptyThird], {
    idempotencyKey: key("drain"),
    kind: "transfer",
    date,
    reason: "Transferencia posterior",
    fromAccountId: "bank",
    toAccountId: "third",
    amountMinor: 10_000_000,
  });
  assert.throws(() =>
    validateFinanceEntry(
      [cash, bank, transfer, emptyThird, drained],
      {
        idempotencyKey: key("reverse-transfer"),
        authorizerPin: "2468",
        kind: "reverse",
        date,
        reason: "Revertir transferencia",
        targetEventId: transfer.id,
      },
      actor,
      sources,
      new Date("2026-11-21T12:00:00Z"),
    ),
  );
  assert.throws(() =>
    validateFinanceEntry(
      [cash],
      {
        idempotencyKey: cash.idempotencyKey,
        authorizerPin: "2468",
        kind: "account_open",
        date,
        reason: "Otro payload",
        account: {
          id: "other",
          name: "Otra",
          kind: "cash",
          openingBalanceMinor: 0,
          active: true,
        },
      },
      actor,
      sources,
      new Date("2026-11-21T12:00:00Z"),
    ),
  );
});

test("revierte lotes previstos sin dinero movido, libera cobros y mantiene ambos eventos", () => {
  const cash = openCash([]);
  const planned = add([cash], {
    idempotencyKey: key("planned-lot-old"),
    kind: "settlement_expected",
    date,
    reason: "Lote equivocado",
    settlement: {
      id: "lot-old",
      sourceRef: { type: "pos_order", id: "order-1" },
      paymentIds: ["pay-1"],
      accountId: "cash",
      occurredAt: date,
      grossMinor: 1_000_000,
      deductionsMinor: 30_000,
      expectedNetMinor: 970_000,
    },
  });
  const reversal = add([cash, planned], {
    idempotencyKey: key("reverse-planned-lot"),
    kind: "reverse",
    date,
    reason: "Corregir lote",
    targetEventId: planned.id,
  });
  const book = buildFinanceBooks(
    [cash, planned, reversal],
    { from: "2026-11-01", to: "2026-11-30" },
    sources,
  );
  assert.equal(book.settlements.length, 0);
  assert.equal(book.sources.posPayments[0]!.alreadySettled, false);
  assert.equal(
    book.entries.some((e) => e.id === planned.id),
    true,
  );
  assert.equal(
    book.entries.some((e) => e.id === reversal.id),
    true,
  );
  const replacement = add([cash, planned, reversal], {
    idempotencyKey: key("planned-lot-replacement"),
    kind: "settlement_expected",
    date,
    reason: "Lote correcto",
    settlement: {
      id: "lot-new",
      sourceRef: { type: "pos_order", id: "order-1" },
      paymentIds: ["pay-1"],
      accountId: "cash",
      occurredAt: date,
      grossMinor: 1_000_000,
      deductionsMinor: 30_000,
      expectedNetMinor: 970_000,
    },
  });
  assert.equal(replacement.input.kind, "settlement_expected");

  const credited = add([cash], {
    idempotencyKey: key("credited-lot"),
    kind: "settlement_expected",
    date,
    reason: "Lote con depósito",
    settlement: {
      id: "lot-credited",
      sourceRef: { type: "pos_order", id: "order-1" },
      paymentIds: ["pay-1"],
      accountId: "cash",
      occurredAt: date,
      grossMinor: 1_000_000,
      deductionsMinor: 0,
      expectedNetMinor: 1_000_000,
    },
  });
  const credit = add([cash, credited], {
    idempotencyKey: key("credit-lot"),
    kind: "settlement_credit",
    date,
    reason: "Depósito recibido",
    settlementId: "lot-credited",
    accountId: "cash",
    actualNetMinor: 1_000_000,
  });
  assert.throws(() =>
    validateFinanceEntry(
      [cash, credited, credit],
      {
        idempotencyKey: key("reverse-credited-lot"),
        authorizerPin: "2468",
        kind: "reverse",
        date,
        reason: "Revertir lote",
        targetEventId: credited.id,
      },
      actor,
      sources,
      new Date("2026-11-21T12:00:00Z"),
    ),
  );
});

test("desvincula compras sin pagos vigentes, libera purchaseId y bloquea si ya salió dinero", () => {
  const cash = openCash([]);
  const obligation = add([cash], {
    idempotencyKey: key("linked-purchase-old"),
    kind: "obligation",
    date,
    reason: "Compra mal asociada",
    obligation: {
      id: "ob-old",
      supplierId: "sup-1",
      supplierName: "Molino",
      description: "Compra anterior",
      purchaseRef: { type: "purchase", id: "buy-1" },
      incurredAt: "2026-11-02",
      amountMinor: 10_000_000,
    },
  });
  assert.equal(
    buildFinanceBooks(
      [cash, obligation],
      { from: "2026-11-01", to: "2026-11-30" },
      sources,
    ).sources.purchases[0]!.alreadyLinked,
    true,
  );
  const reversal = add([cash, obligation], {
    idempotencyKey: key("unlink-purchase"),
    kind: "reverse",
    date,
    reason: "Desvincular compra",
    targetEventId: obligation.id,
  });
  const unlinked = buildFinanceBooks(
    [cash, obligation, reversal],
    { from: "2026-11-01", to: "2026-11-30" },
    sources,
  );
  assert.equal(unlinked.obligations.length, 0);
  assert.equal(unlinked.sources.purchases[0]!.alreadyLinked, false);
  assert.equal(
    unlinked.entries.some((e) => e.id === obligation.id),
    true,
  );
  assert.equal(
    unlinked.entries.some((e) => e.id === reversal.id),
    true,
  );
  const replacement = add([cash, obligation, reversal], {
    idempotencyKey: key("link-purchase-again"),
    kind: "obligation",
    date,
    reason: "Compra bien asociada",
    obligation: {
      id: "ob-new",
      supplierId: "sup-1",
      supplierName: "Molino",
      description: "Compra corregida",
      purchaseRef: { type: "purchase", id: "buy-1" },
      incurredAt: "2026-11-02",
      amountMinor: 10_000_000,
    },
  });
  assert.equal(replacement.input.kind, "obligation");

  const paid = add([cash, obligation], {
    idempotencyKey: key("linked-purchase-payment"),
    kind: "obligation_payment",
    date,
    reason: "Pago emitido",
    obligationId: "ob-old",
    accountId: "cash",
    amountMinor: 1_000_000,
  });
  assert.throws(() =>
    validateFinanceEntry(
      [cash, obligation, paid],
      {
        idempotencyKey: key("unlink-paid-purchase"),
        authorizerPin: "2468",
        kind: "reverse",
        date,
        reason: "Desvincular con pago",
        targetEventId: obligation.id,
      },
      actor,
      sources,
      new Date("2026-11-21T12:00:00Z"),
    ),
  );
});

test("acepta reintentos con snapshots de lote/conteo y rechaza días imposibles", () => {
  const cash = openCash([]);
  const lotInput: FinanceEntryInput = {
    idempotencyKey: key("snapshot-lot"),
    authorizerPin: "2468",
    kind: "settlement_expected",
    date,
    reason: "Lote de prueba",
    settlement: {
      id: "lot-snap",
      sourceRef: { type: "pos_order", id: "order-1" },
      paymentIds: ["pay-1"],
      accountId: "cash",
      occurredAt: date,
      grossMinor: 1_000_000,
      deductionsMinor: 30_000,
      expectedNetMinor: 970_000,
    },
  };
  const lot = validateFinanceEntry(
    [cash],
    lotInput,
    actor,
    sources,
    new Date("2026-11-21T12:00:00Z"),
  );
  assert.equal(
    validateFinanceEntry(
      [cash, lot],
      lotInput,
      actor,
      sources,
      new Date("2026-11-21T12:30:00Z"),
    ).id,
    lot.id,
  );
  const countInput: FinanceEntryInput = {
    idempotencyKey: key("snapshot-count"),
    authorizerPin: "2468",
    kind: "inventory_count",
    date,
    reason: "Conteo guardado",
    count: {
      id: "count-snap",
      occurredAt: date,
      items: [
        {
          itemId: "flour",
          theoreticalQuantity: 25,
          actualQuantity: 20,
          wasteQuantity: 1,
          unit: "kg",
        },
      ],
    },
  };
  const count = validateFinanceEntry(
    [cash],
    countInput,
    actor,
    sources,
    new Date("2026-11-21T12:00:00Z"),
  );
  assert.equal(
    validateFinanceEntry(
      [cash, count],
      countInput,
      actor,
      sources,
      new Date("2026-11-21T12:30:00Z"),
    ).id,
    count.id,
  );
  assert.throws(() =>
    validateFinanceEntry(
      [],
      {
        ...lotInput,
        idempotencyKey: key("invalid-calendar"),
        date: "2026-02-31",
      },
      actor,
      sources,
      new Date("2026-11-21T12:00:00Z"),
    ),
  );
});
