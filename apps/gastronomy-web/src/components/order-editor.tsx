import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useStore } from "zustand";
import { isOrderPrintActive, orderPrintCoordinator, type OrderPrintRequest } from "../order-print";
import type {
  BootstrapDto,
  HalfAndHalfPricingMode,
  KitchenPrintScope,
  OrderDto,
  OrderItemDto,
  OrderOperationalStatus,
  ProductDto,
  UpdateOrderItemPriceInput,
} from "@gastronomy/contracts";
import {
  Check,
  ArrowLeft,
  ArrowCounterClockwise,
  ArrowsLeftRight,
  CookingPot,
  CreditCard,
  MagnifyingGlass,
  Minus,
  Motorcycle,
  PencilSimple,
  Percent,
  CircleHalf,
  Plus,
  Printer,
  Receipt,
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
  useWorkspaceActive,
} from "@gastronomy/ui";
import { bootstrapKey, useApiMutation, useOrderEntryMutation, useOrderDispatchMutation } from "../api";
import { refreshOrderPrintState } from "../order-print-cache";
import { applyTakeawayConfirmation } from "../order-confirm-cache";
import { isDemoMode } from "../demo/install-demo";
import { PaymentModal } from "./payment-modal";
import { NewOrderModal } from "./order-details-form";
import { ComboOrderModal } from "./combo-order-modal";
import { OrderItemPriceModal } from "./order-item-price-modal";
import { calculateHalfAndHalfBase, canCombineHalves, getKitchenAdditions, guardOrderAction, resolveHalfAndHalfGroup } from "@gastronomy/domain";
import { buildProductSearchIndex, searchProductIndex } from "./order-editor-search";
import {
  formatMoney,
  moneyInputValue,
  humanError,
  normalizeSearch,
  paymentStatusLabels,
  parseMoneyInput,
  rankProducts,
  statusLabels,
  typeLabels,
} from "../lib";

