import type {
  FinanceBookEvent,
  FinanceBooksDto,
  FinanceBooksInput,
  FinanceBookSources,
  FinanceEntryInput,
  FinanceInventoryCountDto,
} from "@gastronomy/contracts";

const validAmount = (n: number) => Number.isSafeInteger(n) && n >= 0;
const normalizedDay = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(s)) return "";
  const datePart = s.slice(0, 10);
  const [year, month, date] = datePart.split("-").map(Number);
  const dateValue = new Date(0);
  dateValue.setUTCHours(0, 0, 0, 0);
  dateValue.setUTCFullYear(year!, month! - 1, date!);
  const actualDate = dateValue.toISOString().slice(0, 10);
  return actualDate === datePart &&
    !Number.isNaN(Date.parse(s.length === 10 ? `${s}T00:00:00Z` : s))
    ? datePart
    : "";
};
const day = (s: string) => normalizedDay(s) !== "";
const businessDate = (date: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
const money = (n: number) => {
  if (!Number.isSafeInteger(n))
    throw new Error("El saldo excede el importe permitido.");
  return n;
};
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  return value;
};
function comparableInput(input: FinanceEntryInput) {
  const { authorizerPin: _pin, ...safe } = input;
  const normalized = {
    ...safe,
    date: normalizedDay(input.date),
    reason: input.reason.trim(),
  };
  if (input.kind === "settlement_expected") {
    const { paymentAmountsMinor: _amounts, ...settlement } = input.settlement;
    Object.assign(normalized, { settlement });
  } else if (input.kind === "inventory_count") {
    Object.assign(normalized, {
      count: {
        ...input.count,
        items: input.count.items.map(
          ({
            receivedQuantity: _received,
            actualUsage: _actualUsage,
            theoreticalUsage: _theoreticalUsage,
            unexplainedUsage: _unexplained,
            ...item
          }) => item,
        ),
      },
    });
  }
  return JSON.stringify(canonical(normalized));
}

