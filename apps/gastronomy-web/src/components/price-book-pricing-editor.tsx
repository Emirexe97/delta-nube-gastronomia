import type { PriceBookDto } from "@gastronomy/contracts";
import { calculateBookPrice } from "@gastronomy/domain";
import { Field, Input } from "@gastronomy/ui";
import { formatMoney, moneyInputValue, parsePriceInput } from "../lib";

type Props = {
  books: PriceBookDto[];
  basePrice: string;
  onBasePriceChange(value: string): void;
  overrides: Record<string, string>;
  onOverridesChange(value: Record<string, string>): void;
};

function safeCalculatedPrice(
  baseMinor: number,
  book: PriceBookDto,
): number | null {
  try {
    return calculateBookPrice(baseMinor, book.adjustmentBps, undefined, book.roundingIncrementMinor);
  } catch {
    return null;
  }
}

export function hasInvalidCalculatedBookPrice(
  basePrice: string,
  books: PriceBookDto[],
  overrides: Record<string, string>,
): boolean {
  const baseMinor = parsePriceInput(basePrice);
  if (baseMinor == null) return true;
  return books.some(
    (book) =>
      !book.isBase &&
      overrides[book.id] === undefined &&
      safeCalculatedPrice(baseMinor, book) == null,
  );
}

export function PriceBookPricingEditor({
  books,
  basePrice,
  onBasePriceChange,
  overrides,
  onOverridesChange,
}: Props) {
  const parsedBase = parsePriceInput(basePrice);

  return (
    <div className="grid min-w-0 gap-3">
      <Field label="Precio Principal">
        <Input
          inputMode="decimal"
          value={basePrice}
          onChange={(event) => onBasePriceChange(event.target.value)}
          required
          className="min-w-0 w-full"
        />
      </Field>
      <div className="min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white">
        {books
          .filter((book) => !book.isBase)
          .map((book) => {
            const ownPrice = overrides[book.id] !== undefined;
            // A fixed override is authoritative; don't evaluate a calculation that
            // may overflow when this book already has a valid own amount.
            const calculated = ownPrice
              ? null
              : parsedBase == null
                ? null
                : safeCalculatedPrice(parsedBase, book);
            const onToggle = (checked: boolean) => {
              const next = { ...overrides };
              if (checked) {
                next[book.id] =
                  calculated == null ? "" : moneyInputValue(calculated);
              } else {
                delete next[book.id];
              }
              onOverridesChange(next);
            };
            return (
              <div
                key={book.id}
                role="group"
                aria-label={book.name}
                className="grid min-w-0 gap-2 border-b border-slate-100 p-3 last:border-0 sm:grid-cols-[minmax(0,1fr)_auto_minmax(120px,200px)] sm:items-center"
              >
                <div className="min-w-0">
                  <strong className="block truncate text-sm" title={book.name}>
                    {book.name}
                  </strong>
                  <p className="text-xs text-slate-500">
                    {ownPrice
                      ? "Precio propio fijo"
                      : `Calculado: ${book.adjustmentBps >= 0 ? "+" : ""}${(book.adjustmentBps / 100).toLocaleString("es-AR")}% sobre Principal${book.roundingIncrementMinor && book.roundingIncrementMinor > 1 ? ` · Al múltiplo de ${formatMoney(book.roundingIncrementMinor)} más cercano` : ""}`}
                  </p>
                </div>
                <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={ownPrice}
                    onChange={(event) => onToggle(event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-brand-600"
                  />
                  Precio propio
                </label>
                {ownPrice ? (
                  <Input
                    aria-label={`Precio fijo ${book.name}`}
                    inputMode="decimal"
                    value={overrides[book.id]}
                    onChange={(event) =>
                      onOverridesChange({
                        ...overrides,
                        [book.id]: event.target.value,
                      })
                    }
                    className="min-w-0 w-full"
                  />
                ) : (
                  <span className="min-w-0 text-right text-sm font-semibold tabular-nums text-slate-700">
                    {calculated == null
                      ? parsedBase == null
                        ? "Ingresá un precio válido"
                        : "Fuera de rango"
                      : formatMoney(calculated)}
                  </span>
                )}
              </div>
            );
          })}
        {books.length === 0 ? (
          <p className="p-3 text-xs text-amber-800">
            No se pudieron cargar las listas. Reintentá antes de guardar.
          </p>
        ) : null}
      </div>
    </div>
  );
}
