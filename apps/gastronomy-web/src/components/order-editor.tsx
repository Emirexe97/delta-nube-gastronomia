import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  BootstrapDto,
  OrderDto,
  OrderOperationalStatus,
} from "@gastronomy/contracts";
import {
  Check,
  ArrowLeft,
  ArrowCounterClockwise,
  CookingPot,
  CreditCard,
  MagnifyingGlass,
  Motorcycle,
  Percent,
  Pizza,
  Plus,
  Printer,
  Trash,
  X,
} from "@phosphor-icons/react";
import {
  Badge,
  Button,
  Field,
  Input,
  Modal,
  Select,
  Textarea,
  cn,
} from "@gastronomy/ui";
import { useApiMutation } from "../api";
import { isDemoMode } from "../demo/install-demo";
import { guardOrderAction } from "@gastronomy/domain";
import {
  formatMoney,
  humanError,
  paymentStatusLabels,
  halfAndHalfLabels,
  parseMoneyInput,
  rankProducts,
  statusLabels,
  typeLabels,
} from "../lib";

export function OrderEditor({
  data,
  orderId,
  onClose,
  onEditDraft,
}: {
  data: BootstrapDto;
  orderId: string | null;
  onClose(): void;
  onEditDraft?(orderId: string): void;
}) {
  const order = data.orders.find((candidate) => candidate.id === orderId);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [completeOnPay, setCompleteOnPay] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [halfOpen, setHalfOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [modifierItemId, setModifierItemId] = useState<string | null>(null);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [discardError, setDiscardError] = useState<string | null>(null);
  const [driverOpen, setDriverOpen] = useState(false);
  const [driverUserId, setDriverUserId] = useState("");
  const [driverError, setDriverError] = useState<string | null>(null);
  const [printFeedback, setPrintFeedback] = useState<string | null>(null);
  const [printConfirmKind, setPrintConfirmKind] = useState<
    "KITCHEN_ORDER" | "CUSTOMER_BILL" | null
  >(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const addItemLockRef = useRef(false);
  useEffect(() => {
    if (orderId) window.setTimeout(() => searchRef.current?.focus(), 80);
  }, [orderId]);

  const products = useMemo(
    () => rankProducts(data.products, search, categoryId).slice(0, 30),
    [data.products, search, categoryId],
  );
  const addItem = useApiMutation(
    (input: { orderId: string; productId: string }) =>
      window.gastronomy.addOrderItem(input),
    {
      onError: (value) => setError(humanError(value)),
      onSettled: () => {
        addItemLockRef.current = false;
      },
    },
  );
  const addProduct = (productId: string) => {
    if (!order || addItemLockRef.current || addItem.isPending) return;
    addItemLockRef.current = true;
    setError(null);
    addItem.mutate({ orderId: order.id, productId });
  };
  const removeItem = useApiMutation(
    (input: { orderId: string; itemId: string }) =>
      window.gastronomy.removeOrderItem(input),
    { onError: (value) => setError(humanError(value)) },
  );
  const removeModifier = useApiMutation(
    (input: { orderId: string; modifierId: string }) =>
      window.gastronomy.removeOrderItemModifier(input),
    { onError: (value) => setError(humanError(value)) },
  );
  const updateStatus = useApiMutation(
    (input: { orderId: string; status: OrderOperationalStatus }) =>
      window.gastronomy.updateOrderStatus(input),
    { onError: (value) => setError(humanError(value)) },
  );
  const assignDriver = useApiMutation(
    (input: Parameters<typeof window.gastronomy.assignDeliveryDriver>[0]) =>
      window.gastronomy.assignDeliveryDriver(input),
    {
      onSuccess: () => {
        setDriverError(null);
        setDriverOpen(false);
      },
      onError: (value) => {
        const message = humanError(value);
        setDriverError(message);
        setError(message);
      },
    },
  );
  const confirm = useApiMutation(
    (input: { orderId: string }) => window.gastronomy.confirmOrder(input),
    { onError: (value) => setError(humanError(value)) },
  );
  const discard = useApiMutation(
    (input: { orderId: string }) => window.gastronomy.discardDraftOrder(input),
    {
      onSuccess: () => onClose(),
      onError: (value) => {
        const message = humanError(value);
        setDiscardError(message);
        setError(message);
      },
    },
  );
  const print = useApiMutation(
    async (input: {
      orderId: string;
      kind: "KITCHEN_ORDER" | "CUSTOMER_BILL";
      confirmFirst?: boolean;
    }) => {
      if (input.confirmFirst)
        await window.gastronomy.confirmOrder({ orderId: input.orderId });
      return window.gastronomy.printOrder({
        orderId: input.orderId,
        kind: input.kind,
      });
    },
    {
      onSuccess: (_result, input) => {
        const label = input.kind === "KITCHEN_ORDER" ? "Comanda" : "Cuenta";
        setPrintFeedback(
          isDemoMode
            ? `${label} simulada: se creó el trabajo, pero no fue enviada a una impresora.`
            : `${label} impresa/enviada según el resultado del dispositivo.`,
        );
        setPrintConfirmKind(null);
      },
      onError: (value) => setError(humanError(value)),
    },
  );
  const retryPrint = useApiMutation(
    (input: { jobId: string }) => window.gastronomy.retryPrint(input),
    {
      onSuccess: () => setError(null),
      onError: (value) => setError(humanError(value)),
    },
  );

  useEffect(() => {
    setPrintFeedback(null);
    setPrintConfirmKind(null);
  }, [orderId]);

  useEffect(() => {
    if (!orderId || !order) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "F8" || event.repeat) return;
      const nestedDialogOpen =
        payOpen ||
        refundOpen ||
        halfOpen ||
        cancelOpen ||
        discountOpen ||
        discardConfirmOpen ||
        driverOpen ||
        Boolean(modifierItemId);
      const canOpenPayment =
        order.lifecycleStatus !== "DRAFT" &&
        order.items.length > 0 &&
        order.paymentStatus !== "PAID" &&
        order.operationalStatus !== "CANCELLED";
      if (nestedDialogOpen || !canOpenPayment) return;
      event.preventDefault();
      setError(null);
      setCompleteOnPay(false);
      setPayOpen(true);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    cancelOpen,
    discardConfirmOpen,
    discountOpen,
    driverOpen,
    halfOpen,
    modifierItemId,
    order,
    orderId,
    payOpen,
    refundOpen,
  ]);

  if (!order) return null;
  const locked = ["DELIVERED", "CANCELLED"].includes(order.operationalStatus);
  const isDraft = order.lifecycleStatus === "DRAFT";
  const canConfirm = guardOrderAction(order, "CONFIRM");
  const canDeliver = guardOrderAction(order, "DELIVER");
  const pendingPrint = data.printJobs.find(
    (job) =>
      job.orderId === order.id &&
      ["FAILED", "QUEUED", "RECOVERING"].includes(job.status),
  );
  const printedKinds = new Set(
    data.printJobs
      .filter((job) => job.orderId === order.id && job.status === "PRINTED")
      .map((job) => job.kind),
  );
  const requestPrint = (kind: "KITCHEN_ORDER" | "CUSTOMER_BILL") => {
    if (print.isPending || pendingPrint) return;
    setPrintFeedback(null);
    setError(null);
    if (printedKinds.has(kind)) {
      setPrintConfirmKind(kind);
      return;
    }
    print.mutate({
      orderId: order.id,
      kind,
      confirmFirst: kind === "KITCHEN_ORDER" && isDraft,
    });
  };
  const confirmReprint = () => {
    if (!printConfirmKind) return;
    setPrintFeedback(null);
    setError(null);
    print.mutate({ orderId: order.id, kind: printConfirmKind });
  };
  const editorBusy =
    addItem.isPending ||
    removeItem.isPending ||
    removeModifier.isPending ||
    updateStatus.isPending ||
    assignDriver.isPending ||
    confirm.isPending ||
    discard.isPending ||
    print.isPending ||
    retryPrint.isPending;
  const advancedStatuses = data.settings.modules.advancedStatuses;
  const nextOperationalStatus: OrderOperationalStatus =
    advancedStatuses && order.operationalStatus === "IN_PREPARATION"
      ? "READY"
      : advancedStatuses &&
          order.type === "DELIVERY" &&
          order.operationalStatus === "READY"
        ? "OUT_FOR_DELIVERY"
        : "DELIVERED";
  const nextOperationalLabel =
    nextOperationalStatus === "READY"
      ? "Marcar listo"
      : nextOperationalStatus === "OUT_FOR_DELIVERY"
        ? "Iniciar reparto"
        : order.type === "DINE_IN"
          ? "Cerrar mesa"
          : "Entregar";
  return (
    <Modal
      open={Boolean(orderId)}
      onClose={onClose}
      closeDisabled={editorBusy}
      title={`Pedido #${order.number} · ${typeLabels[order.type]}`}
      description={
        order.tableNumber
          ? `Mesa ${order.tableNumber}`
          : order.customerNameSnapshot ||
            order.customerPhoneSnapshot ||
            "Carga rápida"
      }
      width="max-w-[1180px]"
    >
      <div className="order-editor-layout grid min-h-0 gap-4 lg:grid-cols-[1.35fr_.9fr]">
        <section className="flex min-h-0 min-w-0 flex-col rounded-xl border border-slate-200 bg-slate-50/70 p-3">
          <div className="relative">
            <MagnifyingGlass
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              size={17}
            />
            <Input
              ref={searchRef}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  products[0] &&
                  !locked &&
                  !addItem.isPending
                ) {
                  event.preventDefault();
                  addProduct(products[0].id);
                }
              }}
              placeholder="Código, nombre, categoría… · Enter agrega"
              className="bg-white pl-9"
              disabled={locked}
            />
          </div>
          <div className="mt-2 flex items-center gap-2 overflow-x-auto pb-1">
            <button
              onClick={() => setCategoryId(null)}
              className={cn(
                "min-h-10 whitespace-nowrap rounded-lg px-3 py-1.5 text-[11px] font-bold",
                !categoryId
                  ? "bg-brand-600 text-white"
                  : "bg-white text-slate-500",
              )}
            >
              Todos
            </button>
            {data.categories
              .filter((category) => category.active)
              .map((category) => (
                <button
                  key={category.id}
                  onClick={() => setCategoryId(category.id)}
                  className={cn(
                    "min-h-10 whitespace-nowrap rounded-lg border px-3 py-1.5 text-[11px] font-semibold",
                    categoryId === category.id
                      ? "border-brand-600 bg-brand-50 text-brand-700"
                      : "border-slate-200 bg-white text-slate-500 hover:border-brand-200 hover:text-brand-700",
                  )}
                >
                  {category.name}
                </button>
              ))}
          </div>
          <div className="mt-2 grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto pr-1 xl:grid-cols-3">
            {products.map((product) => {
              const code = order.type === "DINE_IN" ? "SALON" : order.type;
              const price = product.prices.find(
                (item) => item.priceListCode === code,
              )?.amountMinor;
              return (
                <button
                  key={product.id}
                  disabled={locked || addItem.isPending || price == null}
                  onClick={() => {
                    addProduct(product.id);
                  }}
                  className="focus-ring min-h-[76px] rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-brand-300 hover:shadow-sm disabled:opacity-50"
                >
                  <p className="line-clamp-2 text-[12px] font-bold text-slate-800">
                    {product.name}
                  </p>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">
                      {product.categoryName}
                    </span>
                    <span className="text-xs font-extrabold text-brand-700">
                      {price == null ? "Sin precio" : formatMoney(price)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
          <Button
            variant="secondary"
            className="mt-2 w-full"
            onClick={() => setHalfOpen(true)}
            disabled={locked || data.products.length < 2}
          >
            <Pizza size={17} /> Pizza mitad y mitad
          </Button>
        </section>
        <section className="flex min-h-0 min-w-0 flex-col rounded-xl border border-slate-200 bg-white">
          <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold">Detalle</h3>
                <Badge
                  tone={
                    order.operationalStatus === "CANCELLED"
                      ? "rose"
                      : order.operationalStatus === "DELIVERED"
                        ? "green"
                        : "amber"
                  }
                >
                  {isDraft ? "Borrador" : statusLabels[order.operationalStatus]}
                </Badge>
              </div>
              <p className="mt-1 text-[10px] text-slate-400">
                {order.items.length} línea(s) · versión autoguardada
              </p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className="text-xs font-bold text-slate-400">
                {paymentStatusLabels[order.paymentStatus]}
              </span>
              {order.type === "DELIVERY" && !locked ? (
                <button
                  type="button"
                  onClick={() => {
                    setDriverUserId(order.driverUserId ?? "");
                    setDriverError(null);
                    setDriverOpen(true);
                  }}
                  className="inline-flex items-center gap-1 text-[10px] font-bold text-brand-700 hover:underline"
                >
                  <Motorcycle size={12} />
                  {order.driverName ?? "Asignar repartidor"}
                </button>
              ) : null}
            </div>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {order.items.length ? (
              <div className="space-y-2">
                {order.items.map((item) => (
                  <article
                    key={item.id}
                    className="group rounded-xl border border-slate-100 bg-slate-50/70 p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[12px] font-bold">
                          <span className="mr-1 text-brand-700">
                            {item.quantity}×
                          </span>
                          {item.productNameSnapshot}
                        </p>
                        {item.halves.map((half) => (
                          <p
                            key={half.position}
                            className="ml-4 mt-0.5 text-[10px] font-semibold text-slate-500"
                          >
                            ½ {half.nameSnapshot}
                          </p>
                        ))}
                        {item.modifiers.map((modifier) => (
                          <button
                            key={modifier.id}
                            disabled={locked || removeModifier.isPending}
                            onClick={() =>
                              removeModifier.mutate({
                                orderId: order.id,
                                modifierId: modifier.id,
                              })
                            }
                            className="ml-4 mt-0.5 block text-left text-[10px] font-semibold text-brand-700 hover:text-rose-600"
                          >
                            + {modifier.nameSnapshot} ·{" "}
                            {modifier.scope === "FULL_PIZZA"
                              ? "completo"
                              : modifier.scope === "FIRST_HALF"
                                ? "1ª mitad"
                                : "2ª mitad"}{" "}
                            · {formatMoney(modifier.unitPriceMinorSnapshot)}{" "}
                            {!locked ? "×" : ""}
                          </button>
                        ))}
                        {item.notes ? (
                          <p className="ml-4 mt-1 text-[10px] text-amber-700">
                            {item.notes}
                          </p>
                        ) : null}
                        {!locked && data.modifiers.length ? (
                          <button
                            onClick={() => setModifierItemId(item.id)}
                            className="ml-2 mt-1 flex min-h-10 items-center gap-1 px-2 text-[10px] font-bold text-brand-600 hover:underline"
                          >
                            <Plus size={11} />
                            Agregar extra
                          </button>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="whitespace-nowrap text-xs font-extrabold">
                          {formatMoney(item.lineTotalMinor)}
                        </span>
                        {!locked ? (
                          <button
                            onClick={() =>
                              removeItem.mutate({
                                orderId: order.id,
                                itemId: item.id,
                              })
                            }
                            className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                            disabled={
                              removeItem.isPending ||
                              (!isDraft && order.items.length <= 1)
                            }
                            aria-label={`Quitar ${item.productNameSnapshot}`}
                            title={
                              !isDraft && order.items.length <= 1
                                ? "Un pedido confirmado no puede quedar vacío"
                                : "Quitar"
                            }
                          >
                            <Trash size={15} />
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="grid h-full min-h-40 place-items-center text-center">
                <div>
                  <CookingPot className="mx-auto text-slate-300" size={34} />
                  <p className="mt-2 text-xs font-semibold text-slate-500">
                    Agregá productos al pedido
                  </p>
                  <p className="text-[10px] text-slate-400">
                    Escribí para buscar · Enter selecciona
                  </p>
                </div>
              </div>
            )}
          </div>
          {pendingPrint ? (
            <div className="mx-3 mb-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-800">
              <div className="flex items-start justify-between gap-2">
                <span>
                  <b>Impresión pendiente:</b>{" "}
                  {pendingPrint.status === "RECOVERING"
                    ? "Se está reanudando este trabajo. Esperá el resultado antes de volver a imprimir."
                    : pendingPrint.status === "QUEUED"
                      ? "La aplicación se cerró antes de confirmar el resultado. Verificá primero si el ticket salió para evitar una copia duplicada."
                      : (pendingPrint.lastError ??
                        "La impresora no respondió.")}
                </span>
                <button
                  disabled={
                    retryPrint.isPending || pendingPrint.status === "RECOVERING"
                  }
                  onClick={() => retryPrint.mutate({ jobId: pendingPrint.id })}
                  className="shrink-0 rounded-md bg-amber-200 px-2 py-1 font-bold hover:bg-amber-300"
                >
                  {retryPrint.isPending || pendingPrint.status === "RECOVERING"
                    ? "Reintentando…"
                    : pendingPrint.status === "QUEUED"
                      ? "Reanudar"
                      : "Reintentar"}
                </button>
              </div>
            </div>
          ) : null}
          {error ? (
            <div className="mx-3 mb-2 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-2 text-[11px] text-rose-700">
              <X className="mt-0.5 shrink-0" />
              {error}
            </div>
          ) : null}
          {printFeedback ? (
            <div
              role="status"
              aria-live="polite"
              className="mx-3 mb-2 rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-[11px] text-emerald-800"
            >
              {printFeedback}
            </div>
          ) : null}
          <footer className="border-t border-slate-100 p-3">
            <div className="mb-3 flex items-end justify-between">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  Total
                </p>
                {order.discountMinor > 0 ? (
                  <p className="text-[10px] font-bold text-emerald-600">
                    Descuento −{formatMoney(order.discountMinor)}
                  </p>
                ) : null}
                <p className="text-2xl font-extrabold tracking-tight">
                  {formatMoney(order.totalMinor)}
                </p>
              </div>
              <p className="text-right text-[10px] text-slate-400">
                Pagado {formatMoney(order.paidMinor)}
                <br />
                Saldo{" "}
                {formatMoney(Math.max(0, order.totalMinor - order.paidMinor))}
              </p>
            </div>
            {order.payments.length ? (
              <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 p-2.5">
                <div className="mb-1.5 flex items-center justify-between">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                    Pagos registrados
                  </p>
                  {order.payments.some(
                    (payment) => payment.refundableMinor > 0,
                  ) ? (
                    <button
                      type="button"
                      onClick={() => setRefundOpen(true)}
                      className="inline-flex items-center gap-1 text-[10px] font-bold text-brand-700 hover:text-brand-900"
                    >
                      <ArrowCounterClockwise size={12} />
                      Devolver pago
                    </button>
                  ) : null}
                </div>
                <div className="space-y-1">
                  {order.payments.map((payment) => (
                    <div
                      key={payment.id}
                      className="flex items-center justify-between gap-2 text-[11px]"
                    >
                      <span className="text-slate-600">
                        {payment.methodName}
                        {payment.reference ? (
                          <span className="ml-1 text-slate-400">
                            · Ref. {payment.reference}
                          </span>
                        ) : null}
                        {payment.status === "REFUNDED" ? (
                          <strong className="ml-1.5 text-rose-600">
                            · Devuelto
                          </strong>
                        ) : payment.refundedMinor > 0 ? (
                          <strong className="ml-1.5 text-amber-600">
                            · Devolución parcial
                          </strong>
                        ) : null}
                      </span>
                      <span className="text-right font-bold text-slate-800">
                        {formatMoney(payment.amountMinor)}
                        {payment.refundedMinor > 0 &&
                        payment.refundableMinor > 0 ? (
                          <small className="block text-[9px] font-semibold text-amber-600">
                            Saldo {formatMoney(payment.refundableMinor)}
                          </small>
                        ) : null}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="order-action-grid grid grid-cols-2 gap-2">
              <Button
                variant="secondary"
                onClick={() => requestPrint("KITCHEN_ORDER")}
                disabled={
                  !order.items.length ||
                  print.isPending ||
                  Boolean(pendingPrint)
                }
              >
                <Printer size={16} />{" "}
                {print.isPending
                  ? "Enviando…"
                  : isDraft
                    ? "Confirmar e imprimir"
                    : printedKinds.has("KITCHEN_ORDER")
                      ? "Reimprimir comanda"
                      : "Comanda"}
              </Button>
              <Button
                variant="secondary"
                onClick={() => requestPrint("CUSTOMER_BILL")}
                disabled={
                  !order.items.length ||
                  isDraft ||
                  print.isPending ||
                  Boolean(pendingPrint)
                }
              >
                <Printer size={16} />{" "}
                {print.isPending
                  ? "Enviando…"
                  : printedKinds.has("CUSTOMER_BILL")
                    ? "Reimprimir cuenta"
                    : "Cuenta"}
              </Button>
              <Button
                onClick={() => {
                  setCompleteOnPay(false);
                  setPayOpen(true);
                }}
                disabled={
                  isDraft ||
                  !order.items.length ||
                  order.paymentStatus === "PAID" ||
                  order.operationalStatus === "CANCELLED"
                }
              >
                <CreditCard size={16} /> Cobrar{" "}
                <kbd className="text-[9px] opacity-70">F8</kbd>
              </Button>
              <Button
                variant="secondary"
                title={
                  nextOperationalStatus === "DELIVERED"
                    ? (canDeliver.reason ?? undefined)
                    : nextOperationalStatus === "OUT_FOR_DELIVERY" &&
                        !order.driverUserId
                      ? "Asigná un repartidor para continuar"
                      : undefined
                }
                onClick={() => {
                  if (
                    nextOperationalStatus === "OUT_FOR_DELIVERY" &&
                    !order.driverUserId
                  ) {
                    setDriverUserId("");
                    setDriverError(null);
                    setDriverOpen(true);
                    return;
                  }
                  if (
                    nextOperationalStatus === "DELIVERED" &&
                    canDeliver.suggestedAction === "OPEN_PAYMENT"
                  ) {
                    setCompleteOnPay(true);
                    setPayOpen(true);
                    return;
                  }
                  updateStatus.mutate({
                    orderId: order.id,
                    status: nextOperationalStatus,
                  });
                }}
                disabled={locked || isDraft || updateStatus.isPending}
              >
                <Check size={16} />{" "}
                {updateStatus.isPending
                  ? "Actualizando…"
                  : nextOperationalLabel}
              </Button>
            </div>
            {isDraft ? (
              <div className="mt-2 grid grid-cols-2 gap-2">
                {order.type !== "DINE_IN" && onEditDraft ? (
                  <Button
                    variant="secondary"
                    className="col-span-2"
                    onClick={() => onEditDraft(order.id)}
                  >
                    <ArrowLeft size={16} />
                    Volver a datos del cliente y envío
                  </Button>
                ) : null}
                <Button
                  disabled={!canConfirm.allowed || confirm.isPending}
                  title={canConfirm.reason ?? undefined}
                  onClick={() => confirm.mutate({ orderId: order.id })}
                >
                  <Check size={16} />
                  Confirmar pedido
                </Button>
                <Button
                  variant="danger"
                  disabled={discard.isPending}
                  onClick={() => {
                    setDiscardError(null);
                    if (order.items.length) {
                      setDiscardConfirmOpen(true);
                      return;
                    }
                    discard.mutate({ orderId: order.id });
                  }}
                >
                  <Trash size={16} />
                  Descartar borrador
                </Button>
              </div>
            ) : null}
            {!locked && order.items.length ? (
              <Button
                variant="secondary"
                className="mt-2 w-full"
                onClick={() => setDiscountOpen(true)}
              >
                <Percent size={15} />
                Aplicar descuento
              </Button>
            ) : null}
            {!locked && !isDraft ? (
              <button
                onClick={() => setCancelOpen(true)}
                className="mt-2 w-full py-1.5 text-[10px] font-bold text-rose-500 hover:text-rose-700"
              >
                Cancelar pedido
              </button>
            ) : null}
          </footer>
        </section>
      </div>
      <HalfAndHalfModal
        open={halfOpen}
        order={order}
        data={data}
        onClose={() => setHalfOpen(false)}
        onError={setError}
      />
      <ModifierModal
        open={Boolean(modifierItemId)}
        itemId={modifierItemId}
        order={order}
        data={data}
        onClose={() => setModifierItemId(null)}
        onError={setError}
      />
      <DiscountModal
        open={discountOpen}
        order={order}
        onClose={() => setDiscountOpen(false)}
        onError={setError}
      />
      <PaymentModal
        open={payOpen}
        order={order}
        data={data}
        onClose={() => setPayOpen(false)}
        onError={setError}
        completeOnPay={completeOnPay}
      />
      <RefundPaymentModal
        open={refundOpen}
        order={order}
        onClose={() => setRefundOpen(false)}
        onError={setError}
      />
      <CancelModal
        open={cancelOpen}
        order={order}
        onClose={() => setCancelOpen(false)}
        onCancelled={onClose}
        onError={setError}
      />
      <Modal
        open={driverOpen}
        onClose={() => setDriverOpen(false)}
        closeDisabled={assignDriver.isPending}
        title="Asignar repartidor"
        description={`Pedido #${order.number} · se puede corregir hasta finalizar la entrega`}
      >
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!driverUserId || assignDriver.isPending) return;
            assignDriver.mutate({
              orderId: order.id,
              driverUserId,
            });
          }}
        >
          <Field label="Repartidor activo">
            <Select
              autoFocus
              value={driverUserId}
              onChange={(event) => {
                setDriverUserId(event.target.value);
                setDriverError(null);
              }}
            >
              <option value="">Seleccionar repartidor</option>
              {data.users
                .filter(
                  (user) => user.active && user.roleCode === "DELIVERY_DRIVER",
                )
                .map((driver) => (
                  <option key={driver.id} value={driver.id}>
                    {driver.fullName}
                  </option>
                ))}
            </Select>
          </Field>
          {driverError ? (
            <p
              role="alert"
              className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700"
            >
              {driverError}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setDriverOpen(false)}
              disabled={assignDriver.isPending}
            >
              Volver
            </Button>
            <Button
              type="submit"
              disabled={!driverUserId || assignDriver.isPending}
            >
              <Motorcycle size={16} />
              {assignDriver.isPending ? "Asignando…" : "Guardar repartidor"}
            </Button>
          </div>
        </form>
      </Modal>
      <Modal
        open={discardConfirmOpen}
        onClose={() => setDiscardConfirmOpen(false)}
        closeDisabled={discard.isPending}
        title="Descartar borrador"
        description="Esta acción elimina el borrador y los productos cargados"
      >
        <div className="grid gap-4">
          <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-800">
            El pedido #{order.number} tiene {order.items.length} línea(s). No se
            podrá recuperar después de descartarlo.
          </p>
          {discardError ? (
            <p
              role="alert"
              className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700"
            >
              {discardError}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setDiscardConfirmOpen(false)}
              disabled={discard.isPending}
            >
              Conservar borrador
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={() => discard.mutate({ orderId: order.id })}
              disabled={discard.isPending}
            >
              <Trash size={16} />
              {discard.isPending ? "Descartando…" : "Descartar definitivamente"}
            </Button>
          </div>
        </div>
      </Modal>
      <Modal
        open={Boolean(printConfirmKind)}
        onClose={() => setPrintConfirmKind(null)}
        closeDisabled={print.isPending}
        title="Confirmar reimpresión"
        description="Se creará un nuevo trabajo de impresión"
      >
        <div className="grid gap-4">
          <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900">
            Ya se imprimió esta{" "}
            {printConfirmKind === "KITCHEN_ORDER" ? "comanda" : "cuenta"}.
            ¿Querés crear otra copia?
          </p>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setPrintConfirmKind(null)}
              disabled={print.isPending}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={confirmReprint}
              disabled={!printConfirmKind || print.isPending}
            >
              {print.isPending ? "Enviando…" : "Reimprimir"}
            </Button>
          </div>
        </div>
      </Modal>
    </Modal>
  );
}

function RefundPaymentModal({
  open,
  order,
  onClose,
  onError,
}: {
  open: boolean;
  order: OrderDto;
  onClose(): void;
  onError(value: string): void;
}) {
  const refundable = order.payments.filter(
    (payment) => payment.refundableMinor > 0,
  );
  const [paymentId, setPaymentId] = useState("");
  const [reason, setReason] = useState("");
  const [pin, setPin] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setPaymentId(refundable[0]?.id ?? "");
      setReason("");
      setPin("");
      setLocalError(null);
    }
  }, [open, order.id]);
  const selected = refundable.find((payment) => payment.id === paymentId);
  const mutation = useApiMutation(
    (input: Parameters<typeof window.gastronomy.refundPayment>[0]) =>
      window.gastronomy.refundPayment(input),
    {
      onSuccess: () => onClose(),
      onError: (value) => {
        const message = humanError(value);
        setLocalError(message);
        onError(message);
      },
    },
  );
  return (
    <Modal
      open={open}
      onClose={onClose}
      closeDisabled={mutation.isPending}
      title="Devolver o anular pago"
      description="Se revierte la línea completa, se corrige la caja y queda una auditoría"
    >
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          const submittedPaymentId = String(formData.get("paymentId") ?? "");
          const submittedReason = String(formData.get("reason") ?? "").trim();
          const submittedPin = String(formData.get("authorizerPin") ?? "");
          if (
            !submittedPaymentId ||
            !submittedReason ||
            submittedPin.length < 4 ||
            mutation.isPending
          ) {
            setLocalError(
              "Completá el pago, el motivo y el PIN para continuar.",
            );
            return;
          }
          mutation.mutate({
            orderId: order.id,
            paymentId: submittedPaymentId,
            reason: submittedReason,
            authorizerPin: submittedPin,
          });
        }}
      >
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          La venta no se elimina. Si querés cancelar el pedido, primero devolvé
          todos sus pagos.
        </div>
        <Field label="Pago a devolver">
          <Select
            autoFocus
            name="paymentId"
            value={paymentId}
            onChange={(event) => setPaymentId(event.target.value)}
          >
            {refundable.map((payment) => (
              <option key={payment.id} value={payment.id}>
                {payment.methodName} · {formatMoney(payment.refundableMinor)}
              </option>
            ))}
          </Select>
        </Field>
        {selected ? (
          <div className="flex items-center justify-between rounded-xl bg-slate-950 p-4 text-white">
            <span className="text-xs font-semibold text-slate-300">
              Importe a devolver
            </span>
            <strong className="text-xl">
              {formatMoney(selected.refundableMinor)}
            </strong>
          </div>
        ) : null}
        <Field label="Motivo">
          <Textarea
            name="reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Ej.: cobro duplicado o cambio de medio de pago"
          />
        </Field>
        <Field label="PIN de autorización">
          <Input
            name="authorizerPin"
            type="password"
            inputMode="numeric"
            maxLength={8}
            value={pin}
            onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
            placeholder="••••"
          />
        </Field>
        {localError ? (
          <p
            role="alert"
            className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700"
          >
            {localError}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={mutation.isPending}
          >
            Volver
          </Button>
          <Button type="submit" variant="danger" disabled={mutation.isPending}>
            <ArrowCounterClockwise size={16} />
            {mutation.isPending ? "Devolviendo…" : "Confirmar devolución"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ModifierModal({
  open,
  itemId,
  order,
  data,
  onClose,
  onError,
}: {
  open: boolean;
  itemId: string | null;
  order: OrderDto;
  data: BootstrapDto;
  onClose(): void;
  onError(value: string): void;
}) {
  const [modifierId, setModifierId] = useState("");
  const [scope, setScope] = useState<
    "FULL_PIZZA" | "FIRST_HALF" | "SECOND_HALF"
  >("FULL_PIZZA");
  const [localError, setLocalError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setModifierId("");
    setScope("FULL_PIZZA");
    setLocalError(null);
  }, [open, itemId]);
  const mutation = useApiMutation(
    (input: Parameters<typeof window.gastronomy.addOrderItemModifier>[0]) =>
      window.gastronomy.addOrderItemModifier(input),
    {
      onSuccess: () => onClose(),
      onError: (value) => {
        const message = humanError(value);
        setLocalError(message);
        onError(message);
      },
    },
  );
  return (
    <Modal
      open={open}
      onClose={onClose}
      closeDisabled={mutation.isPending}
      title="Agregar modificador"
      description="El precio también queda guardado como snapshot"
    >
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!itemId || !modifierId || mutation.isPending) return;
          mutation.mutate({
            orderId: order.id,
            itemId,
            modifierId,
            scope,
          });
        }}
      >
        <Field label="Extra">
          <Select
            value={modifierId}
            onChange={(event) => {
              setModifierId(event.target.value);
              setLocalError(null);
            }}
          >
            <option value="">Seleccionar</option>
            {data.modifiers
              .filter((item) => item.active)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.groupName} · {item.name} ·{" "}
                  {formatMoney(item.priceMinor)}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Aplicación">
          <Select
            value={scope}
            onChange={(event) => setScope(event.target.value as typeof scope)}
          >
            <option value="FULL_PIZZA">Producto completo</option>
            <option value="FIRST_HALF">Primera mitad</option>
            <option value="SECOND_HALF">Segunda mitad</option>
          </Select>
        </Field>
        {localError ? (
          <p
            role="alert"
            className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700"
          >
            {localError}
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
            disabled={!itemId || !modifierId || mutation.isPending}
          >
            Agregar
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function DiscountModal({
  open,
  order,
  onClose,
  onError,
}: {
  open: boolean;
  order: OrderDto;
  onClose(): void;
  onError(value: string): void;
}) {
  const [mode, setMode] = useState<"PERCENTAGE" | "FIXED">("PERCENTAGE");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [pin, setPin] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setMode("PERCENTAGE");
    setValue("");
    setReason("");
    setPin("");
    setLocalError(null);
  }, [open, order.id]);
  const mutation = useApiMutation(
    (input: Parameters<typeof window.gastronomy.applyOrderDiscount>[0]) =>
      window.gastronomy.applyOrderDiscount(input),
    {
      onSuccess: () => onClose(),
      onError: (error) => {
        const message = humanError(error);
        setLocalError(message);
        onError(message);
      },
    },
  );
  const parsed =
    mode === "FIXED" ? parseMoneyInput(value) : Number(value.replace(",", "."));
  return (
    <Modal
      open={open}
      onClose={onClose}
      closeDisabled={mutation.isPending}
      title="Aplicar descuento"
      description="Requiere autorización y queda auditado"
    >
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (
            parsed == null ||
            !Number.isFinite(parsed) ||
            parsed <= 0 ||
            !reason.trim() ||
            pin.length < 4 ||
            mutation.isPending
          )
            return;
          mutation.mutate({
            orderId: order.id,
            mode,
            value: parsed,
            reason,
            authorizerPin: pin,
          });
        }}
      >
        <Field label="Tipo">
          <Select
            value={mode}
            onChange={(event) => setMode(event.target.value as typeof mode)}
          >
            <option value="PERCENTAGE">Porcentaje</option>
            <option value="FIXED">Importe fijo</option>
          </Select>
        </Field>
        <Field label={mode === "PERCENTAGE" ? "Porcentaje" : "Importe"}>
          <Input
            autoFocus
            inputMode="decimal"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setLocalError(null);
            }}
          />
        </Field>
        <Field label="Motivo">
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Promoción o atención comercial"
          />
        </Field>
        <Field label="PIN de autorización">
          <Input
            type="password"
            inputMode="numeric"
            maxLength={8}
            value={pin}
            onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
          />
        </Field>
        {localError ? (
          <p
            role="alert"
            className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700"
          >
            {localError}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={mutation.isPending}
          >
            Volver
          </Button>
          <Button
            type="submit"
            disabled={
              parsed == null ||
              !Number.isFinite(parsed) ||
              parsed <= 0 ||
              !reason.trim() ||
              pin.length < 4 ||
              mutation.isPending
            }
          >
            <Percent />
            Aplicar
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function HalfAndHalfModal({
  open,
  order,
  data,
  onClose,
  onError,
}: {
  open: boolean;
  order: OrderDto;
  data: BootstrapDto;
  onClose(): void;
  onError(value: string): void;
}) {
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setFirst("");
    setSecond("");
    setLocalError(null);
  }, [open, order.id]);
  const mutation = useApiMutation(
    (input: {
      orderId: string;
      firstProductId: string;
      secondProductId: string;
    }) => window.gastronomy.addHalfAndHalfItem(input),
    {
      onSuccess: () => onClose(),
      onError: (value) => {
        const message = humanError(value);
        setLocalError(message);
        onError(message);
      },
    },
  );
  const pizzas = data.products.filter((product) =>
    product.categoryName.toLocaleLowerCase().includes("pizza"),
  );
  return (
    <Modal
      open={open}
      onClose={onClose}
      closeDisabled={mutation.isPending}
      title="Pizza mitad y mitad"
      description={`Regla: ${halfAndHalfLabels[data.settings.halfAndHalfPricingMode]}`}
    >
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!first || !second || mutation.isPending) return;
          mutation.mutate({
            orderId: order.id,
            firstProductId: first,
            secondProductId: second,
          });
        }}
      >
        <Field label="Primera mitad">
          <Select
            autoFocus
            value={first}
            onChange={(event) => {
              setFirst(event.target.value);
              setLocalError(null);
            }}
          >
            <option value="">Seleccionar variedad</option>
            {pizzas.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Segunda mitad">
          <Select
            value={second}
            onChange={(event) => setSecond(event.target.value)}
          >
            <option value="">Seleccionar variedad</option>
            {pizzas.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </Select>
        </Field>
        {localError ? (
          <p
            role="alert"
            className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700"
          >
            {localError}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={mutation.isPending}
          >
            Volver
          </Button>
          <Button
            type="submit"
            disabled={!first || !second || mutation.isPending}
          >
            <Pizza size={16} />
            Agregar
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function PaymentModal({
  open,
  order,
  data,
  onClose,
  onError,
  completeOnPay,
}: {
  open: boolean;
  order: OrderDto;
  data: BootstrapDto;
  onClose(): void;
  onError(value: string): void;
  completeOnPay: boolean;
}) {
  const remaining = Math.max(0, order.totalMinor - order.paidMinor);
  const [values, setValues] = useState<Record<string, string>>({});
  const [references, setReferences] = useState<Record<string, string>>({});
  const [received, setReceived] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const firstPaymentInputRef = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    if (!open) {
      setInitialized(false);
      return;
    }
    const exact = String(remaining / 100);
    setValues({ CASH: exact });
    setReferences({});
    setReceived(exact);
    setLocalError(null);
    setInitialized(true);
    const focusFrame = window.requestAnimationFrame(() =>
      firstPaymentInputRef.current?.focus(),
    );
    return () => window.cancelAnimationFrame(focusFrame);
  }, [open, remaining]);
  const mutation = useApiMutation(
    (input: Parameters<typeof window.gastronomy.payOrder>[0]) => {
      const collectedByDriver =
        order.type === "DELIVERY" &&
        input.payments.some(
          (payment) => payment.methodCode === "CASH" && payment.amountMinor > 0,
        );
      return completeOnPay
        ? window.gastronomy.completeOrder({
            ...input,
            finalStatus: "DELIVERED",
            collectedByDriver,
          })
        : window.gastronomy.payOrder(input);
    },
    {
      onSuccess: () => onClose(),
      onError: (value) => {
        const message = humanError(value);
        setLocalError(message);
        onError(message);
      },
    },
  );
  const receivedMinor = parseMoneyInput(received) ?? 0;
  const payments = data.paymentMethods
    .map((method) => {
      const amountMinor = parseMoneyInput(values[method.code] ?? "") ?? 0;
      return {
        methodCode: method.code,
        amountMinor,
        ...(method.code !== "CASH"
          ? { reference: references[method.code]?.trim() || null }
          : {}),
        ...(method.code === "CASH" ? { receivedMinor } : {}),
      };
    })
    .filter((item) => item.amountMinor > 0);
  const allocated = payments.reduce((sum, item) => sum + item.amountMinor, 0);
  const cashAmount =
    payments.find((item) => item.methodCode === "CASH")?.amountMinor ?? 0;
  const change = cashAmount > 0 ? receivedMinor - cashAmount : 0;
  const cashValid = cashAmount === 0 || receivedMinor >= cashAmount;
  const submitPayment = () => {
    if (
      !initialized ||
      allocated !== remaining ||
      !cashValid ||
      mutation.isPending
    )
      return;
    mutation.mutate({ orderId: order.id, payments });
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      closeDisabled={mutation.isPending}
      title={
        completeOnPay
          ? order.type === "DINE_IN"
            ? "Cobrar y cerrar mesa"
            : "Cobrar y entregar"
          : "Cobrar pedido"
      }
      description={
        completeOnPay
          ? "El cobro y el cierre se guardan como una única operación"
          : "Podés combinar medios y calcular el vuelto"
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submitPayment();
        }}
      >
        <div className="rounded-xl bg-slate-950 p-4 text-white">
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
            Saldo a cobrar
          </p>
          <p className="text-3xl font-extrabold">{formatMoney(remaining)}</p>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {data.paymentMethods
            .filter((method) => method.active)
            .map((method, index) => (
              <div key={method.code} className="space-y-2">
                <Field label={method.name}>
                  <Input
                    ref={index === 0 ? firstPaymentInputRef : undefined}
                    inputMode="decimal"
                    value={values[method.code] ?? ""}
                    onChange={(event) => {
                      setLocalError(null);
                      setValues((current) => ({
                        ...current,
                        [method.code]: event.target.value,
                      }));
                    }}
                    placeholder="0"
                  />
                </Field>
                {method.code === "TRANSFER" &&
                (parseMoneyInput(values[method.code] ?? "") ?? 0) > 0 ? (
                  <Field label="Referencia / comprobante">
                    <Input
                      value={references[method.code] ?? ""}
                      onChange={(event) =>
                        setReferences((current) => ({
                          ...current,
                          [method.code]: event.target.value,
                        }))
                      }
                      placeholder="Opcional"
                    />
                  </Field>
                ) : null}
              </div>
            ))}
        </div>
        {cashAmount > 0 ? (
          <div className="mt-3 grid gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 sm:grid-cols-2">
            <Field label="Efectivo recibido">
              <Input
                inputMode="decimal"
                value={received}
                onChange={(event) => {
                  setReceived(event.target.value);
                  setLocalError(null);
                }}
              />
            </Field>
            <div className="flex items-center justify-between rounded-lg bg-white px-3">
              <span className="text-xs font-bold text-slate-500">Vuelto</span>
              <span
                className={cn(
                  "text-lg font-extrabold",
                  cashValid ? "text-emerald-700" : "text-rose-600",
                )}
              >
                {cashValid ? formatMoney(change) : "Efectivo insuficiente"}
              </span>
            </div>
          </div>
        ) : null}
        <div
          className={cn(
            "mt-4 flex items-center justify-between rounded-lg p-3 text-xs font-bold",
            allocated === remaining && cashValid
              ? "bg-emerald-50 text-emerald-700"
              : "bg-amber-50 text-amber-700",
          )}
        >
          <span>Asignado</span>
          <span>
            {formatMoney(allocated)} / {formatMoney(remaining)}
          </span>
        </div>
        {localError ? (
          <p
            role="alert"
            className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700"
          >
            {localError}
          </p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
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
              !initialized ||
              allocated !== remaining ||
              !cashValid ||
              mutation.isPending
            }
          >
            <CreditCard size={16} />
            {completeOnPay
              ? order.type === "DINE_IN"
                ? "Cobrar y cerrar"
                : "Cobrar y entregar"
              : "Confirmar cobro"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function CancelModal({
  open,
  order,
  onClose,
  onCancelled,
  onError,
}: {
  open: boolean;
  order: OrderDto;
  onClose(): void;
  onCancelled(): void;
  onError(value: string): void;
}) {
  const [reason, setReason] = useState("");
  const [pin, setPin] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setReason("");
    setPin("");
    setLocalError(null);
  }, [open, order.id]);
  const mutation = useApiMutation(
    (input: { orderId: string; reason: string; authorizerPin: string }) =>
      window.gastronomy.cancelOrder(input),
    {
      onSuccess: () => {
        onClose();
        onCancelled();
      },
      onError: (value) => {
        const message = humanError(value);
        setLocalError(message);
        onError(message);
      },
    },
  );
  return (
    <Modal
      open={open}
      onClose={onClose}
      closeDisabled={mutation.isPending}
      title="Cancelar pedido"
      description="La operación no se elimina y quedará auditada"
    >
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!reason.trim() || pin.length < 4 || mutation.isPending) return;
          mutation.mutate({
            orderId: order.id,
            reason,
            authorizerPin: pin,
          });
        }}
      >
        <Field label="Motivo">
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Ej.: Cliente canceló"
          />
        </Field>
        <Field label="PIN de autorización">
          <Input
            type="password"
            inputMode="numeric"
            maxLength={8}
            value={pin}
            onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
            placeholder="••••"
          />
        </Field>
        {localError ? (
          <p
            role="alert"
            className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700"
          >
            {localError}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={mutation.isPending}
          >
            Volver
          </Button>
          <Button
            type="submit"
            variant="danger"
            disabled={!reason.trim() || pin.length < 4 || mutation.isPending}
          >
            <Trash size={16} />
            Cancelar definitivamente
          </Button>
        </div>
      </form>
    </Modal>
  );
}
