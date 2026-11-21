import assert from "node:assert/strict";
import test from "node:test";
import type {
  FinanceBookEvent,
  FinanceOrderMoneyDetailDto,
  FinanceReportDto,
} from "@gastronomy/contracts";
import { withFinanceBookResults } from "./finance-book-results";
import {
  financeClosingSnapshot,
  financeTenderSources,
} from "./finance-book-sources";

function reportFor(id: string, day: string, sales: number): FinanceReportDto {
  const detail: FinanceOrderMoneyDetailDto = {
    orderId: id,
    orderNumber: 1,
    businessDate: day,
    type: "TAKEAWAY",
    totalMinor: sales,
    depositMinor: 0,
    discountMinor: 0,
    collectedMinor: sales,
    refundedMinor: 0,
    recoveredMinor: 0,
    netCollectedMinor: sales,
    netSalesMinor: sales,
    productSales: [{ productId: "p", productName: "Pizza", salesMinor: sales }],
    movements: [
      {
        id,
        kind: "PAYMENT",
        amountMinor: sales,
        businessDate: day,
        occurredAt: day,
        paymentMethodCode: "TRANSFER",
        paymentMethodName: "Transferencia",
        reason: null,
      },
    ],
  };
  return {
    from: day,
    to: day,
    salesMinor: sales,
    refundsMinor: 0,
    cogsMinor: 0,
    deliveryCostsMinor: 0,
    unknownCostItems: 0,
    costedItems: 1,
    expensesMinor: 0,
    payrollMinor: 0,
    fixedMinor: 0,
    unpaidMinor: 0,
    purchasesMinor: 0,
    grossProfitMinor: sales,
    estimatedOperatingProfitMinor: sales,
    expenses: [],
    recurring: [],
    productCosts: [],
    monthly: [
      {
        month: day.slice(0, 7),
        salesMinor: sales,
        cogsMinor: 0,
        deliveryCostsMinor: 0,
        expensesMinor: 0,
      },
    ],
    orderMoneyDetails: [detail],
    productMargins: [
      {
        productId: "p",
        productName: "Pizza",
        quantity: 1,
        salesMinor: sales,
        cogsMinor: 0,
        grossMarginMinor: sales,
        unknownCostSalesMinor: 0,
        lineCount: 1,
      },
    ],
    channelMargins: [
      {
        channel: "TAKEAWAY",
        salesMinor: sales,
        cogsMinor: 0,
        deliveryCostsMinor: 0,
        grossMarginMinor: sales,
        orderCount: 1,
      },
    ],
    unknownCostSalesMinor: 0,
    unknownCostOrders: [],
    dueAgenda: [],
    paidAgenda: [],
  };
}

test("la comisión de un lote entre dos meses conserva el centavo y excluye la retención", () => {
  const event: FinanceBookEvent = {
    id: "s",
    actorId: "u",
    actorName: "Admin",
    createdAt: "2026-04-01",
    idempotencyKey: "settlement",
    input: {
      kind: "settlement_expected",
      reason: "Lote",
      date: "2026-04-01",
      idempotencyKey: "settlement",
      settlement: {
        id: "s",
        sourceRef: { type: "settlement_batch", id: "s" },
        paymentIds: ["a", "b"],
        paymentAmountsMinor: { a: 500, b: 500 },
        grossMinor: 1000,
        deductionsMinor: 205,
        commissionMinor: 5,
        withheldMinor: 200,
        expectedNetMinor: 795,
        accountId: "bank",
        occurredAt: "2026-04-01",
      },
    },
  };
  const a = withFinanceBookResults(reportFor("a", "2026-02-28", 500), [event]);
  const b = withFinanceBookResults(reportFor("b", "2026-03-01", 500), [event]);
  assert.deepEqual([a.commissionCostsMinor, b.commissionCostsMinor], [3, 2]);
  assert.equal(a.productMargins[0]?.grossMarginMinor, 497);
  assert.equal(b.channelMargins[0]?.grossMarginMinor, 498);
  assert.equal(a.monthly[0]?.commissionCostsMinor, 3);
  const reversal: FinanceBookEvent = {
    ...event,
    id: "r",
    input: {
      kind: "reverse",
      idempotencyKey: "undo-lote",
      reason: "Lote incorrecto",
      date: "2026-04-02",
      targetEventId: event.id,
    },
  };
  const corrected = withFinanceBookResults(reportFor("a", "2026-02-28", 500), [
    event,
    reversal,
  ]);
  assert.equal(corrected.estimatedOperatingProfitMinor, 500);
  assert.equal(corrected.productMargins[0]?.grossMarginMinor, 500);
  assert.deepEqual(financeClosingSnapshot(b), {
    salesMinor: 500,
    costOfGoodsMinor: 0,
    payrollMinor: 0,
    operatingExpensesMinor: 2,
    netMinor: 498,
  });
});

test("el vuelto en un mismo medio y lote se resta una única vez de los cobros disponibles", () => {
  const payment = {
    orderId: "order",
    orderNumber: 2,
    occurredAt: "2026-11-21",
    refundedMinor: 0,
    method: "TRANSFER",
    voided: false,
  };
  const sources = financeTenderSources(
    [
      { ...payment, id: "p1", amountMinor: 500 },
      { ...payment, id: "p2", amountMinor: 300 },
    ],
    [{ ...payment, amountMinor: 650 }],
  );
  assert.deepEqual(
    sources.map((p) => p.amountMinor),
    [0, 150],
  );
});
