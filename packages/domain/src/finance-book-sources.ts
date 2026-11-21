import type {
  FinanceBookSources,
  FinanceMonthlyClosureDto,
  FinanceReportDto,
  PurchaseDto,
} from "@gastronomy/contracts";

export function financePurchaseSources(
  purchases: PurchaseDto[],
): FinanceBookSources["purchases"] {
  return purchases.map((p) => ({
    id: p.id,
    supplierId: p.supplierName
      .trim()
      .normalize("NFC")
      .toLocaleLowerCase("es-AR"),
    supplierName: p.supplierName,
    documentNumber: p.invoiceNumber ?? undefined,
    occurredAt: p.createdAt,
    totalMinor: p.effectiveTotalMinor ?? p.totalMinor,
    status: p.cancelledAt ? "cancelled" : "confirmed",
  }));
}

export function financeReceivedQuantities(purchases: PurchaseDto[]) {
  const result = new Map<string, number>();
  for (const purchase of purchases) {
    if (purchase.cancelledAt) continue;
    for (const line of purchase.items) {
      const id = line.effectiveProductId ?? line.productId;
      result.set(
        id,
        (result.get(id) ?? 0) +
          (line.effectiveQuantityMinor ?? line.quantityMinor),
      );
    }
  }
  return result;
}

export interface BookTender {
  id: string;
  orderId: string;
  orderNumber: number;
  occurredAt: string;
  amountMinor: number;
  refundedMinor: number;
  method: string;
  voided: boolean;
}
export interface BookChange {
  orderId: string;
  occurredAt: string;
  method: string;
  amountMinor: number;
}

export function financeTenderSources(
  tenders: BookTender[],
  change: BookChange[],
): FinanceBookSources["posPayments"] {
  // One payment batch may include more than one line for the same method.
  const key = (row: BookChange | BookTender) =>
    JSON.stringify([row.orderId, row.occurredAt, row.method]);
  const remainingChange = new Map<string, number>();
  for (const row of change)
    remainingChange.set(
      key(row),
      (remainingChange.get(key(row)) ?? 0) + row.amountMinor,
    );
  return tenders.map((row) => {
    const bucket = key(row);
    const available = Math.max(0, row.amountMinor - row.refundedMinor);
    const applied = Math.min(remainingChange.get(bucket) ?? 0, available);
    remainingChange.set(bucket, (remainingChange.get(bucket) ?? 0) - applied);
    const amountMinor = available - applied;
    return {
      id: row.id,
      orderId: row.orderId,
      orderNumber: row.orderNumber,
      occurredAt: row.occurredAt,
      method: row.method,
      amountMinor,
      alreadySettled: false,
      status: row.voided ? "voided" : amountMinor ? "captured" : "refunded",
    };
  });
}

export function financeClosingSnapshot(
  report: FinanceReportDto,
): FinanceMonthlyClosureDto["pnlSnapshot"] {
  return {
    salesMinor: report.salesMinor,
    costOfGoodsMinor: report.cogsMinor + report.deliveryCostsMinor,
    payrollMinor: report.payrollMinor,
    operatingExpensesMinor:
      report.salesMinor -
      report.cogsMinor -
      report.deliveryCostsMinor -
      report.estimatedOperatingProfitMinor -
      report.payrollMinor,
    netMinor: report.estimatedOperatingProfitMinor,
  };
}
export function financeMonthRange(month: string) {
  if (!/^\d{4}-(0[1-9]|1[012])$/.test(month))
    throw new Error("Mes de cierre inválido.");
  const [year, number] = month.split("-").map(Number);
  return {
    from: month + "-01",
    to: new Date(Date.UTC(year!, number!, 0)).toISOString().slice(0, 10),
  };
}

export function financeReplacementMonth(
  startMonth: string,
  previousStart: string,
  today: string,
) {
  financeMonthRange(startMonth);
  if (startMonth < previousStart || startMonth <= today.slice(0, 7))
    throw new Error(
      "Elegí un mes futuro dentro de la vigencia del gasto fijo.",
    );
  const cutoff = new Date(startMonth + "-01T12:00:00Z");
  cutoff.setUTCDate(0);
  return cutoff.toISOString().slice(0, 7);
}