export function validateFinanceEntry(
  events: FinanceBookEvent[],
  input: FinanceEntryInput,
  authorizer: { actorId: string; actorName: string },
  sources: FinanceBookSources,
  now = new Date(),
): FinanceBookEvent {
  const existing = events.find(
    (event) => event.idempotencyKey === input.idempotencyKey,
  );
  if (existing) {
    if (
      comparableInput({
        ...existing.input,
        authorizerPin: "",
      } as FinanceEntryInput) !== comparableInput(input)
    )
      throw new Error(
        "La clave de idempotencia ya fue usada para otra operación.",
      );
    return existing;
  }
  const reason = input.reason.trim();
  let normalizedCount: FinanceInventoryCountDto | undefined;
  if (input.idempotencyKey.trim().length < 8)
    throw new Error("La clave de operación no es válida.");
  if (!input.authorizerPin.trim())
    throw new Error("Se requiere autorización para registrar el movimiento.");
  if (!reason || reason.length < 4)
    throw new Error("Ingresá un motivo de al menos 4 caracteres.");
  if (!day(input.date)) throw new Error("Ingresá una fecha válida.");
  const today = businessDate(now);
  if (normalizedDay(input.date) > today && input.kind !== "settlement_expected")
    throw new Error(
      "No podés registrar un movimiento efectivo con fecha futura.",
    );
  const book = buildFinanceBooks(
    events,
    { from: "0001-01-01", to: "9999-12-31" },
    sources,
  );
  const account = (id: string) => {
    const found = book.accounts.find((a) => a.id === id);
    if (!found) throw new Error("La cuenta seleccionada no existe.");
    return found;
  };
  if (input.kind === "account_open") {
    if (
      !input.account.id.trim() ||
      !input.account.name.trim() ||
      !validAmount(input.account.openingBalanceMinor)
    )
      throw new Error("Revisá los datos de la cuenta y su saldo inicial.");
    if (book.accounts.some((a) => a.id === input.account.id))
      throw new Error("La cuenta ya existe.");
  } else if (input.kind === "transfer") {
    if (input.fromAccountId === input.toAccountId)
      throw new Error("Elegí dos cuentas distintas para transferir.");
    const from = account(input.fromAccountId);
    account(input.toAccountId);
    if (
      !Number.isSafeInteger(input.amountMinor) ||
      input.amountMinor <= 0 ||
      from.balanceMinor < input.amountMinor
    )
      throw new Error("El importe supera el saldo disponible.");
  } else if (input.kind === "obligation") {
    const o = input.obligation;
    if (
      !o.id.trim() ||
      !o.supplierId.trim() ||
      !o.supplierName.trim() ||
      !o.purchaseRef.id.trim() ||
      o.purchaseRef.type !== "purchase" ||
      !day(o.incurredAt) ||
      !validAmount(o.amountMinor) ||
      o.amountMinor === 0
    )
      throw new Error(
        "La obligación debe vincularse a una compra válida y tener un importe mayor a cero.",
      );
    if (
      book.obligations.some(
        (x) => x.id === o.id || x.purchaseRef.id === o.purchaseRef.id,
      )
    )
      throw new Error("La compra ya tiene una obligación registrada.");
    const purchase = sources.purchases.find((p) => p.id === o.purchaseRef.id);
    if (
      !purchase ||
      purchase.status !== "confirmed" ||
      purchase.totalMinor !== o.amountMinor ||
      purchase.supplierId !== o.supplierId ||
      purchase.supplierName !== o.supplierName ||
      normalizedDay(purchase.occurredAt) !== normalizedDay(o.incurredAt) ||
      (o.documentNumber !== undefined &&
        o.documentNumber !== purchase.documentNumber)
    )
      throw new Error(
        "La compra cambió o no está confirmada. Actualizá los datos antes de crear la obligación.",
      );
  } else if (input.kind === "obligation_payment") {
    const o = book.obligations.find((x) => x.id === input.obligationId);
    const a = account(input.accountId);
    if (
      !o ||
      !Number.isSafeInteger(input.amountMinor) ||
      input.amountMinor <= 0
    )
      throw new Error(
        "El pago debe ser positivo y no superar la deuda pendiente.",
      );
    const purchase = sources.purchases.find((p) => p.id === o.purchaseRef.id);
    const currentOutstanding =
      purchase?.status === "confirmed"
        ? Math.max(0, purchase.totalMinor - o.paidMinor)
        : 0;
    if (
      !purchase ||
      purchase.status !== "confirmed" ||
      input.amountMinor > currentOutstanding
    )
      throw new Error(
        "La compra fue cancelada o modificada. Revisá la obligación antes de registrar otro pago.",
      );
    if (normalizedDay(input.date) < normalizedDay(o.incurredAt))
      throw new Error("La fecha del pago no puede ser anterior a la compra.");
    if (a.balanceMinor < input.amountMinor)
      throw new Error("El importe supera el saldo disponible de la cuenta.");
  } else if (input.kind === "settlement_expected") {
    const s = input.settlement;
    const commission = s.commissionMinor;
    const withheld = s.withheldMinor;
    const deductionPartsMatch =
      commission === undefined && withheld === undefined
        ? true
        : Number.isSafeInteger(commission ?? 0) &&
          Number.isSafeInteger(withheld ?? 0) &&
          (commission ?? 0) >= 0 &&
          (withheld ?? 0) >= 0 &&
          (commission ?? 0) + (withheld ?? 0) === s.deductionsMinor;
    if (
      !s.id.trim() ||
      !s.sourceRef.id.trim() ||
      !["pos_order", "settlement_batch"].includes(s.sourceRef.type) ||
      !s.paymentIds.length ||
      new Set(s.paymentIds).size !== s.paymentIds.length ||
      !validAmount(s.grossMinor) ||
      !validAmount(s.deductionsMinor) ||
      !deductionPartsMatch ||
      s.deductionsMinor > s.grossMinor ||
      s.expectedNetMinor !== s.grossMinor - s.deductionsMinor
    )
      throw new Error(
        "El lote debe tener bruto, deducciones y neto esperado coherentes.",
      );
    account(s.accountId);
    if (book.settlements.some((x) => x.id === s.id))
      throw new Error("El lote ya existe.");
    const used = new Set(book.settlements.flatMap((x) => x.paymentIds));
    const payments = s.paymentIds.map((id) =>
      sources.posPayments.find((p) => p.id === id),
    );
    if (
      payments.some(
        (p, idx) =>
          !p ||
          p.status !== "captured" ||
          p.alreadySettled ||
          used.has(s.paymentIds[idx]!) ||
          (s.sourceRef.type === "pos_order" && p.orderId !== s.sourceRef.id),
      )
    )
      throw new Error(
        "El lote incluye cobros ya usados, devueltos o que no corresponden al pedido.",
      );
    if (
      payments.reduce((sum, p) => sum + (p?.amountMinor ?? 0), 0) !==
      s.grossMinor
    )
      throw new Error(
        "El bruto del lote debe coincidir con los cobros seleccionados.",
      );
  } else if (input.kind === "settlement_credit") {
    const s = book.settlements.find((x) => x.id === input.settlementId);
    account(input.accountId);
    if (!s || s.status !== "expected" || !validAmount(input.actualNetMinor))
      throw new Error(
        "Seleccioná un lote pendiente y un neto acreditado válido.",
      );
    if (s.accountId !== input.accountId)
      throw new Error(
        "La cuenta debe coincidir con la cuenta de acreditación del lote.",
      );
  } else if (input.kind === "settlement_reconcile") {
    const s = book.settlements.find((x) => x.id === input.settlementId);
    if (!s || s.status !== "credited")
      throw new Error("Acreditá el lote antes de conciliarlo.");
  } else if (input.kind === "inventory_count") {
    if (
      !day(input.count.occurredAt) ||
      normalizedDay(input.count.occurredAt) !== today ||
      normalizedDay(input.count.occurredAt) !== normalizedDay(input.date)
    )
      throw new Error(
        "El conteo debe usar la fecha comercial de hoy para tomar la existencia disponible.",
      );
    if (
      !input.count.items.length ||
      input.count.items.some((i) => {
        const t = sources.theoreticalInventory.find(
          (x) => x.itemId === i.itemId,
        );
        return (
          !t ||
          i.theoreticalQuantity !== t.quantity ||
          i.unit !== t.unit ||
          !i.itemId.trim() ||
          !Number.isFinite(i.actualQuantity) ||
          !Number.isFinite(i.wasteQuantity) ||
          i.actualQuantity < 0 ||
          i.wasteQuantity < 0
        );
      })
    )
      throw new Error(
        "El consumo teórico cambió o las cantidades reales/de merma no son válidas. Actualizá el conteo.",
      );
    normalizedCount = {
      ...input.count,
      items: input.count.items.map((item) => {
        const source = sources.theoreticalInventory.find(
          (row) => row.itemId === item.itemId,
        )!;
        const previous = events
          .flatMap((event) =>
            event.input.kind === "inventory_count"
              ? event.input.count.items
                  .filter((row) => row.itemId === item.itemId)
                  .map((row) => ({
                    date: normalizedDay(event.input.date),
                    row,
                  }))
              : [],
          )
          .filter((record) => record.date < normalizedDay(input.date))
          .sort((a, b) => b.date.localeCompare(a.date))[0]?.row;
        const receivedQuantity = source.receivedQuantity;
        if (
          !previous ||
          receivedQuantity === undefined ||
          previous.receivedQuantity === undefined
        )
          return { ...item, receivedQuantity };
        const incomingDelta = receivedQuantity - previous.receivedQuantity;
        const actualUsage =
          previous.actualQuantity + incomingDelta - item.actualQuantity;
        const theoreticalUsage =
          previous.theoreticalQuantity +
          incomingDelta -
          item.theoreticalQuantity;
        return {
          ...item,
          receivedQuantity,
          actualUsage,
          theoreticalUsage,
          unexplainedUsage: actualUsage - theoreticalUsage - item.wasteQuantity,
        };
      }),
    };
  } else if (input.kind === "adjustment") {
    if (
      !validAmount(Math.abs(input.amountMinor)) ||
      input.amountMinor === 0 ||
      !input.targetRef.id.trim()
    )
      throw new Error(
        "El ajuste debe tener un importe y un registro de origen.",
      );
    if (input.accountId) account(input.accountId);
    const knownTarget =
      input.targetRef.type === "purchase"
        ? sources.purchases.some((p) => p.id === input.targetRef.id)
        : input.targetRef.type === "pos_payment"
          ? sources.posPayments.some((p) => p.id === input.targetRef.id)
          : input.targetRef.type === "pos_order"
            ? sources.posPayments.some((p) => p.orderId === input.targetRef.id)
            : (sources.adjustmentTargets?.some(
                (ref) =>
                  ref.type === input.targetRef.type &&
                  ref.id === input.targetRef.id,
              ) ?? false);
    if (!knownTarget)
      throw new Error(
        "El registro de origen del ajuste ya no existe o no está disponible.",
      );
  } else if (input.kind === "month_close") {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month))
      throw new Error("Indicá un mes válido para el cierre.");
    const monthEnd = new Date(
      Date.UTC(
        Number(input.month.slice(0, 4)),
        Number(input.month.slice(5, 7)),
        0,
      ),
    )
      .toISOString()
      .slice(0, 10);
    if (input.date < monthEnd)
      throw new Error("El cierre se registra al finalizar el mes o después.");
    if (input.date > today)
      throw new Error("No se puede cerrar un mes antes de que termine.");
    if (book.monthlyClosures.some((c) => c.month === input.month))
      throw new Error("El mes ya está cerrado; registrá un ajuste trazable.");
    if (!sources.pnlByMonth?.[input.month])
      throw new Error(
        "No se pudo obtener el resultado del mes desde el servidor.",
      );
  } else if (input.kind === "cash_category") {
    if (
      !input.movementId.trim() ||
      input.category.trim().length < 2 ||
      input.expectedCategory.trim() === input.category.trim()
    )
      throw new Error(
        "Elegí un movimiento y una categoría distinta a la actual.",
      );
    const latestCategory = [...events]
      .reverse()
      .find(
        (e) =>
          e.input.kind === "cash_category" &&
          e.input.movementId === input.movementId,
      );
    const currentCategory =
      latestCategory?.input.kind === "cash_category"
        ? latestCategory.input.category
        : sources.cashCategories?.[input.movementId];
    if (
      currentCategory !== undefined &&
      currentCategory !== input.expectedCategory
    )
      throw new Error(
        "La categoría del movimiento cambió. Actualizá la información.",
      );
  } else if (input.kind === "recurring_rate") {
    if (
      !input.recurringId.trim() ||
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(input.startMonth) ||
      !Number.isSafeInteger(input.amountMinor) ||
      input.amountMinor < 0 ||
      !Number.isSafeInteger(input.expectedAmountMinor) ||
      input.amountMinor === input.expectedAmountMinor
    )
      throw new Error(
        "Revisá la regla mensual, el mes de vigencia y el importe nuevo.",
      );
    const latestRate = [...events]
      .reverse()
      .find(
        (e) =>
          e.input.kind === "recurring_rate" &&
          e.input.recurringId === input.recurringId,
      );
    const currentRate =
      latestRate?.input.kind === "recurring_rate"
        ? latestRate.input.amountMinor
        : sources.recurringAmountsMinor?.[input.recurringId];
    if (currentRate !== undefined && currentRate !== input.expectedAmountMinor)
      throw new Error(
        "El importe de la regla cambió. Actualizá la información.",
      );
  } else if (input.kind === "reverse") {
    const target = events.find((e) => e.id === input.targetEventId);
    if (
      !target ||
      ![
        "transfer",
        "obligation_payment",
        "settlement_credit",
        "adjustment",
        "obligation",
        "settlement_expected",
      ].includes(target.input.kind) ||
      events.some(
        (e) =>
          e.input.kind === "reverse" &&
          e.input.targetEventId === input.targetEventId,
      )
    )
      throw new Error(
        "Seleccioná un movimiento reversible que todavía no haya sido corregido.",
      );
    const targetInput = target.input;
    if (targetInput.kind === "obligation") {
      const obligation = book.obligations.find(
        (o) => o.id === targetInput.obligation.id,
      );
      if (obligation?.payments.length)
        throw new Error(
          "No se puede desvincular una compra mientras tenga pagos vigentes.",
        );
    } else if (targetInput.kind === "settlement_expected") {
      const settlement = book.settlements.find(
        (s) => s.id === targetInput.settlement.id,
      );
      if (!settlement || settlement.status !== "expected")
        throw new Error(
          "No se puede revertir el lote después de acreditar o conciliar dinero.",
        );
    } else if (target.input.kind === "transfer") {
      if (
        account(target.input.toAccountId).balanceMinor <
        target.input.amountMinor
      )
        throw new Error(
          "No se puede revertir la transferencia porque la cuenta de destino ya no tiene saldo suficiente.",
        );
    } else if (target.input.kind === "obligation_payment") {
      if (
        account(target.input.accountId).balanceMinor +
          target.input.amountMinor >
        Number.MAX_SAFE_INTEGER
      )
        throw new Error(
          "El saldo resultante de la reversa supera el límite permitido.",
        );
    } else if (target.input.kind === "settlement_credit") {
      if (
        account(target.input.accountId).balanceMinor <
        target.input.actualNetMinor
      )
        throw new Error(
          "La cuenta ya no tiene saldo suficiente para revertir la acreditación.",
        );
      const settlementId = target.input.settlementId;
      if (
        events.some(
          (e) =>
            e.input.kind === "settlement_reconcile" &&
            e.input.settlementId === settlementId,
        )
      )
        throw new Error(
          "Desconciliá el lote antes de revertir su acreditación.",
        );
    } else if (target.input.kind === "adjustment" && target.input.accountId) {
      const resultingBalance =
        account(target.input.accountId).balanceMinor - target.input.amountMinor;
      if (!Number.isSafeInteger(resultingBalance) || resultingBalance < 0)
        throw new Error(
          "La cuenta no tiene saldo suficiente para revertir el ajuste.",
        );
    }
  } else {
    throw new Error("El tipo de movimiento financiero no está admitido.");
  }
  const { authorizerPin: _pin, ...safeInput } = {
    ...input,
    date: normalizedDay(input.date),
    reason,
  };
  if (input.kind === "obligation") {
    const purchase = sources.purchases.find(
      (p) => p.id === input.obligation.purchaseRef.id,
    )!;
    Object.assign(safeInput, {
      obligation: {
        ...input.obligation,
        supplierId: purchase.supplierId,
        supplierName: purchase.supplierName,
        documentNumber: purchase.documentNumber,
        incurredAt: purchase.occurredAt,
        amountMinor: purchase.totalMinor,
      },
    });
  }
  if (input.kind === "inventory_count")
    Object.assign(safeInput, { count: normalizedCount });
  let accountBalancesSnapshot: Record<string, number> | undefined;
  if (input.kind === "month_close") {
    const monthEnd = new Date(
      Date.UTC(
        Number(input.month.slice(0, 4)),
        Number(input.month.slice(5, 7)),
        0,
      ),
    )
      .toISOString()
      .slice(0, 10);
    accountBalancesSnapshot = Object.fromEntries(
      buildFinanceBooks(
        events.filter((e) => normalizedDay(e.input.date) <= monthEnd),
        { from: "0001-01-01", to: "9999-12-31" },
        sources,
      ).accounts.map((a) => [a.id, a.balanceMinor]),
    );
  }
  const paymentAmountsMinor =
    input.kind === "settlement_expected"
      ? Object.fromEntries(
          input.settlement.paymentIds.map((id) => [
            id,
            sources.posPayments.find((p) => p.id === id)!.amountMinor,
          ]),
        )
      : undefined;
  if (input.kind === "settlement_expected") {
    const { paymentAmountsMinor: _clientAmounts, ...settlement } =
      input.settlement as typeof input.settlement & {
        paymentAmountsMinor?: Record<string, number>;
      };
    Object.assign(safeInput, {
      settlement: {
        ...settlement,
        occurredAt: normalizedDay(input.date),
        paymentAmountsMinor,
      },
    });
  }
  return {
    id: input.idempotencyKey,
    idempotencyKey: input.idempotencyKey,
    actorId: authorizer.actorId,
    actorName: authorizer.actorName,
    createdAt: now.toISOString(),
    input: safeInput,
    ...(input.kind === "month_close"
      ? {
          pnlSnapshot: sources.pnlByMonth?.[input.month],
          accountBalancesSnapshot,
        }
      : {}),
  };
}

