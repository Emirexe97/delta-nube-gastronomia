import type {
  BootstrapDto,
  CustomerDto,
  FinanceBookSources,
  FinanceBookEvent,
  FinanceExpenseDto,
  FinanceRecurringDto,
  PurchaseDto,
} from "@gastronomy/contracts";
import {
  businessDateFromOpening,
  financePurchaseSources,
  financeReceivedQuantities,
  financeReplacementMonth,
  financeTenderSources,
} from "@gastronomy/domain";

export function demoFinanceBookSources(
  data: BootstrapDto,
  purchases: PurchaseDto[],
  customers: CustomerDto[],
  movements: {
    type: string;
    reason: string | null;
    orderId: string | null;
    paymentMethodCode: string | null;
    amountMinor: number;
    createdAt: string;
  }[],
  expenses: FinanceExpenseDto[] = [],
): FinanceBookSources {
  const digital = new Set(
    data.paymentMethods
      .filter(
        (m) => !m.affectsCash && m.code !== "ACCOUNT" && m.code !== "CASH",
      )
      .map((m) => m.code),
  );
  const tenders = data.orders.flatMap((o) =>
    o.payments
      .filter((p) => digital.has(p.methodCode))
      .map((p) => ({
        id: p.id,
        orderId: o.id,
        orderNumber: o.number,
        occurredAt: p.createdAt,
        method: p.methodCode,
        amountMinor: p.amountMinor,
        refundedMinor: p.refundedMinor,
        voided: o.operationalStatus === "CANCELLED",
      })),
  );
  const changes = movements.flatMap((m) =>
    m.type === "REFUND" &&
    m.reason?.startsWith("Vuelto cobro pedido #") &&
    m.orderId &&
    m.paymentMethodCode
      ? [
          {
            orderId: m.orderId,
            occurredAt: m.createdAt,
            method: m.paymentMethodCode,
            amountMinor: m.amountMinor,
          },
        ]
      : [],
  );
  const tracked = new Set(
    data.categories.filter((c) => c.stockControlEnabled).map((c) => c.id),
  );
  const received = financeReceivedQuantities(purchases);
  return {
    adjustmentTargets: expenses.map((e) => ({
      type: "expense",
      id: e.id,
      occurredAt: e.incurredOn,
    })),
    purchases: financePurchaseSources(purchases),
    posPayments: financeTenderSources(tenders, changes),
    theoreticalInventory: data.products
      .filter(
        (p) => p.active && tracked.has(p.categoryId) && p.stockMinor != null,
      )
      .map((p) => ({
        itemId: p.id,
        name: p.name,
        quantity: p.stockMinor! / 1000,
        unit: "un.",
        receivedQuantity: (received.get(p.id) ?? 0) / 1000,
      })),
    customerBalances: customers
      .filter((c) => (c.outstandingMinor ?? 0) > 0)
      .map((c) => ({
        id: c.id,
        name: c.name,
        outstandingMinor: c.outstandingMinor!,
      })),
  };
}

export function applyDemoFinanceBookChange(
  state: {
    financeRecurring?: FinanceRecurringDto[];
    financeExpenses?: FinanceExpenseDto[];
    financeExpenseMovements?: Record<string, string>;
    financeExpenseClosedPaymentCorrections?: { originalMovementId: string }[];
    movements: {
      id: string;
      type: string;
      referenceId?: string;
      orderId: string | null;
      reason: string | null;
    }[];
  },
  event: FinanceBookEvent,
) {
  const i = event.input;
  if (i.kind === "cash_category") {
    const m = state.movements.find(
      (m) => m.id === i.movementId && m.type === "EXPENSE",
    );
    if (
      !m ||
      m.referenceId ||
      m.orderId ||
      m.reason?.startsWith("Liquidación de reparto") ||
      state.movements.some((v) => v.referenceId === m.id) ||
      Object.values(state.financeExpenseMovements ?? {}).includes(m.id) ||
      state.financeExpenseClosedPaymentCorrections?.some(
        (c) => c.originalMovementId === m.id,
      )
    )
      throw new Error(
        "Este egreso de caja ya no está disponible para clasificar.",
      );
  }
  if (i.kind !== "recurring_rate") return;
  const rule = state.financeRecurring?.find(
    (r) => r.id === i.recurringId && r.active,
  );
  if (!rule || rule.amountMinor !== i.expectedAmountMinor)
    throw new Error("La regla mensual cambió. Actualizá la pantalla.");
  const previousEnd = financeReplacementMonth(
    i.startMonth,
    rule.startMonth,
    businessDateFromOpening(event.createdAt),
  );
  const occurrences = (state.financeExpenses ?? []).filter(
    (e) => e.recurringId === rule.id && e.incurredOn >= i.startMonth + "-01",
  );
  if (
    occurrences.some(
      (e) =>
        (e.revision && e.amountMinor !== rule.amountMinor) ||
        e.paidAt ||
        e.cancelledAt,
    )
  )
    throw new Error(
      "Hay cuotas modificadas o pagadas desde ese mes. Elegí una vigencia posterior.",
    );
  state.financeRecurring!.push({
    ...rule,
    id: event.id,
    startMonth: i.startMonth,
    amountMinor: i.amountMinor,
    active: true,
    stopMonth: null,
  });
  rule.active = false;
  rule.stopMonth = previousEnd;
  for (const e of occurrences) {
    e.recurringId = event.id;
    e.amountMinor = i.amountMinor;
    e.revision = (e.revision ?? 0) + 1;
  }
}