export function OrderEditor({
  data: bootstrapData,
  orderId,
  fallbackOrder,
  onClose,
  onEditDraft,
}: {
  data: BootstrapDto;
  orderId: string | null;
  fallbackOrder?: OrderDto | null;
  onClose(): void;
  onEditDraft?(orderId: string): void;
}) {
  const workspaceActive = useWorkspaceActive();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const currentOrderId = useRef(orderId);
  currentOrderId.current = orderId;
  const orderPrint = useStore(orderPrintCoordinator.store, (state) => state.jobs[orderId ?? ""]);
  const orderPrintBusy = isOrderPrintActive(orderPrint);
  let bootstrapOrder = bootstrapData.orders.find((candidate) => candidate.id === orderId);
  // Opening a just-created pickup can precede the batched notification to
  // this component's parent. It is already in the operational cache, not history.
  if (orderId && !bootstrapOrder && bootstrapData.cashSession) {
    const current = queryClient.getQueryState<BootstrapDto>(bootstrapKey);
    if (current?.data && current.data !== bootstrapData && !current.isInvalidated &&
        current.fetchStatus === "idle" && current.data.cashSession?.id === bootstrapData.cashSession.id)
      bootstrapOrder = current.data.orders.find(o => o.id === orderId && o.type === "TAKEAWAY" && o.lifecycleStatus === "DRAFT");
  }
  const historicalOrder = useQuery({
    queryKey: [...bootstrapKey, "historical-editor", orderId],
    queryFn: async () => {
      const order = await window.gastronomy.getOrder({ orderId: orderId! });
      if (order.type !== "DELIVERY") return { order };
      const detail = await window.gastronomy.getDeliveryProjection({ orderId: order.id });
      return { order: detail.order, ledger: detail.deliveryLedger };
    },
    enabled: Boolean(orderId) && !bootstrapOrder,
  });
  const data = useMemo(() => {
    const ledger = !bootstrapOrder && historicalOrder.data?.ledger;
    return ledger ? { ...bootstrapData, deliveryLedger: [...bootstrapData.deliveryLedger.filter(row => row.orderId !== orderId), ...ledger] } : bootstrapData;
  }, [bootstrapData, bootstrapOrder, historicalOrder.data, orderId]);
  const order =
    bootstrapOrder ?? historicalOrder.data?.order ??
    (fallbackOrder?.id === orderId && fallbackOrder?.type !== "DELIVERY" ? fallbackOrder : undefined);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [completeOnPay, setCompleteOnPay] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsState, setDetailsState] = useState({ dirty: false, pending: false });
  useEffect(() => {
    setDetailsOpen(false);
    setDetailsState({ dirty: false, pending: false });
  }, [orderId]);
  const returnToProducts = () => {
    setDetailsOpen(false);
    setDetailsState({ dirty: false, pending: false });
    window.requestAnimationFrame(() => searchRef.current?.focus());
  };
  const [payOpen, setPayOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [halfOpen, setHalfOpen] = useState(false);
  const [halfFirstId, setHalfFirstId] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [changeTableOpen, setChangeTableOpen] = useState(false);
  const [modifierItemId, setModifierItemId] = useState<string | null>(null);
  const [notesItemId, setNotesItemId] = useState<string | null>(null);
  const [notesError, setNotesError] = useState<string | null>(null);
  const [priceItemId, setPriceItemId] = useState<string | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);
  const canEditItemPrice =
    order != null && guardOrderAction(order, "EDIT").allowed;
  const priceItem = canEditItemPrice
    ? order.items.find((item) => item.id === priceItemId)
    : undefined;
  useEffect(() => {
    setPriceItemId(null);
    setPriceError(null);
  }, [orderId]);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
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
  const [kitchenPrintScope, setKitchenPrintScope] = useState<KitchenPrintScope>("FULL");
  const [comboProduct, setComboProduct] = useState<ProductDto | null>(null);
  const [comboAddError, setComboAddError] = useState<string | null>(null);
  const [variantPickerProduct, setVariantPickerProduct] =
    useState<ProductDto | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const addItemLockRef = useRef(false);
  const submittedAddSearchRef = useRef("");
  const addComboLockRef = useRef(false);
  const [activeProductIndex, setActiveProductIndex] = useState(0);
  const halfAndHalfEnabled = data.settings.halfAndHalfEnabled ?? true;
  const halfPriceChannel = order?.type === "DINE_IN" ? "SALON" : order?.type;
  const availableHalves = useMemo(() => {
    if (!halfAndHalfEnabled || !halfPriceChannel) return [];
    const categories = new Map(data.categories.map((category) => [category.id, category]));
    const groups = new Map<string, HalfAndHalfOption[]>();
    for (const product of data.products) {
      const group = resolveHalfAndHalfGroup(categories.get(product.categoryId), product);
      if (!group || !product.prices.some((price) => price.priceListCode === halfPriceChannel)) continue;
      const key = JSON.stringify([product.categoryId, group.id]);
      const entries = groups.get(key) ?? [];
      entries.push({
        ...product,
        halfAndHalfGroupId: group.id,
        halfAndHalfPricingMode: group.pricingMode ?? data.settings.halfAndHalfPricingMode,
      });
      groups.set(key, entries);
    }
    return [...groups.values()].filter((entries) => entries.length > 1).flat();
  }, [data.categories, data.products, data.settings.halfAndHalfPricingMode, halfAndHalfEnabled, halfPriceChannel]);
  const availableHalfIds = useMemo(() => new Set(availableHalves.map(({ id }) => id)), [availableHalves]);
  const canOpenHalf = availableHalves.length > 0;
  useEffect(() => {
    setHalfOpen(false);
    setHalfFirstId(null);
  }, [orderId]);
  useEffect(() => {
    if (!canOpenHalf) setHalfOpen(false);
  }, [canOpenHalf]);

  function openHalfPicker(firstId: string | null = null) {
    setHalfFirstId(firstId);
    setHalfOpen(true);
  }
  useEffect(() => {
    if (!order?.id || !workspaceActive) return;
    const frame = window.requestAnimationFrame(() => {
      const input = searchRef.current;
      if (input?.closest('[role="dialog"][data-top-dialog="true"]'))
        input.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [order?.id, workspaceActive]);
  useEffect(() => {
    setComboProduct(null);
    setComboAddError(null);
    addComboLockRef.current = false;
  }, [orderId]);

  const isHalfAndHalfSearch = useMemo(() => {
    if (!search.trim()) return false;
    const q = normalizeSearch(search);
    return (
      q.includes("mitad") || q.includes("media") || q === "mm" || q === "mym"
    );
  }, [search]);

  const productSearchIndex = useMemo(
    () => buildProductSearchIndex(data.products),
    [data.products],
  );
  const products = useMemo(
    () => searchProductIndex(productSearchIndex, search, categoryId),
    [productSearchIndex, search, categoryId],
  );
  const variantsByParent = useMemo(
    () => new Map(productSearchIndex.filter(entry => entry.variants.length)
      .map((entry) => [entry.product.id, entry.variants.map((variant) => variant.product)])),
    [productSearchIndex],
  );

  useEffect(() => {
    setActiveProductIndex(0);
  }, [search, categoryId]);

  useEffect(() => {
    const el = document.getElementById(
      `order-editor-product-${activeProductIndex}`,
    );
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeProductIndex]);

  const addItem = useOrderEntryMutation(
    (input: Parameters<typeof window.gastronomy.addOrderItem>[0]) =>
      window.gastronomy.addOrderItem(input),
    {
      secondRound: true,
      onSuccess: (_saved, variables) => {
        if (currentOrderId.current !== variables.orderId) return;
        setSearch((current) => current === submittedAddSearchRef.current ? "" : current);
        window.setTimeout(() => searchRef.current?.focus(), 50);
      },
      onError: (value) => setError(humanError(value)),
      onSettled: () => {
        addItemLockRef.current = false;
      },
    },
  );
  const addCombo = useOrderEntryMutation((input: Parameters<typeof window.gastronomy.addComboItem>[0]) => window.gastronomy.addComboItem(input), {
    onSuccess: () => { setComboProduct(null); setComboAddError(null); setSearch(""); window.setTimeout(() => searchRef.current?.focus(), 50); },
    onError: (value) => { const message = humanError(value); setComboAddError(message); setError(message); },
    onSettled: () => { addComboLockRef.current = false; },
  });
  const productPrice = (product: ProductDto) => {
    if (!order) return null;
    const code = order.type === "DINE_IN" ? "SALON" : order.type;
    return (
      product.prices.find((price) => price.priceListCode === code)
        ?.amountMinor ?? null
    );
  };
  const addCatalogUnit = (product: ProductDto) => {
    if (!order || locked || addItemLockRef.current || addItem.isPending) return;
    if (productPrice(product) == null) {
      setError("El producto no tiene un precio configurado para este canal.");
      return;
    }
    addItemLockRef.current = true;
    submittedAddSearchRef.current = search;
    setError(null);
    addItem.mutate({ orderId: order.id, productId: product.id, quantity: 1 });
  };
  const handleProductCardClick = (product: ProductDto) => {
    if (locked || addItemLockRef.current || addItem.isPending || addCombo.isPending) return;
    if (product.comboDefinition) { setComboProduct(product); return; }
    const variants = variantsByParent.get(product.id) ?? [];
    if (variants.length > 0) {
      searchRef.current?.blur();
      setVariantPickerProduct(product);
    } else {
      addCatalogUnit(product);
    }
  };
  const updateItemQuantity = useOrderEntryMutation(
    (input: { orderId: string; itemId: string; quantity: number }) =>
      window.gastronomy.updateOrderItemQuantity(input),
    {
      onError: (value) => setError(humanError(value)),
    },
  );
  const [qtyInputs, setQtyInputs] = useState<Record<string, string>>({});

  const commitQuantity = (item: OrderItemDto) => {
    const raw = qtyInputs[item.id];
    if (raw === undefined) return;
    setQtyInputs((prev) => {
      const next = { ...prev };
      delete next[item.id];
      return next;
    });
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed > 0 && parsed !== item.quantity) {
      if (order) {
        updateItemQuantity.mutate({
          orderId: order.id,
          itemId: item.id,
          quantity: parsed,
        });
      }
    }
  };

  const handleStepQuantity = (item: OrderItemDto, delta: number) => {
    if (locked || updateItemQuantity.isPending || !order) return;
    const newQty = item.quantity + delta;
    if (newQty < 1) return;
    setQtyInputs((prev) => {
      const next = { ...prev };
      delete next[item.id];
      return next;
    });
    updateItemQuantity.mutate({
      orderId: order.id,
      itemId: item.id,
      quantity: newQty,
    });
  };
  const removeItem = useOrderEntryMutation(
    (input: { orderId: string; itemId: string }) =>
      window.gastronomy.removeOrderItem(input),
    { onError: (value) => setError(humanError(value)) },
  );
  const removeModifier = useOrderEntryMutation(
    (input: { orderId: string; modifierId: string }) =>
      window.gastronomy.removeOrderItemModifier(input),
    { onError: (value) => setError(humanError(value)) },
  );
  const updateItemNotes = useOrderEntryMutation(
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
  const updateItemPrice = useApiMutation(
    (input: UpdateOrderItemPriceInput) =>
      window.gastronomy.updateOrderItemPrice(input),
    {
      onSuccess: (_updated, input) => {
        if (currentOrderId.current === input.orderId) setPriceItemId(null);
      },
      onError: (value, input) => {
        if (currentOrderId.current === input.orderId)
          setPriceError(humanError(value));
      },
    },
  );
  const updateStatus = useOrderDispatchMutation(
    (input: { orderId: string; status: OrderOperationalStatus }) =>
      window.gastronomy.updateOrderStatus(input),
    "state",
    {
      onSuccess: (_data, variables) => {
        if (variables.status === "DELIVERED") {
          onClose();
        }
      },
      onError: (value) => setError(humanError(value)),
    },
  );
  const assignDriver = useOrderDispatchMutation(
    (input: Parameters<typeof window.gastronomy.assignDeliveryDriver>[0]) =>
      window.gastronomy.assignDeliveryDriver(input),
    "assign",
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
  const confirmSnapshots = useRef(new WeakMap<object, { bootstrap?: BootstrapDto; order?: OrderDto }>());
  const confirm = useApiMutation(
    (input: { orderId: string }) => window.gastronomy.confirmOrder(input),
    {
      onMutate: (input) => {
        const state = queryClient.getQueryState<BootstrapDto>(bootstrapKey);
        const order = state?.data?.orders.find((row) => row.id === input.orderId);
        if (state?.data && !state.isInvalidated && state.fetchStatus === "idle" &&
            order?.type === "TAKEAWAY" && order.lifecycleStatus === "DRAFT" && order.version !== undefined)
          confirmSnapshots.current.set(input, { bootstrap: state.data, order });
      },
      applyBootstrapResult: async (confirmed, input) => {
        const snapshot = confirmSnapshots.current.get(input);
        confirmSnapshots.current.delete(input);
        if (!snapshot?.bootstrap || !snapshot.order || queryClient.getQueryData(bootstrapKey) !== snapshot.bootstrap) return false;
        const delta = await window.gastronomy.getOrderPrintState({
          orderId: input.orderId, includeConfirmation: true,
        });
        return applyTakeawayConfirmation(queryClient, snapshot.bootstrap, snapshot.order, confirmed, delta);
      },
      onError: (value) => setError(humanError(value)),
    },
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
  const runPrint = (input: OrderPrintRequest) => {
    let confirmed = false;
    return orderPrintCoordinator.run(input, () => {
      confirmed = true;
      return refreshOrderPrintState(queryClient, input.orderId, true);
    }, () => input.confirmFirst && !confirmed
      ? queryClient.invalidateQueries({ queryKey: bootstrapKey })
      : refreshOrderPrintState(queryClient, input.orderId));
  };
  const print = useMutation({
      mutationFn: runPrint, retry: false,
      onSuccess: (result, input) => {
        if (currentOrderId.current !== input.orderId) return;
        const label = input.kind === "KITCHEN_ORDER" ? "Comanda" : "Cuenta";
        setSkippedPrintKind(result.status === "SKIPPED" ? input.kind : null);
        setPrintFeedback(
          result.status === "SKIPPED"
            ? `${label} no impresa. Podés continuar trabajando y volver a imprimirla cuando quieras.`
            : isDemoMode
              ? `${label} simulada; no se envió a una impresora.`
              : `${label} enviada a la impresora.`,
        );
        setPrintConfirmKind(null);
      },
      onError: (value, input) => { if (currentOrderId.current === input.orderId) setError(humanError(value)); },
  });
  const retryPrint = useMutation({
      mutationFn: runPrint, retry: false,
      onSuccess: (_result, input) => { if (currentOrderId.current === input.orderId) setError(null); },
      onError: (value, input) => { if (currentOrderId.current === input.orderId) setError(humanError(value)); },
  });

  useEffect(() => {
    setPrintFeedback(null);
    setError(null);
    setPrintConfirmKind(null);
    setSkippedPrintKind(null);
    setVariantPickerProduct(null);
    setNotesItemId(null);
    setNotesError(null);
  }, [orderId]);

  const pendingPrint = order
    ? data.printJobs.find(
        (job) =>
          job.orderId === order.id &&
          !(job.id === orderPrint?.resultJobId && (orderPrint.status === "PRINTED" || orderPrint.status === "SKIPPED")) &&
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
  if (orderPrint?.status === "PRINTED") printedKinds.add(orderPrint.kind);
  if (order && (order.kitchenPrintedQuantities === null ||
    Object.keys(order.kitchenPrintedQuantities ?? {}).length > 0)) {
    printedKinds.add("KITCHEN_ORDER");
  }
  const kitchenAdditions = order ? getKitchenAdditions(order) : [];
  const requestPrint = (kind: "KITCHEN_ORDER" | "CUSTOMER_BILL") => {
    if (!order || orderPrintBusy || pendingPrint) return;
    setPrintFeedback(null);
    setError(null);
    if (printedKinds.has(kind)) {
      setKitchenPrintScope(kitchenAdditions.length > 0 ? "ADDED" : "FULL");
      setPrintConfirmKind(kind);
      return;
    }
    print.mutate({
      orderId: order.id,
      orderNumber: order.number,
      kind,
      confirmFirst:
        kind === "KITCHEN_ORDER" && order.lifecycleStatus === "DRAFT",
    });
  };

  useEffect(() => {
    if (!workspaceActive || !orderId || !order || detailsOpen) return;
    const handler = (event: KeyboardEvent) => {
      if (event.repeat) return;
      const nestedDialogOpen =
        payOpen ||
        depositOpen ||
        refundOpen ||
        halfOpen ||
        cancelOpen ||
        changeTableOpen ||
        discountOpen ||
        discardConfirmOpen ||
        driverOpen ||
        Boolean(printConfirmKind) ||
        Boolean(comboProduct) ||
        Boolean(variantPickerProduct) ||
        Boolean(modifierItemId) ||
        Boolean(notesItemId) ||
        Boolean(priceItem);
      if (nestedDialogOpen) return;

      if (event.key === "F6") {
        if (canOpenHalf && !locked) {
          event.preventDefault();
          openHalfPicker();
        }
        return;
      }

      if (event.key === "F7") {
        const canPrintComanda =
          order.items.length > 0 && !orderPrintBusy && !Boolean(pendingPrint);
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
    cancelOpen,
    comboProduct,
    changeTableOpen,
    depositOpen,
    discardConfirmOpen,
    discountOpen,
    driverOpen,
    halfOpen,
    canOpenHalf,
    modifierItemId,
    notesItemId,
    priceItem,
    order,
    orderId,
    payOpen,
    pendingPrint,
    printConfirmKind,
    orderPrintBusy,
    refundOpen,
    variantPickerProduct,
    workspaceActive,
    detailsOpen,
  ]);

  if (!order) return orderId ? (
    <Modal open onClose={onClose} title="Abrir pedido" width="max-w-lg">
      {historicalOrder.isError ? (
        <div className="space-y-3">
          <p role="alert">{humanError(historicalOrder.error)}</p>
          <Button type="button" onClick={() => void historicalOrder.refetch()}>Reintentar</Button>
        </div>
      ) : <p role="status">Cargando pedido…</p>}
    </Modal>
  ) : null;
  const locked = ["DELIVERED", "CANCELLED"].includes(order.operationalStatus);
  const isDraft = order.lifecycleStatus === "DRAFT";

  const categoryHalves = availableHalves.filter((product) => product.categoryId === categoryId);
  const showHalfAndHalfCard = canOpenHalf && !locked &&
    (isHalfAndHalfSearch || (categoryHalves.length > 0 && !search.trim()));
  const canConfirm = guardOrderAction(order, "CONFIRM");
  const canDeliver = guardOrderAction(order, "DELIVER");
  const confirmReprint = () => {
    if (!printConfirmKind || orderPrintBusy || pendingPrint) return;
    if (printConfirmKind === "KITCHEN_ORDER" && kitchenPrintScope === "ADDED" && !kitchenAdditions.length) return;
    setPrintFeedback(null);
    setError(null);
    setPrintConfirmKind(null);
    print.mutate({
      orderId: order.id,
      orderNumber: order.number,
      kind: printConfirmKind,
      ...(printConfirmKind === "KITCHEN_ORDER" ? { kitchenScope: kitchenPrintScope } : {}),
    });
  };
  const editorBusy =
    addItem.isPending ||
    addCombo.isPending ||
    updateItemQuantity.isPending ||
    removeItem.isPending ||
    removeModifier.isPending ||
    updateItemNotes.isPending ||
    updateItemPrice.isPending ||
    updateStatus.isPending ||
    assignDriver.isPending ||
    confirm.isPending ||
    discard.isPending ||
    orderPrint?.status === "PREPARING";
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
      closeDisabled={editorBusy || (detailsOpen && detailsState.pending)}
      confirmClose={detailsOpen && detailsState.dirty}
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
      {data.cashSession?.id !== order.cashSessionCreatedId && !locked ? (
        <p className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Este pedido pertenece a un turno anterior. Podés revisarlo y finalizarlo conservando su historial.
        </p>
      ) : null}
      <div className="order-editor-layout grid min-h-0 gap-3 min-[900px]:grid-cols-[1.1fr_.9fr] lg:gap-4 lg:grid-cols-[1.35fr_.9fr]">
        {detailsOpen ? (
          <div className="min-h-0 min-w-0 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50/70 p-3">
            <NewOrderModal
              inline
              open
              type={order.type}
              data={data}
              editingOrder={order}
              initialCustomer={null}
              onFormStateChange={setDetailsState}
              onClose={returnToProducts}
              onSaved={returnToProducts}
            />
          </div>
        ) : null}
        <section hidden={detailsOpen} className={cn("min-h-0 min-w-0 flex-col rounded-xl border border-slate-200 bg-slate-50/70 p-3", detailsOpen ? "hidden" : "flex")}>
          {order.type !== "DINE_IN" && order.paidMinor === 0 && !locked ? (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-600">
                {order.customerNameSnapshot || "Cliente pendiente"}
              </span>
              <Button type="button" variant="secondary" disabled={editorBusy} onClick={() => setDetailsOpen(true)}>
                Cliente y envío
              </Button>
            </div>
          ) : null}
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
                const canNavigateProducts =
                  !event.nativeEvent.isComposing &&
                  !event.altKey &&
                  !event.ctrlKey &&
                  !event.metaKey &&
                  !event.shiftKey;
                if (
                  canNavigateProducts &&
                  (event.key === "ArrowDown" || event.key === "ArrowRight")
                ) {
                  event.preventDefault();
                  setActiveProductIndex((prev) =>
                    products.length ? (prev + 1) % products.length : 0,
                  );
                  return;
                }
                if (
                  canNavigateProducts &&
                  (event.key === "ArrowUp" || event.key === "ArrowLeft")
                ) {
                  event.preventDefault();
                  setActiveProductIndex((prev) =>
                    products.length
                      ? (prev - 1 + products.length) % products.length
                      : 0,
                  );
                  return;
                }
                if (
                  event.key === "Enter" &&
                  !event.repeat &&
                  !locked &&
                  !addItem.isPending &&
                  !variantPickerProduct &&
                  !halfOpen
                ) {
                  if (
                    canOpenHalf &&
                    isHalfAndHalfSearch &&
                    (!products.length || activeProductIndex === 0)
                  ) {
                    event.preventDefault();
                    event.stopPropagation();
                    openHalfPicker();
                    return;
                  }
                  const targetProduct =
                    products[activeProductIndex] ?? products[0];
                  if (targetProduct) {
                    event.preventDefault();
                    event.stopPropagation();
                    handleProductCardClick(targetProduct);
                  }
                }
              }}
              placeholder={`Código, nombre, categoría… · Enter agrega${canOpenHalf ? " · F6 mitad y mitad" : ""} · ↑ ↓ ← → navega`}
              className="bg-white pl-9"
              disabled={locked}
            />
          </div>
          <div className="mt-2 flex items-center gap-2 overflow-x-auto pb-1">
            <button
              onClick={() => setCategoryId(null)}
              className={cn(
                "min-h-10 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-bold",
                !categoryId
                  ? "bg-brand-700 text-white"
                  : "bg-white text-slate-600",
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
                    "min-h-10 whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs font-semibold",
                    categoryId === category.id
                      ? "border-brand-600 bg-brand-50 text-brand-700"
                      : "border-slate-200 bg-white text-slate-600 hover:border-brand-200 hover:text-brand-700",
                  )}
                >
                  {category.name}
                </button>
              ))}
          </div>
          <div className="order-editor-products mt-2 grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto p-1.5 xl:grid-cols-3">
            {showHalfAndHalfCard ? (
              <div
                id="order-editor-half-and-half-card"
                role="button"
                tabIndex={0}
                onClick={() => openHalfPicker()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    openHalfPicker();
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
                      <CircleHalf className="text-brand-600 shrink-0" size={16} />
                      <p className="line-clamp-2 text-[12px] font-bold text-brand-900">
                        Armar mitad y mitad
                      </p>
                    </div>
                    <span className="inline-flex shrink-0 items-center rounded bg-brand-200/80 px-1.5 py-0.5 text-xs font-bold text-brand-800">
                      F6
                    </span>
                  </div>
                  <span className="text-xs font-semibold uppercase tracking-wide text-brand-700">
                    {categoryHalves[0]?.categoryName ?? "Variedades combinables"}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-600">
                    Elegir 2 variedades
                  </span>
                  <span className="text-xs font-bold text-brand-700">
                    Elegir →
                  </span>
                </div>
              </div>
            ) : null}
            {products.map((product, index) => {
              const code = order.type === "DINE_IN" ? "SALON" : order.type;
              const price = product.prices.find(
                (item) => item.priceListCode === code,
              )?.amountMinor;
              const variants = variantsByParent.get(product.id) ?? [];
              const hasVariants = variants.length > 0;
              const disabled =
                locked || addItem.isPending || (!hasVariants && price == null);
              const isSelected = index === activeProductIndex;

              return (
                <div key={product.id} className="relative m-1">
                  <div
                    id={`order-editor-product-${index}`}
                    role="button"
                    tabIndex={disabled ? -1 : 0}
                    aria-disabled={disabled}
                    onMouseEnter={() => setActiveProductIndex(index)}
                    onClick={(event) => {
                      if (event.detail > 1) return;
                      if (!disabled) handleProductCardClick(product);
                    }}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget || disabled) return;
                      if (
                        event.repeat &&
                        (event.key === "Enter" || event.key === " ")
                      ) {
                        event.preventDefault();
                        return;
                      }
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        event.stopPropagation();
                        handleProductCardClick(product);
                      }
                    }}
                    className={cn(
                      "focus-ring group flex min-h-[76px] cursor-pointer flex-col justify-between rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-brand-300 hover:shadow-sm scroll-m-2",
                      isSelected &&
                        "border-brand-500 ring-2 ring-brand-500/80 shadow-md bg-brand-50/20",
                      disabled && "cursor-not-allowed opacity-50",
                    )}
                  >
                  <div>
                    <div className="flex items-start justify-between gap-1">
                      <p className="line-clamp-2 text-[12px] font-bold text-slate-800 group-hover:text-brand-800">
                        {product.name}
                      </p>
                      {hasVariants ? (
                        <span className="inline-flex shrink-0 items-center rounded bg-brand-50 px-1.5 py-0.5 text-xs font-bold text-brand-700">
                          {variants.length + 1} opciones
                        </span>
                      ) : null}
                    </div>
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">
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
                            addCatalogUnit(product);
                          }}
                          title={`Agregar ${product.name} (Base) - ${formatMoney(price)}`}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs font-bold text-slate-700 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800"
                        >
                          <span>Base</span>
                          <span className="text-brand-700">
                            {formatMoney(price)}
                          </span>
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
                              addCatalogUnit(v);
                            }}
                            title={`Agregar ${v.name} - ${vPrice == null ? "Sin precio" : formatMoney(vPrice)}`}
                            className="inline-flex items-center gap-1 rounded-md border border-brand-200 bg-brand-50/70 px-1.5 py-0.5 text-xs font-bold text-brand-800 transition hover:border-brand-400 hover:bg-brand-100"
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
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                        {product.code ? `#${product.code}` : ""}
                      </span>
                      <span className="text-xs font-extrabold text-brand-700">
                        {price == null ? "Sin precio" : formatMoney(price)}
                      </span>
                    </div>
                  )}
                  </div>
                  {!hasVariants && availableHalfIds.has(product.id) ? (
                    <div className="flex justify-end px-1 pb-1 pt-0.5">
                      <button
                        type="button"
                        className="rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-brand-700 hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                        aria-label={`Mitad y mitad: ${product.name}`}
                        disabled={locked || addItem.isPending}
                        onClick={() => openHalfPicker(product.id)}
                      >
                        Mitad y mitad
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          <Button
            variant="secondary"
            className="mt-2 w-full"
            onClick={() => openHalfPicker()}
            disabled={!canOpenHalf || locked}
          >
            <CircleHalf size={17} /> Armar mitad y mitad{" "}
            {canOpenHalf ? <kbd className="text-xs">F6</kbd> : null}
          </Button>
        </section>
        <fieldset disabled={detailsOpen} aria-label="Detalle del pedido" className="m-0 flex min-h-0 min-w-0 flex-col rounded-xl border border-slate-200 bg-white p-0">
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
              <p className="mt-1 text-xs text-slate-600">
                {order.items.length} línea(s) · Guardado
              </p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className="text-xs font-bold text-slate-600">
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
                  className="inline-flex items-center gap-1 text-xs font-bold text-brand-700 hover:underline"
                >
                  <Motorcycle size={12} />
                  {order.driverName ?? "Asignar repartidor"}
                </button>
              ) : null}
            </div>
          </header>
          <div className="order-editor-items min-h-0 flex-1 overflow-y-auto p-3">
            {order.items.length ? (
              <div className="space-y-1.5">
                {order.items.map((item) => (
                  <article
                    key={item.id}
                    className="group rounded-xl border border-slate-100 bg-slate-50/70 p-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          {!locked ? (
                            <div className="inline-flex shrink-0 items-center rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm">
                              <button
                                type="button"
                                onClick={() => handleStepQuantity(item, -1)}
                                disabled={
                                  item.quantity <= 1 ||
                                  updateItemQuantity.isPending
                                }
                                className="grid h-6 w-6 place-items-center rounded text-slate-600 transition hover:bg-slate-100 active:scale-95 disabled:pointer-events-none disabled:opacity-30"
                                aria-label={`Restar una unidad de ${item.productNameSnapshot}`}
                                title="Restar una unidad"
                              >
                                <Minus size={11} weight="bold" />
                              </button>
                              <input
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                value={
                                  qtyInputs[item.id] ?? String(item.quantity)
                                }
                                onChange={(e) =>
                                  setQtyInputs((prev) => ({
                                    ...prev,
                                    [item.id]: e.target.value.replace(
                                      /\D/g,
                                      "",
                                    ),
                                  }))
                                }
                                onFocus={(e) => e.currentTarget.select()}
                                onBlur={() => commitQuantity(item)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") e.currentTarget.blur();
                                  if (e.key === "Escape") {
                                    setQtyInputs((prev) => {
                                      const next = { ...prev };
                                      delete next[item.id];
                                      return next;
                                    });
                                  }
                                }}
                                disabled={updateItemQuantity.isPending}
                                className="h-6 w-8 rounded border-0 bg-transparent p-0 text-center text-xs font-black text-slate-800 focus:outline-none focus:ring-1 focus:ring-brand-500"
                                aria-label={`Cantidad de ${item.productNameSnapshot}`}
                              />
                              <button
                                type="button"
                                onClick={() => handleStepQuantity(item, 1)}
                                disabled={updateItemQuantity.isPending}
                                className="grid h-6 w-6 place-items-center rounded text-slate-600 transition hover:bg-slate-100 active:scale-95 disabled:pointer-events-none disabled:opacity-30"
                                aria-label={`Sumar una unidad de ${item.productNameSnapshot}`}
                                title="Sumar una unidad"
                              >
                                <Plus size={11} weight="bold" />
                              </button>
                            </div>
                          ) : (
                            <span className="mr-1 font-bold text-brand-700">
                              {item.quantity}×
                            </span>
                          )}
                          <span className="text-[12px] font-bold text-slate-900 leading-snug">
                            {item.halfAndHalfGroupNameSnapshot ? `${item.halfAndHalfGroupNameSnapshot} mitad y mitad` : item.productNameSnapshot}
                          </span>
                        </div>
                        {item.halves.map((half) => (
                          <p
                            key={half.position}
                            className="ml-2 mt-0.5 text-xs font-semibold text-slate-600"
                          >
                            ½ {half.nameSnapshot}
                          </p>
                        ))}
                        {item.comboComponents?.map((component) => (
                          <p key={`${item.id}-${component.slotId}`} className="ml-2 mt-0.5 text-xs text-slate-600">
                            {component.slotName}: {component.quantity}× {component.nameSnapshot}{component.modifiers.length ? ` · ${component.modifiers.map((modifier) => `+ ${modifier.nameSnapshot}`).join(", ")}` : ""}
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
                            className="ml-2 mt-0.5 block text-left text-xs font-semibold text-brand-700 hover:text-rose-700"
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
                          <p className="ml-2 mt-0.5 text-xs text-amber-800">
                            {item.notes}
                          </p>
                        ) : null}
                        {!locked ? (
                          <div className="ml-1 mt-1 flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setNotesError(null);
                                setNotesItemId(item.id);
                              }}
                              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-bold text-brand-700 hover:bg-brand-50 hover:text-brand-800 transition"
                              aria-label={`${item.notes ? "Editar" : "Agregar"} observación para ${item.productNameSnapshot}`}
                            >
                              <Plus size={10} weight="bold" />
                              {item.notes
                                ? "Editar observación"
                                : "Agregar observación"}
                            </button>
                            {canEditItemPrice ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setPriceError(null);
                                  setPriceItemId(item.id);
                                }}
                                disabled={editorBusy || orderPrintBusy}
                                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-bold text-brand-700 transition hover:bg-brand-50 hover:text-brand-800 disabled:opacity-50"
                                aria-label={`Editar precio de ${item.productNameSnapshot}`}
                              >
                                <PencilSimple size={11} weight="bold" />
                                Editar precio
                              </button>
                            ) : null}
                            {data.modifiers.length ? (
                              <button
                                type="button"
                                onClick={() => setModifierItemId(item.id)}
                                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-bold text-brand-700 hover:bg-brand-50 hover:text-brand-800 transition"
                              >
                                <Plus size={10} weight="bold" />
                                Agregar extra
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
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
                            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
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
                            <Trash size={14} />
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
                  <p className="mt-2 text-xs font-semibold text-slate-600">
                    Agregá productos al pedido
                  </p>
                  <p className="text-xs text-slate-600">
                    Escribí para buscar · Enter selecciona
                  </p>
                </div>
              </div>
            )}
          </div>
          {orderPrintBusy && (
            <p role="status" className="mx-3 mb-2 rounded-lg border border-sky-200 bg-sky-50 p-2 text-xs text-sky-900">
              {orderPrint?.status === "PREPARING"
                ? "Guardando el pedido…"
                : "Enviando a la impresora. Podés cerrar este pedido y seguir trabajando."}
            </p>
          )}
          {pendingPrint && !orderPrintBusy ? (
            <div className="mx-3 mb-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
              <div className="flex items-start justify-between gap-2">
                <span>
                  <b>Impresión pendiente:</b>{" "}
                  {pendingPrint.status === "RECOVERING"
                    ? "La impresión se está reanudando. Esperá el resultado antes de volver a imprimir."
                    : pendingPrint.status === "QUEUED"
                      ? "La aplicación se cerró antes de confirmar el resultado. Verificá primero si el ticket salió para evitar una copia duplicada."
                      : (pendingPrint.lastError ??
                        "La impresora no respondió.")}
                </span>
                <button
                  disabled={
                    orderPrintBusy || retryPrint.isPending || pendingPrint.status === "RECOVERING"
                  }
                  onClick={() => retryPrint.mutate({ orderId: order.id, orderNumber: order.number, kind: pendingPrint.kind, retryJobId: pendingPrint.id })}
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
            <div role="alert" className="mx-3 mb-2 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">
              <X className="mt-0.5 shrink-0" />
              {error}
            </div>
          ) : null}
          {addItem.isPending ? (
            <p role="status" aria-live="polite" className="sr-only">
              Agregando producto al pedido…
            </p>
          ) : null}
          {printFeedback ? (
            <div
              role="status"
              aria-live="polite"
              className="mx-3 mb-2 rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800"
            >
              {printFeedback}
            </div>
          ) : null}
          <footer className="border-t border-slate-100 p-3">
            <div className="mb-3 flex items-end justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Total
                </p>
                {order.discountMinor > 0 ? (
                  <p className="text-xs font-bold text-emerald-700">
                    Descuento −{formatMoney(order.discountMinor)}
                  </p>
                ) : null}
                {order.depositMinor > 0 ? (
                  <p className="text-xs font-bold text-indigo-700">
                    Seña −{formatMoney(order.depositMinor)}
                    {order.depositNotes ? (
                      <span className="ml-1 font-normal text-slate-600">
                        ({order.depositNotes})
                      </span>
                    ) : null}
                  </p>
                ) : null}
                <p className="text-2xl font-extrabold tracking-tight">
                  {formatMoney(order.totalMinor)}
                </p>
              </div>
              <p className="text-right text-xs text-slate-600">
                Pagado {formatMoney(order.paidMinor)}
                <br />
                Saldo{" "}
                {formatMoney(Math.max(0, order.totalMinor - order.paidMinor))}
              </p>
            </div>
            {order.payments.length ? (
              <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 p-2.5">
                <div className="mb-1.5 flex items-center justify-between">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-600">
                    Pagos registrados
                  </p>
                  {order.payments.some(
                    (payment) => payment.refundableMinor > 0,
                  ) ? (
                    <button
                      type="button"
                      onClick={() => setRefundOpen(true)}
                      className="inline-flex items-center gap-1 text-xs font-bold text-brand-700 hover:text-brand-900"
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
                      className="flex items-center justify-between gap-2 text-xs"
                    >
                      <span className="text-slate-600">
                        {payment.methodName}
                        {payment.reference ? (
                          <span className="ml-1 text-slate-600">
                            · Ref. {payment.reference}
                          </span>
                        ) : null}
                        {payment.status === "REFUNDED" ? (
                          <strong className="ml-1.5 text-rose-700">
                            · Devuelto
                          </strong>
                        ) : payment.refundedMinor > 0 ? (
                          <strong className="ml-1.5 text-amber-800">
                            · Devolución parcial
                          </strong>
                        ) : null}
                      </span>
                      <span className="text-right font-bold text-slate-800">
                        {formatMoney(payment.amountMinor)}
                        {payment.refundedMinor > 0 &&
                        payment.refundableMinor > 0 ? (
                          <small className="block text-xs font-semibold text-amber-800">
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
                  orderPrintBusy ||
                  Boolean(pendingPrint)
                }
              >
                <Printer size={16} />{" "}
                {orderPrintBusy
                  ? "Enviando…"
                  : skippedPrintKind === "KITCHEN_ORDER"
                    ? "Reintentar comanda"
                    : isDraft
                      ? "Confirmar e imprimir"
                      : printedKinds.has("KITCHEN_ORDER")
                        ? "Reimprimir comanda"
                        : "Comanda"}{" "}
                <kbd className="text-xs">F7</kbd>
              </Button>
              <Button
                variant="secondary"
                onClick={() => requestPrint("CUSTOMER_BILL")}
                disabled={
                  !order.items.length ||
                  isDraft ||
                  orderPrintBusy ||
                  Boolean(pendingPrint)
                }
              >
                <Printer size={16} />{" "}
                {orderPrintBusy
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
                <kbd className="text-xs">F8</kbd>
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
            {order.type !== "DINE_IN" && (order.paidMinor === 0 || onEditDraft) && !locked ? (
              <Button
                variant="secondary"
                className="mt-2 w-full"
                disabled={editorBusy}
                onClick={() => order.paidMinor === 0 ? setDetailsOpen(true) : onEditDraft?.(order.id)}
              >
                <ArrowLeft size={16} />
                {order.paidMinor > 0
                  ? "Cambiar cliente, modalidad o envío (requiere autorización)"
                  : "Volver a datos del cliente y envío"}
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
                {!canConfirm.allowed && canConfirm.reason ? (
                  <p className="col-span-2 text-xs text-slate-600" role="status">{canConfirm.reason}</p>
                ) : null}
              </div>
            ) : null}
            {!locked &&
            (order.items.length ||
              order.depositMinor > 0 ||
              (order.type === "DINE_IN" && order.tableId)) ? (
              <div
                className={cn(
                  "mt-2 grid gap-2",
                  (order.type === "DINE_IN" && order.tableId) ||
                    order.items.length
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
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={() => setDepositOpen(true)}
                >
                  <Receipt size={15} />
                  {order.depositMinor > 0 ? "Modificar seña" : "Restar seña"}
                </Button>
                {order.type === "DINE_IN" && order.tableId ? (
                  <Button
                    variant="secondary"
                    className={cn(
                      "w-full",
                      order.items.length ? "col-span-2" : "col-span-1",
                    )}
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
                className="mt-2 w-full py-1.5 text-xs font-bold text-rose-700 hover:text-rose-700"
              >
                Cancelar pedido
              </button>
            ) : null}
          </footer>
        </fieldset>
      </div>
      <SelectVariantModal
        open={Boolean(variantPickerProduct)}
        parentProduct={variantPickerProduct}
        variants={
          variantPickerProduct
            ? variantsByParent.get(variantPickerProduct.id) ?? []
            : []
        }
        orderType={order.type}
        initialQuery={search}
        onSelect={(product) => {
          setVariantPickerProduct(null);
          addCatalogUnit(product);
        }}
        onClose={() => {
          setVariantPickerProduct(null);
          window.setTimeout(() => searchRef.current?.focus(), 50);
        }}
      />
      {halfOpen && canOpenHalf && <HalfAndHalfModal
        order={order}
        products={categoryHalves.length && (!halfFirstId || categoryHalves.some(({ id }) => id === halfFirstId)) ? categoryHalves : availableHalves}
        firstProductId={halfFirstId}
        onClose={() => {
          setHalfOpen(false);
          setSearch("");
          window.setTimeout(() => searchRef.current?.focus(), 50);
        }}
      />}
      <ComboOrderModal open={Boolean(comboProduct)} product={comboProduct} data={data} orderType={order.type} pending={addCombo.isPending} error={comboAddError} onClose={() => { if (!addCombo.isPending) { setComboProduct(null); setComboAddError(null); } }} onSelect={(product, selections, quantity, idempotencyKey) => {
        if (!order || addComboLockRef.current || addCombo.isPending) return;
        addComboLockRef.current = true;
        setComboAddError(null);
        addCombo.mutate({ orderId: order.id, comboProductId: product.id, selections, quantity, idempotencyKey });
      }} />
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
      {priceItem ? (
        <OrderItemPriceModal
          key={priceItem.id}
          item={priceItem}
          onClose={() => setPriceItemId(null)}
          onSave={(unitPriceMinor, authorizerPin) => {
            setPriceError(null);
            updateItemPrice.mutate({
              orderId: order.id,
              itemId: priceItem.id,
              unitPriceMinor,
              authorizerPin,
            });
          }}
          isPending={updateItemPrice.isPending}
          error={priceError}
        />
      ) : null}
      <DiscountModal
        open={discountOpen}
        order={order}
        onClose={() => setDiscountOpen(false)}
        onError={setError}
      />
      <DepositModal
        open={depositOpen}
        order={order}
        onClose={() => setDepositOpen(false)}
        onError={setError}
      />
      <PaymentModal
        open={payOpen}
        order={order}
        data={data}
        onClose={() => {
          setPayOpen(false);
          if (completeOnPay) {
            onClose();
          }
        }}
        onError={setError}
        completeOnPay={completeOnPay}
        onOpenDeposit={() => setDepositOpen(true)}
      />
      <RefundPaymentModal
        open={refundOpen}
        order={order}
        data={data}
        onClose={() => setRefundOpen(false)}
        onGoToSettlements={() => {
          setRefundOpen(false);
          onClose();
          navigate("/repartidores");
        }}
        onError={setError}
      />
      <CancelModal
        open={cancelOpen}
        order={order}
        onClose={() => setCancelOpen(false)}
        onCancelled={onClose}
        onError={setError}
      />
      {changeTableOpen && <ChangeTableModal
        open
        order={order}
        data={data}
        onClose={() => setChangeTableOpen(false)}
        onError={setError}
      />}
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
          {data.deliveryLedger.some(
            (entry) => entry.orderId === order.id && entry.status === "SETTLED",
          ) ? (
            <div className="grid gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs text-amber-950">
                Revertí primero desde Repartidores &gt; Revertir liquidación. La
                reasignación se habilitará después de registrar la devolución
                física del dinero.
              </p>
              <Button
                type="button"
                variant="secondary"
                className="justify-self-start"
                onClick={() => {
                  setDriverOpen(false);
                  onClose();
                  navigate("/repartidores");
                }}
              >
                Ir a Repartidores
              </Button>
            </div>
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
        closeDisabled={orderPrintBusy}
        title="Confirmar reimpresión"
        description="Se enviará una nueva impresión"
      >
        <div className="grid gap-4">
          {printConfirmKind === "KITCHEN_ORDER" ? (
            <>
              <fieldset className="grid gap-3">
                <legend className="mb-3 text-sm font-semibold">¿Qué querés imprimir?</legend>
                <label className={cn("flex items-start gap-3 rounded-xl border p-3", !kitchenAdditions.length && "opacity-60")}>
                  <input
                    type="radio"
                    name="kitchen-print-scope"
                    aria-label="Sólo lo agregado"
                    value="ADDED"
                    checked={kitchenPrintScope === "ADDED"}
                    disabled={!kitchenAdditions.length || orderPrintBusy}
                    onChange={() => setKitchenPrintScope("ADDED")}
                  />
                  <span className="text-sm"><strong>Sólo lo agregado</strong><span className="mt-1 block text-xs">Productos y cantidades nuevos desde la última comanda impresa.</span></span>
                </label>
                <label className="flex items-start gap-3 rounded-xl border p-3">
                  <input
                    type="radio"
                    name="kitchen-print-scope"
                    aria-label="Comanda completa"
                    value="FULL"
                    checked={kitchenPrintScope === "FULL"}
                    disabled={orderPrintBusy}
                    onChange={() => setKitchenPrintScope("FULL")}
                  />
                  <span className="text-sm"><strong>Comanda completa</strong><span className="mt-1 block text-xs">Todos los productos del pedido actual.</span></span>
                </label>
              </fieldset>
              {kitchenAdditions.length > 0 ? (
                <div className="rounded-xl bg-slate-50 p-3 text-sm">
                  <p className="font-semibold">Agregados pendientes</p>
                  <ul className="mt-2 space-y-1">
                    {kitchenAdditions.map((item) => <li key={item.id}>{item.quantity} × {item.productNameSnapshot}</li>)}
                  </ul>
                </div>
              ) : <p className="text-sm text-slate-600">{order.kitchenPrintedQuantities == null
                ? "Esta comanda es anterior al registro de agregados. Imprimí la completa una vez para habilitar la impresión parcial."
                : "No hay productos nuevos para imprimir."}</p>}
              <p className="text-xs text-slate-600">Para cambios en observaciones o bajas de productos ya enviados, elegí la comanda completa.</p>
            </>
          ) : (
            <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900">
              Ya se imprimió esta cuenta. ¿Querés crear otra copia?
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setPrintConfirmKind(null)}
              disabled={orderPrintBusy}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={confirmReprint}
              disabled={!printConfirmKind || orderPrintBusy || (printConfirmKind === "KITCHEN_ORDER" && kitchenPrintScope === "ADDED" && !kitchenAdditions.length)}
            >
              {orderPrintBusy ? "Enviando…" : "Reimprimir"}
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
  }, [open, item?.id]);

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
          <p id="item-notes-helper" className="text-xs text-slate-600">
            Sólo se imprime en la comanda; no aparece en la cuenta del cliente.
          </p>
          <p
            id="item-notes-counter"
            className="text-right text-xs text-slate-600"
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
  data,
  onClose,
  onGoToSettlements,
  onError,
}: {
  open: boolean;
  order: OrderDto;
  data: BootstrapDto;
  onClose(): void;
  onGoToSettlements(): void;
  onError(value: string): void;
}) {
  const refundable = order.payments.filter(
    (payment) => payment.refundableMinor > 0,
  );
  const [paymentId, setPaymentId] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [pin, setPin] = useState("");
  const [reverseDeliverySettlement, setReverseDeliverySettlement] =
    useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const settledLedger = data.deliveryLedger.some(
    (entry) => entry.orderId === order.id && entry.status === "SETTLED",
  );
  useEffect(() => {
    if (open) {
      setPaymentId(refundable[0]?.id ?? "");
      setAmount(
        String((refundable[0]?.refundableMinor ?? 0) / 100).replace(".", ","),
      );
      setReason("");
      setPin("");
      setReverseDeliverySettlement(false);
      setLocalError(null);
    }
  }, [open, order.id]);
  const selected = refundable.find((payment) => payment.id === paymentId);
  const selectedAmountMinor = parseMoneyInput(amount) ?? 0;
  const canRefund = Boolean(
    selected &&
    selectedAmountMinor > 0 &&
    selectedAmountMinor <= selected.refundableMinor,
  );
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
      description="Elegí el importe a devolver; queda registrado con motivo y autorización"
    >
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          const submittedPaymentId = String(formData.get("paymentId") ?? "");
          const submittedReason = String(formData.get("reason") ?? "").trim();
          const submittedPin = String(formData.get("authorizerPin") ?? "");
          const submittedAmount = parseMoneyInput(
            String(formData.get("amountMinor") ?? ""),
          );
          const submittedReverse =
            formData.get("reverseDeliverySettlement") === "on";
          if (
            !submittedPaymentId ||
            submittedAmount == null ||
            submittedAmount <= 0 ||
            !selected ||
            submittedAmount > selected.refundableMinor ||
            !submittedReason ||
            submittedPin.length < 4 ||
            (settledLedger && !submittedReverse) ||
            mutation.isPending
          ) {
            setLocalError(
              "Verificá el importe disponible, el motivo, el PIN y la autorización de reversión de liquidación.",
            );
            return;
          }
          mutation.mutate({
            orderId: order.id,
            paymentId: submittedPaymentId,
            amountMinor: submittedAmount,
            reason: submittedReason,
            authorizerPin: submittedPin,
            reverseDeliverySettlement: submittedReverse,
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
            onChange={(event) => {
              const nextId = event.target.value;
              setPaymentId(nextId);
              const nextPayment = refundable.find(
                (payment) => payment.id === nextId,
              );
              setAmount(
                String((nextPayment?.refundableMinor ?? 0) / 100).replace(
                  ".",
                  ",",
                ),
              );
              setLocalError(null);
            }}
          >
            {refundable.map((payment) => (
              <option key={payment.id} value={payment.id}>
                {payment.methodName} · {formatMoney(payment.refundableMinor)}
              </option>
            ))}
          </Select>
        </Field>
        {selected ? (
          <>
            <Field
              label={`Importe a devolver · máximo ${formatMoney(selected.refundableMinor)}`}
            >
              <Input
                name="amountMinor"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </Field>
            {selected.methodCode === "ACCOUNT" ? (
              <p className="-mt-2 text-xs text-amber-800">
                Esto reduce la deuda pendiente del cliente. Si ya abonó esta
                deuda, el sistema puede rechazar la devolución: corregí el
                recibo de pago del cliente.
              </p>
            ) : selected.methodCode === "CASH" && order.collectedByDriver ? (
              <p className="-mt-2 text-xs text-amber-800">
                Este efectivo lo cobró el repartidor: coordiná la devolución al
                cliente con él. No se descontará de la caja del negocio.
              </p>
            ) : selected.methodCode === "CASH" ? (
              <p className="-mt-2 text-xs text-slate-600">
                La devolución en efectivo se descontará de la caja del negocio.
              </p>
            ) : null}
          </>
        ) : null}
        {settledLedger ? (
          <div className="grid gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <label className="flex items-start gap-2 text-xs text-amber-950">
              <input
                name="reverseDeliverySettlement"
                type="checkbox"
                checked={reverseDeliverySettlement}
                onChange={(event) =>
                  setReverseDeliverySettlement(event.target.checked)
                }
              />
              <span>
                Confirmo que se realizó físicamente la devolución del dinero de
                la liquidación al repartidor. También se revertirá su registro;
                no confirmes antes de hacer el movimiento real.
              </span>
            </label>
            <Button
              type="button"
              variant="secondary"
              className="justify-self-start"
              onClick={onGoToSettlements}
            >
              Ir a Repartidores para revertir la liquidación
            </Button>
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
          <Button
            type="submit"
            variant="danger"
            disabled={
              mutation.isPending ||
              !canRefund ||
              !reason.trim() ||
              pin.length < 4 ||
              (settledLedger && !reverseDeliverySettlement)
            }
          >
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
  const mutation = useOrderEntryMutation(
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
        <Field label="Modificador">
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
      description="Ingresá el PIN para autorizar el cambio"
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

function DepositModal({
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
  const [value, setValue] = useState("");
  const [notes, setNotes] = useState("");
  const [pin, setPin] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setValue(order.depositMinor > 0 ? moneyInputValue(order.depositMinor) : "");
    setNotes(order.depositNotes ?? "");
    setPin("");
    setLocalError(null);
  }, [open, order.id, order.depositMinor, order.depositNotes]);

  const mutation = useApiMutation(
    (input: Parameters<typeof window.gastronomy.applyOrderDeposit>[0]) =>
      window.gastronomy.applyOrderDeposit(input),
    {
      onSuccess: () => onClose(),
      onError: (error) => {
        const message = humanError(error);
        setLocalError(message);
        onError(message);
      },
    },
  );

  const parsed = parseMoneyInput(value);
  const currentBase =
    order.subtotalMinor + order.deliveryFeeMinor - order.discountMinor;
  const isDepositOverBase =
    parsed != null && parsed > 0 && parsed > currentBase;

  const handleApply = (depositAmount: number, depositNotes: string) => {
    if (pin.length < 4) {
      setLocalError("Ingresá el PIN de un usuario autorizado.");
      return;
    }
    mutation.mutate({
      orderId: order.id,
      depositMinor: depositAmount,
      notes: depositNotes.trim() || null,
      authorizerPin: pin,
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      closeDisabled={mutation.isPending}
      title={order.depositMinor > 0 ? "Modificar seña" : "Restar seña"}
      description="Movimiento sensible. Requiere autorización y resta el importe del total a cobrar"
    >
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (
            parsed == null ||
            parsed < 0 ||
            pin.length < 4 ||
            mutation.isPending
          )
            return;
          handleApply(parsed, notes);
        }}
      >
        <Field
          label="Importe de la seña"
          hint="Se descontará del saldo a cobrar"
          hintMode="inline"
        >
          <Input
            autoFocus
            inputMode="decimal"
            placeholder="0"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setLocalError(null);
            }}
          />
        </Field>
        <Field label="Nota o comprobante (opcional)">
          <Input
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Ej. Transferencia alias..., Efectivo reserva 20/09"
          />
        </Field>
        <Field
          label="PIN de autorización"
          hint="Usuario autorizado para aplicar o modificar señas"
        >
          <Input
            type="password"
            inputMode="numeric"
            maxLength={8}
            placeholder="PIN (4-8 dígitos)"
            value={pin}
            onChange={(event) => {
              setPin(event.target.value.replace(/\D/g, ""));
              setLocalError(null);
            }}
          />
        </Field>
        {isDepositOverBase ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
            La seña ({formatMoney(parsed)}) supera el consumo actual (
            {formatMoney(currentBase)}). El saldo a cobrar quedará en $0 hasta
            que se carguen más consumos.
          </p>
        ) : null}
        {localError ? (
          <p
            role="alert"
            className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700"
          >
            {localError}
          </p>
        ) : null}
        <div className="flex justify-between gap-2">
          {order.depositMinor > 0 ? (
            <Button
              type="button"
              variant="danger"
              disabled={mutation.isPending || pin.length < 4}
              onClick={() => handleApply(0, "")}
              title={
                pin.length < 4
                  ? "Ingresá el PIN para autorizar quitar la seña"
                  : undefined
              }
            >
              Quitar seña
            </Button>
          ) : (
            <div />
          )}
          <div className="flex gap-2">
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
                parsed == null ||
                parsed < 0 ||
                pin.length < 4 ||
                mutation.isPending
              }
            >
              <Receipt size={16} />
              {mutation.isPending
                ? "Guardando…"
                : order.depositMinor > 0
                  ? "Actualizar seña"
                  : "Aplicar seña"}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function HalfSelector({
  label,
  products,
  getPrice,
  selectedId,
  onSelect,
  onClear,
  autoFocus = false,
  disabled,
  inputRef,
}: {
  label: string;
  products: ProductDto[];
  getPrice(product: ProductDto): number | undefined;
  selectedId?: string | null;
  onSelect(product: ProductDto): void;
  onClear?(): void;
  autoFocus?: boolean;
  disabled?: boolean;
  inputRef?: React.RefObject<HTMLInputElement>;
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
    () => products.find((p) => p.id === selectedId),
    [products, selectedId],
  );

  const suggestions = useMemo(() => {
    return rankProducts(products, query);
  }, [products, query]);

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
    if (disabled || selectingLockRef.current) return;
    selectingLockRef.current = true;
    isInteractingRef.current = false;
    onSelect(product);
    setIsOpen(false);
    setQuery("");
    window.setTimeout(() => {
      selectingLockRef.current = false;
    }, 150);
  };

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
                <span className="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-xs font-bold text-slate-600">
                  {selectedProduct.code}
                </span>
              ) : null}
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-xs">
              <span className="font-bold text-brand-700">
                {price != null ? formatMoney(price) : "Sin precio"}
              </span>
              <span className="text-xs text-slate-600">
                {selectedProduct.categoryName}
              </span>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            className="h-8 shrink-0 px-2.5 text-xs text-slate-600 hover:text-brand-700"
            disabled={disabled}
            onClick={() => {
              onClear?.();
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
            disabled={disabled}
            aria-label={label}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={isOpen}
            placeholder={`Buscar ${label.toLocaleLowerCase("es-AR")}`}
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
                    disabled={disabled}
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
                          <span className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs text-slate-600">
                            {product.code}
                          </span>
                        ) : null}
                      </div>
                      <span className="block truncate text-xs text-slate-600">
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
              <div className="p-3 text-center text-xs text-slate-600">
                No encontramos variedades con &ldquo;{query}&rdquo;
              </div>
            )}
          </div>
        ) : null}
      </div>
    </Field>
  );
}

type HalfAndHalfOption = ProductDto & {
  halfAndHalfGroupId: string;
  halfAndHalfPricingMode: HalfAndHalfPricingMode;
};

function HalfAndHalfModal({
  order,
  products,
  firstProductId,
  onClose,
}: {
  order: OrderDto;
  products: HalfAndHalfOption[];
  firstProductId: string | null;
  onClose(): void;
}) {
  const [first, setFirst] = useState(firstProductId);
  const [error, setError] = useState<string | null>(null);
  const secondInputRef = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
  const firstProduct = products.find((product) => product.id === first);
  const secondOptions = useMemo(
    () => firstProduct ? products.filter((product) => canCombineHalves(firstProduct, product)) : [],
    [firstProduct, products],
  );
  const priceListCode = order.type === "DINE_IN" ? "SALON" : order.type;
  function channelPrice(product: ProductDto) {
    return product.prices.find((price) => price.priceListCode === priceListCode)?.amountMinor;
  }

  const mutation = useApiMutation(
    (input: Parameters<typeof window.gastronomy.addHalfAndHalfItem>[0]) =>
      window.gastronomy.addHalfAndHalfItem(input),
    {
      onSuccess: onClose,
      onError: (value) => {
        submitting.current = false;
        setError(humanError(value));
        window.requestAnimationFrame(() => secondInputRef.current?.focus());
      },
    },
  );

  return (
    <Modal open onClose={onClose} closeDisabled={mutation.isPending} title="Armar mitad y mitad">
      <div className="grid gap-4 pb-3" aria-busy={mutation.isPending}>
        <HalfSelector
          label="Primera mitad"
          products={products}
          getPrice={channelPrice}
          selectedId={firstProduct?.id ?? null}
          disabled={mutation.isPending}
          autoFocus={!firstProduct}
          onClear={() => {
            setFirst(null);
            setError(null);
          }}
          onSelect={(product) => {
            setFirst(product.id);
            setError(null);
            window.requestAnimationFrame(() => secondInputRef.current?.focus());
          }}
        />
        {firstProduct ? (
          <HalfSelector
            key={firstProduct.id}
            label="Segunda mitad"
            products={secondOptions}
            getPrice={(product) => {
              const firstPrice = channelPrice(firstProduct);
              const secondPrice = channelPrice(product);
              return firstPrice == null || secondPrice == null ? undefined :
                calculateHalfAndHalfBase(firstPrice, secondPrice, firstProduct.halfAndHalfPricingMode);
            }}
            disabled={mutation.isPending}
            autoFocus={firstProduct.id === firstProductId}
            inputRef={secondInputRef}
            onSelect={(product) => {
              if (submitting.current) return;
              submitting.current = true;
              setError(null);
              mutation.mutate({
                orderId: order.id,
                firstProductId: firstProduct.id,
                secondProductId: product.id,
              });
            }}
          />
        ) : null}
        {error ? <p role="alert" className="text-xs text-rose-700">{error}</p> : null}
        <p className="text-xs text-slate-600" role="status">
          {mutation.isPending ? "Agregando…" : firstProduct ?
            "El importe junto a cada opción es el total. Elegí la segunda mitad para agregar al pedido." :
            "Elegí dos variedades compatibles."}
        </p>
        <div className="flex justify-end">
          <Button type="button" variant="secondary" onClick={onClose} disabled={mutation.isPending}>
            Volver
          </Button>
        </div>
      </div>
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
          table.active && table.id !== order.tableId && !table.currentOrderId,
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
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
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
  const workspaceActive = useWorkspaceActive();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectionSessionRef = useRef<string | null>(null);
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
    if (!open) {
      selectionSessionRef.current = null;
      return;
    }
    const session = JSON.stringify([
      parentProduct?.id,
      channelCode,
      initialQuery,
    ]);
    if (selectionSessionRef.current === session) return;
    selectionSessionRef.current = session;
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
  }, [open, parentProduct, allOptions, initialQuery, channelCode]);

  useEffect(() => {
    if (!workspaceActive || !open || !allOptions.length) return;
    const timer = window.setTimeout(() => {
      const idx = Math.min(Math.max(0, selectedIndex), allOptions.length - 1);
      buttonRefs.current[idx]?.focus();
      buttonRefs.current[idx]?.scrollIntoView({ block: "nearest" });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [open, workspaceActive]);

  useEffect(() => {
    if (!workspaceActive || !open || !allOptions.length) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        !(event.target instanceof Node) ||
        !buttonRefs.current[0]
          ?.closest('[role="dialog"]')
          ?.contains(event.target)
      )
        return;
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
        const prev =
          (selectedIndex - 1 + allOptions.length) % allOptions.length;
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
  }, [open, allOptions, selectedIndex, onSelect, channelCode, workspaceActive]);

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
                    if (e.repeat || Date.now() - openedAtRef.current < 250)
                      return;
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
                          "inline-flex h-5 min-w-[20px] items-center justify-center rounded border px-1 font-mono text-xs font-bold shadow-sm",
                          isSelected
                            ? "border-brand-300 bg-brand-200 text-brand-900"
                            : "border-slate-300 bg-white text-slate-600",
                        )}
                      >
                        {idx + 1}
                      </kbd>
                    ) : null}
                    <span className="font-bold text-slate-800">
                      {shortName}
                    </span>
                    {isBase ? (
                      <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs font-bold text-slate-700">
                        Padre / Base
                      </span>
                    ) : (
                      <span className="rounded bg-brand-100 px-1.5 py-0.5 text-xs font-bold text-brand-800">
                        Variante
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-slate-600">
                    {product.code ? <span>Cód: {product.code}</span> : null}
                    {product.stockMinor != null ? (
                      <span>
                        Stock:{" "}
                        {(product.stockMinor / 1000).toLocaleString("es-AR")} u.
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm font-extrabold text-brand-700">
                    {price == null ? "Sin precio" : formatMoney(price)}
                  </div>
                  <span className="text-xs font-bold text-brand-700">
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
