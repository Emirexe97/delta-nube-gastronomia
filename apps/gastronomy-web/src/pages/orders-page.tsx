import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type {
  BootstrapDto,
  CreateOrderInput,
  CustomerDto,
  OrderDto,
  OrderType,
  UpdateDraftOrderInput,
} from "@gastronomy/contracts";
import {
  Clock,
  MagnifyingGlass,
  Motorcycle,
  Plus,
  ShoppingBag,
} from "@phosphor-icons/react";
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  Modal,
  Select,
  Textarea,
  cn,
} from "@gastronomy/ui";
import { useApiMutation } from "../api";
import { OrderEditor } from "../components/order-editor";
import { OrderCustomerSelector } from "../components/order-customer-selector";
import {
  formatMoney,
  formatTime,
  humanError,
  parseMoneyInput,
  paymentStatusLabels,
  promisedTiming,
  statusLabels,
  typeLabels,
} from "../lib";

export function OrdersPage({ data }: { data: BootstrapDto }) {
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<
    "ALL" | OrderType | "PENDING" | "PAID" | "OVERDUE" | "READY"
  >("ALL");
  const [query, setQuery] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<string | null>(null);
  const [newType, setNewType] = useState<OrderType | null>(null);
  const [initialCustomer, setInitialCustomer] = useState<CustomerDto | null>(
    null,
  );
  const [editingDraftOrderId, setEditingDraftOrderId] = useState<string | null>(
    null,
  );
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const value = params.get("nuevo");
    const customerId = params.get("cliente");
    const focusSearch = params.get("buscar") === "1";
    if (!value && !focusSearch && !customerId) return;
    const orderType =
      value === "TAKEAWAY" || value === "DELIVERY" ? value : null;
    if (customerId && orderType)
      void window.gastronomy
        .getCustomerProfile({ customerId, page: 1, pageSize: 1 })
        .then((profile) => {
          setInitialCustomer(profile.customer);
          setNewType(orderType);
        })
        .catch(() => setNewType(orderType));
    else if (orderType) setNewType(orderType);
    if (focusSearch)
      window.requestAnimationFrame(() => searchRef.current?.focus());
    const next = new URLSearchParams(params);
    next.delete("nuevo");
    next.delete("buscar");
    next.delete("cliente");
    setParams(next, { replace: true });
  }, [params, setParams]);
  const orders = useMemo(() => {
    const now = Date.now();
    const statusPriority: Record<OrderDto["operationalStatus"], number> = {
      READY: 0,
      OUT_FOR_DELIVERY: 1,
      IN_PREPARATION: 2,
      PENDING: 3,
      DELIVERED: 4,
      CANCELLED: 5,
    };
    return data.orders
      .filter((order) => {
        if (order.type === "DINE_IN") return false;
        const terminal = ["DELIVERED", "CANCELLED"].includes(
          order.operationalStatus,
        );
        if (filter === "PENDING" && terminal) return false;
        if (filter === "PAID" && order.paymentStatus !== "PAID") return false;
        if (
          filter === "OVERDUE" &&
          (terminal ||
            !order.promisedAt ||
            new Date(order.promisedAt).valueOf() > now)
        )
          return false;
        if (
          filter === "READY" &&
          !["READY", "OUT_FOR_DELIVERY"].includes(order.operationalStatus)
        )
          return false;
        if (
          ["DINE_IN", "TAKEAWAY", "DELIVERY"].includes(filter) &&
          order.type !== filter
        )
          return false;
        const haystack =
          `${order.number} ${order.customerNameSnapshot ?? ""} ${order.customerPhoneSnapshot ?? ""} ${order.deliveryAddressSnapshot ?? ""}`.toLocaleLowerCase(
            "es-AR",
          );
        return haystack.includes(query.toLocaleLowerCase("es-AR"));
      })
      .sort((left, right) => {
        const leftTerminal = ["DELIVERED", "CANCELLED"].includes(
          left.operationalStatus,
        );
        const rightTerminal = ["DELIVERED", "CANCELLED"].includes(
          right.operationalStatus,
        );
        if (leftTerminal !== rightTerminal) return leftTerminal ? 1 : -1;
        if (!leftTerminal) {
          const statusDifference =
            statusPriority[left.operationalStatus] -
            statusPriority[right.operationalStatus];
          if (statusDifference) return statusDifference;
          const promiseDifference =
            (left.promisedAt
              ? new Date(left.promisedAt).valueOf()
              : Number.POSITIVE_INFINITY) -
            (right.promisedAt
              ? new Date(right.promisedAt).valueOf()
              : Number.POSITIVE_INFINITY);
          if (promiseDifference) return promiseDifference;
        }
        return (
          new Date(right.createdAt).valueOf() -
          new Date(left.createdAt).valueOf()
        );
      });
  }, [data.orders, filter, query]);
  const editingDraftOrder = data.orders.find(
    (order) => order.id === editingDraftOrderId,
  );
  return (
    <div className="panel-enter mx-auto max-w-[1500px] space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold tracking-tight">
            Para retirar y envíos
          </h2>
          <p className="text-xs text-slate-400">
            Una sola bandeja operativa, estados y cobros separados
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => setNewType("TAKEAWAY")}
            disabled={!data.cashSession}
          >
            <ShoppingBag size={17} />
            F3 Para retirar
          </Button>
          <Button
            onClick={() => setNewType("DELIVERY")}
            disabled={!data.cashSession}
          >
            <Motorcycle size={17} />
            F4 Envío
          </Button>
        </div>
      </div>
      {!data.cashSession ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800">
          Abrí una caja antes de crear pedidos.
        </div>
      ) : null}
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-2.5 border-b border-slate-100 p-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="relative w-full min-w-0 flex-1 xl:max-w-xs">
            <MagnifyingGlass
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              size={16}
            />
            <Input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Pedido, cliente, teléfono o dirección"
              className="pl-9"
            />
          </div>
          <div className="flex min-w-0 max-w-full gap-1 overflow-x-auto pb-0.5">
            {(
              [
                ["ALL", "Todos"],
                ["TAKEAWAY", "Para retirar"],
                ["DELIVERY", "Envío"],
                ["PENDING", "Pendientes"],
                ["OVERDUE", "Atrasados"],
                ["READY", "Listos / reparto"],
                ["PAID", "Pagados"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setFilter(value)}
                className={cn(
                  "h-9 shrink-0 whitespace-nowrap rounded-lg px-3 text-[11px] font-bold transition",
                  filter === value
                    ? "bg-brand-600 text-white"
                    : "bg-slate-100 text-slate-500 hover:bg-slate-200",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="max-h-[calc(100vh-270px)] overflow-auto">
          {orders.length ? (
            <table className="dn-table min-w-[720px]">
              <thead>
                <tr>
                  <th className="whitespace-nowrap">Pedido</th>
                  <th className="whitespace-nowrap">Tipo</th>
                  <th className="min-w-[180px]">Cliente / destino</th>
                  <th className="whitespace-nowrap">Hora de entrega</th>
                  <th className="whitespace-nowrap">Estado</th>
                  <th className="whitespace-nowrap">Pago</th>
                  <th className="whitespace-nowrap text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr
                    key={order.id}
                    tabIndex={0}
                    onClick={() => setSelectedOrder(order.id)}
                    onKeyDown={(event) =>
                      event.key === "Enter" && setSelectedOrder(order.id)
                    }
                    className={cn(
                      "cursor-pointer",
                      !["DELIVERED", "CANCELLED"].includes(
                        order.operationalStatus,
                      ) && promisedTiming(order.promisedAt).tone === "rose"
                        ? "bg-rose-50/60"
                        : "",
                    )}
                  >
                    <td>
                      <span className="text-sm font-extrabold text-slate-950">
                        #{order.number}
                      </span>
                      <p className="text-[9px] text-slate-400">
                        {formatTime(order.createdAt)}
                      </p>
                    </td>
                    <td>
                      <Badge
                        tone={
                          order.type === "DELIVERY"
                            ? "blue"
                            : order.type === "TAKEAWAY"
                              ? "orange"
                              : "green"
                        }
                      >
                        {typeLabels[order.type]}
                      </Badge>
                    </td>
                    <td>
                      <p className="font-semibold text-slate-700">
                        {order.customerNameSnapshot ||
                          order.customerPhoneSnapshot ||
                          `Pedido #${order.number}`}
                      </p>
                      <p className="max-w-[260px] truncate text-[10px] text-slate-400">
                        {order.deliveryAddressSnapshot ||
                          order.customerPhoneSnapshot ||
                          "Sin observaciones"}
                      </p>
                    </td>
                    <td>
                      <div className="flex items-center gap-1 font-bold">
                        <Clock size={13} />
                        {formatTime(order.promisedAt)}
                        {order.scheduled ? (
                          <Badge tone="orange">Programado</Badge>
                        ) : null}
                      </div>
                      {!["DELIVERED", "CANCELLED"].includes(
                        order.operationalStatus,
                      ) ? (
                        <div className="mt-1">
                          <Badge tone={promisedTiming(order.promisedAt).tone}>
                            {promisedTiming(order.promisedAt).label}
                          </Badge>
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <Badge
                        tone={
                          order.operationalStatus === "CANCELLED"
                            ? "rose"
                            : order.operationalStatus === "DELIVERED"
                              ? "green"
                              : "amber"
                        }
                      >
                        {order.lifecycleStatus === "DRAFT"
                          ? "Borrador"
                          : statusLabels[order.operationalStatus]}
                      </Badge>
                    </td>
                    <td>
                      <Badge
                        tone={
                          order.paymentStatus === "PAID"
                            ? "green"
                            : order.paymentStatus === "PARTIALLY_PAID"
                              ? "amber"
                              : "slate"
                        }
                      >
                        {paymentStatusLabels[order.paymentStatus]}
                      </Badge>
                    </td>
                    <td className="whitespace-nowrap text-right text-sm font-extrabold">
                      {formatMoney(order.totalMinor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="grid h-64 place-items-center text-center">
              <div>
                <ShoppingBag size={36} className="mx-auto text-slate-300" />
                <p className="mt-2 text-sm font-semibold text-slate-500">
                  No hay pedidos para este filtro
                </p>
                <Button
                  className="mt-3"
                  onClick={() => setNewType("TAKEAWAY")}
                  disabled={!data.cashSession}
                >
                  <Plus />
                  Nuevo pedido
                </Button>
              </div>
            </div>
          )}
        </div>
      </Card>
      <NewOrderModal
        open={Boolean(newType || editingDraftOrder)}
        type={editingDraftOrder?.type ?? newType ?? "TAKEAWAY"}
        data={data}
        editingOrder={editingDraftOrder ?? null}
        initialCustomer={initialCustomer}
        onClose={() => {
          setNewType(null);
          setEditingDraftOrderId(null);
          setInitialCustomer(null);
        }}
        onSaved={(order) => {
          setNewType(null);
          setEditingDraftOrderId(null);
          setInitialCustomer(null);
          setSelectedOrder(order.id);
        }}
      />
      <OrderEditor
        data={data}
        orderId={selectedOrder}
        onClose={() => setSelectedOrder(null)}
        onEditDraft={(orderId) => {
          setSelectedOrder(null);
          setEditingDraftOrderId(orderId);
        }}
      />
    </div>
  );
}

function toLocalDateTimeInput(date: Date) {
  return new Date(date.valueOf() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

function NewOrderModal({
  open,
  type,
  data,
  editingOrder,
  initialCustomer,
  onClose,
  onSaved,
}: {
  open: boolean;
  type: OrderType;
  data: BootstrapDto;
  editingOrder: OrderDto | null;
  initialCustomer: CustomerDto | null;
  onClose(): void;
  onSaved(order: OrderDto): void;
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
  const [delay, setDelay] = useState(40);
  const [scheduleMode, setScheduleMode] = useState<"QUICK" | "SCHEDULED">(
    "QUICK",
  );
  const [timingChanged, setTimingChanged] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const [fee, setFee] = useState("0");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const initializedSession = useRef<string | null>(null);
  const drivers = data.users.filter(
    (user) => user.roleCode === "DELIVERY_DRIVER" && user.active,
  );
  const mutation = useApiMutation(
    (
      input: CreateOrderInput & {
        reason?: string;
        authorizerPin?: string;
        refunds?: UpdateDraftOrderInput["refunds"];
        reverseDeliverySettlement?: boolean;
        driverCashRemitted?: boolean;
      },
    ) =>
      editingOrder
        ? window.gastronomy.updateDraftOrder({
            ...input,
            orderId: editingOrder.id,
          })
        : window.gastronomy.createOrder(input),
    { onSuccess: onSaved, onError: (value) => setError(humanError(value)) },
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
      setDelay(initialDelay);
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
  const newFeeMinor =
    selectedType === "DELIVERY" ? (parseMoneyInput(fee) ?? 0) : 0;
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

  const submit = () => {
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
          ? new Date(scheduledAt).toISOString()
          : new Date(Date.now() + delay * 60_000).toISOString();
    mutation.mutate({
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
  const scheduledValid =
    scheduleMode === "QUICK"
      ? delay > 0
      : Boolean(scheduledAt && new Date(scheduledAt).valueOf() > Date.now());
  const timingValid = Boolean(editingOrder && !timingChanged) || scheduledValid;
  const customerValid = Boolean(
    name.trim() &&
    phone.trim() &&
    (selectedType !== "DELIVERY" || address.trim()),
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      closeDisabled={mutation.isPending}
      title={
        editingOrder
          ? `Editar datos · ${typeLabels[selectedType]}`
          : `Nuevo ${typeLabels[selectedType]}`
      }
      description={
        editingOrder
          ? `Pedido #${editingOrder.number} · los productos cargados se conservan${editingOrder.printedAt ? " · reimprimí la comanda para reflejar los cambios" : ""}`
          : "Carga rápida o pedido para una fecha y hora específicas"
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (timingValid) submit();
        }}
        className="grid gap-4"
      >
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
          <p className="mt-1 text-xs text-slate-500">
            Cambiar la modalidad conserva los datos ingresados y la fecha/hora.
          </p>
        </Field>
        {!editingOrder ? (
          <div className="rounded-xl border border-brand-200 bg-brand-50 p-3 text-sm text-brand-900">
            Podés comenzar por los productos. El cliente y, si es envío, su
            dirección serán obligatorios antes de confirmar.
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
            <Field label="Costo de envío">
              <Input
                value={fee}
                onChange={(event) => setFee(event.target.value)}
                inputMode="decimal"
              />
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
                  ? "bg-brand-600 text-white"
                  : "bg-slate-100 text-slate-500",
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
                  ? "bg-brand-600 text-white"
                  : "bg-slate-100 text-slate-500",
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
                      setDelay(minutes);
                    }}
                    className={cn(
                      "h-9 rounded-lg px-3 text-xs font-bold",
                      delay === minutes
                        ? "bg-brand-600 text-white"
                        : "bg-slate-100 text-slate-500",
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
                    setDelay(Number(event.target.value) || 0);
                  }}
                  inputMode="numeric"
                />
              </div>
              <p className="text-xs font-bold text-brand-700">
                Hora de entrega:{" "}
                {new Date(Date.now() + delay * 60_000).toLocaleTimeString(
                  "es-AR",
                  { hour: "2-digit", minute: "2-digit" },
                )}
              </p>
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
                  scheduledValid ? "text-brand-700" : "text-rose-600",
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
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={mutation.isPending}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            disabled={
              mutation.isPending ||
              !data.cashSession ||
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
            {editingOrder ? "Guardar y volver al pedido" : "Crear pedido"}
          </Button>
          {!editingOrder ? (
            <Button
              type="button"
              variant="secondary"
              disabled={
                mutation.isPending || !data.cashSession || !scheduledValid
              }
              onClick={() =>
                mutation.mutate({
                  type: selectedType,
                  customerId,
                  customerAddressId:
                    selectedType === "DELIVERY" ? customerAddressId : null,
                  customerName: name.trim() || null,
                  customerPhone: phone.trim() || null,
                  deliveryAddress:
                    selectedType === "DELIVERY" ? address.trim() || null : null,
                  deliveryFeeMinor:
                    selectedType === "DELIVERY"
                      ? (parseMoneyInput(fee) ?? 0)
                      : 0,
                  driverUserId:
                    selectedType === "DELIVERY" ? driverUserId || null : null,
                  promisedAt:
                    scheduleMode === "SCHEDULED"
                      ? new Date(scheduledAt).toISOString()
                      : new Date(Date.now() + delay * 60_000).toISOString(),
                  scheduled: scheduleMode === "SCHEDULED",
                  notes: notes || null,
                })
              }
            >
              <ShoppingBag size={16} /> Cargar productos primero
            </Button>
          ) : null}
        </div>
      </form>
    </Modal>
  );
}
