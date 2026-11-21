import type { FinanceBookEvent, FinanceReportDto } from "@gastronomy/contracts";

/** Largest remainder allocation preserves the exact cent total independently of the date filter. */
function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((n, w) => n + BigInt(w), 0n);
  if (!sum) return weights.map(() => 0);
  const parts = weights.map((w, index) => {
    const product = BigInt(total) * BigInt(w);
    return { index, cents: Number(product / sum), remainder: product % sum };
  });
  const left = total - parts.reduce((s, p) => s + p.cents, 0);
  const ranked = [...parts].sort((a, b) =>
    a.remainder === b.remainder
      ? a.index - b.index
      : a.remainder > b.remainder
        ? -1
        : 1,
  );
  ranked.slice(0, left).forEach((p) => {
    p.cents++;
  });
  return parts.map((p) => p.cents);
}

export function withFinanceBookResults(
  report: FinanceReportDto,
  events: FinanceBookEvent[],
): FinanceReportDto {
  if (!events.length) return report;
  const ordersByTender = new Map(
    report.orderMoneyDetails.flatMap((o) =>
      o.movements
        .filter((m) => m.kind === "PAYMENT")
        .map((m) => [m.id, o] as const),
    ),
  );
  const channels = new Map(report.channelMargins.map((c) => [c.channel, c]));
  const products = new Map(
    report.productMargins.map((p) => [p.productId ?? p.productName, p]),
  );
  const adjustments = new Map<string, number>();
  const categories = new Map<string, string>();
  const reversed = new Set(
    events.flatMap((e) =>
      e.input.kind === "reverse" ? [e.input.targetEventId] : [],
    ),
  );
  let fees = 0,
    adjusted = 0;
  function monthly(date: string) {
    const key = date.slice(0, 7);
    let row = report.monthly.find((m) => m.month === key);
    if (!row) {
      row = {
        month: key,
        salesMinor: 0,
        cogsMinor: 0,
        deliveryCostsMinor: 0,
        expensesMinor: 0,
      };
      report.monthly.push(row);
    }
    return row;
  }
  for (const e of events) {
    const i = e.input;
    if (i.kind === "cash_category")
      categories.set("cash-" + i.movementId, i.category);
    if (i.kind === "adjustment") adjustments.set(e.id, i.amountMinor);
    const adjustment =
      i.kind === "adjustment"
        ? i.amountMinor
        : i.kind === "reverse"
          ? -(adjustments.get(i.targetEventId) ?? 0)
          : 0;
    if (adjustment && i.date >= report.from && i.date <= report.to) {
      adjusted += adjustment;
      const month = monthly(i.date);
      month.managementAdjustmentMinor =
        (month.managementAdjustmentMinor ?? 0) + adjustment;
    }
    if (
      i.kind !== "settlement_expected" ||
      reversed.has(e.id) ||
      !i.settlement.deductionsMinor
    )
      continue;
    const s = i.settlement;
    const shares = allocate(
      s.commissionMinor ?? s.deductionsMinor,
      s.paymentIds.map((id) => s.paymentAmountsMinor?.[id] ?? 0),
    );
    s.paymentIds.forEach((id, index) => {
      const order = ordersByTender.get(id),
        fee = shares[index]!;
      if (!order || !fee) return;
      fees += fee;
      const month = monthly(order.businessDate);
      month.commissionCostsMinor = (month.commissionCostsMinor ?? 0) + fee;
      const channel = channels.get(order.type);
      if (channel) channel.grossMarginMinor -= fee;
      const lines = order.productSales ?? [];
      const lineParts = allocate(
        fee,
        lines.map((p) => p.salesMinor),
      );
      lines.forEach((p, n) => {
        const row = products.get(p.productId ?? p.productName);
        if (row) row.grossMarginMinor -= lineParts[n]!;
      });
    });
  }
  if (fees) {
    report.commissionCostsMinor = fees;
    report.grossProfitMinor -= fees;
  }
  if (adjusted) report.managementAdjustmentMinor = adjusted;
  for (const expense of report.expenses)
    expense.category = categories.get(expense.id) ?? expense.category;
  report.estimatedOperatingProfitMinor += adjusted - fees;
  report.monthly.sort((a, b) => a.month.localeCompare(b.month));
  return report;
}
