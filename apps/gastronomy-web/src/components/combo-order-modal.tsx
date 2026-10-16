import { useEffect, useMemo, useRef, useState } from "react";
import type { BootstrapDto, ProductDto } from "@gastronomy/contracts";
import { calculateComboPrice } from "@gastronomy/domain";
import { Button, Modal } from "@gastronomy/ui";
import { formatMoney } from "../lib";

type ComboSelection = {
  slotId: string;
  productId: string;
  modifierIds: string[];
};

export function ComboOrderModal({
  open,
  product,
  data,
  orderType,
  pending = false,
  error = null,
  onClose,
  onSelect,
}: {
  open: boolean;
  product: ProductDto | null;
  data: BootstrapDto;
  orderType: "DINE_IN" | "TAKEAWAY" | "DELIVERY";
  pending?: boolean;
  error?: string | null;
  onClose(): void;
  onSelect(
    product: ProductDto,
    selections: ComboSelection[],
    quantity: number,
    idempotencyKey: string,
  ): void;
}) {
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [extras, setExtras] = useState<Record<string, string[]>>({});
  const [quantityInput, setQuantityInput] = useState("1");
  const submissionRef = useRef<{
    fingerprint: string;
    idempotencyKey: string;
  } | null>(null);
  const code = orderType === "DINE_IN" ? "SALON" : orderType;
  const base = product?.prices.find(
    (p) => p.priceListCode === code,
  )?.amountMinor;
  const slots = product?.comboDefinition?.slots ?? [];
  const categories = new Set(
    data.categories.filter((c) => c.active).map((c) => c.id),
  );
  const optionsBySlot = useMemo(
    () =>
      new Map(
        slots.map((slot) => [
          slot.id,
          data.products.filter(
            (option) =>
              slot.productIds.includes(option.id) &&
              option.active &&
              !option.comboDefinition &&
              categories.has(option.categoryId) &&
              option.prices.some(
                (price) =>
                  price.priceListCode === code &&
                  Number.isSafeInteger(price.amountMinor) &&
                  price.amountMinor >= 0,
              ),
          ),
        ]),
      ),
    [slots, data.products, data.categories, code],
  );
  const quantity = Number(quantityInput);
  const quantityValid = Number.isSafeInteger(quantity) && quantity > 0;
  const chosenComponents = slots.flatMap((slot) => {
    if (!selected[slot.id]) return [];
    return [
      {
        quantity: slot.quantity,
        modifiers: data.modifiers
          .filter(
            (modifier) =>
              modifier.active && extras[slot.id]?.includes(modifier.id),
          )
          .map((modifier) => ({ unitPriceMinorSnapshot: modifier.priceMinor })),
      },
    ];
  });
  let unitTotal: number | null = null;
  let total: number | null = null;
  try {
    if (
      base != null &&
      Number.isSafeInteger(base) &&
      base >= 0 &&
      slots.every((slot) => Boolean(selected[slot.id]))
    ) {
      unitTotal = calculateComboPrice(base, chosenComponents);
      if (quantityValid && Number.isSafeInteger(unitTotal * quantity))
        total = unitTotal * quantity;
    }
  } catch {
    unitTotal = null;
  }
  const valid = Boolean(
    product &&
    slots.length > 0 &&
    base != null &&
    quantityValid &&
    total != null &&
    slots.every((slot) =>
      optionsBySlot
        .get(slot.id)
        ?.some((option) => option.id === selected[slot.id]),
    ),
  );

  useEffect(() => {
    if (!open) return;
    setSelected({});
    setExtras({});
    setQuantityInput("1");
    submissionRef.current = null;
  }, [open, product]);
  if (!product) return null;

  const handleClose = () => {
    if (!pending) onClose();
  };
  const submit = () => {
    if (!valid || pending || !product) return;
    const selections = slots.map((slot) => ({
      slotId: slot.id,
      productId: selected[slot.id]!,
      modifierIds: extras[slot.id] ?? [],
    }));
    const fingerprint = JSON.stringify({
      productId: product.id,
      orderType,
      selections,
      quantity,
    });
    if (submissionRef.current?.fingerprint !== fingerprint) {
      submissionRef.current = {
        fingerprint,
        idempotencyKey: crypto.randomUUID(),
      };
    }
    onSelect(
      product,
      selections,
      quantity,
      submissionRef.current.idempotencyKey,
    );
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      closeDisabled={pending}
      title={`Armar ${product.name}`}
      description={`Base ${base == null ? "Sin precio" : formatMoney(base)} · los componentes no suman su precio de venta`}
    >
      <div className="max-h-[60vh] space-y-3 overflow-y-auto">
        {slots.map((slot) => {
          const options = optionsBySlot.get(slot.id) ?? [];
          const chosen = selected[slot.id];
          return (
            <section
              key={slot.id}
              className="space-y-2 rounded-xl border border-slate-200 p-3"
            >
              <h3 className="text-sm font-bold">
                {slot.name}{" "}
                <span className="font-normal text-slate-500">
                  × {slot.quantity}
                </span>
              </h3>
              {options.length ? (
                <div className="grid grid-cols-2 gap-2">
                  {options.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        setSelected((s) => ({ ...s, [slot.id]: option.id }));
                        setExtras((old) => ({ ...old, [slot.id]: [] }));
                      }}
                      className={`rounded-lg border p-2 text-left text-sm disabled:opacity-60 ${chosen === option.id ? "border-brand-500 bg-brand-50 font-bold" : "border-slate-200"}`}
                    >
                      {option.name}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
                  No hay productos activos con precio vigente para esta opción.
                </p>
              )}
              {chosen && data.modifiers.some((m) => m.active) && (
                <div className="grid grid-cols-2 gap-1">
                  {data.modifiers
                    .filter(
                      (m) =>
                        m.active &&
                        Number.isSafeInteger(m.priceMinor) &&
                        m.priceMinor >= 0,
                    )
                    .map((modifier) => (
                      <label
                        key={modifier.id}
                        className={`flex items-center gap-2 rounded bg-slate-50 p-1.5 text-xs ${pending ? "opacity-60" : ""}`}
                      >
                        <input
                          type="checkbox"
                          disabled={pending}
                          checked={
                            extras[slot.id]?.includes(modifier.id) ?? false
                          }
                          onChange={(e) =>
                            setExtras((old) => ({
                              ...old,
                              [slot.id]: e.target.checked
                                ? [...(old[slot.id] ?? []), modifier.id]
                                : (old[slot.id] ?? []).filter(
                                    (id) => id !== modifier.id,
                                  ),
                            }))
                          }
                        />
                        {modifier.name} +{formatMoney(modifier.priceMinor)}
                      </label>
                    ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-between rounded-xl bg-slate-50 p-3">
        <label className="text-sm font-semibold">
          Cantidad del combo{" "}
          <input
            className="ml-2 w-16 rounded border p-1"
            type="number"
            min={1}
            step={1}
            value={quantityInput}
            disabled={pending}
            aria-invalid={!quantityValid}
            onChange={(e) => setQuantityInput(e.target.value)}
          />
        </label>
        <div className="text-right">
          <div className="text-xs text-slate-500">
            Unitario · {unitTotal == null ? "—" : formatMoney(unitTotal)}
          </div>
          <strong>{total == null ? "—" : formatMoney(total)}</strong>
        </div>
      </div>
      {!quantityValid && (
        <p role="alert" className="mt-2 text-xs text-rose-700">
          Ingresá una cantidad entera mayor que cero.
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="mt-2 rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800"
        >
          {error}
        </p>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="secondary" disabled={pending} onClick={handleClose}>
          Cancelar
        </Button>
        <Button disabled={!valid || pending} onClick={submit}>
          {pending ? "Agregando…" : "Agregar combo"}
        </Button>
      </div>
    </Modal>
  );
}
