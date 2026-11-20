import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { catalogWindow } from "./catalog-window";
import { useSearchParams } from "react-router-dom";
import type {
  BootstrapDto,
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
  Input,
  cn,
  useWorkspaceActive,
} from "@gastronomy/ui";
import { NewOrderModal } from "../components/order-details-form";
export { NewOrderModal } from "../components/order-details-form";
import { OrderEditor } from "../components/order-editor";
import { WebOrdersInbox } from "./web-orders-inbox";
import {
  formatMoney,
  formatTime,
  paymentStatusLabels,
  promisedTiming,
  statusLabels,
  typeLabels,
} from "../lib";

export function OrdersPage({ data }: { data: BootstrapDto }) {
  const active = useWorkspaceActive();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<
    "ALL" | OrderType | "PENDING" | "PAID" | "OVERDUE" | "READY"
  >("ALL");
  const [query, setQuery] = useState("");
  const [ordersTab, setOrdersTab] = useState<"POS" | "WEB">("POS");
  const onOrdersTabKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
  ) => {
    const tabs = Array.from(
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
        '[role="tab"]',
      ) ?? [],
    );
    const index = tabs.indexOf(event.currentTarget);
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % tabs.length
        : event.key === "ArrowLeft"
          ? (index - 1 + tabs.length) % tabs.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? tabs.length - 1
              : -1;
    if (next >= 0) {
      event.preventDefault();
      tabs[next]?.focus();
      tabs[next]?.click();
    }
  };
  const [selectedOrder, setSelectedOrder] = useState<string | null>(null);
  const [restoreOrderId, setRestoreOrderId] = useState<string | null>(null);
  const [newType, setNewType] = useState<OrderType | null>(null);
  const [initialCustomer, setInitialCustomer] = useState<CustomerDto | null>(
    null,
  );
  const [editingDraftOrderId, setEditingDraftOrderId] = useState<string | null>(
    null,
  );
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!active) return;
    const value = params.get("nuevo");
    const customerId = params.get("cliente");
    const focusSearch = params.get("buscar") === "1";
    if (!value && !focusSearch && !customerId) return;
    // Returning via a shortcut must resume the pending entry, not replace its data.
    const hasPendingEntry = Boolean(
      newType || editingDraftOrderId || selectedOrder,
    );
    const orderType =
      value === "TAKEAWAY" || value === "DELIVERY" ? value : null;
    if (customerId && orderType && !hasPendingEntry)
      void window.gastronomy
        .getCustomerProfile({ customerId, page: 1, pageSize: 1 })
        .then((profile) => {
          setInitialCustomer(profile.customer);
          setNewType(orderType);
        })
        .catch(() => setNewType(orderType));
    else if (orderType && !hasPendingEntry) setNewType(orderType);
    if (focusSearch && !hasPendingEntry)
      window.requestAnimationFrame(() => searchRef.current?.focus());
    const next = new URLSearchParams(params);
    next.delete("nuevo");
    next.delete("buscar");
    next.delete("cliente");
    setParams(next, { replace: true });
  }, [active, params, setParams, newType, editingDraftOrderId, selectedOrder]);
  const index = useMemo(
    () =>
      data.orders
        .filter((o) => o.type !== "DINE_IN")
        .map((order) => ({
          order,
          terminal: ["DELIVERED", "CANCELLED"].includes(
            order.operationalStatus,
          ),
          priority: STATUS_PRIORITY[order.operationalStatus],
          promised: order.promisedAt ? Date.parse(order.promisedAt) : Infinity,
          created: Date.parse(order.createdAt),
          text: `${order.number} ${order.customerNameSnapshot ?? ""} ${order.customerPhoneSnapshot ?? ""} ${order.deliveryAddressSnapshot ?? ""}`.toLocaleLowerCase(
            "es-AR",
          ),
        }))
        .sort(
          (a, b) =>
            Number(a.terminal) - Number(b.terminal) ||
            (!a.terminal && !b.terminal
              ? a.priority - b.priority || a.promised - b.promised
              : 0) ||
            b.created - a.created,
        ),
    [data.orders],
  );
  const orders = useMemo(() => {
    const needle = query.toLocaleLowerCase("es-AR");
    const now = Date.now();
    return index
      .filter(
        ({ order, terminal, promised, text }) =>
          (filter !== "PENDING" || !terminal) &&
          (filter !== "PAID" || order.paymentStatus === "PAID") &&
          (filter !== "OVERDUE" || (!terminal && promised <= now)) &&
          (filter !== "READY" ||
            ["READY", "OUT_FOR_DELIVERY"].includes(order.operationalStatus)) &&
          (!["DINE_IN", "TAKEAWAY", "DELIVERY"].includes(filter) ||
            order.type === filter) &&
          text.includes(needle),
      )
      .map((entry) => entry.order);
  }, [index, filter, query]);
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
        <div
          className="flex gap-1 border-b border-slate-100 p-2"
          role="tablist"
          aria-label="Pedidos"
        >
          <button
            id="orders-tab-pos"
            aria-controls="orders-panel-pos"
            type="button"
            role="tab"
            aria-selected={ordersTab === "POS"}
            tabIndex={ordersTab === "POS" ? 0 : -1}
            onKeyDown={onOrdersTabKeyDown}
            onClick={() => setOrdersTab("POS")}
            className={cn(
              "rounded-lg px-3 py-2 text-xs font-bold",
              ordersTab === "POS"
                ? "bg-brand-700 text-white"
                : "bg-slate-100 text-slate-700",
            )}
          >
            Pedidos del local
          </button>
          <button
            id="orders-tab-web"
            aria-controls="orders-panel-web"
            type="button"
            role="tab"
            aria-selected={ordersTab === "WEB"}
            tabIndex={ordersTab === "WEB" ? 0 : -1}
            onKeyDown={onOrdersTabKeyDown}
            onClick={() => setOrdersTab("WEB")}
            className={cn(
              "rounded-lg px-3 py-2 text-xs font-bold",
              ordersTab === "WEB"
                ? "bg-brand-700 text-white"
                : "bg-slate-100 text-slate-700",
            )}
          >
            Pedidos web <WebOrdersInboxCount data={data} active={active} />
          </button>
        </div>
        {ordersTab === "WEB" ? (
          <div
            id="orders-panel-web"
            role="tabpanel"
            aria-labelledby="orders-tab-web"
          >
            <WebOrdersInbox data={data} active={active} />
          </div>
        ) : (
          <div
            id="orders-panel-pos"
            role="tabpanel"
            aria-labelledby="orders-tab-pos"
          >
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
                    aria-pressed={filter === value}
                    onClick={() => setFilter(value)}
                    className={cn(
                      "h-9 shrink-0 whitespace-nowrap rounded-lg px-3 text-xs font-bold transition",
                      filter === value
                        ? "bg-brand-700 text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              {orders.length ? (
                <VirtualizedOrdersTable
                  orders={orders}
                  onSelect={(orderId) => setSelectedOrder(orderId)}
                  restoreOrderId={restoreOrderId}
                  onRestored={() => setRestoreOrderId(null)}
                />
              ) : (
                <div className="grid h-64 place-items-center text-center">
                  <div>
                    <ShoppingBag size={36} className="mx-auto text-slate-300" />
                    <p className="mt-2 text-sm font-semibold text-slate-600">
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
          </div>
        )}
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
        onClose={() => {
          const id = selectedOrder;
          setSelectedOrder(null);
          if (id) setRestoreOrderId(id);
        }}
        onEditDraft={(orderId) => {
          setSelectedOrder(null);
          setEditingDraftOrderId(orderId);
        }}
      />
    </div>
  );
}

