import type { AdjustCustomerAccountInput, CustomerProfileDto } from "@gastronomy/contracts";

export function resolveCustomerAccountAdjustments(
  input: Pick<AdjustCustomerAccountInput, "charges" | "reason">,
  charges: CustomerProfileDto["accountCharges"],
) {
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason.length < 4) throw new Error("Ingresá el motivo del ajuste de deuda.");
  if (!Array.isArray(input.charges) || !input.charges.length)
    throw new Error("Seleccioná al menos un pedido para ajustar.");

  const byOrder = new Map(charges.map((charge) => [charge.orderId, charge]));
  const seen = new Set<string>();
  const adjustments = input.charges.map((change) => {
    const charge = byOrder.get(change?.orderId);
    if (!charge || seen.has(charge.orderId) ||
        (charge.outstandingMinor === 0 && charge.adjustmentMinor >= 0))
      throw new Error("Seleccioná pedidos con deuda pendiente o reducida por un ajuste.");
    seen.add(charge.orderId);
    if (change.expectedOutstandingMinor !== charge.outstandingMinor)
      throw new Error("La deuda cambió. Volvé a abrir la ficha del cliente y revisá el saldo.");
    const afterMinor = change.outstandingMinor;
    const adjustedCharge = charge.settledMinor + afterMinor;
    if (!Number.isSafeInteger(afterMinor) || afterMinor < 0 || !Number.isSafeInteger(adjustedCharge))
      throw new Error("Ingresá un saldo válido, mayor o igual a cero.");
    return {
      orderId: charge.orderId,
      beforeMinor: charge.outstandingMinor,
      afterMinor,
      adjustmentMinor: adjustedCharge - charge.amountMinor,
    };
  }).filter((adjustment) => adjustment.beforeMinor !== adjustment.afterMinor);

  if (!adjustments.length) throw new Error("Modificá al menos un saldo para guardar el ajuste.");
  const total = charges.reduce((sum, charge) => sum + BigInt(charge.outstandingMinor), 0n);
  const adjustedTotal = adjustments.reduce(
    (sum, adjustment) => sum + BigInt(adjustment.afterMinor) - BigInt(adjustment.beforeMinor),
    total,
  );
  if (adjustedTotal > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("La deuda total del cliente supera el importe permitido.");

  return { reason, adjustments };
}
