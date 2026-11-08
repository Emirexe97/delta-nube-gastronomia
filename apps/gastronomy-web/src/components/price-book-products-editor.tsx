import { useMemo, useState } from "react";
import type {
  PriceBookDto,
  PriceBookRoundingIncrementMinor,
  ProductDto,
} from "@gastronomy/contracts";
import { calculateBookPrice } from "@gastronomy/domain";
import { Button, Input } from "@gastronomy/ui";
import {
  formatMoney,
  moneyInputValue,
  normalizeSearch,
  parsePriceInput,
} from "../lib";

type Props = {
  products: ProductDto[];
  book: PriceBookDto;
  adjustmentBps: number | null;
  roundingIncrementMinor: PriceBookRoundingIncrementMinor;
  overrides: Record<string, string | null>;
  onOverridesChange(value: Record<string, string | null>): void;
  editable: boolean;
};

const basePrice = (product: ProductDto): number | null => {
  const amount =
    product.priceBook?.baseMinor ??
    product.prices.find((price) => price.priceListCode === "SALON")
      ?.amountMinor ??
    product.prices[0]?.amountMinor;
  return amount == null ? null : Number(amount);
};

export function PriceBookProductsEditor({
  products,
  book,
  adjustmentBps,
  roundingIncrementMinor,
  overrides,
  onOverridesChange,
  editable,
}: Props) {
  const [search, setSearch] = useState("");
  const [onlyOverrides, setOnlyOverrides] = useState(false);
  const [requestedPage, setPage] = useState(0);
  const pageSize = 8;
  const query = normalizeSearch(search.trim());
  const overrideCount = products.filter((product) =>
    overrides[product.id] !== undefined
      ? overrides[product.id] !== null
      : product.priceBook?.overrides[book.id] !== undefined,
  ).length;
  const filtered = useMemo(
    () =>
      products.filter((product) => {
        const haystack = normalizeSearch(
          `${product.name} ${product.code ?? ""} ${product.categoryName} ${product.active ? "activo" : "inactivo"} ${product.parentProductId ? "variante" : "producto"}`,
        );
        const pending = overrides[product.id];
        const own =
          pending !== undefined
            ? pending !== null
            : product.priceBook?.overrides[book.id] !== undefined;
        return haystack.includes(query) && (!onlyOverrides || own);
      }),
    [products, query, onlyOverrides, overrides, book.id],
  );
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(requestedPage, pages - 1);
  const shown = filtered.slice(page * pageSize, (page + 1) * pageSize);
  const invalidCount = Object.values(overrides).filter(
    (value) => value !== null && parsePriceInput(value) == null,
  ).length;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold">Precios por producto</h3>
          <p className="text-xs text-slate-600">
            {book.isBase
              ? "Este es el precio de referencia. Podés cambiarlo en la ficha del producto."
              : "El precio calculado sigue la regla de la lista. Un precio propio es exacto: no lleva porcentaje ni redondeo."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {!book.isBase && (
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={onlyOverrides}
                onChange={(event) => {
                  setOnlyOverrides(event.target.checked);
                  setPage(0);
                }}
              />
              Sólo precios propios ({overrideCount})
            </label>
          )}
          <Input
            aria-label="Buscar producto en lista de precios"
            placeholder="Buscar nombre, código o categoría…"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(0);
            }}
          />
        </div>
      </div>
      {invalidCount > 0 ? (
        <p
          role="alert"
          className="rounded-md bg-rose-50 p-2 text-xs text-rose-800"
        >
          Hay {invalidCount} precio{invalidCount === 1 ? "" : "s"} propio
          {invalidCount === 1 ? "" : "s"} inválido
          {invalidCount === 1 ? "" : "s"} en los cambios, incluso si no aparece
          en esta página. Corregilo o elegí Heredar.
        </p>
      ) : null}
      <div className="overflow-hidden rounded-lg border border-slate-200">
        {shown.map((product) => {
          const base = basePrice(product);
          const pending = overrides[product.id];
          const stored = product.priceBook?.overrides[book.id];
          const own =
            pending !== undefined ? pending !== null : stored !== undefined;
          const amount = own
            ? pending !== undefined
              ? parsePriceInput(pending ?? "")
              : Number(stored)
            : null;
          let calculated: number | null = null;
          if (
            !own &&
            adjustmentBps !== null &&
            base !== null &&
            Number.isSafeInteger(base)
          ) {
            try {
              calculated = calculateBookPrice(
                base,
                adjustmentBps,
                undefined,
                roundingIncrementMinor,
              );
            } catch {
              calculated = null;
            }
          }
          const value = own ? amount : calculated;
          return (
            <div
              key={product.id}
              role="group"
              aria-label={product.name}
              className="grid gap-2 border-b border-slate-100 p-3 last:border-0 sm:grid-cols-[minmax(0,1fr)_minmax(130px,190px)_auto] sm:items-center"
            >
              <div className="min-w-0">
                <strong className="block truncate text-sm">
                  {product.name}
                </strong>
                <p className="truncate text-xs text-slate-500">
                  {product.categoryName}
                  {product.code ? ` · ${product.code}` : ""} ·{" "}
                  {product.active ? "Activo" : "Inactivo"}
                  {product.parentProductId ? " · Variante" : ""}
                </p>
              </div>
              {own && editable ? (
                <div className="grid min-w-0 gap-1">
                  <span className="whitespace-nowrap text-[11px] text-slate-500">
                    Principal {base == null ? "Sin precio" : formatMoney(base)}
                  </span>
                  <Input
                    aria-label={`Precio fijo ${product.name}`}
                    inputMode="decimal"
                    placeholder="0,00"
                    value={
                      pending !== undefined
                        ? (pending ?? "")
                        : moneyInputValue(Number(stored))
                    }
                    aria-invalid={amount == null}
                    onChange={(event) =>
                      onOverridesChange({
                        ...overrides,
                        [product.id]: event.target.value,
                      })
                    }
                  />
                </div>
              ) : (
                <span className="text-left text-sm font-semibold tabular-nums sm:text-right">
                  {!book.isBase && (
                    <span className="block text-[11px] font-normal text-slate-500">
                      Principal{" "}
                      {base == null ? "Sin precio" : formatMoney(base)}
                    </span>
                  )}
                  {value == null
                    ? adjustmentBps == null
                      ? "Corregí el porcentaje"
                      : "Fuera de rango"
                    : formatMoney(value)}
                </span>
              )}
              <div className="flex items-center justify-between gap-2 sm:justify-end">
                <span
                  className={`text-xs font-medium ${own ? "text-amber-700" : "text-slate-500"}`}
                >
                  {book.isBase
                    ? "Precio base"
                    : own
                      ? "Precio propio"
                      : "Calculado"}
                </span>
                {editable ? (
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-8 px-2 text-xs"
                    onClick={() =>
                      onOverridesChange({
                        ...overrides,
                        [product.id]: own
                          ? null
                          : value == null && base == null
                            ? ""
                            : moneyInputValue(value ?? base!),
                      })
                    }
                  >
                    {own ? "Heredar" : "Fijar precio"}
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
        {shown.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">
            No hay productos que coincidan.
          </p>
        ) : null}
      </div>
      {filtered.length > pageSize ? (
        <div className="flex items-center justify-between text-xs text-slate-600">
          <span>
            {page * pageSize + 1}–
            {Math.min((page + 1) * pageSize, filtered.length)} de{" "}
            {filtered.length}
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              className="h-8 px-2"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              Anterior
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="h-8 px-2"
              disabled={page + 1 >= pages}
              onClick={() => setPage(page + 1)}
            >
              Siguiente
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
