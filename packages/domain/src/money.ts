export function assertMoneyMinor(value: number, label = "importe") {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`El ${label} debe expresarse como entero en centavos.`);
  }
  return value;
}

export function nonNegativeMoney(value: number, label = "importe") {
  assertMoneyMinor(value, label);
  if (value < 0) throw new Error(`El ${label} no puede ser negativo.`);
  return value;
}

export function roundHalfUp(value: number) {
  return Math.round(value + Number.EPSILON);
}

export function formatMoney(amountMinor: number, currency = "ARS") {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(amountMinor / 100);
}
