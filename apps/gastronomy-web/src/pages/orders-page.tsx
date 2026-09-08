import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type {
  BootstrapDto,
  CreateOrderInput,
  CustomerDto,
  OrderDto,
  OrderType,
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
        <div className="flex gap-2">
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
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
          <div className="relative min-w-[240px] flex-1">
            <MagnifyingGlass
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
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
          <div className="flex gap-1 overflow-x-auto">
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
                  "h-9 whitespace-nowrap rounded-lg px-3 text-[11px] font-bold",
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
        <div className="max-h-[calc(100vh-230px)] overflow-auto">
          {orders.length ? (
            <table className="dn-table">
              <thead>
                <tr>
                  <th>Pedido</th>
                  <th>Tipo</th>
                  <th>Cliente / destino</th>
                  <th>Hora de entrega</th>
                  <th>Estado</th>
                  <th>Pago</th>
                  <th className="text-right">Total</th>
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
                    <td className="text-right text-sm font-extrabold">
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
  const [scheduledAt, setScheduledAt] = useState("");
  const [fee, setFee] = useState("0");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const drivers = data.users.filter(
    (user) => user.roleCode === "DELIVERY_DRIVER" && user.active,
  );
  const mutation = useApiMutation(
    (input: CreateOrderInput) =>
      editingOrder
        ? window.gastronomy.updateDraftOrder({
            ...input,
            orderId: editingOrder.id,
          })
        : window.gastronomy.createOrder(input),
    { onSuccess: onSaved, onError: (value) => setError(humanError(value)) },
  );

  useEffect(() => {
    if (open) {
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
    }
  }, [
    data.settings.quickDelayMinutes,
    editingOrder,
    initialCustomer,
    open,
    type,
  ]);

  const submit = () => {
    if (!name.trim() || !phone.trim()) {
      setError("Completá el nombre y el teléfono del cliente para continuar.");
      return;
    }
    if (type === "DELIVERY" && !address.trim()) {
      setError("Ingresá la dirección del cliente para continuar.");
      return;
    }
    const promisedAt =
      scheduleMode === "SCHEDULED"
        ? new Date(scheduledAt).toISOString()
        : new Date(Date.now() + delay * 60_000).toISOString();
    mutation.mutate({
      type,
      customerId,
      customerAddressId,
      customerName: name.trim(),
      customerPhone: phone.trim(),
      deliveryAddress: address.trim() || null,
      deliveryFeeMinor: type === "DELIVERY" ? (parseMoneyInput(fee) ?? 0) : 0,
      driverUserId: type === "DELIVERY" ? driverUserId || null : null,
      promisedAt,
      scheduled: scheduleMode === "SCHEDULED",
      notes: notes || null,
    });
  };
  const scheduledValid =
    scheduleMode === "QUICK"
      ? delay > 0
      : Boolean(scheduledAt && new Date(scheduledAt).valueOf() > Date.now());
  const customerValid = Boolean(
    name.trim() && phone.trim() && (type !== "DELIVERY" || address.trim()),
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      closeDisabled={mutation.isPending}
      title={
        editingOrder
          ? `Editar datos · ${typeLabels[type]}`
          : `Nuevo ${typeLabels[type]}`
      }
      description={
        editingOrder
          ? `Borrador #${editingOrder.number} · los productos cargados se conservan`
          : "Carga rápida o pedido para una fecha y hora específicas"
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (scheduledValid) submit();
        }}
        className="grid gap-4"
      >
        <OrderCustomerSelector
          open={open}
          type={type}
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
        {type === "DELIVERY" ? (
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
              onClick={() => setScheduleMode("QUICK")}
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
              onClick={() => setScheduleMode("SCHEDULED")}
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
                    onClick={() => setDelay(minutes)}
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
                  onChange={(event) =>
                    setDelay(Number(event.target.value) || 0)
                  }
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
                onChange={(event) => setScheduledAt(event.target.value)}
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
              !scheduledValid ||
              !customerValid
            }
          >
            {editingOrder ? "Guardar y volver al pedido" : "Crear pedido"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
