import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  BootstrapDto,
  OrderDto,
  OrderOperationalStatus,
  ProductDto,
} from "@gastronomy/contracts";
import {
  Check,
  ArrowLeft,
  ArrowCounterClockwise,
  ArrowsLeftRight,
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
import { calculateHalfAndHalfBase, guardOrderAction } from "@gastronomy/domain";
import {
  formatMoney,
  humanError,
  normalizeSearch,
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
  const [changeTableOpen, setChangeTableOpen] = useState(false);
  const [modifierItemId, setModifierItemId] = useState<string | null>(null);
  const [notesItemId, setNotesItemId] = useState<string | null>(null);
  const [notesError, setNotesError] = useState<string | null>(null);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [discardError, setDiscardError] = useState<string | null>(null);
  const [driverOpen, setDriverOpen] = useState(false);
  const [driverUserId, setDriverUserId] = useState("");
  const [driverError, setDriverError] = useState<string | null>(null);
  const [printFeedback, setPrintFeedback] = useState<string | null>(null);
  const [skippedPrintKind, setSkippedPrintKind] = useState<
    "KITCHEN_ORDER" | "CUSTOMER_BILL" | null
  >(null);
  const [printConfirmKind, setPrintConfirmKind] = useState<
    "KITCHEN_ORDER" | "CUSTOMER_BILL" | null
  >(null);
  const [addingProduct, setAddingProduct] = useState<ProductDto | null>(null);
  const [variantPickerProduct, setVariantPickerProduct] =
    useState<ProductDto | null>(null);
  const [addingQuantity, setAddingQuantity] = useState("1");
  const [addingPrice, setAddingPrice] = useState("");
  const [addingPin, setAddingPin] = useState("");
  const [addingError, setAddingError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const addingQuantityRef = useRef<HTMLInputElement>(null);
  const addingPriceRef = useRef<HTMLInputElement>(null);
  const addItemLockRef = useRef(false);
  const [activeProductIndex, setActiveProductIndex] = useState(0);
  useEffect(() => {
    if (orderId) window.setTimeout(() => searchRef.current?.focus(), 80);
  }, [orderId]);

  const isHalfAndHalfSearch = useMemo(() => {
    if (!search.trim()) return false;
    const q = normalizeSearch(search);
    return (
      q.includes("mitad") ||
      q.includes("media") ||
      q === "mm" ||
      q === "mym"
    );
  }, [search]);

  const products = useMemo(() => {
    // En la grilla principal sólo se muestran los productos base/padres
    const baseProducts = data.products.filter(
      (p) =>
        !p.parentProductId ||
        !data.products.some((cand) => cand.id === p.parentProductId),
    );

    if (!search.trim()) {
      return rankProducts(baseProducts, search, categoryId).slice(0, 30);
    }

    const normalizedQuery = normalizeSearch(search);
    const tokens = normalizedQuery.split(/\s+/).filter(Boolean);

    return baseProducts
      .filter(
        (product) =>
          product.active && (!categoryId || product.categoryId === categoryId),
      )
      .map((product, index) => {
        const variants = data.products.filter(
          (v) => v.parentProductId === product.id && v.active,
        );
        const code = normalizeSearch(product.code ?? "");
        const name = normalizeSearch(product.name);
        const variantHaystack = variants
          .map(
            (v) =>
              `${normalizeSearch(v.code ?? "")} ${normalizeSearch(v.name)}`,
          )
          .join(" ");
        const haystack = `${code} ${name} ${variantHaystack} ${normalizeSearch(product.categoryName)}`;

        if (!tokens.every((token) => haystack.includes(token))) return null;

        let bestScore = 5;
        const candidates = [product, ...variants];
        for (const cand of candidates) {
          const cCode = normalizeSearch(cand.code ?? "");
          const cName = normalizeSearch(cand.name);
          const score =
            cCode === normalizedQuery
              ? 0
              : cCode.startsWith(normalizedQuery)
                ? 1
                : cName.startsWith(normalizedQuery)
                  ? 2
                  : cName
                        .split(/\s+/)
                        .some((w) => w.startsWith(normalizedQuery))
                    ? 3
                    : 4;
          if (score < bestScore) bestScore = score;
        }
        return { product, score: bestScore, index };
      })
      .filter(
        (
          entry,
        ): entry is { product: ProductDto; score: number; index: number } =>
          Boolean(entry),
      )
      .sort((a, b) => a.score - b.score || a.index - b.index)
      .slice(0, 30)
      .map((entry) => entry.product);
  }, [data.products, search, categoryId]);

  useEffect(() => {
    setActiveProductIndex(0);
  }, [search, categoryId]);

  useEffect(() => {
    const el = document.getElementById(`order-editor-product-${activeProductIndex}`);
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeProductIndex]);

  const addItem = useApiMutation(
    (input: Parameters<typeof window.gastronomy.addOrderItem>[0]) =>
      window.gastronomy.addOrderItem(input),
    {
      onSuccess: () => {
        setAddingProduct(null);
        setAddingError(null);
        setSearch("");
        window.setTimeout(() => searchRef.current?.focus(), 50);
      },
      onError: (value) => {
        const message = humanError(value);
        setAddingError(message);
        setError(message);
      },
      onSettled: () => {
        addItemLockRef.current = false;
      },
    },
  );
  const productPrice = (product: ProductDto) => {
    if (!order) return null;
    const code = order.type === "DINE_IN" ? "SALON" : order.type;
    return (
      product.prices.find((price) => price.priceListCode === code)
        ?.amountMinor ?? null
    );
  };
  const openProduct = (product: ProductDto) => {
    const price = productPrice(product);
    if (price == null) {
      setError("El producto no tiene un precio configurado para este canal.");
      return;
    }
    setAddingProduct(product);
    setAddingQuantity("1");
    setAddingPrice(String(price / 100).replace(".", ","));
    setAddingPin("");
    setAddingError(null);
    window.setTimeout(() => {
      addingQuantityRef.current?.focus();
      addingQuantityRef.current?.select();
    }, 50);
  };
  const handleProductCardClick = (product: ProductDto) => {
    if (locked || addItem.isPending) return;
    const variants = data.products.filter(
      (p) => p.parentProductId === product.id && p.active,
    );
    if (variants.length > 0) {
      searchRef.current?.blur();
      setVariantPickerProduct(product);
    } else {
      openProduct(product);
    }
  };
  const addProduct = () => {
    if (!order || addItemLockRef.current || addItem.isPending) return;
    if (!addingProduct) return;
    const quantity = Number(addingQuantity);
    const price = parseMoneyInput(addingPrice);
    const catalogPrice = productPrice(addingProduct);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      setAddingError("Ingresá una cantidad entera mayor que cero.");
      return;
    }
    if (price == null || catalogPrice == null) {
      setAddingError("Ingresá un precio válido.");
      return;
    }
    const changed = price !== catalogPrice;
    if (changed && !/^\d{4,8}$/.test(addingPin)) {
      setAddingError("Ingresá un PIN válido para autorizar el precio manual.");
      return;
    }
    addItemLockRef.current = true;
    setError(null);
    setAddingError(null);
    addItem.mutate({
      orderId: order.id,
      productId: addingProduct.id,
      quantity,
      ...(changed
        ? { unitPriceMinorOverride: price, authorizerPin: addingPin }
        : {}),
    });
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
  const updateItemNotes = useApiMutation(
    (input: { orderId: string; itemId: string; notes: string | null }) =>
      window.gastronomy.updateOrderItemNotes(input),
    {
      onSuccess: () => setNotesItemId(null),
      onError: (value) => {
        const message = humanError(value);
        setNotesError(message);
        setError(message);
      },
    },
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
      onSuccess: (result, input) => {
        const label = input.kind === "KITCHEN_ORDER" ? "Comanda" : "Cuenta";
        setSkippedPrintKind(result.status === "SKIPPED" ? input.kind : null);
        setPrintFeedback(
          result.status === "SKIPPED"
            ? `${label} no impresa. Podés continuar trabajando y volver a imprimirla cuando quieras.`
            : isDemoMode
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
    setSkippedPrintKind(null);
    setAddingProduct(null);
    setVariantPickerProduct(null);
    setAddingError(null);
    setNotesItemId(null);
    setNotesError(null);
  }, [orderId]);

  const pendingPrint = order
    ? data.printJobs.find(
        (job) =>
          job.orderId === order.id &&
          ["FAILED", "QUEUED", "RECOVERING"].includes(job.status),
      )
    : undefined;
  const printedKinds = new Set(
    order
      ? data.printJobs
          .filter((job) => job.orderId === order.id && job.status === "PRINTED")
          .map((job) => job.kind)
      : [],
  );
  const requestPrint = (kind: "KITCHEN_ORDER" | "CUSTOMER_BILL") => {
    if (!order || print.isPending || pendingPrint) return;
    setPrintFeedback(null);
    setError(null);
    if (printedKinds.has(kind)) {
      setPrintConfirmKind(kind);
      return;
    }
    print.mutate({
      orderId: order.id,
      kind,
      confirmFirst: kind === "KITCHEN_ORDER" && order.lifecycleStatus === "DRAFT",
    });
  };

  useEffect(() => {
    if (!orderId || !order) return;
    const handler = (event: KeyboardEvent) => {
      if (event.repeat) return;
      const nestedDialogOpen =
        payOpen ||
        refundOpen ||
        halfOpen ||
        cancelOpen ||
        changeTableOpen ||
        discountOpen ||
        discardConfirmOpen ||
        driverOpen ||
        Boolean(addingProduct) ||
        Boolean(variantPickerProduct) ||
        Boolean(modifierItemId) ||
        Boolean(notesItemId);
      if (nestedDialogOpen) return;

      if (event.key === "F6") {
        const canOpenHalf =
          !locked &&
          data.products.length >= 2;
        if (canOpenHalf) {
          event.preventDefault();
          setHalfOpen(true);
        }
        return;
      }

      if (event.key === "F7") {
        const canPrintComanda =
          order.items.length > 0 &&
          !print.isPending &&
          !Boolean(pendingPrint);
        if (canPrintComanda) {
          event.preventDefault();
          requestPrint("KITCHEN_ORDER");
        }
        return;
      }

      if (event.key === "F8") {
        const canOpenPayment =
          order.lifecycleStatus !== "DRAFT" &&
          order.items.length > 0 &&
          order.paymentStatus !== "PAID" &&
          order.operationalStatus !== "CANCELLED";
        if (canOpenPayment) {
          event.preventDefault();
          setError(null);
          setCompleteOnPay(false);
          setPayOpen(true);
        }
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    addingProduct,
    cancelOpen,
    changeTableOpen,
    discardConfirmOpen,
    discountOpen,
    driverOpen,
    halfOpen,
    modifierItemId,
    notesItemId,
    order,
    orderId,
    payOpen,
    pendingPrint,
    print.isPending,
    refundOpen,
    variantPickerProduct,
  ]);

  if (!order) return null;
  const locked = ["DELIVERED", "CANCELLED"].includes(order.operationalStatus);
  const isDraft = order.lifecycleStatus === "DRAFT";

  const isPizzaCategory = useMemo(() => {
    if (!categoryId) return false;
    const cat = data.categories.find((c) => c.id === categoryId);
    return cat ? cat.name.toLocaleLowerCase("es-AR").includes("pizza") : false;
  }, [data.categories, categoryId]);

  const showHalfAndHalfCard = useMemo(() => {
    if (locked || data.products.length < 2) return false;
    if (isHalfAndHalfSearch) return true;
    if (isPizzaCategory && !search.trim()) return true;
    return false;
  }, [locked, data.products.length, isHalfAndHalfSearch, isPizzaCategory, search]);
  const addingCatalogPrice = addingProduct ? productPrice(addingProduct) : null;
  const addingParsedPrice = parseMoneyInput(addingPrice);
  const addingPriceChanged =
    addingCatalogPrice != null &&
    addingParsedPrice != null &&
    addingParsedPrice !== addingCatalogPrice;
  const canConfirm = guardOrderAction(order, "CONFIRM");
  const canDeliver = guardOrderAction(order, "DELIVER");
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
    updateItemNotes.isPending ||
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
      <div className="order-editor-layout grid min-h-0 gap-3 min-[900px]:grid-cols-[1.1fr_.9fr] lg:gap-4 lg:grid-cols-[1.35fr_.9fr]">
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
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActiveProductIndex((prev) =>
                    products.length ? (prev + 1) % products.length : 0,
                  );
                  return;
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActiveProductIndex((prev) =>
                    products.length ? (prev - 1 + products.length) % products.length : 0,
                  );
                  return;
                }
                if (
                  event.key === "Enter" &&
                  !locked &&
                  !addItem.isPending &&
                  !variantPickerProduct &&
                  !addingProduct &&
                  !halfOpen
                ) {
                  if (
                    isHalfAndHalfSearch &&
                    (!products.length || activeProductIndex === 0)
                  ) {
                    event.preventDefault();
                    event.stopPropagation();
                    setHalfOpen(true);
                    return;
                  }
                  const targetProduct = products[activeProductIndex] ?? products[0];
                  if (targetProduct) {
                    event.preventDefault();
                    event.stopPropagation();
                    handleProductCardClick(targetProduct);
                  }
                }
              }}
              placeholder="Código, nombre, categoría… · Enter agrega · F6 mitad y mitad · ↑ ↓ navega"
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
          <div className="mt-2 grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto p-1.5 xl:grid-cols-3">
            {showHalfAndHalfCard ? (
              <div
                id="order-editor-half-and-half-card"
                role="button"
                tabIndex={0}
                onClick={() => setHalfOpen(true)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    setHalfOpen(true);
                  }
                }}
                className={cn(
                  "focus-ring group m-1 flex min-h-[76px] cursor-pointer flex-col justify-between rounded-xl border border-brand-300 bg-brand-50/50 p-3 text-left transition hover:border-brand-400 hover:bg-brand-50/80 hover:shadow-sm scroll-m-2",
                  isHalfAndHalfSearch &&
                    activeProductIndex === 0 &&
                    "border-brand-500 ring-2 ring-brand-500/80 shadow-md bg-brand-50/70",
                )}
              >
                <div>
                  <div className="flex items-start justify-between gap-1">
                    <div className="flex items-center gap-1.5">
                      <Pizza className="text-brand-600 shrink-0" size={16} />
                      <p className="line-clamp-2 text-[12px] font-bold text-brand-900">
                        Pizza mitad y mitad
                      </p>
                    </div>
                    <span className="inline-flex shrink-0 items-center rounded bg-brand-200/80 px-1.5 py-0.5 text-[9px] font-bold text-brand-800">
                      F6
                    </span>
                  </div>
                  <span className="text-[9px] font-semibold uppercase tracking-wide text-brand-600/80">
                    Pizzas combinadas
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[10px] font-medium text-slate-500">
                    Elegir 2 variedades
                  </span>
                  <span className="text-xs font-bold text-brand-700">
                    Configurar →
                  </span>
                </div>
              </div>
            ) : null}
            {products.map((product, index) => {
              const code = order.type === "DINE_IN" ? "SALON" : order.type;
              const price = product.prices.find(
                (item) => item.priceListCode === code,
              )?.amountMinor;
              const variants = data.products.filter(
                (p) => p.parentProductId === product.id && p.active,
              );
              const hasVariants = variants.length > 0;
              const disabled =
                locked ||
                addItem.isPending ||
                (!hasVariants && price == null);
              const isSelected = index === activeProductIndex;

              return (
                <div
                  key={product.id}
                  id={`order-editor-product-${index}`}
                  role="button"
                  tabIndex={disabled ? -1 : 0}
                  aria-disabled={disabled}
                  onMouseEnter={() => setActiveProductIndex(index)}
                  onClick={() => {
                    if (!disabled) handleProductCardClick(product);
                  }}
                  onKeyDown={(event) => {
                    if (disabled) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      event.stopPropagation();
                      handleProductCardClick(product);
                    }
                  }}
                  className={cn(
                    "focus-ring group m-1 flex min-h-[76px] cursor-pointer flex-col justify-between rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-brand-300 hover:shadow-sm scroll-m-2",
                    isSelected && "border-brand-500 ring-2 ring-brand-500/80 shadow-md bg-brand-50/20",
                    disabled && "cursor-not-allowed opacity-50",
                  )}
                >
                  <div>
                    <div className="flex items-start justify-between gap-1">
                      <p className="line-clamp-2 text-[12px] font-bold text-slate-800 group-hover:text-brand-800">
                        {product.name}
                      </p>
                      {hasVariants ? (
                        <span className="inline-flex shrink-0 items-center rounded bg-brand-50 px-1.5 py-0.5 text-[9px] font-bold text-brand-700">
                          {variants.length + 1} opciones
                        </span>
                      ) : null}
                    </div>
                    <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">
                      {product.categoryName}
                    </span>
                  </div>

                  {hasVariants ? (
                    <div
                      className="mt-2 flex flex-wrap gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {price != null ? (
                        <button
                          type="button"
                          disabled={locked || addItem.isPending}
                          onClick={(e) => {
                            e.stopPropagation();
                            openProduct(product);
                          }}
                          title={`Agregar ${product.name} (Base) - ${formatMoney(price)}`}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-bold text-slate-700 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800"
                        >
                          <span>Base</span>
                          <span className="text-brand-700">{formatMoney(price)}</span>
                        </button>
                      ) : null}
                      {variants.map((v) => {
                        const vPrice = productPrice(v);
                        const vLabel = getVariantShortName(v, product);
                        return (
                          <button
                            key={v.id}
                            type="button"
                            disabled={
                              locked || addItem.isPending || vPrice == null
                            }
                            onClick={(e) => {
                              e.stopPropagation();
                              openProduct(v);
                            }}
                            title={`Agregar ${v.name} - ${vPrice == null ? "Sin precio" : formatMoney(vPrice)}`}
                            className="inline-flex items-center gap-1 rounded-md border border-brand-200 bg-brand-50/70 px-1.5 py-0.5 text-[10px] font-bold text-brand-800 transition hover:border-brand-400 hover:bg-brand-100"
                          >
                            <span>{vLabel}</span>
                            <span className="text-brand-700">
                              {vPrice == null ? "—" : formatMoney(vPrice)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">
                        {product.code ? `#${product.code}` : ""}
                      </span>
                      <span className="text-xs font-extrabold text-brand-700">
                        {price == null ? "Sin precio" : formatMoney(price)}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <Button
            variant="secondary"
            className="mt-2 w-full"
            onClick={() => setHalfOpen(true)}
            disabled={locked || data.products.length < 2}
          >
            <Pizza size={17} /> Pizza mitad y mitad{" "}
            <kbd className="text-[9px] opacity-70">F6</kbd>
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
                    className="group rounded-xl border border-slate-100 bg-slate-50/70 p-2.5"
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
                        {!locked ? (
                          <button
                            type="button"
                            onClick={() => {
                              setNotesError(null);
                              setNotesItemId(item.id);
                            }}
                            className="ml-2 mt-1 flex min-h-10 items-center gap-1 px-2 text-[10px] font-bold text-brand-600 hover:underline"
                            aria-label={`${item.notes ? "Editar" : "Agregar"} observación para ${item.productNameSnapshot}`}
                          >
                            <Plus size={11} />
                            {item.notes
                              ? "Editar observación"
                              : "Agregar observación"}
                          </button>
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
                  : skippedPrintKind === "KITCHEN_ORDER"
                    ? "Reintentar comanda"
                    : isDraft
                      ? "Confirmar e imprimir"
                      : printedKinds.has("KITCHEN_ORDER")
                        ? "Reimprimir comanda"
                        : "Comanda"}{" "}
                <kbd className="text-[9px] opacity-70">F7</kbd>
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
                  : skippedPrintKind === "CUSTOMER_BILL"
                    ? "Reintentar cuenta"
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
            {order.type !== "DINE_IN" &&
            onEditDraft &&
            !locked &&
            order.paidMinor === 0 ? (
              <Button
                variant="secondary"
                className="mt-2 w-full"
                onClick={() => onEditDraft(order.id)}
              >
                <ArrowLeft size={16} />
                Volver a datos del cliente y envío
              </Button>
            ) : null}
            {isDraft ? (
              <div className="mt-2 grid grid-cols-2 gap-2">
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
            {!locked &&
            (order.items.length ||
              (order.type === "DINE_IN" && order.tableId)) ? (
              <div
                className={cn(
                  "mt-2 grid gap-2",
                  order.items.length &&
                    order.type === "DINE_IN" &&
                    order.tableId
                    ? "grid-cols-2"
                    : "grid-cols-1",
                )}
              >
                {order.items.length ? (
                  <Button
                    variant="secondary"
                    className="w-full"
                    onClick={() => setDiscountOpen(true)}
                  >
                    <Percent size={15} />
                    Aplicar descuento
                  </Button>
                ) : null}
                {order.type === "DINE_IN" && order.tableId ? (
                  <Button
                    variant="secondary"
                    className="w-full"
                    onClick={() => setChangeTableOpen(true)}
                  >
                    <ArrowsLeftRight size={15} />
                    Cambiar de mesa
                  </Button>
                ) : null}
              </div>
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
      <Modal
        open={Boolean(addingProduct)}
        onClose={() => {
          setAddingProduct(null);
          setAddingError(null);
          window.setTimeout(() => searchRef.current?.focus(), 50);
        }}
        closeDisabled={addItem.isPending}
        title={
          addingProduct ? `Agregar · ${addingProduct.name}` : "Agregar producto"
        }
        description="Confirmá cantidad y precio antes de incorporarlo a la mesa"
      >
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            addProduct();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-[120px_1fr]">
            <Field label="Cantidad">
              <Input
                ref={addingQuantityRef}
                autoFocus
                inputMode="numeric"
                value={addingQuantity}
                disabled={addItem.isPending}
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => {
                  setAddingQuantity(event.target.value.replace(/\D/g, ""));
                  setAddingError(null);
                }}
              />
            </Field>
            <Field
              label="Precio unitario"
              hint={
                addingPriceChanged
                  ? "Precio manual · requiere PIN"
                  : addingCatalogPrice == null
                    ? undefined
                    : `Precio de lista: ${formatMoney(addingCatalogPrice)}`
              }
            >
              <Input
                ref={addingPriceRef}
                inputMode="decimal"
                value={addingPrice}
                disabled={addItem.isPending}
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => {
                  setAddingPrice(event.target.value);
                  setAddingError(null);
                }}
                className={
                  addingPriceChanged
                    ? "border-amber-300 bg-amber-50 font-extrabold text-amber-800"
                    : "font-bold"
                }
              />
            </Field>
          </div>
          {addingPriceChanged ? (
            <Field label="PIN para autorizar el precio manual">
              <Input
                type="password"
                inputMode="numeric"
                maxLength={8}
                value={addingPin}
                disabled={addItem.isPending}
                onChange={(event) => {
                  setAddingPin(event.target.value.replace(/\D/g, ""));
                  setAddingError(null);
                }}
                placeholder="••••"
              />
            </Field>
          ) : null}
          {addingError ? (
            <p
              role="alert"
              className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs font-semibold text-rose-700"
            >
              {addingError}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={addItem.isPending}
              onClick={() => {
                setAddingProduct(null);
                window.setTimeout(() => searchRef.current?.focus(), 50);
              }}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={
                addItem.isPending ||
                !addingQuantity ||
                addingParsedPrice == null ||
                (addingPriceChanged && addingPin.length < 4)
              }
            >
              <Plus size={16} />
              {addItem.isPending
                ? "Agregando…"
                : order.type === "DINE_IN"
                  ? "Agregar a la mesa"
                  : "Agregar al pedido"}
            </Button>
          </div>
        </form>
      </Modal>
      <SelectVariantModal
        open={Boolean(variantPickerProduct)}
        parentProduct={variantPickerProduct}
        variants={
          variantPickerProduct
            ? data.products.filter(
                (p) =>
                  p.parentProductId === variantPickerProduct.id && p.active,
              )
            : []
        }
        orderType={order.type}
        initialQuery={search}
        onSelect={(product) => {
          setVariantPickerProduct(null);
          openProduct(product);
        }}
        onClose={() => {
          setVariantPickerProduct(null);
          window.setTimeout(() => searchRef.current?.focus(), 50);
        }}
      />
      <HalfAndHalfModal
        open={halfOpen}
        order={order}
        data={data}
        onClose={() => {
          setHalfOpen(false);
          setSearch("");
          window.setTimeout(() => searchRef.current?.focus(), 50);
        }}
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
      <ItemNotesModal
        open={Boolean(notesItemId)}
        item={order.items.find((item) => item.id === notesItemId) ?? null}
        onClose={() => {
          setNotesError(null);
          setNotesItemId(null);
        }}
        onSave={(notes) => {
          if (!notesItemId) return;
          setNotesError(null);
          updateItemNotes.mutate({
            orderId: order.id,
            itemId: notesItemId,
            notes: notes.trim() || null,
          });
        }}
        isPending={updateItemNotes.isPending}
        error={notesError}
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
      <ChangeTableModal
        open={changeTableOpen}
        order={order}
        data={data}
        onClose={() => setChangeTableOpen(false)}
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

function ItemNotesModal({
  open,
  item,
  onClose,
  onSave,
  isPending,
  error,
}: {
  open: boolean;
  item: OrderDto["items"][number] | null;
  onClose(): void;
  onSave(notes: string): void;
  isPending: boolean;
  error: string | null;
}) {
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (open) setNotes(item?.notes ?? "");
  }, [open, item]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      closeDisabled={isPending}
      title={item?.notes ? "Editar observación" : "Agregar observación"}
      description={
        item ? `${item.quantity}× ${item.productNameSnapshot}` : undefined
      }
    >
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!item || isPending) return;
          onSave(notes);
        }}
      >
        <Field label="Observación para comanda">
          <Textarea
            autoFocus
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            maxLength={500}
            rows={4}
            placeholder="Ej.: sin ajo · alergia a los frutos secos"
            aria-describedby="item-notes-helper item-notes-counter"
          />
        </Field>
        <div className="-mt-1 space-y-1">
          <p id="item-notes-helper" className="text-[11px] text-slate-500">
            Sólo se imprime en la comanda; no aparece en la cuenta del cliente.
          </p>
          <p
            id="item-notes-counter"
            className="text-right text-[10px] text-slate-400"
          >
            {notes.length}/500
          </p>
        </div>
        {error ? (
          <p
            role="alert"
            className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700"
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
          <Button
            type="button"
            variant="danger"
            onClick={() => onSave("")}
            disabled={!item?.notes || isPending}
          >
            Quitar / limpiar
          </Button>
          <Button type="submit" disabled={!item || !notes.trim() || isPending}>
            Guardar
          </Button>
        </div>
      </form>
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

export function PizzaHalfSelector({
  label,
  pizzas,
  priceListCode,
  selectedId,
  onSelect,
  onClear,
  autoFocus = false,
  inputRef,
  onEnterNext,
}: {
  label: string;
  pizzas: ProductDto[];
  priceListCode: string;
  selectedId: string;
  onSelect(product: ProductDto): void;
  onClear(): void;
  autoFocus?: boolean;
  inputRef?: React.RefObject<HTMLInputElement>;
  onEnterNext?(): void;
}) {
  const optionIdPrefix = useId();
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const localInputRef = useRef<HTMLInputElement>(null);
  const actualInputRef = inputRef ?? localInputRef;
  const blurTimerRef = useRef<number | null>(null);
  const isInteractingRef = useRef(false);
  const selectingLockRef = useRef(false);

  const selectedProduct = useMemo(
    () => pizzas.find((p) => p.id === selectedId),
    [pizzas, selectedId],
  );

  const suggestions = useMemo(() => {
    return rankProducts(pizzas, query);
  }, [pizzas, query]);

  useEffect(() => {
    if (!selectedId) {
      setQuery("");
      setActiveIndex(0);
    }
  }, [selectedId]);

  useEffect(() => {
    if (!isOpen) return;
    const el = document.getElementById(`${optionIdPrefix}-opt-${activeIndex}`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, isOpen, optionIdPrefix]);

  useEffect(() => {
    return () => {
      if (blurTimerRef.current !== null) {
        window.clearTimeout(blurTimerRef.current);
      }
    };
  }, []);

  const handleSelect = (product: ProductDto) => {
    if (selectingLockRef.current) return;
    selectingLockRef.current = true;
    isInteractingRef.current = false;
    onSelect(product);
    setIsOpen(false);
    setQuery("");
    onEnterNext?.();
    window.setTimeout(() => {
      selectingLockRef.current = false;
    }, 150);
  };

  const getPrice = (product: ProductDto) =>
    product.prices.find((p) => p.priceListCode === priceListCode)?.amountMinor;

  if (selectedProduct) {
    const price = getPrice(selectedProduct);
    return (
      <Field label={label}>
        <div className="flex items-center justify-between rounded-xl border border-brand-200 bg-brand-50/50 p-3 transition">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-xs font-bold text-slate-800">
                {selectedProduct.name}
              </span>
              {selectedProduct.code ? (
                <span className="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-600">
                  {selectedProduct.code}
                </span>
              ) : null}
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-xs">
              <span className="font-bold text-brand-700">
                {price != null ? formatMoney(price) : "Sin precio"}
              </span>
              <span className="text-[10px] text-slate-400">
                {selectedProduct.categoryName}
              </span>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            className="h-8 shrink-0 px-2.5 text-xs text-slate-600 hover:text-brand-700"
            onClick={() => {
              onClear();
              setIsOpen(true);
              window.setTimeout(() => actualInputRef.current?.focus(), 0);
            }}
          >
            Cambiar
          </Button>
        </div>
      </Field>
    );
  }

  return (
    <Field label={label}>
      <div className="relative">
        <div className="relative">
          <MagnifyingGlass
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <Input
            ref={actualInputRef}
            autoFocus={autoFocus}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={isOpen}
            placeholder={`Buscar ${label.toLocaleLowerCase("es-AR")} (ej. Muzzarella, Jamón...)`}
            className="pl-9 pr-8"
            value={query}
            onClick={() => {
              if (blurTimerRef.current !== null) {
                window.clearTimeout(blurTimerRef.current);
                blurTimerRef.current = null;
              }
              setIsOpen(true);
            }}
            onChange={(event) => {
              setQuery(event.target.value);
              setIsOpen(true);
              setActiveIndex(0);
            }}
            onFocus={() => {
              if (blurTimerRef.current !== null) {
                window.clearTimeout(blurTimerRef.current);
                blurTimerRef.current = null;
              }
              setIsOpen(true);
            }}
            onBlur={() => {
              if (isInteractingRef.current) return;
              blurTimerRef.current = window.setTimeout(() => {
                if (isInteractingRef.current) return;
                setIsOpen(false);
                blurTimerRef.current = null;
              }, 200);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setIsOpen(true);
                setActiveIndex((prev) =>
                  suggestions.length > 0 ? (prev + 1) % suggestions.length : 0,
                );
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setIsOpen(true);
                setActiveIndex((prev) =>
                  suggestions.length > 0
                    ? (prev - 1 + suggestions.length) % suggestions.length
                    : 0,
                );
              } else if (event.key === "Enter") {
                const target =
                  isOpen && suggestions[activeIndex]
                    ? suggestions[activeIndex]
                    : suggestions.length > 0
                      ? suggestions[0]
                      : null;
                if (target) {
                  event.preventDefault();
                  event.stopPropagation();
                  handleSelect(target);
                }
              } else if (event.key === "Escape") {
                if (isOpen) {
                  event.preventDefault();
                  event.stopPropagation();
                  setIsOpen(false);
                }
              }
            }}
          />
          {query ? (
            <button
              type="button"
              tabIndex={-1}
              onClick={() => {
                setQuery("");
                setActiveIndex(0);
                actualInputRef.current?.focus();
              }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              aria-label="Limpiar búsqueda"
            >
              <X size={14} />
            </button>
          ) : null}
        </div>

        {isOpen ? (
          <div
            role="listbox"
            onMouseEnter={() => {
              isInteractingRef.current = true;
            }}
            onMouseLeave={() => {
              isInteractingRef.current = false;
            }}
            onPointerDown={() => {
              isInteractingRef.current = true;
            }}
            onMouseDown={(event) => {
              event.preventDefault();
              isInteractingRef.current = true;
            }}
            className="absolute inset-x-0 top-[calc(100%+4px)] z-40 max-h-52 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl"
          >
            {suggestions.length > 0 ? (
              suggestions.map((product, idx) => {
                const price = getPrice(product);
                const isHighlighted = idx === activeIndex;
                return (
                  <button
                    key={product.id}
                    id={`${optionIdPrefix}-opt-${idx}`}
                    type="button"
                    role="option"
                    tabIndex={-1}
                    aria-selected={isHighlighted}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      isInteractingRef.current = true;
                    }}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      isInteractingRef.current = true;
                      handleSelect(product);
                    }}
                    onClick={(event) => {
                      event.preventDefault();
                      handleSelect(product);
                    }}
                    onMouseEnter={() => setActiveIndex(idx)}
                    className={cn(
                      "flex w-full cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-left text-xs transition",
                      isHighlighted
                        ? "bg-brand-50 font-semibold text-brand-900"
                        : "text-slate-700 hover:bg-slate-50",
                    )}
                  >
                    <div className="min-w-0 pr-2">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate">{product.name}</span>
                        {product.code ? (
                          <span className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[9px] text-slate-500">
                            {product.code}
                          </span>
                        ) : null}
                      </div>
                      <span className="block truncate text-[10px] text-slate-400">
                        {product.categoryName}
                      </span>
                    </div>
                    <span className="shrink-0 font-bold text-brand-700">
                      {price != null ? formatMoney(price) : "Sin precio"}
                    </span>
                  </button>
                );
              })
            ) : (
              <div className="p-3 text-center text-xs text-slate-500">
                No encontramos variedades con &ldquo;{query}&rdquo;
              </div>
            )}
          </div>
        ) : null}
      </div>
    </Field>
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
  const firstInputRef = useRef<HTMLInputElement>(null);
  const secondInputRef = useRef<HTMLInputElement>(null);
  const submitButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    setFirst("");
    setSecond("");
    setLocalError(null);
    const timer = window.setTimeout(() => {
      firstInputRef.current?.focus();
    }, 60);
    return () => window.clearTimeout(timer);
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

  const priceListCode = order.type === "DINE_IN" ? "SALON" : order.type;
  const pizzas = useMemo(() => {
    const activeWithPrice = data.products.filter(
      (product) =>
        product.active &&
        product.prices.some((p) => p.priceListCode === priceListCode),
    );
    const pizzaCategoryOrName = activeWithPrice.filter(
      (product) =>
        product.categoryName.toLocaleLowerCase("es-AR").includes("pizza") ||
        product.name.toLocaleLowerCase("es-AR").includes("pizza"),
    );
    return pizzaCategoryOrName.length > 0 ? pizzaCategoryOrName : activeWithPrice;
  }, [data.products, priceListCode]);

  const firstProduct = useMemo(
    () => pizzas.find((p) => p.id === first),
    [pizzas, first],
  );
  const secondProduct = useMemo(
    () => pizzas.find((p) => p.id === second),
    [pizzas, second],
  );
  const firstPrice = firstProduct?.prices.find(
    (p) => p.priceListCode === priceListCode,
  )?.amountMinor;
  const secondPrice = secondProduct?.prices.find(
    (p) => p.priceListCode === priceListCode,
  )?.amountMinor;

  const estimatedPrice = useMemo(() => {
    if (firstPrice == null || secondPrice == null) return null;
    return calculateHalfAndHalfBase(
      firstPrice,
      secondPrice,
      data.settings.halfAndHalfPricingMode,
    );
  }, [firstPrice, secondPrice, data.settings.halfAndHalfPricingMode]);

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
        <PizzaHalfSelector
          label="Primera mitad"
          pizzas={pizzas}
          priceListCode={priceListCode}
          selectedId={first}
          onSelect={(product) => {
            setFirst(product.id);
            setLocalError(null);
          }}
          onClear={() => {
            setFirst("");
            setLocalError(null);
          }}
          autoFocus
          inputRef={firstInputRef}
          onEnterNext={() => {
            window.setTimeout(() => secondInputRef.current?.focus(), 60);
          }}
        />

        <PizzaHalfSelector
          label="Segunda mitad"
          pizzas={pizzas}
          priceListCode={priceListCode}
          selectedId={second}
          onSelect={(product) => {
            setSecond(product.id);
            setLocalError(null);
          }}
          onClear={() => {
            setSecond("");
            setLocalError(null);
          }}
          inputRef={secondInputRef}
          onEnterNext={() => {
            window.setTimeout(() => submitButtonRef.current?.focus(), 60);
          }}
        />

        {estimatedPrice != null ? (
          <div className="flex items-center justify-between rounded-xl border border-brand-200 bg-brand-50/70 p-3">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-brand-700">
                Precio final calculado
              </span>
              <p className="text-[11px] text-slate-500">
                {data.settings.halfAndHalfPricingMode === "MOST_EXPENSIVE"
                  ? "Se cobra la variedad más cara"
                  : "Promedio (50% de cada mitad)"}
              </p>
            </div>
            <span className="text-base font-extrabold text-brand-800">
              {formatMoney(estimatedPrice)}
            </span>
          </div>
        ) : null}

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
            ref={submitButtonRef}
            type="submit"
            disabled={!first || !second || mutation.isPending}
          >
            <Pizza size={16} />
            {mutation.isPending ? "Agregando…" : "Agregar pizza"}
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
  const defaultChangeMethod = useMemo(
    () =>
      data.paymentMethods.find((m) => m.code === "CASH" && m.active)?.code ??
      data.paymentMethods.find((m) => m.active)?.code ??
      "CASH",
    [data.paymentMethods],
  );
  const [changeMethodCode, setChangeMethodCode] =
    useState<string>(defaultChangeMethod);
  const [payDriverNow, setPayDriverNow] = useState(
    data.settings.deliveryDriverPaymentMode === "ON_ORDER_PAYMENT",
  );
  const firstPaymentInputRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    if (!open) {
      setInitialized(false);
      return;
    }
    const exact = String(remaining / 100);
    setValues({ CASH: exact });
    setReferences({});
    setChangeMethodCode(defaultChangeMethod);
    setPayDriverNow(
      data.settings.deliveryDriverPaymentMode === "ON_ORDER_PAYMENT",
    );
    setLocalError(null);
    setInitialized(true);
    const focusFrame = window.requestAnimationFrame(() =>
      firstPaymentInputRef.current?.focus(),
    );
    return () => window.cancelAnimationFrame(focusFrame);
  }, [
    open,
    remaining,
    defaultChangeMethod,
    data.settings.deliveryDriverPaymentMode,
  ]);

  const mutation = useApiMutation(
    (input: Parameters<typeof window.gastronomy.payOrder>[0]) => {
      const cashMinor = input.payments
        .filter((payment) => payment.methodCode === "CASH")
        .reduce((sum, payment) => sum + payment.amountMinor, 0);
      const nonCashMinor = input.payments
        .filter((payment) => payment.methodCode !== "CASH")
        .reduce((sum, payment) => sum + payment.amountMinor, 0);
      const collectedByDriver =
        order.type === "DELIVERY" && cashMinor > 0 && nonCashMinor === 0;
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

  const payments = data.paymentMethods
    .map((method) => {
      const amountMinor = parseMoneyInput(values[method.code] ?? "") ?? 0;
      return {
        methodCode: method.code,
        amountMinor,
        ...(method.code !== "CASH"
          ? { reference: references[method.code]?.trim() || null }
          : {}),
      };
    })
    .filter((item) => item.amountMinor > 0);

  const allocated = payments.reduce((sum, item) => sum + item.amountMinor, 0);
  const changeDue = Math.max(0, allocated - remaining);

  const selectedChangeMethod = data.paymentMethods.find(
    (m) => m.code === changeMethodCode,
  );
  const incomingCashMinor =
    payments.find((item) => item.methodCode === "CASH")?.amountMinor ?? 0;
  const drawerCashAvailable =
    (data.cashSession?.expectedAmountMinor ?? 0) + incomingCashMinor;
  const isCashChangeInsufficient =
    changeDue > 0 &&
    Boolean(selectedChangeMethod?.affectsCash) &&
    changeDue > drawerCashAvailable;

  const isDeliveryWithDriver =
    order.type === "DELIVERY" &&
    Boolean(order.driverUserId) &&
    data.settings.deliverySettlementEnabled &&
    order.deliveryFeeMinor > 0;

  const canSubmit =
    initialized &&
    allocated >= remaining &&
    !isCashChangeInsufficient &&
    !mutation.isPending;

  const submitPayment = () => {
    if (!canSubmit) return;
    mutation.mutate({
      orderId: order.id,
      payments,
      change:
        changeDue > 0
          ? { methodCode: changeMethodCode, amountMinor: changeDue }
          : null,
      payDriverNow: isDeliveryWithDriver ? payDriverNow : false,
    });
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
          : "Podés sobrepagar y entregar el vuelto en el medio que desees"
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

        {changeDue > 0 ? (
          <div className="mt-3 rounded-xl border border-emerald-300 bg-emerald-50/80 p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-800">
                  Vuelto a entregar
                </span>
                <p className="text-[11px] text-emerald-700">
                  Sobrepago recibido: {formatMoney(changeDue)}
                </p>
              </div>
              <span className="text-2xl font-black text-emerald-700">
                {formatMoney(changeDue)}
              </span>
            </div>
            <Field label="Entregar vuelto en:">
              <Select
                value={changeMethodCode}
                onChange={(event) => {
                  setChangeMethodCode(event.target.value);
                  setLocalError(null);
                }}
              >
                {data.paymentMethods
                  .filter((method) => method.active)
                  .map((method) => (
                    <option key={method.code} value={method.code}>
                      {method.name}{" "}
                      {method.affectsCash
                        ? "(Efectivo de caja)"
                        : "(Electrónico / No caja)"}
                    </option>
                  ))}
              </Select>
            </Field>
            {isCashChangeInsufficient ? (
              <p
                role="alert"
                className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs font-semibold text-rose-700"
              >
                La caja no cuenta con efectivo suficiente ({formatMoney(drawerCashAvailable)}) para entregar este vuelto ({formatMoney(changeDue)}).
              </p>
            ) : null}
          </div>
        ) : null}

        {isDeliveryWithDriver ? (
          <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50/70 p-3">
            <label className="flex items-start gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={payDriverNow}
                onChange={(event) => setPayDriverNow(event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded accent-brand-600"
              />
              <div className="text-xs">
                <span className="font-bold text-slate-800">
                  Pagar envío al repartidor ahora ({formatMoney(order.deliveryFeeMinor)})
                </span>
                <p className="text-slate-500 mt-0.5">
                  {payDriverNow
                    ? `Se registrará el egreso de caja (${formatMoney(order.deliveryFeeMinor)}) y el reparto quedará liquidado.`
                    : "El envío se acumulará en la cuenta corriente del repartidor para liquidarse luego en la sección Repartidores."}
                </p>
              </div>
            </label>
          </div>
        ) : null}

        <div
          className={cn(
            "mt-4 flex items-center justify-between rounded-lg p-3 text-xs font-bold",
            allocated === remaining
              ? "bg-emerald-50 text-emerald-700"
              : allocated > remaining
                ? "bg-blue-50 text-blue-800"
                : "bg-amber-50 text-amber-700",
          )}
        >
          <span>
            {allocated > remaining
              ? "Total abonado (con sobrepago)"
              : allocated === remaining
                ? "Asignado"
                : "Falta abonar"}
          </span>
          <span>
            {allocated > remaining
              ? `${formatMoney(allocated)} · Vuelto: ${formatMoney(changeDue)}`
              : `${formatMoney(allocated)} / ${formatMoney(remaining)}`}
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
          <Button type="submit" disabled={!canSubmit}>
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

function ChangeTableModal({
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
  const [targetTableId, setTargetTableId] = useState("");
  const [reason, setReason] = useState("Cambio de mesa");
  const [pin, setPin] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const availableTables = useMemo(() => {
    return data.tables
      .filter(
        (table) =>
          table.active &&
          table.id !== order.tableId &&
          !table.currentOrderId,
      )
      .sort((a, b) => a.number - b.number);
  }, [data.tables, order.tableId]);

  useEffect(() => {
    if (!open) return;
    setTargetTableId("");
    setReason("Cambio de mesa");
    setPin("");
    setLocalError(null);
  }, [open, order.id]);

  const mutation = useApiMutation(
    (input: Parameters<typeof window.gastronomy.changeOrderTable>[0]) =>
      window.gastronomy.changeOrderTable(input),
    {
      onSuccess: () => {
        onClose();
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
      title="Cambiar de mesa"
      description={`Trasladar los consumos del pedido #${order.number} (Mesa ${order.tableNumber ?? "s/n"}) a otra mesa disponible.`}
    >
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!targetTableId || pin.length < 4 || mutation.isPending) return;
          mutation.mutate({
            orderId: order.id,
            targetTableId,
            authorizerPin: pin,
            reason: reason.trim() || undefined,
          });
        }}
      >
        <Field label="Mesa de destino">
          <Select
            value={targetTableId}
            onChange={(event) => {
              setTargetTableId(event.target.value);
              setLocalError(null);
            }}
          >
            <option value="">Seleccionar mesa libre…</option>
            {availableTables.map((table) => (
              <option key={table.id} value={table.id}>
                Mesa {table.number}
                {table.name ? ` (${table.name})` : ""}
              </option>
            ))}
          </Select>
        </Field>

        {availableTables.length === 0 ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700">
            No hay otras mesas libres en el salón para realizar el traslado.
          </p>
        ) : null}

        <Field label="Motivo (opcional)">
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Cambio de mesa"
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
            disabled={!targetTableId || pin.length < 4 || mutation.isPending}
          >
            <ArrowsLeftRight size={16} />
            {mutation.isPending ? "Trasladando…" : "Confirmar traslado"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function getVariantShortName(variant: ProductDto, parent: ProductDto): string {
  const pName = parent.name.trim();
  const vName = variant.name.trim();
  if (vName.toLowerCase().startsWith(pName.toLowerCase())) {
    let remainder = vName.slice(pName.length).trim();
    while (
      remainder.length > 0 &&
      (remainder.startsWith("-") ||
        remainder.startsWith(":") ||
        remainder.startsWith("·"))
    ) {
      remainder = remainder.slice(1).trim();
    }
    if (remainder.length > 0) return remainder;
  }
  return vName;
}

function SelectVariantModal({
  open,
  parentProduct,
  variants,
  orderType,
  initialQuery,
  onSelect,
  onClose,
}: {
  open: boolean;
  parentProduct: ProductDto | null;
  variants: ProductDto[];
  orderType: OrderDto["type"];
  initialQuery?: string;
  onSelect: (product: ProductDto) => void;
  onClose: () => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const openedAtRef = useRef(0);

  useEffect(() => {
    if (open) {
      openedAtRef.current = Date.now();
    }
  }, [open]);

  const channelCode = orderType === "DINE_IN" ? "SALON" : orderType;
  const channelLabel =
    orderType === "DINE_IN"
      ? "Salón"
      : orderType === "DELIVERY"
        ? "Delivery"
        : "Para retirar";

  const allOptions = useMemo(() => {
    if (!parentProduct) return [];
    const validVariants = variants.filter((v) => v.active);
    return [parentProduct, ...validVariants];
  }, [parentProduct, variants]);

  useEffect(() => {
    if (!parentProduct || !allOptions.length) {
      setSelectedIndex(0);
      return;
    }
    if (initialQuery?.trim()) {
      const q = normalizeSearch(initialQuery);
      const matchIndex = allOptions.findIndex((opt) => {
        const name = normalizeSearch(opt.name);
        const code = normalizeSearch(opt.code ?? "");
        const hasPrice = opt.prices.some(
          (p) => p.priceListCode === channelCode && p.amountMinor != null,
        );
        return hasPrice && (name.includes(q) || code.includes(q));
      });
      if (matchIndex >= 0) {
        setSelectedIndex(matchIndex);
        return;
      }
    }
    const firstValidIndex = allOptions.findIndex((opt) =>
      opt.prices.some(
        (p) => p.priceListCode === channelCode && p.amountMinor != null,
      ),
    );
    setSelectedIndex(firstValidIndex >= 0 ? firstValidIndex : 0);
  }, [parentProduct, allOptions, initialQuery, channelCode]);

  useEffect(() => {
    if (!open || !allOptions.length) return;
    const timer = window.setTimeout(() => {
      const idx = Math.min(Math.max(0, selectedIndex), allOptions.length - 1);
      buttonRefs.current[idx]?.focus();
      buttonRefs.current[idx]?.scrollIntoView({ block: "nearest" });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open || !allOptions.length) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) {
        event.preventDefault();
        return;
      }

      if (event.key === "Tab") {
        event.preventDefault();
        const next = event.shiftKey
          ? (selectedIndex - 1 + allOptions.length) % allOptions.length
          : (selectedIndex + 1) % allOptions.length;
        setSelectedIndex(next);
        buttonRefs.current[next]?.focus();
        buttonRefs.current[next]?.scrollIntoView({ block: "nearest" });
        return;
      }

      if (event.key === "ArrowDown" || event.key === "ArrowRight") {
        event.preventDefault();
        const next = (selectedIndex + 1) % allOptions.length;
        setSelectedIndex(next);
        buttonRefs.current[next]?.focus();
        buttonRefs.current[next]?.scrollIntoView({ block: "nearest" });
        return;
      }

      if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        event.preventDefault();
        const prev = (selectedIndex - 1 + allOptions.length) % allOptions.length;
        setSelectedIndex(prev);
        buttonRefs.current[prev]?.focus();
        buttonRefs.current[prev]?.scrollIntoView({ block: "nearest" });
        return;
      }

      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        // Prevent accidental confirm from the Enter key that opened this modal
        if (Date.now() - openedAtRef.current < 250) {
          return;
        }
        const selected = allOptions[selectedIndex];
        if (selected) {
          const price = selected.prices.find(
            (p) => p.priceListCode === channelCode,
          )?.amountMinor;
          if (price != null) {
            onSelect(selected);
          }
        }
        return;
      }

      if (event.key >= "1" && event.key <= "9") {
        const num = Number(event.key);
        const selected = allOptions[num - 1];
        if (selected) {
          const price = selected.prices.find(
            (p) => p.priceListCode === channelCode,
          )?.amountMinor;
          if (price != null) {
            event.preventDefault();
            onSelect(selected);
          }
        }
        return;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, allOptions, selectedIndex, onSelect, channelCode]);

  if (!parentProduct) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="max-w-lg"
      title={`Seleccionar variante / opción · ${parentProduct.name}`}
      description={`Elegí con ↑ / ↓, Tab o 1-${Math.min(allOptions.length, 9)} y presioná Enter (${channelLabel})`}
    >
      <div className="space-y-2">
        {allOptions.length === 0 ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-center text-xs font-semibold text-amber-800">
            No hay opciones disponibles para este producto en el canal actual.
          </p>
        ) : (
          allOptions.map((product, idx) => {
            const isBase = product.id === parentProduct.id;
            const price = product.prices.find(
              (p) => p.priceListCode === channelCode,
            )?.amountMinor;
            const shortName = isBase
              ? `${parentProduct.name} (Base)`
              : getVariantShortName(product, parentProduct);
            const isSelected = idx === selectedIndex;

            return (
              <button
                key={product.id}
                ref={(el) => {
                  buttonRefs.current[idx] = el;
                }}
                type="button"
                disabled={price == null}
                onMouseEnter={() => {
                  setSelectedIndex(idx);
                }}
                onFocus={() => setSelectedIndex(idx)}
                onClick={() => {
                  if (Date.now() - openedAtRef.current < 250) return;
                  if (price != null) onSelect(product);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    if (e.repeat || Date.now() - openedAtRef.current < 250) return;
                    if (price != null) onSelect(product);
                  }
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded-xl border p-3 text-left transition focus:outline-none focus:ring-2 focus:ring-brand-500",
                  isSelected
                    ? "border-brand-500 ring-2 ring-brand-500 bg-brand-50/70"
                    : isBase
                      ? "border-slate-300 bg-slate-50/70 hover:border-brand-300 hover:bg-brand-50/30"
                      : "border-slate-200 bg-white hover:border-brand-300 hover:bg-brand-50/30",
                  price == null && "cursor-not-allowed opacity-50",
                )}
              >
                <div className="min-w-0 pr-3">
                  <div className="flex items-center gap-2">
                    {idx < 9 ? (
                      <kbd
                        className={cn(
                          "inline-flex h-5 min-w-[20px] items-center justify-center rounded border px-1 font-mono text-[10px] font-bold shadow-sm",
                          isSelected
                            ? "border-brand-300 bg-brand-200 text-brand-900"
                            : "border-slate-300 bg-white text-slate-600",
                        )}
                      >
                        {idx + 1}
                      </kbd>
                    ) : null}
                    <span className="font-bold text-slate-800">{shortName}</span>
                    {isBase ? (
                      <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-700">
                        Padre / Base
                      </span>
                    ) : (
                      <span className="rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-bold text-brand-800">
                        Variante
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
                    {product.code ? <span>Cód: {product.code}</span> : null}
                    {product.stockMinor != null ? (
                      <span>
                        Stock: {(product.stockMinor / 1000).toLocaleString("es-AR")} u.
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm font-extrabold text-brand-700">
                    {price == null ? "Sin precio" : formatMoney(price)}
                  </div>
                  <span className="text-[11px] font-bold text-brand-600">
                    Elegir →
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>
    </Modal>
  );
}