const STATUS_PRIORITY = {
  READY: 0,
  OUT_FOR_DELIVERY: 1,
  IN_PREPARATION: 2,
  PENDING: 3,
  DELIVERED: 4,
  CANCELLED: 5,
} as const;

function VirtualizedOrdersTable({
  orders,
  onSelect,
  restoreOrderId,
  onRestored,
}: {
  orders: OrderDto[];
  onSelect: (id: string) => void;
  restoreOrderId: string | null;
  onRestored: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(560);
  const heights = useRef(new Map<string, number>());
  const [revision, setRevision] = useState(0);
  const pendingFrame = useRef(0);
  const measure = useCallback((id: string, h: number) => {
    if (h <= 0 || heights.current.get(id) === h) return;
    heights.current.set(id, h);
    if (!pendingFrame.current)
      pendingFrame.current = requestAnimationFrame(() => {
        pendingFrame.current = 0;
        setRevision((r) => r + 1);
      });
  }, []);
  useLayoutEffect(() => {
    const node = scrollRef.current!;
    const resize = () => {
      if (node.clientHeight) setHeight(node.clientHeight);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(node);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(pendingFrame.current);
      pendingFrame.current = 0;
    };
  }, []);
  const offsets = useMemo(() => {
    const offsets = [0];
    for (const order of orders)
      offsets.push(
        offsets[offsets.length - 1]! + (heights.current.get(order.id) ?? 64),
      );
    return offsets;
  }, [orders, revision]);
  const indices = useMemo(
    () => new Map(orders.map((o, i) => [o.id, i])),
    [orders],
  );
  const [focused, setFocused] = useState<string | null>(null);
  const ownsFocus = useRef(false);
  const [requested, setRequested] = useState<string | null>(null);
  const win = catalogWindow(offsets, scrollTop, height);
  const focusedIndex = focused == null ? undefined : indices.get(focused);
  const rendered = new Set(
    Array.from({ length: win.end - win.start }, (_, i) => i + win.start),
  );
  // Keep at most one active row and a keyboard destination mounted even when
  // incoming orders move them out of the visible window.
  if (ownsFocus.current && focusedIndex !== undefined)
    rendered.add(focusedIndex);
  const destination = requested ?? restoreOrderId;
  const destIndex = destination ? indices.get(destination) : undefined;
  if (destIndex !== undefined) rendered.add(destIndex);
  const tabId =
    focusedIndex !== undefined && rendered.has(focusedIndex)
      ? focused
      : orders[win.start]?.id;
  const previousOrders = useRef(orders);
  useLayoutEffect(() => {
    const moved = previousOrders.current !== orders;
    previousOrders.current = orders;
    const node = scrollRef.current!;
    const active = document.activeElement;
    const id =
      destination ??
      (moved &&
      ownsFocus.current &&
      (active === document.body || node.contains(active))
        ? focused
        : null);
    if (!id) return;
    const row = Array.from(
      node.querySelectorAll<HTMLTableRowElement>("tr[data-order-id]"),
    ).find((r) => r.dataset.orderId === id);
    if (row) {
      row.focus({ preventScroll: true });
      const bounds = node.getBoundingClientRect(),
        box = row.getBoundingClientRect();
      const visibleTop =
        bounds.top +
        (row.closest("table")?.tHead?.getBoundingClientRect().height ?? 0);
      if (box.top < visibleTop) node.scrollTop += box.top - visibleTop;
      else if (box.bottom > bounds.bottom)
        node.scrollTop += box.bottom - bounds.bottom;
      setScrollTop(node.scrollTop);
    }
    if (requested) setRequested(null);
    if (restoreOrderId) onRestored();
  }, [orders, destination, focused, requested, restoreOrderId, onRestored]);
  const keyDown = (e: React.KeyboardEvent<HTMLTableRowElement>, id: string) => {
    const i = indices.get(id)!;
    const next =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? orders.length - 1
          : e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)
            ? i + 1
            : e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)
              ? i - 1
              : -1;
    if (next >= 0 && next < orders.length) {
      e.preventDefault();
      setRequested(orders[next]!.id);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(id);
    }
  };
  const spacer = (px: number) =>
    px > 0 ? (
      <tr aria-hidden="true">
        <td colSpan={7} style={{ height: px, padding: 0, border: 0 }} />
      </tr>
    ) : null;
  let last = 0;
  return (
    <div
      ref={scrollRef}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      onBlurCapture={(e) => {
        if (
          e.relatedTarget &&
          !e.currentTarget.contains(e.relatedTarget as Node)
        )
          ownsFocus.current = false;
      }}
      className="max-h-[calc(100vh-270px)] overflow-auto"
      role="region"
      aria-label="Lista de pedidos"
    >
      <table
        className="dn-table min-w-[720px]"
        aria-rowcount={orders.length + 1}
      >
        <thead>
          <tr>
            <th>Pedido</th>
            <th>Tipo</th>
            <th className="min-w-[180px]">Cliente / destino</th>
            <th>Hora de entrega</th>
            <th>Estado</th>
            <th>Pago</th>
            <th className="text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {[...rendered]
            .sort((a, b) => a - b)
            .map((i) => {
              const order = orders[i]!,
                gap = offsets[i]! - offsets[last]!;
              last = i + 1;
              return (
                <Fragment key={order.id}>
                  {spacer(gap)}
                  <VirtualOrderRow
                    order={order}
                    rowIndex={i + 2}
                    focused={tabId === order.id}
                    onSelect={onSelect}
                    onKeyDown={keyDown}
                    onMeasure={measure}
                    onFocus={() => {
                      ownsFocus.current = true;
                      setFocused(order.id);
                    }}
                  />
                </Fragment>
              );
            })}
          {spacer(offsets[orders.length]! - offsets[last]!)}
        </tbody>
      </table>
    </div>
  );
}

