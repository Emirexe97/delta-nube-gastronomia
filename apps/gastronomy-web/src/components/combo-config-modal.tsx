import { useEffect, useRef, useState } from "react";
import type { ComboDefinitionDto, ProductDto } from "@gastronomy/contracts";
import { assertComboDefinition } from "@gastronomy/domain";
import { Button, Field, Input, Modal } from "@gastronomy/ui";
import { useApiMutation } from "../api";
import { humanError } from "../lib";

export function ComboConfigModal({
  open,
  product,
  products,
  onClose,
}: {
  open: boolean;
  product: ProductDto | null;
  products: ProductDto[];
  onClose(): void;
}) {
  const [slots, setSlots] = useState<ComboDefinitionDto["slots"]>([]);
  const [reason, setReason] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submissionRef = useRef<{
    fingerprint: string;
    idempotencyKey: string;
  } | null>(null);
  const mutation = useApiMutation(
    (input: Parameters<typeof window.gastronomy.configureProductCombo>[0]) =>
      window.gastronomy.configureProductCombo(input),
    {
      onSuccess: () => {
        setError(null);
        onClose();
      },
      onError: (value) => setError(humanError(value)),
    },
  );
  const productId = product?.id;
  useEffect(() => {
    if (!open || !product) return;
    setSlots(
      product.comboDefinition?.slots.map((slot) => ({
        ...slot,
        productIds: [...slot.productIds],
      })) ?? [
        {
          id: crypto.randomUUID(),
          name: "Opción 1",
          quantity: 1,
          productIds: [],
        },
      ],
    );
    setReason("");
    setPin("");
    setError(null);
    submissionRef.current = null;
  }, [open, productId]);
  if (!product) return null;
  const candidates = products.filter(
    (candidate) =>
      candidate.id !== product.id &&
      !candidate.comboDefinition &&
      candidate.active,
  );

  const submit = (definition: ComboDefinitionDto | null) => {
    if (mutation.isPending) return;
    if (!reason.trim()) {
      setError("Indicá el motivo del cambio.");
      return;
    }
    if (!/^\d{4,8}$/.test(pin)) {
      setError("Ingresá un PIN de autorización válido.");
      return;
    }
    if (definition) {
      try {
        assertComboDefinition(definition, product.id, products);
      } catch (validationError) {
        setError(humanError(validationError));
        return;
      }
      const eligibleIds = new Set(candidates.map((candidate) => candidate.id));
      if (
        definition.slots.some((slot) =>
          slot.productIds.some((id) => !eligibleIds.has(id)),
        )
      ) {
        setError(
          "Quitá de las opciones los productos inactivos o que ya no están disponibles.",
        );
        return;
      }
      if (product.stockMinor != null) {
        setError(
          "Desactivá el control de stock de este producto antes de configurarlo como combo. No se quitará stock automáticamente.",
        );
        return;
      }
    }
    const fingerprint = JSON.stringify({
      productId: product.id,
      definition,
      reason: reason.trim(),
      authorizerPin: pin,
    });
    if (submissionRef.current?.fingerprint !== fingerprint)
      submissionRef.current = {
        fingerprint,
        idempotencyKey: crypto.randomUUID(),
      };
    mutation.mutate({
      productId: product.id,
      definition,
      reason: reason.trim(),
      authorizerPin: pin,
      idempotencyKey: submissionRef.current.idempotencyKey,
    });
  };
  const edit = (
    update: (
      current: ComboDefinitionDto["slots"],
    ) => ComboDefinitionDto["slots"],
  ) => {
    setSlots((current) => update(current));
    setError(null);
  };
  const authorized = Boolean(reason.trim() && /^\d{4,8}$/.test(pin));

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!mutation.isPending) onClose();
      }}
      closeDisabled={mutation.isPending}
      title={`Configurar combo · ${product.name}`}
      description="El precio del combo usa el precio del producto; los componentes no suman su precio de venta."
    >
      <div className="max-h-[58vh] space-y-3 overflow-y-auto pr-1">
        {product.stockMinor != null && (
          <p
            role="alert"
            className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900"
          >
            Este producto tiene stock controlado. Desactiva el control antes de
            configurarlo como combo; no se quitará inventario automáticamente.
          </p>
        )}
        {slots.map((slot, index) => (
          <section
            key={slot.id}
            className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3"
          >
            <div className="grid grid-cols-[1fr_90px_auto] items-end gap-2">
              <Field label={`Opción ${index + 1}`}>
                <Input
                  disabled={mutation.isPending}
                  maxLength={80}
                  value={slot.name}
                  onChange={(event) =>
                    edit((old) =>
                      old.map((entry) =>
                        entry.id === slot.id
                          ? { ...entry, name: event.target.value }
                          : entry,
                      ),
                    )
                  }
                />
              </Field>
              <Field label="Cantidad">
                <Input
                  disabled={mutation.isPending}
                  type="number"
                  min={1}
                  max={99}
                  step={1}
                  value={slot.quantity}
                  onChange={(event) =>
                    edit((old) =>
                      old.map((entry) =>
                        entry.id === slot.id
                          ? { ...entry, quantity: Number(event.target.value) }
                          : entry,
                      ),
                    )
                  }
                />
              </Field>
              <Button
                variant="secondary"
                disabled={mutation.isPending}
                onClick={() =>
                  edit((old) => old.filter((entry) => entry.id !== slot.id))
                }
              >
                Quitar
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-1">
              {candidates.map((candidate) => (
                <label
                  key={candidate.id}
                  className={`flex items-center gap-2 rounded-lg bg-white px-2 py-1.5 text-xs ${mutation.isPending ? "opacity-60" : ""}`}
                >
                  <input
                    disabled={mutation.isPending}
                    type="checkbox"
                    checked={slot.productIds.includes(candidate.id)}
                    onChange={(event) =>
                      edit((old) =>
                        old.map((entry) =>
                          entry.id === slot.id
                            ? {
                                ...entry,
                                productIds: event.target.checked
                                  ? [...entry.productIds, candidate.id]
                                  : entry.productIds.filter(
                                      (id) => id !== candidate.id,
                                    ),
                              }
                            : entry,
                        ),
                      )
                    }
                  />
                  {candidate.name}
                </label>
              ))}
            </div>
          </section>
        ))}
        {slots.length < 12 && (
          <Button
            variant="secondary"
            disabled={mutation.isPending}
            onClick={() =>
              edit((old) => [
                ...old,
                {
                  id: crypto.randomUUID(),
                  name: `Opción ${old.length + 1}`,
                  quantity: 1,
                  productIds: [],
                },
              ])
            }
          >
            ＋ Agregar opción
          </Button>
        )}
        <Field label="Motivo">
          <Input
            disabled={mutation.isPending}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              setError(null);
            }}
            maxLength={200}
          />
        </Field>
        <Field label="PIN de autorización">
          <Input
            disabled={mutation.isPending}
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(event) => {
              setPin(event.target.value.replace(/\D/g, ""));
              setError(null);
            }}
            maxLength={8}
          />
        </Field>
        {error && (
          <p
            role="alert"
            className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800"
          >
            {error}
          </p>
        )}
      </div>
      <div className="mt-4 flex justify-between gap-2">
        {product.comboDefinition && (
          <Button
            variant="secondary"
            disabled={mutation.isPending || !authorized}
            onClick={() => submit(null)}
          >
            {mutation.isPending ? "Guardando…" : "Quitar configuración"}
          </Button>
        )}
        <div className="ml-auto flex gap-2">
          <Button
            variant="secondary"
            disabled={mutation.isPending}
            onClick={() => onClose()}
          >
            Cancelar
          </Button>
          <Button
            disabled={
              mutation.isPending || !authorized || product.stockMinor != null
            }
            onClick={() => submit({ slots })}
          >
            {mutation.isPending ? "Guardando…" : "Guardar combo"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
