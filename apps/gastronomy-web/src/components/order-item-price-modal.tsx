import { useState } from "react";
import type { OrderItemDto } from "@gastronomy/contracts";
import { Button, Field, Input, Modal } from "@gastronomy/ui";
import { moneyInputValue, parsePriceInput } from "../lib";

export function OrderItemPriceModal({
  item,
  onClose,
  onSave,
  isPending,
  error,
}: {
  item: OrderItemDto;
  onClose(): void;
  onSave(unitPriceMinor: number, authorizerPin: string): void;
  isPending: boolean;
  error: string | null;
}) {
  const [price, setPrice] = useState(() =>
    moneyInputValue(item.unitPriceMinorSnapshot),
  );
  const [pin, setPin] = useState("");
  const priceMinor = parsePriceInput(price);
  const canSave =
    priceMinor != null &&
    priceMinor !== item.unitPriceMinorSnapshot &&
    /^\d{4,8}$/.test(pin);

  return (
    <Modal
      open
      onClose={onClose}
      closeDisabled={isPending}
      title="Editar precio"
      description={`${item.quantity} × ${item.productNameSnapshot}`}
    >
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSave || isPending) return;
          onSave(priceMinor, pin);
        }}
      >
        <Field label="Precio unitario">
          <Input
            autoFocus
            inputMode="decimal"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            required
            disabled={isPending}
          />
        </Field>
        <Field label="PIN de autorización">
          <Input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={8}
            value={pin}
            onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
            required
            disabled={isPending}
          />
        </Field>
        {error ? (
          <p
            role="alert"
            className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700"
          >
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={isPending}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={!canSave || isPending}>
            {isPending ? "Guardando…" : "Guardar precio"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