export function buildFinanceBooks(
  events: FinanceBookEvent[],
  range: FinanceBooksInput,
  sources?: FinanceBookSources,
): FinanceBooksDto {
  if (!day(range.from) || !day(range.to) || range.from > range.to)
    throw new Error("El rango de fechas no es válido.");
  const accounts = new Map<string, FinanceBooksDto["accounts"][number]>();
  const obligations = new Map<string, FinanceBooksDto["obligations"][number]>();
  const settlements = new Map<string, FinanceBooksDto["settlements"][number]>();
  const inventoryCounts: FinanceBooksDto["inventoryCounts"] = [],
    adjustments: FinanceBooksDto["adjustments"] = [],
    monthlyClosures: FinanceBooksDto["monthlyClosures"] = [];
  const unique = new Set<string>();
  const reversedEventIds = new Set(
    events.flatMap((event) =>
      event.input.kind === "reverse" ? [event.input.targetEventId] : [],
    ),
  );
  for (const event of events) {
    if (unique.has(event.idempotencyKey)) continue;
    unique.add(event.idempotencyKey);
    const i = event.input;
    const cancelledLink =
      reversedEventIds.has(event.id) &&
      (i.kind === "obligation" || i.kind === "settlement_expected");
    if (cancelledLink) continue;
    if (i.kind === "account_open")
      accounts.set(i.account.id, {
        ...i.account,
        balanceMinor: i.account.openingBalanceMinor,
      });
    else if (i.kind === "transfer") {
      const from = accounts.get(i.fromAccountId),
        to = accounts.get(i.toAccountId);
      if (from && to) {
        from.balanceMinor = money(from.balanceMinor - i.amountMinor);
        to.balanceMinor = money(to.balanceMinor + i.amountMinor);
      }
    } else if (i.kind === "obligation")
      obligations.set(i.obligation.id, {
        ...i.obligation,
        paidMinor: 0,
        outstandingMinor: i.obligation.amountMinor,
        status: "open",
        payments: [],
      });
    else if (i.kind === "obligation_payment") {
      const o = obligations.get(i.obligationId),
        a = accounts.get(i.accountId);
      if (o) {
        o.paidMinor = money(o.paidMinor + i.amountMinor);
        o.outstandingMinor = money(o.amountMinor - o.paidMinor);
        o.status = o.outstandingMinor ? "partial" : "paid";
        o.payments.push({
          id: event.id,
          obligationId: o.id,
          occurredAt: i.date,
          amountMinor: i.amountMinor,
          accountId: i.accountId,
          actorId: event.actorId,
          sourceRef: o.purchaseRef,
        });
      }
      if (a) a.balanceMinor = money(a.balanceMinor - i.amountMinor);
    } else if (i.kind === "settlement_expected")
      settlements.set(i.settlement.id, { ...i.settlement, status: "expected" });
    else if (i.kind === "settlement_credit") {
      const s = settlements.get(i.settlementId),
        a = accounts.get(i.accountId);
      if (s) {
        s.actualNetMinor = i.actualNetMinor;
        s.differenceMinor = i.actualNetMinor - s.expectedNetMinor;
        s.creditedAt = i.date;
        s.status = "credited";
      }
      if (a) a.balanceMinor = money(a.balanceMinor + i.actualNetMinor);
    } else if (i.kind === "settlement_reconcile") {
      const s = settlements.get(i.settlementId);
      if (s) {
        s.status = "reconciled";
        s.reconciledAt = i.date;
      }
    } else if (i.kind === "inventory_count") inventoryCounts.push(i.count);
    else if (i.kind === "adjustment") {
      adjustments.push({
        id: event.id,
        occurredAt: i.date,
        actorId: event.actorId,
        reason: i.reason,
        amountMinor: i.amountMinor,
        targetRef: i.targetRef,
      });
      const a = i.accountId && accounts.get(i.accountId);
      if (a) a.balanceMinor = money(a.balanceMinor + i.amountMinor);
    } else if (i.kind === "reverse") {
      const target = events.find((e) => e.id === i.targetEventId)?.input;
      if (target?.kind === "transfer") {
        const f = accounts.get(target.fromAccountId),
          t = accounts.get(target.toAccountId);
        if (f && t) {
          f.balanceMinor = money(f.balanceMinor + target.amountMinor);
          t.balanceMinor = money(t.balanceMinor - target.amountMinor);
        }
      } else if (target?.kind === "obligation_payment") {
        const o = obligations.get(target.obligationId),
          a = accounts.get(target.accountId);
        if (o) {
          o.paidMinor = money(o.paidMinor - target.amountMinor);
          o.outstandingMinor = money(o.outstandingMinor + target.amountMinor);
          o.status = o.paidMinor ? "partial" : "open";
          o.payments = o.payments.filter((p) => p.id !== i.targetEventId);
        }
        if (a) a.balanceMinor = money(a.balanceMinor + target.amountMinor);
      } else if (target?.kind === "settlement_credit") {
        const s = settlements.get(target.settlementId),
          a = accounts.get(target.accountId);
        if (s) {
          delete s.actualNetMinor;
          delete s.differenceMinor;
          delete s.creditedAt;
          delete s.reconciledAt;
          s.status = "expected";
        }
        if (a) a.balanceMinor = money(a.balanceMinor - target.actualNetMinor);
      } else if (target?.kind === "adjustment") {
        adjustments.push({
          id: event.id,
          occurredAt: i.date,
          actorId: event.actorId,
          reason: i.reason,
          amountMinor: -target.amountMinor,
          targetRef: target.targetRef,
        });
        const a = target.accountId && accounts.get(target.accountId);
        if (a) a.balanceMinor = money(a.balanceMinor - target.amountMinor);
      } else if (target?.kind === "obligation") {
        obligations.delete(target.obligation.id);
      } else if (target?.kind === "settlement_expected") {
        settlements.delete(target.settlement.id);
      }
    } else if (i.kind === "month_close")
      monthlyClosures.push({
        id: event.id,
        month: i.month,
        closedAt: event.createdAt,
        actorId: event.actorId,
        reason: i.reason,
        adjustmentIds: adjustments
          .filter((a) => a.occurredAt.startsWith(i.month))
          .map((a) => a.id),
        accountBalances:
          event.accountBalancesSnapshot ??
          Object.fromEntries(
            [...accounts].map(([id, a]) => [id, a.balanceMinor]),
          ),
        pnlSnapshot: event.pnlSnapshot ?? {
          salesMinor: 0,
          costOfGoodsMinor: 0,
          payrollMinor: 0,
          operatingExpensesMinor: 0,
          netMinor: 0,
        },
        status: "closed",
      });
  }
  const inRange = (date: string) =>
    normalizedDay(date) >= range.from && normalizedDay(date) <= range.to;
  const reconciledObligations = [...obligations.values()].map((o) => {
    const p = sources?.purchases.find(
      (purchase) => purchase.id === o.purchaseRef.id,
    );
    const currentAmount = p?.status === "confirmed" ? p.totalMinor : 0;
    const currentOutstanding = Math.max(0, currentAmount - o.paidMinor);
    const creditBalanceMinor = Math.max(0, o.paidMinor - currentAmount);
    return p
      ? {
          ...o,
          currentPurchaseAmountMinor: currentAmount,
          purchaseVarianceMinor: currentAmount - o.amountMinor,
          outstandingMinor: currentOutstanding,
          creditBalanceMinor,
          status:
            currentOutstanding > 0
              ? o.paidMinor > 0
                ? ("partial" as const)
                : ("open" as const)
              : ("paid" as const),
        }
      : o;
  });
  const emptySources: FinanceBookSources = sources ?? {
    purchases: [],
    posPayments: [],
    theoreticalInventory: [],
  };
  const usedPaymentIds = new Set(
    [...settlements.values()].flatMap((settlement) => settlement.paymentIds),
  );
  const returnedSources: FinanceBookSources = {
    ...emptySources,
    purchases: emptySources.purchases.map((purchase) => ({
      ...purchase,
      alreadyLinked: [...obligations.values()].some(
        (o) => o.purchaseRef.id === purchase.id,
      ),
    })),
    posPayments: emptySources.posPayments.map((payment) => ({
      ...payment,
      alreadySettled: payment.alreadySettled || usedPaymentIds.has(payment.id),
    })),
  };
  const closedRows = monthlyClosures.map((closure) => {
    const closureAdjustments = adjustments.filter((adjustment) => {
      const purchase =
        adjustment.targetRef.type === "purchase"
          ? sources?.purchases.find((p) => p.id === adjustment.targetRef.id)
          : undefined;
      const payment =
        adjustment.targetRef.type === "pos_payment"
          ? sources?.posPayments.find((p) => p.id === adjustment.targetRef.id)
          : undefined;
      const otherTarget = sources?.adjustmentTargets?.find(
        (target) =>
          target.type === adjustment.targetRef.type &&
          target.id === adjustment.targetRef.id,
      );
      return (
        adjustment.occurredAt.startsWith(closure.month) ||
        purchase?.occurredAt.startsWith(closure.month) === true ||
        payment?.occurredAt.startsWith(closure.month) === true ||
        otherTarget?.occurredAt?.startsWith(closure.month) === true
      );
    });
    return {
      ...closure,
      adjustmentIds: closureAdjustments.map((adjustment) => adjustment.id),
      status:
        closureAdjustments.length > 0
          ? ("adjusted" as const)
          : ("closed" as const),
    };
  });
  const visibleClosures = closedRows.filter(
    (closure) =>
      closure.month >= range.from.slice(0, 7) &&
      closure.month <= range.to.slice(0, 7),
  );
  const visibleClosureAdjustmentIds = new Set(
    visibleClosures.flatMap((closure) => closure.adjustmentIds),
  );
  return {
    accounts: [...accounts.values()],
    obligations: reconciledObligations.filter(
      (o) =>
        o.outstandingMinor > 0 ||
        (o.creditBalanceMinor ?? 0) > 0 ||
        inRange(o.incurredAt) ||
        inRange(o.dueAt ?? "") ||
        o.payments.some((p) => inRange(p.occurredAt)),
    ),
    settlements: [...settlements.values()].filter(
      (s) =>
        s.status !== "reconciled" ||
        inRange(s.occurredAt) ||
        inRange(s.creditedAt ?? "") ||
        inRange(s.reconciledAt ?? ""),
    ),
    inventoryCounts: inventoryCounts.filter((c) => inRange(c.occurredAt)),
    adjustments: adjustments.filter(
      (a) => inRange(a.occurredAt) || visibleClosureAdjustmentIds.has(a.id),
    ),
    monthlyClosures: visibleClosures,
    appliedEventIds: [...unique],
    reversedEventIds: [...reversedEventIds],
    entries: (() => {
      const inRangeEvents = events.filter((e) => inRange(e.input.date));
      const reversalTargets = inRangeEvents.flatMap((e) =>
        e.input.kind === "reverse" ? [e.input.targetEventId] : [],
      );
      const visible = new Set([
        ...inRangeEvents.map((e) => e.id),
        ...reversalTargets,
      ]);
      return events.filter((e) => visible.has(e.id));
    })(),
    sources: returnedSources,
  };
}
