import { useEffect, useRef, useState } from "react";
import type { BootstrapDto, CreateOrderInput, CustomerDto, OrderDto, OrderType, UpdateDraftOrderInput } from "@gastronomy/contracts";
import { ShoppingBag } from "@phosphor-icons/react";
import { Button, Field, Input, Modal, Select, Textarea, cn } from "@gastronomy/ui";
import { bootstrapKey, useApiMutation } from "../api";
import { addTakeawayDraftToCache } from "../takeaway-draft-cache";
import { useQueryClient } from "@tanstack/react-query";
import { OrderCustomerSelector } from "./order-customer-selector";
import { formatMoney, humanError, parseMoneyInput, typeLabels } from "../lib";
function toLocalDateTimeInput(date: Date) {
  return new Date(date.valueOf() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

export function NewOrderModal({
  open,
  type,
  data,
  editingOrder,
  initialCustomer,
  onClose,
  onSaved,
  inline = false,
  onFormStateChange,
}: {
  open: boolean;
  type: OrderType;
  data: BootstrapDto;
  editingOrder: OrderDto | null;
  initialCustomer: CustomerDto | null;
  onClose(): void;
  onSaved(order: OrderDto): void;
  inline?: boolean;
  onFormStateChange?(state: { dirty: boolean; pending: boolean }): void;
}) {
  const [selectedType, setSelectedType] = useState<OrderType>(type);
  const [reason, setReason] = useState("");
  const [authorizerPin, setAuthorizerPin] = useState("");
  const [reverseDeliverySettlement, setReverseDeliverySettlement] =
    useState(false);
  const [driverCashRemitted, setDriverCashRemitted] = useState(false);
  const [refundAmounts, setRefundAmounts] = useState<Record<string, string>>(
    {},
  );
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerAddressId, setCustomerAddressId] = useState<string | null>(
    null,
  );
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [driverUserId, setDriverUserId] = useState("");
  const [delay, setDelay] = useState("40");
  const [scheduleMode, setScheduleMode] = useState<"QUICK" | "SCHEDULED">(
    "QUICK",
  );
  const [timingChanged, setTimingChanged] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const [fee, setFee] = useState("0");
  const initialForm = useRef<string | null>(null);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const initializedSession = useRef<string | null>(null);
  const submitLock = useRef(false);
  const pendingRef = useRef(false);
  const submittedOrderId = useRef<string | null>(null);
  const hasChangesRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const queryClient = useQueryClient();
  const createSnapshots = useRef(new WeakMap<object, BootstrapDto>());
  const currentOrderId = useRef(editingOrder?.id ?? null);
  currentOrderId.current = editingOrder?.id ?? null;
  const drivers = data.users.filter(
    (user) => user.roleCode === "DELIVERY_DRIVER" && user.active,
  );
  const mutation = useApiMutation(
    (
      input: CreateOrderInput & {
        orderId?: string;
        reason?: string;
        authorizerPin?: string;
        refunds?: UpdateDraftOrderInput["refunds"];
        reverseDeliverySettlement?: boolean;
        driverCashRemitted?: boolean;
      },
    ) => {
      const { orderId, ...details } = input;
      return orderId
        ? window.gastronomy.updateDraftOrder({ ...details, orderId })
        : window.gastronomy.createOrder(details);
    },
    {
      onMutate: (input) => {
        const snapshot = queryClient.getQueryData<BootstrapDto>(bootstrapKey);
        if (!input.orderId && input.type === "TAKEAWAY" && snapshot) {
          const state = queryClient.getQueryState<BootstrapDto>(bootstrapKey);
          if (!state?.isInvalidated && state?.fetchStatus === "idle")
            createSnapshots.current.set(input, snapshot);
        }
      },
      applyBootstrapResult: (order, input) => {
        const snapshot = createSnapshots.current.get(input);
        createSnapshots.current.delete(input);
        return !input.orderId && input.type === "TAKEAWAY"
          ? addTakeawayDraftToCache(queryClient, snapshot, order)
          : false;
      },
      onSuccess: (order) => {
        initialForm.current = null;
        if (currentOrderId.current === submittedOrderId.current) onSaved(order);
      },
      onError: (value) => {
        if (currentOrderId.current === submittedOrderId.current) setError(humanError(value));
      },
      onSettled: () => {
        submitLock.current = false;
        pendingRef.current = false;
      },
    },
  );

  useEffect(() => {
    const sessionKey = editingOrder?.id ?? (open ? "new" : null);
    if (open && sessionKey && initializedSession.current !== sessionKey) {
      initializedSession.current = sessionKey;
      setSelectedType(editingOrder?.type ?? type);
      const preferredAddress = initialCustomer?.addresses[0];
      setCustomerId(editingOrder?.customerId ?? initialCustomer?.id ?? null);
      setCustomerAddressId(
        editingOrder ? null : (preferredAddress?.id ?? null),
      );
      setName(
        editingOrder?.customerNameSnapshot ?? initialCustomer?.name ?? "",
      );
      setPhone(
        editingOrder?.customerPhoneSnapshot ?? initialCustomer?.phone ?? "",
      );
      setAddress(
        editingOrder?.deliveryAddressSnapshot ??
          preferredAddress?.address ??
          "",
      );
      setDriverUserId(editingOrder?.driverUserId ?? "");
      setNotes(editingOrder?.notes ?? "");
      setError(null);
      setReason("");
      setAuthorizerPin("");
      setReverseDeliverySettlement(false);
      setDriverCashRemitted(false);
      setRefundAmounts({});
      const initialDelay = editingOrder?.promisedAt
        ? Math.max(
            1,
            Math.round(
              (new Date(editingOrder.promisedAt).valueOf() - Date.now()) /
                60_000,
            ),
          )
        : (data.settings.quickDelayMinutes[2] ?? 40);
      setDelay(String(initialDelay));
      setScheduleMode(editingOrder?.scheduled ? "SCHEDULED" : "QUICK");
      setTimingChanged(false);
      setScheduledAt(
        toLocalDateTimeInput(
          editingOrder?.promisedAt
            ? new Date(editingOrder.promisedAt)
            : new Date(Date.now() + 60 * 60_000),
        ),
      );
      setFee(
        String(
          (editingOrder?.deliveryFeeMinor ??
            preferredAddress?.deliveryFeeMinor ??
            0) / 100,
        ).replace(".", ","),
      );
      initialForm.current = null;
    } else if (!open) {
      initializedSession.current = null;
    }
  }, [editingOrder?.id, initialCustomer?.id, open, type]);

  useEffect(() => {
    if (!editingOrder && open && initializedSession.current === "new") {
      setSelectedType(type);
    }
  }, [editingOrder, open, type]);

  const isPaidEdit = Boolean(editingOrder && editingOrder.paidMinor > 0);
  const paidTypeChanged = Boolean(
    editingOrder && selectedType !== editingOrder.type,
  );
  const parsedFeeMinor = parseMoneyInput(fee);
  const feeValid = selectedType !== "DELIVERY" || parsedFeeMinor !== null;
  const newFeeMinor = selectedType === "DELIVERY" ? (parsedFeeMinor ?? 0) : 0;
  const previewTotalMinor = editingOrder
    ? Math.max(
        0,
        editingOrder.subtotalMinor -
          editingOrder.discountMinor -
          editingOrder.depositMinor +
          newFeeMinor,
      )
    : 0;
  const refundDueMinor = isPaidEdit
    ? Math.max(0, editingOrder!.paidMinor - previewTotalMinor)
    : 0;
  const refundLines = editingOrder
    ? editingOrder.payments.filter((payment) => payment.refundableMinor > 0)
    : [];
  useEffect(() => {
    if (!editingOrder || !isPaidEdit) return;
    setRefundAmounts((current) => {
      let remaining = refundDueMinor;
      const next: Record<string, string> = {};
      for (const payment of refundLines) {
        const requested =
          current[payment.id] == null
            ? 0
            : (parseMoneyInput(current[payment.id] ?? "0") ?? 0);
        const amount = Math.min(requested, payment.refundableMinor, remaining);
        next[payment.id] = String(amount / 100).replace(".", ",");
        remaining -= amount;
      }
      if (remaining > 0) {
        for (const payment of refundLines) {
          const already = parseMoneyInput(next[payment.id] ?? "0") ?? 0;
          const amount = Math.min(payment.refundableMinor - already, remaining);
          next[payment.id] = String((already + amount) / 100).replace(".", ",");
          remaining -= amount;
          if (!remaining) break;
        }
      }
      return next;
    });
  }, [editingOrder?.id, refundDueMinor, isPaidEdit]);
  const refunds = refundLines
    .map((payment) => ({
      paymentId: payment.id,
      amountMinor: parseMoneyInput(refundAmounts[payment.id] ?? "0") ?? 0,
    }))
    .filter((refund) => refund.amountMinor > 0);
  const refundsAllocatedMinor = refunds.reduce(
    (total, refund) => total + refund.amountMinor,
    0,
  );
  const refundsWithinLimits = refundLines.every(
    (payment) =>
      (parseMoneyInput(refundAmounts[payment.id] ?? "0") ?? 0) <=
      payment.refundableMinor,
  );
  const settledDeliveryLedger = Boolean(
    editingOrder &&
    data.deliveryLedger.some(
      (entry) =>
        entry.orderId === editingOrder.id && entry.status === "SETTLED",
    ),
  );
  const requiresSettlementReversal = settledDeliveryLedger;
  const requiresDriverCashRemittance = Boolean(
    editingOrder?.type === "DELIVERY" &&
    editingOrder.collectedByDriver &&
    selectedType === "TAKEAWAY",
  );

  const quickDelay = Number(delay);
  const quickDate = new Date(Date.now() + quickDelay * 60_000);
  const scheduledDate = new Date(scheduledAt);
  const scheduledValid =
    scheduleMode === "QUICK"
      ? Number.isFinite(quickDelay) &&
        Number.isInteger(quickDelay) &&
        quickDelay > 0 &&
        Number.isFinite(quickDate.valueOf())
      : Boolean(
          scheduledAt &&
          Number.isFinite(scheduledDate.valueOf()) &&
          scheduledDate.valueOf() > Date.now(),
        );
  const timingValid = Boolean(editingOrder && !timingChanged) || scheduledValid;
  const runMutation = (input: CreateOrderInput & {
    reason?: string; authorizerPin?: string; refunds?: UpdateDraftOrderInput["refunds"];
    reverseDeliverySettlement?: boolean; driverCashRemitted?: boolean;
  }) => {
    if (submitLock.current || mutation.isPending) return;
    submitLock.current = true;
    pendingRef.current = true;
    submittedOrderId.current = editingOrder?.id ?? null;
    onFormStateChange?.({ dirty: hasChangesRef.current, pending: true });
    mutation.mutate({ ...input, ...(editingOrder ? { orderId: editingOrder.id } : {}) });
  };
  const submit = () => {
    if (submitLock.current || mutation.isPending) return;
    if (!feeValid) {
      setError("Ingresá un costo de envío válido y no negativo.");
      return;
    }
    if (!timingValid) {
      setError(
        scheduleMode === "QUICK"
          ? "Ingresá una demora entera y positiva válida."
          : "Elegí una fecha y hora futuras válidas.",
      );
      return;
    }
    if (!name.trim() || !phone.trim()) {
      setError("Completá el nombre y el teléfono del cliente para continuar.");
      return;
    }
    if (selectedType === "DELIVERY" && !address.trim()) {
      setError("Ingresá la dirección del cliente para continuar.");
      return;
    }
    const promisedAt =
      editingOrder && !timingChanged
        ? editingOrder.promisedAt
        : scheduleMode === "SCHEDULED"
          ? scheduledDate.toISOString()
          : quickDate.toISOString();
    runMutation({
      type: selectedType,
      customerId,
      customerAddressId: selectedType === "DELIVERY" ? customerAddressId : null,
      customerName: name.trim(),
      customerPhone: phone.trim(),
      deliveryAddress:
        selectedType === "DELIVERY" ? address.trim() || null : null,
      deliveryFeeMinor: newFeeMinor,
      driverUserId: selectedType === "DELIVERY" ? driverUserId || null : null,
      promisedAt,
      scheduled: scheduleMode === "SCHEDULED",
      notes: notes || null,
      ...(isPaidEdit
        ? {
            reason: reason.trim(),
            authorizerPin,
            refunds,
            reverseDeliverySettlement,
            driverCashRemitted,
          }
        : {}),
    });
  };
  const customerValid = Boolean(
    name.trim() &&
    phone.trim() &&
    (selectedType !== "DELIVERY" || address.trim()),
  );
  const currentForm = JSON.stringify({
    selectedType,
    customerId,
    customerAddressId,
    name,
    phone,
    address,
    driverUserId,
    delay,
    scheduleMode,
    timingChanged,
    scheduledAt,
    fee,
    notes,
    reason,
    authorizerPin,
    reverseDeliverySettlement,
    driverCashRemitted,
    refundAmounts,
  });
  if (open && initialForm.current === null) initialForm.current = currentForm;
  const hasChanges = Boolean(
    initialForm.current && initialForm.current !== currentForm,
  );
  hasChangesRef.current = hasChanges;
  useEffect(() => {
    onFormStateChange?.({ dirty: hasChanges, pending: mutation.isPending || pendingRef.current });
  }, [hasChanges, mutation.isPending, onFormStateChange]);
  useEffect(() => {
    if (!inline || !open) return;
    const frame = window.requestAnimationFrame(() => {
      formRef.current?.querySelector<HTMLInputElement>('input[role="combobox"], input:not([type="hidden"]):not([disabled])')?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [inline, open, editingOrder?.id]);
  const cancel = () => {
    if (mutation.isPending || submitLock.current) return;
    if (
      hasChanges &&
      !window.confirm("Hay cambios sin guardar. ¿Querés cerrar igualmente?")
    )
      return;
    onClose();
  };

  const form = (
      <form
        ref={formRef}
        onSubmit={(event) => {
          event.preventDefault();
          if (timingValid) submit();
        }}
        className="grid gap-4"
      >
        <fieldset disabled={mutation.isPending} className="m-0 grid min-w-0 gap-4 border-0 p-0">
        <Field label="Modalidad del pedido">
          <Select
            value={selectedType}
            onChange={(event) =>
              setSelectedType(event.target.value as OrderType)
            }
          >
            <option value="TAKEAWAY">Para retirar</option>
            <option value="DELIVERY">Envío</option>
          </Select>
          <p className="mt-1 text-xs text-slate-600">
            Cambiar la modalidad conserva los datos ingresados y la fecha/hora.
          </p>
        </Field>
        {!editingOrder ? (
          <div className="text-xs text-slate-600">
            Podés comenzar por los productos y completar estos datos al
            confirmar.
          </div>
        ) : null}
        <OrderCustomerSelector
          open={open}
          type={selectedType}
          customerId={customerId}
          name={name}
          phone={phone}
          address={address}
          customerAddressId={customerAddressId}
          deliveryFee={fee}
          setName={setName}
          setPhone={setPhone}
          setAddress={setAddress}
          setCustomerId={setCustomerId}
          setCustomerAddressId={setCustomerAddressId}
          setDeliveryFee={setFee}
        />
        {selectedType === "DELIVERY" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Costo de envío"
              hint={
                editingOrder && paidTypeChanged
                  ? "Al cambiar la modalidad, este importe se aplica al pedido."
                  : "Si elegís un domicilio registrado, este valor se recuerda para próximos envíos."
              }
            >
              <Input
                value={fee}
                onChange={(event) => setFee(event.target.value)}
                inputMode="decimal"
              />
              {!feeValid ? (
                <span
                  role="alert"
                  className="text-xs font-medium text-rose-700"
                >
                  Ingresá un costo válido (vacío equivale a 0).
                </span>
              ) : null}
            </Field>
            <Field label="Repartidor">
              <Select
                value={driverUserId}
                onChange={(event) => setDriverUserId(event.target.value)}
              >
                <option value="">Asignar después</option>
                {drivers.map((driver) => (
                  <option key={driver.id} value={driver.id}>
                    {driver.fullName}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        ) : null}
        <Field label="Hora de entrega">
          <div className="mb-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                setTimingChanged(true);
                setScheduleMode("QUICK");
              }}
              className={cn(
                "h-9 rounded-lg text-xs font-bold",
                scheduleMode === "QUICK"
                  ? "bg-brand-700 text-white"
                  : "bg-slate-100 text-slate-600",
              )}
            >
              Demora rápida
            </button>
            <button
              type="button"
              onClick={() => {
                setTimingChanged(true);
                setScheduleMode("SCHEDULED");
              }}
              className={cn(
                "h-9 rounded-lg text-xs font-bold",
                scheduleMode === "SCHEDULED"
                  ? "bg-brand-700 text-white"
                  : "bg-slate-100 text-slate-600",
              )}
            >
              Fecha y hora
            </button>
          </div>
          {scheduleMode === "QUICK" ? (
            <>
              <div className="flex flex-wrap gap-2">
                {data.settings.quickDelayMinutes.map((minutes) => (
                  <button
                    type="button"
                    key={minutes}
                    onClick={() => {
                      setTimingChanged(true);
                      setDelay(String(minutes));
                    }}
                    className={cn(
                      "h-9 rounded-lg px-3 text-xs font-bold",
                      Number(delay) === minutes
                        ? "bg-brand-700 text-white"
                        : "bg-slate-100 text-slate-600",
                    )}
                  >
                    {minutes} min
                  </button>
                ))}
                <Input
                  className="w-20"
                  value={delay}
                  onChange={(event) => {
                    setTimingChanged(true);
                    setDelay(event.target.value);
                  }}
                  inputMode="numeric"
                />
              </div>
              <p className="text-xs font-bold text-brand-700">
                Hora de entrega:{" "}
                {Number.isFinite(quickDate.valueOf())
                  ? quickDate.toLocaleTimeString("es-AR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "—"}
              </p>
              {!scheduledValid ? (
                <p role="alert" className="text-xs font-medium text-rose-700">
                  Ingresá una demora entera y positiva válida.
                </p>
              ) : null}
            </>
          ) : (
            <>
              <Input
                type="datetime-local"
                min={toLocalDateTimeInput(new Date())}
                value={scheduledAt}
                onChange={(event) => {
                  setTimingChanged(true);
                  setScheduledAt(event.target.value);
                }}
                required
              />
              <p
                className={cn(
                  "mt-1 text-xs font-bold",
                  scheduledValid ? "text-brand-700" : "text-rose-700",
                )}
              >
                {scheduledValid
                  ? "Se mostrará como pedido programado."
                  : "Elegí una fecha y hora futuras."}
              </p>
            </>
          )}
        </Field>
        <Field label="Observaciones">
          <Textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Detalles para cocina o entrega"
          />
        </Field>
        {isPaidEdit ? (
          <div className="grid gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm font-bold text-amber-950">
              Cambio de pedido ya cobrado
            </p>
            {!paidTypeChanged ? (
              <p className="text-xs text-amber-900">
                Un pedido cobrado no admite guardar cambios de datos dentro de
                la misma modalidad. Cambiá entre retiro y envío para continuar.
              </p>
            ) : null}
            <p className="text-xs text-amber-900">
              Total actualizado: {formatMoney(previewTotalMinor)} · Cobrado:{" "}
              {formatMoney(editingOrder!.paidMinor)}
              {refundDueMinor > 0
                ? ` · Devolver: ${formatMoney(refundDueMinor)}`
                : previewTotalMinor > editingOrder!.paidMinor
                  ? ` · Quedará pendiente: ${formatMoney(previewTotalMinor - editingOrder!.paidMinor)}`
                  : ""}
              . Los precios de los productos no se modifican.
            </p>
            {refundDueMinor > 0 ? (
              <>
                <p className="text-xs text-amber-900">
                  Indicá cómo se devuelve la diferencia usando los pagos
                  originales. Cuenta corriente reduce deuda; efectivo y otros
                  medios requieren devolución efectiva.
                </p>
                {editingOrder!.type === "DELIVERY" &&
                editingOrder!.collectedByDriver ? (
                  <p className="text-xs font-semibold text-amber-950">
                    Este efectivo lo cobró el repartidor: la devolución al
                    cliente debe coordinarse físicamente con él y no se registra
                    como egreso de caja del negocio.
                  </p>
                ) : null}
                {refundLines.map((payment) => (
                  <Field
                    key={payment.id}
                    label={`${payment.methodName} · máximo ${formatMoney(payment.refundableMinor)}`}
                  >
                    <Input
                      inputMode="decimal"
                      value={refundAmounts[payment.id] ?? "0"}
                      onChange={(event) =>
                        setRefundAmounts((current) => ({
                          ...current,
                          [payment.id]: event.target.value,
                        }))
                      }
                    />
                  </Field>
                ))}
                <p
                  className={cn(
                    "text-xs font-bold",
                    refundsAllocatedMinor === refundDueMinor
                      ? "text-emerald-800"
                      : "text-rose-700",
                  )}
                >
                  Distribuido: {formatMoney(refundsAllocatedMinor)} de{" "}
                  {formatMoney(refundDueMinor)}
                </p>
              </>
            ) : null}
            {requiresSettlementReversal ? (
              <label className="flex items-start gap-2 text-xs text-amber-950">
                <input
                  type="checkbox"
                  checked={reverseDeliverySettlement}
                  onChange={(event) =>
                    setReverseDeliverySettlement(event.target.checked)
                  }
                />
                <span>
                  Confirmo que se recuperó físicamente el dinero del repartidor
                  (o se le devolvió el importe que el negocio le adeudaba). La
                  reversión financiera quedará registrada; no se debe confirmar
                  antes de realizar este movimiento real.
                </span>
              </label>
            ) : null}
            {requiresDriverCashRemittance ? (
              <label className="flex items-start gap-2 text-xs text-amber-950">
                <input
                  type="checkbox"
                  checked={driverCashRemitted}
                  onChange={(event) =>
                    setDriverCashRemitted(event.target.checked)
                  }
                />
                <span>
                  Confirmo que el efectivo del cliente retenido por el
                  repartidor fue entregado físicamente al negocio. El sistema no
                  registrará un ingreso ficticio en caja.
                </span>
              </label>
            ) : null}
            <Field label="Motivo del cambio (obligatorio)">
              <Textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Ej.: el cliente cambió de retiro a envío"
              />
            </Field>
            <Field label="PIN de autorización (obligatorio)">
              <Input
                type="password"
                inputMode="numeric"
                value={authorizerPin}
                onChange={(event) =>
                  setAuthorizerPin(event.target.value.replace(/\D/g, ""))
                }
                maxLength={8}
              />
            </Field>
          </div>
        ) : null}
        {error ? (
          <p
            role="alert"
            className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700"
          >
            {error}
          </p>
        ) : null}
        <div className={cn("flex flex-wrap justify-end gap-2", inline && "sticky bottom-0 z-10 border-t border-slate-200 bg-slate-50 py-3")}>
          <Button
            type="button"
            variant="secondary"
            onClick={cancel}
            disabled={mutation.isPending}
          >
            {inline ? "Volver a productos" : "Cancelar"}
          </Button>
          <Button
            type="submit"
            disabled={
              mutation.isPending ||
              !data.cashSession ||
              !feeValid ||
              !timingValid ||
              !customerValid ||
              (isPaidEdit && !paidTypeChanged) ||
              (isPaidEdit &&
                (!reason.trim() ||
                  authorizerPin.length < 4 ||
                  (requiresSettlementReversal && !reverseDeliverySettlement) ||
                  (requiresDriverCashRemittance && !driverCashRemitted))) ||
              (refundDueMinor > 0 &&
                (refundsAllocatedMinor !== refundDueMinor ||
                  !refundsWithinLimits))
            }
          >
            {mutation.isPending ? "Guardando…" : inline ? "Guardar datos" : editingOrder ? "Guardar y volver al pedido" : "Crear pedido"}
          </Button>
          {!editingOrder ? (
            <Button
              type="button"
              variant="secondary"
              disabled={
                mutation.isPending ||
                !data.cashSession ||
                !scheduledValid ||
                !feeValid
              }
              onClick={() =>
                runMutation({
                  type: selectedType,
                  customerId,
                  customerAddressId: selectedType === "DELIVERY" ? customerAddressId : null,
                  customerName: name.trim() || null,
                  customerPhone: phone.trim() || null,
                  deliveryAddress: selectedType === "DELIVERY" ? address.trim() || null : null,
                  deliveryFeeMinor: selectedType === "DELIVERY" ? newFeeMinor : 0,
                  driverUserId: selectedType === "DELIVERY" ? driverUserId || null : null,
                  promisedAt:
                    scheduleMode === "SCHEDULED"
                      ? scheduledDate.toISOString()
                      : quickDate.toISOString(),
                  scheduled: scheduleMode === "SCHEDULED",
                  notes: notes || null,
                })
              }
            >
              <ShoppingBag size={16} /> Cargar productos primero
            </Button>
          ) : null}
        </div>
        </fieldset>
      </form>
  );
  if (inline) return open ? (
    <section role="region" aria-label="Datos del cliente y envío">
      <h3 className="mb-1 text-sm font-bold">Cliente y envío</h3>
      <p className="mb-4 text-xs text-slate-600">El pedido y sus productos se conservan. Guardá los datos para seguir cargando o confirmar.</p>
      {form}
    </section>
  ) : null;
  return (
    <Modal
      open={open}
      onClose={onClose}
      closeDisabled={mutation.isPending}
      confirmClose={hasChanges && !mutation.isPending}
      title={editingOrder ? `Editar datos · ${typeLabels[selectedType]}` : `Nuevo ${typeLabels[selectedType]}`}
      description={editingOrder ? `Pedido #${editingOrder.number} · los productos cargados se conservan${editingOrder.printedAt ? " · reimprimí la comanda para reflejar los cambios" : ""}` : "Datos del cliente y de la entrega"}
    >
      {form}
    </Modal>
  );
}
