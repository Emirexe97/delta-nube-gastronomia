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

// Formatters are immutable and considerably more expensive than formatting a
// value. Keep a bounded cache, never amounts or business data.
const moneyFormatters = new Map<string, Intl.NumberFormat>();
const maxMoneyFormatters = 16;

export function formatMoney(amountMinor: number, currency = "ARS") {
  let formatter = moneyFormatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
    if (moneyFormatters.size >= maxMoneyFormatters)
      moneyFormatters.delete(moneyFormatters.keys().next().value!);
    moneyFormatters.set(currency, formatter);
  }
  return formatter.format(amountMinor / 100);
}
