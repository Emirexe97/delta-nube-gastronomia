import { useEffect, useRef, useState } from "react";
import type {
  CategoryDto,
  ComboDefinitionDto,
  ConfigureProductComboInput,
  CreateComboInput,
  ProductDto,
} from "@gastronomy/contracts";
import { assertComboDefinition } from "@gastronomy/domain";
import { Button, Field, Input, Modal, Select } from "@gastronomy/ui";
import { useApiMutation } from "../api";
import { humanError, parseMoneyInput } from "../lib";

export function ComboConfigModal({
  open,
  product,
  products,
  categories,
  onClose,
}: {
  open: boolean;
  product: ProductDto | null;
  products: ProductDto[];
  categories: CategoryDto[];
  onClose(): void;
}) {
  const [slots, setSlots] = useState<ComboDefinitionDto["slots"]>([]);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [salonPrice, setSalonPrice] = useState("");
  const [offPremisePrice, setOffPremisePrice] = useState("");
  const [reason, setReason] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submissionRef = useRef<{
    fingerprint: string;
    idempotencyKey: string;
  } | null>(null);
  const mutation = useApiMutation(
    (
      request:
        | { mode: "create"; input: CreateComboInput }
        | { mode: "edit"; input: ConfigureProductComboInput },
    ) =>
      request.mode === "create"
        ? window.gastronomy.createCombo(request.input)
        : window.gastronomy.configureProductCombo(request.input),
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
    if (!open) return;
    setName("");
    setCode("");
    setCategoryId(categories.find((category) => category.active)?.id ?? "");
    setSalonPrice("");
    setOffPremisePrice("");
    setSlots(
      product?.comboDefinition?.slots.map((slot) => ({
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
  if (!open) return null;
  const candidates = products.filter(
    (candidate) =>
      candidate.id !== product?.id &&
      !candidate.comboDefinition &&
      candidate.active &&
      categories.some(
        (category) => category.id === candidate.categoryId && category.active,
      ),
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
        assertComboDefinition(definition, product?.id, products);
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
      if (product?.stockMinor != null) {
        setError(
          "Desactivá el control de stock de este producto antes de configurarlo como combo. No se quitará stock automáticamente.",
        );
        return;
      }
    }
    const common = { reason: reason.trim(), authorizerPin: pin };
    let request:
      | { mode: "create"; input: CreateComboInput }
      | { mode: "edit"; input: ConfigureProductComboInput };
    if (product) {
      request = {
        mode: "edit",
        input: { ...common, productId: product.id, definition },
      };
    } else {
      const salon = parseMoneyInput(salonPrice);
      const offPremise = parseMoneyInput(offPremisePrice);
      if (
        !name.trim() ||
        !categoryId ||
        salon == null ||
        offPremise == null ||
        !definition
      ) {
        setError("Completá nombre, categoría y precios válidos del combo.");
        return;
      }
      request = {
        mode: "create",
        input: {
          ...common,
          name: name.trim(),
          code: code.trim() || null,
          categoryId,
          definition,
          prices: [
            { priceListCode: "SALON", amountMinor: salon },
            { priceListCode: "TAKEAWAY", amountMinor: offPremise },
            { priceListCode: "DELIVERY", amountMinor: offPremise },
          ],
        },
      };
    }
    const fingerprint = JSON.stringify(request);
    if (submissionRef.current?.fingerprint !== fingerprint)
      submissionRef.current = {
        fingerprint,
        idempotencyKey: crypto.randomUUID(),
      };
    request.input.idempotencyKey = submissionRef.current.idempotencyKey;
    mutation.mutate(request);
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
      title={product ? `Editar opciones · ${product.name}` : "Nuevo combo"}
      description="El combo tiene precio propio; los componentes no suman su precio de venta."
      width="max-w-3xl"
    >
      <div className="max-h-[58vh] space-y-3 overflow-y-auto pr-1">
        {!product && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nombre del combo">
              <Input
                aria-label="Nombre del combo"
                disabled={mutation.isPending}
                maxLength={120}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field label="Categoría">
              <Select
                aria-label="Categoría del combo"
                disabled={mutation.isPending}
                value={categoryId}
                onChange={(event) => setCategoryId(event.target.value)}
              >
                <option value="">Seleccioná una categoría</option>
                {categories
                  .filter((category) => category.active)
                  .map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Código (opcional)">
              <Input
                aria-label="Código del combo"
                disabled={mutation.isPending}
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            </Field>
            <div />
            <Field label="Precio Salón">
              <Input
                aria-label="Precio Salón del combo"
                inputMode="decimal"
                disabled={mutation.isPending}
                value={salonPrice}
                onChange={(event) => setSalonPrice(event.target.value)}
              />
            </Field>
            <Field label="Precio Delivery / Para retirar">
              <Input
                aria-label="Precio Delivery / Para retirar del combo"
                inputMode="decimal"
                disabled={mutation.isPending}
                value={offPremisePrice}
                onChange={(event) => setOffPremisePrice(event.target.value)}
              />
            </Field>
            <p className="text-xs text-slate-500 sm:col-span-2">
              El stock se controla en los componentes, según las opciones
              elegidas al vender.
            </p>
          </div>
        )}
        {product?.stockMinor != null && (
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
                  aria-label={`Nombre de opción ${index + 1}`}
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
                  aria-label={`Cantidad de opción ${index + 1}`}
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
            aria-label="Motivo"
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
            aria-label="PIN de autorización"
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
        {product?.comboDefinition && (
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
              mutation.isPending ||
              !authorized ||
              product?.stockMinor != null ||
              (!product &&
                (!name.trim() ||
                  !categoryId ||
                  parseMoneyInput(salonPrice) == null ||
                  parseMoneyInput(offPremisePrice) == null))
            }
            onClick={() => submit({ slots })}
          >
            {mutation.isPending
              ? "Guardando…"
              : product
                ? "Guardar combo"
                : "Crear combo"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