function VirtualOrderRow({
  order,
  rowIndex,
  focused,
  onSelect,
  onKeyDown,
  onMeasure,
  onFocus,
}: {
  order: OrderDto;
  rowIndex: number;
  focused: boolean;
  onSelect: (id: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTableRowElement>, id: string) => void;
  onMeasure: (id: string, height: number) => void;
  onFocus: () => void;
}) {
  const ref = useRef<HTMLTableRowElement>(null);
  useLayoutEffect(() => {
    const node = ref.current!;
    const record = () =>
      onMeasure(order.id, node.getBoundingClientRect().height);
    record();
    const ro = new ResizeObserver(record);
    ro.observe(node);
    return () => ro.disconnect();
  }, [order.id, onMeasure]);
  const timing = promisedTiming(order.promisedAt);
  return (
    <tr
      ref={ref}
      data-order-id={order.id}
      aria-rowindex={rowIndex}
      tabIndex={focused ? 0 : -1}
      onFocus={onFocus}
      onClick={() => onSelect(order.id)}
      onKeyDown={(e) => onKeyDown(e, order.id)}
      className={cn(
        "cursor-pointer",
        !["DELIVERED", "CANCELLED"].includes(order.operationalStatus) &&
          timing.tone === "rose" &&
          "bg-rose-50/60",
      )}
    >
      <td>
        <span className="text-sm font-extrabold text-slate-950">
          #{order.number}
        </span>
        <p className="text-xs text-slate-600">{formatTime(order.createdAt)}</p>
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
        <p className="max-w-[260px] truncate text-xs text-slate-600">
          {order.deliveryAddressSnapshot ||
            order.customerPhoneSnapshot ||
            "Sin observaciones"}
        </p>
      </td>
      <td>
        <div className="flex items-center gap-1 font-bold">
          <Clock size={13} />
          {formatTime(order.promisedAt)}
          {order.scheduled ? <Badge tone="orange">Programado</Badge> : null}
        </div>
        {!["DELIVERED", "CANCELLED"].includes(order.operationalStatus) ? (
          <div className="mt-1">
            <Badge tone={timing.tone}>{timing.label}</Badge>
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
  );
}

function WebOrdersInboxCount({
  data,
  active,
}: {
  data: BootstrapDto;
  active: boolean;
}) {
  const [count, setCount] = useState(0);
  const allowed = data.currentUser.permissions.includes("orders.edit");
  useEffect(() => {
    if (!allowed || !active) return;
    let live = true;
    const refresh = () =>
      window.gastronomy
        .listWebOrders()
        .then((orders) => {
          if (live)
            setCount(
              orders.filter((entry) => entry.status === "PENDING").length,
            );
        })
        .catch(() => undefined);
    void refresh();
    const timer = window.setInterval(refresh, 15_000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [allowed, active]);
  return (
    <span
      className="ml-1 rounded-full bg-white/20 px-1.5 py-0.5"
      aria-label={`${count} pedidos web pendientes`}
    >
      {count}
    </span>
  );
}
