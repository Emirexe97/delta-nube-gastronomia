import { useEffect, useMemo, useState } from "react";
import type { CustomerDto, OrderDto, OrderType } from "@gastronomy/contracts";
import {
  ArrowCounterClockwise,
  MapPin,
  WarningCircle,
} from "@phosphor-icons/react";
import { Button, Card, Modal } from "@gastronomy/ui";
import { useApiMutation } from "../api";
import { formatMoney, humanError } from "../lib";
import { isRepeatOrderEligible } from "../repeat-order";

type RepeatType = Extract<OrderType, "TAKEAWAY" | "DELIVERY">;

export function RepeatOrderModal({
  source,
  customer,
  cashOpen,
  onClose,
  onCreated,
}: {
  source: OrderDto | null;
  customer: CustomerDto | null;
  cashOpen: boolean;
  onClose(): void;
  onCreated(order: OrderDto): void;
}) {
  const [type, setType] = useState<RepeatType>("TAKEAWAY");
  const [addressId, setAddressId] = useState("");
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);
  const addresses = customer?.addresses ?? [];
  const address = addresses.find((candidate) => candidate.id === addressId);
  useEffect(() => {
    if (!source) return;
    setType(source.type === "DELIVERY" ? "DELIVERY" : "TAKEAWAY");
    setAddressId(customer?.addresses[0]?.id ?? "");
    setError(null);
    setRequestKey(crypto.randomUUID());
  }, [source?.id, customer?.id]);
  const mutation = useApiMutation(
    (input: {
      sourceOrderId: string;
      customerId: string;
      type: RepeatType;
      customerAddressId?: string | null;
      idempotencyKey: string;
    }) => window.gastronomy.repeatOrder(input),
    { onSuccess: onCreated, onError: (value) => setError(humanError(value)) },
  );
  const eligible = Boolean(
    source && customer && isRepeatOrderEligible(source, customer.active),
  );
  const canSubmit = Boolean(
    eligible &&
    cashOpen &&
    customer &&
    source &&
    (type !== "DELIVERY" || address) &&
    !mutation.isPending,
  );
  const summary = useMemo(() => source?.items ?? [], [source]);
  const setTypeWithKey = (next: RepeatType) => {
    if (next === type) return;
    setType(next);
    setRequestKey(crypto.randomUUID());
    setError(null);
  };
  return (
    <Modal
      open={Boolean(source)}
      onClose={() => {
        if (!mutation.isPending) onClose();
      }}
      width="max-w-2xl"
      title="Repetir pedido"
      description="Revisá el pedido anterior y elegí cómo querés prepararlo hoy."
    >
      {source && customer ? (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSubmit) return;
            setError(null);
            mutation.mutate({
              sourceOrderId: source.id,
              customerId: customer.id,
              type,
              customerAddressId: type === "DELIVERY" ? addressId : null,
              idempotencyKey: requestKey,
            });
          }}
        >
          <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[.14em] text-slate-500">
                Pedido de referencia
              </p>
              <p className="mt-1 text-sm font-extrabold text-slate-900">
                #{source.number}{" "}
                <span className="font-normal text-slate-500">
                  · {new Date(source.createdAt).toLocaleDateString("es-AR")}
                </span>
              </p>
            </div>
            <ArrowCounterClockwise size={20} className="text-brand-700" />
          </div>
          <div
            className="max-h-52 space-y-2 overflow-y-auto pr-1"
            aria-label="Detalle histórico"
          >
            {summary.map((item) => (
              <Card
                key={item.id}
                className="flex items-start justify-between gap-3 p-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-900">
                    {item.quantity} × {item.productNameSnapshot}
                  </p>
                  {item.halves.length ? (
                    <p className="text-xs text-slate-600">
                      {item.halves.map((half) => half.nameSnapshot).join(" / ")}
                    </p>
                  ) : null}
                  {item.comboComponents?.map((component) => (
                    <p
                      key={component.slotId}
                      className="text-xs text-slate-600"
                    >
                      {component.slotName}: {component.quantity} ×{" "}
                      {component.nameSnapshot}
                      {component.modifiers
                        .map((extra) => ` · + ${extra.nameSnapshot}`)
                        .join("")}
                    </p>
                  ))}
                  {item.modifiers.length ? (
                    <p className="text-xs text-slate-600">
                      {item.modifiers
                        .map((modifier) => modifier.nameSnapshot)
                        .join(" · ")}
                    </p>
                  ) : null}
                  {item.notes ? (
                    <p className="mt-1 text-xs italic text-slate-500">
                      Nota anterior: {item.notes}
                    </p>
                  ) : null}
                </div>
                <span className="shrink-0 text-xs font-bold">
                  {formatMoney(item.lineTotalMinor)}
                </span>
              </Card>
            ))}
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-950">
            <b>Se creará un borrador con precios actuales.</b> Revisá extras y
            notas antes de confirmarlo. No se copian pagos ni cargos del pedido
            anterior.
          </div>
          <fieldset className="space-y-2">
            <legend className="mb-2 text-xs font-extrabold uppercase tracking-wide text-slate-600">
              Modalidad del nuevo pedido
            </legend>
            <div className="grid grid-cols-2 gap-2">
              {(["TAKEAWAY", "DELIVERY"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={type === option}
                  onClick={() => setTypeWithKey(option)}
                  className={`focus-ring rounded-xl border p-3 text-left transition ${type === option ? "border-brand-500 bg-brand-50 ring-1 ring-brand-500" : "border-slate-200 bg-white hover:border-slate-300"}`}
                >
                  <span className="block text-sm font-extrabold">
                    {option === "TAKEAWAY" ? "Retiro" : "Envío"}
                  </span>
                  <span className="mt-1 block text-xs text-slate-600">
                    {option === "TAKEAWAY"
                      ? "Para retirar por el local"
                      : "A una dirección del cliente"}
                  </span>
                </button>
              ))}
            </div>
          </fieldset>
          {type === "DELIVERY" ? (
            <label className="block space-y-1 text-xs font-bold text-slate-700">
              <span className="flex items-center gap-1">
                <MapPin size={14} /> Dirección de entrega
              </span>
              <select
                className="focus-ring h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
                value={addressId}
                onChange={(event) => {
                  setAddressId(event.target.value);
                  setRequestKey(crypto.randomUUID());
                  setError(null);
                }}
              >
                <option value="">Elegir dirección guardada</option>
                {addresses.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label || item.address} · {item.address}
                  </option>
                ))}
              </select>
              {address ? (
                <span className="block rounded-lg bg-slate-50 p-2 font-normal text-slate-600">
                  {address.address}
                  {address.notes ? ` · ${address.notes}` : ""}
                  <b className="float-right font-bold text-slate-800">
                    Envío actual: {formatMoney(address.deliveryFeeMinor)}
                  </b>
                </span>
              ) : null}
            </label>
          ) : null}
          {!customer.active ? (
            <p className="flex gap-2 text-xs text-rose-700">
              <WarningCircle size={15} /> La ficha está archivada; activala para
              repetir pedidos.
            </p>
          ) : null}
          {!cashOpen ? (
            <p className="text-xs font-semibold text-amber-800">
              Abrí una caja antes de crear el borrador.
            </p>
          ) : null}
          {type === "DELIVERY" && !addresses.length ? (
            <p className="text-xs text-amber-800">
              Este cliente no tiene direcciones guardadas.
            </p>
          ) : null}
          {error ? (
            <p
              role="alert"
              className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700"
            >
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
            <Button
              type="button"
              variant="secondary"
              disabled={mutation.isPending}
              onClick={onClose}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {mutation.isPending
                ? "Creando borrador…"
                : "Crear borrador y revisar"}
            </Button>
          </div>
        </form>
      ) : null}
    </Modal>
  );
}
