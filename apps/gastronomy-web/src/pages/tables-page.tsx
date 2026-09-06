import { useEffect, useMemo, useRef, useState } from "react";
import type {
  BootstrapDto,
  OrderDto,
  RestaurantTableDto,
} from "@gastronomy/contracts";
import {
  CheckCircle,
  Eye,
  Keyboard,
  LockKey,
  Plus,
  SquaresFour,
  UserCircle,
  Trash,
} from "@phosphor-icons/react";
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  Modal,
  Select,
} from "@gastronomy/ui";
import { useApiMutation } from "../api";
import { OrderEditor } from "../components/order-editor";
import { useDebouncedValue } from "../hooks/use-debounced-value";
import {
  formatElapsed,
  formatMoney,
  humanError,
  parseMoneyInput,
} from "../lib";

type OpenTableInput = { tableId: string; waiterUserId: string };
const waiterRoleLabels = {
  WAITER: "Mozo",
  MANAGER: "Supervisor",
  ADMIN: "Administrador",
} as const;

export function TablesPage({ data }: { data: BootstrapDto }) {
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [openingTable, setOpeningTable] = useState<RestaurantTableDto | null>(
    null,
  );
  const [waiterUserId, setWaiterUserId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [tableCount, setTableCount] = useState(
    Math.max(1, data.tables.filter((table) => table.active).length),
  );
  const [tableMessage, setTableMessage] = useState<string | null>(null);
  const [deletingTable, setDeletingTable] = useState<RestaurantTableDto | null>(
    null,
  );
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [removedEvent, setRemovedEvent] = useState<{
    tableId: string;
    revision: number;
  } | null>(null);
  const eligibleWaiters = data.users.filter(
    (user) =>
      user.active && ["WAITER", "MANAGER", "ADMIN"].includes(user.roleCode),
  );
  const canManageTables =
    data.currentUser.permissions.includes("tables.manage") ||
    data.currentUser.permissions.includes("*");

  const createOrder = useApiMutation(
    (input: OpenTableInput) =>
      window.gastronomy.createOrder({ type: "DINE_IN", ...input }),
    {
      onSuccess: (order: OrderDto) => {
        setOpeningTable(null);
        setError(null);
        setSelectedOrderId(order.id);
      },
      onError: (value) => setError(humanError(value)),
    },
  );
  useEffect(() => {
    setTableCount(
      Math.max(1, data.tables.filter((table) => table.active).length),
    );
  }, [data.tables]);
  const configureTables = useApiMutation(
    (count: number) => window.gastronomy.configureTables({ count }),
    {
      onSuccess: (updatedTables) => {
        const activeCount = updatedTables.filter(
          (table) => table.active,
        ).length;
        setTableCount(Math.max(1, activeCount));
        setTableMessage(
          `Salón actualizado: ${activeCount} mesa${activeCount === 1 ? "" : "s"} activa${activeCount === 1 ? "" : "s"}.`,
        );
      },
      onError: (value) => setTableMessage(humanError(value)),
    },
  );
  const deleteTable = useApiMutation(
    (input: { tableId: string }) => window.gastronomy.deleteTable(input),
    {
      onSuccess: (_result, variables) => {
        setTableMessage("Mesa eliminada.");
        setRemovedEvent({ tableId: variables.tableId, revision: Date.now() });
        if (deletingTable?.currentOrderId === selectedOrderId)
          setSelectedOrderId(null);
        setDeletingTable(null);
        setDeleteConfirmation("");
      },
      onError: (value) => setTableMessage(humanError(value)),
    },
  );
  const tables = data.tables.filter((table) => table.active);
  const occupiedCount = tables.filter((table) => table.currentOrderId).length;

  const requestOpen = (table: RestaurantTableDto) => {
    setError(null);
    const preferred =
      eligibleWaiters.find((user) => user.roleCode === "WAITER") ??
      eligibleWaiters.find((user) => user.id === data.currentUser.id) ??
      eligibleWaiters[0];
    setWaiterUserId(preferred?.id ?? "");
    setOpeningTable(table);
  };

  return (
    <div className="panel-enter mx-auto max-w-[1500px] space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold">Salón</h2>
          <p className="text-xs text-slate-400">
            Abrí una mesa y asigná quién la atiende
          </p>
        </div>
        <Badge tone="orange">
          {occupiedCount} ocupadas · {tables.length - occupiedCount} libres
        </Badge>
      </div>

      {error && !openingTable ? (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700"
        >
          {error}
        </div>
      ) : null}
      {!data.cashSession ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800">
          Abrí caja para iniciar mesas nuevas.
        </div>
      ) : null}

      <Card className="border-orange-100 bg-gradient-to-r from-white to-orange-50/70 p-3">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (tableCount >= 1 && tableCount <= 200)
              configureTables.mutate(tableCount);
          }}
        >
          <div className="min-w-0 flex-1">
            <h3 className="text-xs font-extrabold text-slate-700">
              Cantidad de mesas
            </h3>
            <p className="mt-0.5 text-[10px] text-slate-400">
              Generá del 1 al {tableCount}. Las mesas ocupadas y su historial se
              conservan al reducir la cantidad.
            </p>
          </div>
          <Field label="Mesas activas">
            <Input
              className="w-24"
              type="number"
              min={1}
              max={200}
              value={tableCount}
              onChange={(event) => {
                setTableCount(Number(event.target.value));
                setTableMessage(null);
              }}
              aria-describedby="table-count-status"
            />
          </Field>
          <Button
            type="submit"
            disabled={
              configureTables.isPending || tableCount < 1 || tableCount > 200
            }
          >
            {configureTables.isPending ? "Actualizando…" : "Actualizar salón"}
          </Button>
        </form>
        {tableMessage ? (
          <p
            id="table-count-status"
            role="status"
            aria-live="polite"
            className={`mt-2 rounded-lg px-3 py-2 text-[11px] font-semibold ${configureTables.isError ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}
          >
            {tableMessage}
          </p>
        ) : null}
      </Card>

      <QuickEntry
        data={data}
        onOpenFullOrder={setSelectedOrderId}
        removedEvent={removedEvent}
      />

      <section
        aria-label="Mesas del salón"
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6"
      >
        {tables.map((table) => {
          const occupied = Boolean(table.currentOrderId);
          return (
            <Card
              key={table.id}
              className={`relative min-h-[150px] overflow-hidden p-4 transition hover:shadow-md ${occupied ? "border-brand-200 bg-gradient-to-br from-white to-brand-50/80" : "border-emerald-100"}`}
            >
              <div
                className={`absolute inset-x-0 top-0 h-1 ${occupied ? "bg-brand-600" : "bg-emerald-500"}`}
              />
              <div className="flex items-start justify-between">
                <div
                  className={`grid h-10 w-10 place-items-center rounded-xl ${occupied ? "bg-brand-100 text-brand-700" : "bg-emerald-50 text-emerald-600"}`}
                >
                  <SquaresFour size={20} weight="duotone" />
                </div>
                <Badge tone={occupied ? "orange" : "green"}>
                  {occupied ? "Ocupada" : "Libre"}
                </Badge>
              </div>
              <p className="mt-4 text-xl font-extrabold">Mesa {table.number}</p>
              {occupied ? (
                <div className="mt-1">
                  <p className="text-sm font-bold text-brand-700">
                    {formatMoney(table.currentTotalMinor)}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1 text-[10px] text-slate-400">
                    <UserCircle size={12} /> {table.waiterName || "Sin mesero"}{" "}
                    · {formatElapsed(table.openedAt)}
                  </p>
                </div>
              ) : (
                <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-emerald-600">
                  <Plus size={13} />
                  Abrir pedido
                </p>
              )}
              <div className="mt-4 flex gap-2">
                <Button
                  type="button"
                  className="flex-1"
                  aria-label={
                    occupied
                      ? `Abrir pedido de mesa ${table.number}`
                      : `Abrir mesa ${table.number}`
                  }
                  disabled={!occupied && !data.cashSession}
                  onClick={() =>
                    occupied
                      ? setSelectedOrderId(table.currentOrderId)
                      : requestOpen(table)
                  }
                >
                  {occupied ? "Abrir pedido" : "Abrir mesa"}
                </Button>
                {canManageTables ? (
                  <Button
                    type="button"
                    variant="secondary"
                    aria-label={`Eliminar mesa ${table.number}`}
                    onClick={() => {
                      deleteTable.reset();
                      setTableMessage(null);
                      setDeletingTable(table);
                      setDeleteConfirmation("");
                    }}
                  >
                    <Trash size={16} />
                  </Button>
                ) : null}
              </div>
            </Card>
          );
        })}
      </section>

      <Modal
        open={Boolean(openingTable)}
        onClose={() => {
          if (!createOrder.isPending) {
            setOpeningTable(null);
            setError(null);
          }
        }}
        title={`Abrir mesa ${openingTable?.number ?? ""}`}
        description="La asignación queda visible en el salón y vinculada al pedido."
      >
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (openingTable && waiterUserId)
              createOrder.mutate({ tableId: openingTable.id, waiterUserId });
          }}
        >
          <Field
            label="Mesero responsable"
            hint="Podés elegir un mesero, encargado o administrador activo."
          >
            <Select
              autoFocus
              value={waiterUserId}
              onChange={(event) => setWaiterUserId(event.target.value)}
              required
            >
              {eligibleWaiters.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.fullName} ·{" "}
                  {
                    waiterRoleLabels[
                      user.roleCode as keyof typeof waiterRoleLabels
                    ]
                  }
                </option>
              ))}
            </Select>
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
              onClick={() => setOpeningTable(null)}
              disabled={createOrder.isPending}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={!waiterUserId || createOrder.isPending}
            >
              {createOrder.isPending ? "Abriendo…" : "Abrir mesa"}
            </Button>
          </div>
        </form>
      </Modal>

      <OrderEditor
        data={data}
        orderId={selectedOrderId}
        onClose={() => setSelectedOrderId(null)}
      />
      <Modal
        open={Boolean(deletingTable)}
        onClose={() => {
          if (!deleteTable.isPending) {
            setDeletingTable(null);
            setDeleteConfirmation("");
          }
        }}
        title={`Eliminar mesa ${deletingTable?.number ?? ""}`}
        description="Se conservará el historial. Esta acción sólo elimina la mesa del salón."
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (
              deletingTable &&
              deleteConfirmation.trim() === String(deletingTable.number)
            )
              deleteTable.mutate({ tableId: deletingTable.id });
          }}
          className="grid gap-4"
        >
          <p className="text-sm text-slate-700">
            Escribí <strong>{deletingTable?.number}</strong> para confirmar. Si
            tiene consumo, pagos o impresiones, la operación será bloqueada.
          </p>
          <Input
            autoFocus
            value={deleteConfirmation}
            onChange={(event) => setDeleteConfirmation(event.target.value)}
            placeholder={`Número de mesa ${deletingTable?.number ?? ""}`}
            aria-label="Confirmación número de mesa"
          />
          {tableMessage && deleteTable.isError ? (
            <p
              role="alert"
              className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700"
            >
              {tableMessage}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setDeletingTable(null);
                setDeleteConfirmation("");
              }}
              disabled={deleteTable.isPending}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={
                deleteConfirmation.trim() !==
                  String(deletingTable?.number ?? "") || deleteTable.isPending
              }
            >
              {deleteTable.isPending ? "Eliminando…" : "Eliminar mesa"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

type QuickStep = "TABLE" | "WAITER" | "ITEM";

function QuickEntry({
  data,
  onOpenFullOrder,
  removedEvent,
}: {
  data: BootstrapDto;
  onOpenFullOrder(orderId: string): void;
  removedEvent?: { tableId: string; revision: number } | null;
}) {
  const [step, setStep] = useState<QuickStep>("TABLE");
  const [tableNumber, setTableNumber] = useState("");
  const [table, setTable] = useState<RestaurantTableDto | null>(null);
  const [waiterNumber, setWaiterNumber] = useState("");
  const [waiterUserId, setWaiterUserId] = useState("");
  const [order, setOrder] = useState<OrderDto | null>(null);
  const [quantity, setQuantity] = useState("");
  const [productCode, setProductCode] = useState("");
  const [productName, setProductName] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [selectedProductId, setSelectedProductId] = useState<string | null>(
    null,
  );
  const [productListOpen, setProductListOpen] = useState(false);
  const [activeProductIndex, setActiveProductIndex] = useState(0);
  const [priceAuthorizationOpen, setPriceAuthorizationOpen] = useState(false);
  const [authorizerPin, setAuthorizerPin] = useState("");
  const [priceAuthorizationError, setPriceAuthorizationError] = useState<
    string | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const tableRef = useRef<HTMLInputElement>(null);
  const waiterRef = useRef<HTMLInputElement>(null);
  const waiterNameRef = useRef<HTMLSelectElement>(null);
  const quantityRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const productNameRef = useRef<HTMLInputElement>(null);
  const priceRef = useRef<HTMLInputElement>(null);
  const productBlurTimerRef = useRef<number | null>(null);
  const focusFrameRef = useRef<number | null>(null);
  const tableAdvanceRef = useRef(false);
  const waiterAdvanceRef = useRef(false);
  const preferredWaiterFocusRef = useRef<"number" | "name">("number");

  const activeProducts = useMemo(
    () =>
      data.products
        .filter((product) => product.active)
        .sort((left, right) =>
          left.name.localeCompare(right.name, "es-AR", {
            sensitivity: "base",
          }),
        ),
    [data.products],
  );
  const eligibleWaiters = useMemo(
    () =>
      data.users
        .filter(
          (user) =>
            user.active &&
            ["WAITER", "MANAGER", "ADMIN"].includes(user.roleCode),
        )
        .sort((left, right) =>
          left.fullName.localeCompare(right.fullName, "es-AR", {
            sensitivity: "base",
          }),
        ),
    [data.users],
  );
  const normalizeSearch = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLocaleLowerCase("es-AR");
  const debouncedProductName = useDebouncedValue(productName);
  const productSearchPending = productName !== debouncedProductName;
  const productSuggestions = useMemo(() => {
    if (productSearchPending) return [];
    const query = normalizeSearch(debouncedProductName);
    if (!query) return activeProducts.slice(0, 8);
    return activeProducts
      .filter((product) => normalizeSearch(product.name).includes(query))
      .slice(0, 8);
  }, [activeProducts, debouncedProductName, productSearchPending]);
  const selectedProduct = activeProducts.find(
    (product) => product.id === selectedProductId,
  );
  const salonPrice = selectedProduct?.prices.find(
    (price) => price.priceListCode === "SALON",
  )?.amountMinor;
  const enteredPriceMinor = parseMoneyInput(unitPrice);
  const priceWasChanged =
    salonPrice != null &&
    enteredPriceMinor != null &&
    enteredPriceMinor !== salonPrice;

  useEffect(() => {
    if (!order) return;
    const fresh = data.orders.find((candidate) => candidate.id === order.id);
    if (fresh) setOrder(fresh);
  }, [data.orders, order?.id]);

  const focus = (ref: React.RefObject<HTMLElement | null>) => {
    if (focusFrameRef.current !== null) {
      window.cancelAnimationFrame(focusFrameRef.current);
    }
    const captured = document.activeElement;
    focusFrameRef.current = window.requestAnimationFrame(() => {
      focusFrameRef.current = null;
      const target = ref.current;
      if (
        target &&
        (document.activeElement === captured ||
          document.activeElement === document.body ||
          document.activeElement === target)
      ) {
        target.focus();
      }
    });
  };
  useEffect(() => {
    return () => {
      if (focusFrameRef.current !== null) {
        window.cancelAnimationFrame(focusFrameRef.current);
      }
    };
  }, []);
  const fail = (
    message: string,
    ref?: React.RefObject<HTMLInputElement | null>,
  ) => {
    setStatus(null);
    setError(message);
    if (ref) focus(ref);
  };
  const resetLine = () => {
    setQuantity("");
    setProductCode("");
    setProductName("");
    setUnitPrice("");
    setSelectedProductId(null);
    setProductListOpen(false);
    setActiveProductIndex(0);
    setPriceAuthorizationOpen(false);
    setAuthorizerPin("");
    setPriceAuthorizationError(null);
    focus(quantityRef);
  };
  const resetFlow = () => {
    setStep("TABLE");
    setTableNumber("");
    setWaiterNumber("");
    setWaiterUserId("");
    setTable(null);
    setOrder(null);
    setError(null);
    setStatus(null);
    resetLine();
    focus(tableRef);
  };
  useEffect(() => {
    if (removedEvent?.tableId === table?.id) resetFlow();
  }, [removedEvent]);

  const ensureTable = useApiMutation((number: number) =>
    window.gastronomy.ensureTable({ number }),
  );
  const createOrder = useApiMutation((input: OpenTableInput) =>
    window.gastronomy.createOrder({ type: "DINE_IN", ...input }),
  );
  const addItem = useApiMutation(
    (input: Parameters<typeof window.gastronomy.addOrderItem>[0]) =>
      window.gastronomy.addOrderItem(input),
  );

  const submitTable = async () => {
    if (tableAdvanceRef.current || ensureTable.isPending) return;
    tableAdvanceRef.current = true;
    if (!data.cashSession) {
      fail("Abrí caja antes de iniciar una mesa.", tableRef);
      tableAdvanceRef.current = false;
      return;
    }
    const number = Number(tableNumber);
    if (!Number.isInteger(number) || number < 1 || number > 9999) {
      fail("Ingresá un número de mesa válido (entre 1 y 9999).", tableRef);
      tableAdvanceRef.current = false;
      return;
    }
    try {
      const existed = data.tables.some(
        (candidate) => candidate.number === number,
      );
      const resolved = await ensureTable.mutateAsync(number);
      setTable(resolved);
      setError(null);
      if (resolved.currentOrderId) {
        const currentOrder = data.orders.find(
          (candidate) => candidate.id === resolved.currentOrderId,
        );
        if (!currentOrder) {
          fail(
            "La mesa tiene un pedido abierto que no se pudo cargar.",
            tableRef,
          );
          tableAdvanceRef.current = false;
          return;
        }
        const assignedWaiter = eligibleWaiters.find(
          (user) => user.id === currentOrder.waiterUserId,
        );
        setWaiterUserId(assignedWaiter?.id ?? "");
        setWaiterNumber(
          assignedWaiter ? String(assignedWaiter.staffNumber) : "",
        );
        setOrder(currentOrder);
        setStatus(`Mesa ${number} abierta · pedido #${currentOrder.number}`);
        setStep("WAITER");
        return;
      }
      setStatus(existed ? `Mesa ${number} lista` : `Mesa ${number} creada`);
      setStep("WAITER");
    } catch (value) {
      fail(humanError(value), tableRef);
    } finally {
      tableAdvanceRef.current = false;
    }
  };

  const submitWaiter = async () => {
    if (!table) return;
    if (waiterAdvanceRef.current || createOrder.isPending) return;
    const number = Number(waiterNumber);
    const waiter = eligibleWaiters.find(
      (user) =>
        user.id === waiterUserId && user.staffNumber === number && user.active,
    );
    if (!waiter) {
      fail(
        `No existe un mozo activo con el número ${waiterNumber || "ingresado"}.`,
        waiterRef,
      );
      return;
    }
    if (order) {
      setError(null);
      setStep("ITEM");
      focus(quantityRef);
      return;
    }
    waiterAdvanceRef.current = true;
    try {
      const created = await createOrder.mutateAsync({
        tableId: table.id,
        waiterUserId: waiter.id,
      });
      setOrder(created);
      setError(null);
      setStatus(
        `Mesa ${table.number} · ${waiter.fullName} (#${waiter.staffNumber})`,
      );
      setStep("ITEM");
      focus(quantityRef);
    } catch (value) {
      fail(humanError(value), waiterRef);
    } finally {
      waiterAdvanceRef.current = false;
    }
  };

  const tableNumberIsValid = Boolean(
    data.cashSession &&
    /^\d+$/.test(tableNumber) &&
    Number(tableNumber) >= 1 &&
    Number(tableNumber) <= 9999,
  );
  const resolveTableForMouse = () => {
    if (step === "TABLE" && tableNumberIsValid) void submitTable();
  };

  const changeWaiterNumber = (value: string) => {
    const digits = value.replace(/\D/g, "");
    const waiter = eligibleWaiters.find(
      (candidate) => candidate.staffNumber === Number(digits),
    );
    setWaiterNumber(digits);
    setWaiterUserId(waiter?.id ?? "");
    setError(null);
  };

  const changeWaiterName = (userId: string) => {
    const waiter = eligibleWaiters.find((candidate) => candidate.id === userId);
    setWaiterUserId(userId);
    setWaiterNumber(waiter ? String(waiter.staffNumber) : "");
    setError(null);
  };

  const matchCode = (value: string) => {
    const normalized = value.trim().toLocaleLowerCase("es-AR");
    return activeProducts.find(
      (product) =>
        product.code?.toLocaleLowerCase("es-AR") === normalized ||
        product.id.toLocaleLowerCase("es-AR") === normalized,
    );
  };
  const matchName = (value: string) => {
    const normalized = normalizeSearch(value);
    return activeProducts.find(
      (product) => normalizeSearch(product.name) === normalized,
    );
  };
  const editablePrice = (amountMinor: number) =>
    (amountMinor / 100).toLocaleString("es-AR", {
      useGrouping: false,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  const priceForProduct = (product: BootstrapDto["products"][number]) =>
    product.prices.find((price) => price.priceListCode === "SALON")
      ?.amountMinor;
  const setProductPrice = (product: BootstrapDto["products"][number]) => {
    const price = priceForProduct(product);
    setUnitPrice(price == null ? "" : editablePrice(price));
  };
  const chooseProduct = (product: BootstrapDto["products"][number]) => {
    setSelectedProductId(product.id);
    setProductCode(product.code || product.id);
    setProductName(product.name);
    setProductPrice(product);
    setError(null);
  };
  const previewProduct = (product: BootstrapDto["products"][number]) => {
    setSelectedProductId(product.id);
    setProductCode(product.code || product.id);
    setProductPrice(product);
    setError(null);
  };
  const changeCode = (value: string) => {
    setProductCode(value);
    const product = matchCode(value);
    if (product) chooseProduct(product);
    else {
      setSelectedProductId(null);
      setProductName("");
      setUnitPrice("");
    }
  };
  const changeName = (value: string) => {
    setProductName(value);
    setActiveProductIndex(0);
    setProductListOpen(true);
    setSelectedProductId(null);
    setProductCode("");
    setUnitPrice("");
  };

  useEffect(() => {
    if (!productListOpen || productSearchPending) return;
    const product = productSuggestions[0];
    setActiveProductIndex(0);
    if (product && debouncedProductName.trim()) previewProduct(product);
  }, [
    debouncedProductName,
    productListOpen,
    productSearchPending,
    productSuggestions,
  ]);

  const performAdd = async (
    product: BootstrapDto["products"][number],
    parsedQuantity: number,
    manualPriceMinor?: number,
    pin?: string,
  ) => {
    if (!order) return;
    try {
      const updated = await addItem.mutateAsync({
        orderId: order.id,
        productId: product.id,
        quantity: parsedQuantity,
        ...(manualPriceMinor == null
          ? {}
          : {
              unitPriceMinorOverride: manualPriceMinor,
              authorizerPin: pin,
            }),
      });
      setOrder(updated);
      setError(null);
      setPriceAuthorizationError(null);
      setStatus(
        manualPriceMinor == null
          ? `${parsedQuantity} × ${product.name} agregado`
          : `${parsedQuantity} × ${product.name} agregado con precio autorizado`,
      );
      resetLine();
    } catch (value) {
      const message = humanError(value);
      if (manualPriceMinor != null) {
        setPriceAuthorizationError(message);
        return;
      }
      fail(message, codeRef);
    }
  };

  const submitItem = async () => {
    if (!order || busy) return;
    const parsedQuantity = Number(quantity);
    if (!Number.isInteger(parsedQuantity) || parsedQuantity <= 0) {
      fail("Ingresá una cantidad entera mayor que cero.", quantityRef);
      return;
    }
    const product =
      selectedProduct ?? matchCode(productCode) ?? matchName(productName);
    if (!product) {
      fail("No existe un producto con ese código, ID o nombre.", codeRef);
      return;
    }
    const catalogPrice = priceForProduct(product);
    if (catalogPrice == null) {
      fail("El producto no tiene un precio de salón configurado.", priceRef);
      return;
    }
    const parsedPrice = parseMoneyInput(unitPrice);
    if (parsedPrice == null) {
      fail("Ingresá un precio válido.", priceRef);
      return;
    }
    if (parsedPrice !== catalogPrice) {
      setPriceAuthorizationError(null);
      setAuthorizerPin("");
      setPriceAuthorizationOpen(true);
      return;
    }
    await performAdd(product, parsedQuantity);
  };

  const cancelPriceOverride = () => {
    setPriceAuthorizationOpen(false);
    setAuthorizerPin("");
    setPriceAuthorizationError(null);
    if (salonPrice != null) setUnitPrice(editablePrice(salonPrice));
    focus(priceRef);
  };

  const confirmPriceOverride = async () => {
    const parsedQuantity = Number(quantity);
    const product =
      selectedProduct ?? matchCode(productCode) ?? matchName(productName);
    const parsedPrice = parseMoneyInput(unitPrice);
    if (
      !product ||
      !Number.isInteger(parsedQuantity) ||
      parsedQuantity <= 0 ||
      parsedPrice == null
    ) {
      setPriceAuthorizationError(
        "No se pudo conservar el producto, la cantidad o el precio. Volvé y revisalos.",
      );
      return;
    }
    if (!/^\d{4,8}$/.test(authorizerPin)) {
      setPriceAuthorizationError("Ingresá un PIN válido de 4 a 8 dígitos.");
      return;
    }
    await performAdd(product, parsedQuantity, parsedPrice, authorizerPin);
  };

  const itemCount =
    order?.items.reduce((total, item) => total + item.quantity, 0) ?? 0;
  const busy =
    ensureTable.isPending || createOrder.isPending || addItem.isPending;
  const waiterFieldsEnabled =
    !busy && (step === "WAITER" || (step === "TABLE" && tableNumberIsValid));
  useEffect(() => {
    if (step !== "WAITER" || busy || !table) return;
    focus(
      preferredWaiterFocusRef.current === "name" ? waiterNameRef : waiterRef,
    );
    preferredWaiterFocusRef.current = "number";
  }, [busy, step, table?.id]);

  return (
    <>
      <Card className="overflow-hidden border-brand-200 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-brand-100 bg-brand-50/60 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-brand-600 text-white">
              <Keyboard size={19} weight="bold" />
            </div>
            <div>
              <h3 className="text-sm font-extrabold text-slate-900">
                Carga rápida por teclado
              </h3>
              <p className="text-[11px] text-slate-500">
                Enter avanza · Shift+Enter retrocede · Tab conserva el flujo
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide">
            {(["TABLE", "WAITER", "ITEM"] as const).map((value, index) => (
              <span
                key={value}
                className={`rounded-md px-2 py-1 ${step === value ? "bg-brand-600 text-white" : "bg-white text-slate-400"}`}
              >
                {index + 1} ·{" "}
                {value === "TABLE"
                  ? "Mesa"
                  : value === "WAITER"
                    ? "Mozo"
                    : "Productos"}
              </span>
            ))}
          </div>
        </div>

        <div className="p-4">
          <form
            data-navigation-autosave="true"
            onSubmit={(event) => {
              event.preventDefault();
              if (step === "TABLE") void submitTable();
              if (step === "WAITER") void submitWaiter();
            }}
            className="grid max-w-3xl items-end gap-2 sm:grid-cols-[minmax(150px_.7fr)_minmax(150px_.7fr)_minmax(240px_1.3fr)_auto]"
          >
            <Field
              label="Número de mesa"
              hint="Enter, Tab o Continuar abre o crea la mesa."
            >
              <Input
                ref={tableRef}
                autoFocus
                inputMode="numeric"
                value={tableNumber}
                disabled={busy || (step !== "TABLE" && !order)}
                onChange={(event) => {
                  const next = event.target.value.replace(/\D/g, "");
                  if (next !== tableNumber) {
                    setTable(null);
                    setOrder(null);
                    setWaiterNumber("");
                    setWaiterUserId("");
                    setQuantity("");
                    setProductCode("");
                    setProductName("");
                    setUnitPrice("");
                    setSelectedProductId(null);
                    setProductListOpen(false);
                  }
                  setTableNumber(next);
                  if (step !== "TABLE") {
                    setStep("TABLE");
                  }
                  setError(null);
                }}
                onKeyDown={(event) => {
                  if (
                    (event.key === "Enter" || event.key === "Tab") &&
                    !event.shiftKey
                  ) {
                    event.preventDefault();
                    void submitTable();
                  } else if (event.key === "Enter" && event.shiftKey) {
                    event.preventDefault();
                  }
                }}
                placeholder="Ej.: 12"
              />
            </Field>
            <Field label="Número de mozo" hint="Se sincroniza con el nombre.">
              <Input
                ref={waiterRef}
                inputMode="numeric"
                value={waiterNumber}
                disabled={busy || (!waiterFieldsEnabled && !order)}
                readOnly={Boolean(order)}
                aria-readonly={order ? "true" : undefined}
                onChange={(event) => changeWaiterNumber(event.target.value)}
                onMouseDown={() => {
                  preferredWaiterFocusRef.current = "number";
                  resolveTableForMouse();
                }}
                onFocus={resolveTableForMouse}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    focus(waiterNameRef);
                  } else if (event.key === "Enter" && event.shiftKey) {
                    event.preventDefault();
                    setStep("TABLE");
                    focus(tableRef);
                  }
                }}
                placeholder="Ej.: 2"
              />
            </Field>
            <Field label="Nombre de mozo" hint="Podés elegirlo por nombre.">
              <Select
                ref={waiterNameRef}
                value={waiterUserId}
                disabled={busy || (!waiterFieldsEnabled && !order)}
                aria-readonly={order ? "true" : undefined}
                onMouseDown={() => {
                  preferredWaiterFocusRef.current = "name";
                  resolveTableForMouse();
                }}
                onFocus={resolveTableForMouse}
                onChange={(event) => {
                  if (!order) changeWaiterName(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (
                    (event.key === "Enter" || event.key === "Tab") &&
                    !event.shiftKey
                  ) {
                    event.preventDefault();
                    void submitWaiter();
                  } else if (event.key === "Enter" && event.shiftKey) {
                    event.preventDefault();
                    focus(waiterRef);
                  }
                }}
              >
                <option value="">Seleccioná un mozo</option>
                {eligibleWaiters.map((waiter) => (
                  <option key={waiter.id} value={waiter.id}>
                    {waiter.fullName}
                  </option>
                ))}
              </Select>
            </Field>
            {step === "WAITER" ? (
              <Button
                type="button"
                variant="secondary"
                disabled={!waiterUserId || busy}
                onClick={() => void submitWaiter()}
              >
                Abrir mesa
              </Button>
            ) : step === "ITEM" ? (
              <Button type="button" variant="ghost" onClick={resetFlow}>
                Nueva mesa
              </Button>
            ) : (
              <Button
                type="button"
                variant="secondary"
                disabled={!tableNumberIsValid || busy}
                onClick={() => void submitTable()}
              >
                Continuar
              </Button>
            )}
          </form>

          {step === "ITEM" && order ? (
            <div className="mt-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs">
                <span className="font-bold text-slate-700">
                  Mesa {table?.number ?? order.tableNumber} · Pedido #
                  {order.number} · {order.waiterName || "Mozo asignado"}
                </span>
                <span className="text-slate-500">
                  {itemCount} unidades ·{" "}
                  <strong className="text-brand-700">
                    {formatMoney(order.totalMinor)}
                  </strong>
                </span>
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitItem();
                }}
                className="grid items-end gap-2 lg:grid-cols-[90px_minmax(145px_.7fr)_minmax(220px_1.3fr)_170px_auto]"
              >
                <Field label="Cantidad">
                  <Input
                    ref={quantityRef}
                    autoFocus
                    inputMode="numeric"
                    value={quantity}
                    onChange={(event) => {
                      setQuantity(event.target.value.replace(/\D/g, ""));
                      setError(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && event.shiftKey) {
                        event.preventDefault();
                        setStep("WAITER");
                        focus(waiterNameRef);
                      } else if (event.key === "Enter") {
                        event.preventDefault();
                        focus(codeRef);
                      }
                    }}
                    placeholder="0"
                  />
                </Field>
                <Field label="Código / ID">
                  <Input
                    ref={codeRef}
                    list="quick-product-codes"
                    value={productCode}
                    onChange={(event) => changeCode(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && event.shiftKey) {
                        event.preventDefault();
                        focus(quantityRef);
                      } else if (event.key === "Enter") {
                        event.preventDefault();
                        focus(productNameRef);
                      }
                    }}
                    placeholder="MUZG"
                    autoComplete="off"
                  />
                  <datalist id="quick-product-codes">
                    {activeProducts.map((product) => (
                      <option
                        key={product.id}
                        value={product.code || product.id}
                      >
                        {product.name}
                      </option>
                    ))}
                  </datalist>
                </Field>
                <div className="grid gap-1.5 text-[12px] font-semibold text-slate-600">
                  <label htmlFor="quick-product-name">Producto</label>
                  <div className="relative">
                    <Input
                      id="quick-product-name"
                      ref={productNameRef}
                      value={productName}
                      onChange={(event) => changeName(event.target.value)}
                      onFocus={() => {
                        if (productBlurTimerRef.current !== null) {
                          window.clearTimeout(productBlurTimerRef.current);
                          productBlurTimerRef.current = null;
                        }
                        setProductListOpen(true);
                        setActiveProductIndex(0);
                      }}
                      onBlur={() => {
                        productBlurTimerRef.current = window.setTimeout(() => {
                          setProductListOpen(false);
                          productBlurTimerRef.current = null;
                        }, 100);
                      }}
                      onKeyDown={(event) => {
                        if (
                          (event.key === "ArrowDown" ||
                            event.key === "ArrowUp") &&
                          productSuggestions.length
                        ) {
                          event.preventDefault();
                          const direction = event.key === "ArrowDown" ? 1 : -1;
                          const next =
                            (activeProductIndex +
                              direction +
                              productSuggestions.length) %
                            productSuggestions.length;
                          setProductListOpen(true);
                          setActiveProductIndex(next);
                          previewProduct(productSuggestions[next]!);
                          return;
                        }
                        if (event.key === "Enter" && event.shiftKey) {
                          event.preventDefault();
                          setProductListOpen(false);
                          focus(codeRef);
                          return;
                        }
                        if (
                          (event.key === "Enter" || event.key === "Tab") &&
                          productListOpen &&
                          productSuggestions.length
                        ) {
                          if (event.key === "Enter") event.preventDefault();
                          chooseProduct(
                            productSuggestions[activeProductIndex] ??
                              productSuggestions[0]!,
                          );
                          setProductListOpen(false);
                          if (event.key === "Enter") focus(priceRef);
                          return;
                        }
                        if (event.key === "Enter") {
                          event.preventDefault();
                          const product =
                            selectedProduct ?? matchName(productName);
                          if (product) chooseProduct(product);
                          setProductListOpen(false);
                          focus(priceRef);
                          return;
                        }
                        if (event.key === "Escape") {
                          event.preventDefault();
                          setProductListOpen(false);
                        }
                      }}
                      placeholder="Escribí para buscar"
                      autoComplete="off"
                      role="combobox"
                      aria-autocomplete="list"
                      aria-expanded={
                        productListOpen && productSuggestions.length > 0
                      }
                      aria-controls="quick-product-options"
                      aria-activedescendant={
                        productListOpen &&
                        productSuggestions[activeProductIndex]
                          ? `quick-product-${productSuggestions[activeProductIndex]!.id}`
                          : undefined
                      }
                    />
                    {productListOpen && productSuggestions.length ? (
                      <div
                        id="quick-product-options"
                        role="listbox"
                        aria-label="Productos disponibles"
                        className="absolute inset-x-0 top-[calc(100%+4px)] z-40 max-h-64 overflow-y-auto rounded-xl border border-brand-200 bg-white p-1.5 shadow-xl"
                      >
                        {productSuggestions.map((product, index) => {
                          const price = product.prices.find(
                            (candidate) => candidate.priceListCode === "SALON",
                          )?.amountMinor;
                          const active = index === activeProductIndex;
                          return (
                            <button
                              id={`quick-product-${product.id}`}
                              key={product.id}
                              type="button"
                              role="option"
                              aria-selected={active}
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => {
                                chooseProduct(product);
                                setProductListOpen(false);
                                focus(priceRef);
                              }}
                              className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-xs transition ${active ? "bg-brand-50 text-brand-800" : "text-slate-700 hover:bg-slate-50"}`}
                            >
                              <span>
                                <strong className="block text-[13px]">
                                  {product.name}
                                </strong>
                                <span className="text-[10px] text-slate-400">
                                  {product.code || product.id} ·{" "}
                                  {product.categoryName}
                                </span>
                              </span>
                              <strong className="whitespace-nowrap text-brand-700">
                                {price == null
                                  ? "Sin precio"
                                  : formatMoney(price)}
                              </strong>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                    {productListOpen && productSearchPending ? (
                      <div className="absolute inset-x-0 top-[calc(100%+4px)] z-40 rounded-xl border border-brand-200 bg-white px-3 py-2 text-xs font-semibold text-brand-700 shadow-lg">
                        Esperando para buscar…
                      </div>
                    ) : null}
                    {productListOpen &&
                    productName &&
                    !productSearchPending &&
                    !productSuggestions.length ? (
                      <div className="absolute inset-x-0 top-[calc(100%+4px)] z-40 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500 shadow-lg">
                        No hay productos que coincidan.
                      </div>
                    ) : null}
                  </div>
                </div>
                <Field
                  label="Precio salón"
                  hint={
                    priceWasChanged
                      ? "Precio manual · requiere PIN"
                      : "Podés modificarlo"
                  }
                >
                  <Input
                    ref={priceRef}
                    inputMode="decimal"
                    disabled={!selectedProduct || busy}
                    value={unitPrice}
                    onFocus={(event) => event.currentTarget.select()}
                    onChange={(event) => {
                      setUnitPrice(event.target.value);
                      setError(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && event.shiftKey) {
                        event.preventDefault();
                        focus(productNameRef);
                      } else if (event.key === "Enter") {
                        event.preventDefault();
                        void submitItem();
                      }
                    }}
                    placeholder="$ 0"
                    className={
                      priceWasChanged
                        ? "border-amber-300 bg-amber-50 font-extrabold text-amber-800"
                        : "font-bold text-slate-700"
                    }
                  />
                </Field>
                <Button
                  type="submit"
                  disabled={
                    !quantity ||
                    !selectedProduct ||
                    enteredPriceMinor == null ||
                    busy
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && event.shiftKey) {
                      event.preventDefault();
                      focus(priceRef);
                    }
                  }}
                >
                  {addItem.isPending ? "Agregando…" : "Agregar"}{" "}
                  <Plus size={16} />
                </Button>
              </form>
              <div className="flex flex-wrap justify-between gap-2">
                <Button type="button" variant="ghost" onClick={resetFlow}>
                  Nueva mesa
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => onOpenFullOrder(order.id)}
                >
                  <Eye size={16} />
                  Ver pedido completo
                </Button>
              </div>
            </div>
          ) : null}

          {error ? (
            <p
              role="alert"
              className="mt-3 inline-flex rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700"
            >
              {error}
            </p>
          ) : null}
          {status && !error ? (
            <p
              role="status"
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700"
            >
              <CheckCircle size={15} weight="fill" />
              {status}
            </p>
          ) : null}
        </div>
      </Card>
      <Modal
        open={priceAuthorizationOpen}
        onClose={cancelPriceOverride}
        title="Autorizar precio manual"
        description="El cambio se aplica solamente a este producto dentro de la mesa. El precio del catálogo no se modifica."
      >
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void confirmPriceOverride();
          }}
        >
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-500 text-white">
                <LockKey size={19} weight="bold" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-extrabold text-slate-900">
                  {selectedProduct?.name ?? "Producto"}
                </p>
                <div className="mt-2 grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="block text-[10px] font-bold uppercase tracking-wide text-slate-500">
                      Precio de lista
                    </span>
                    <strong>
                      {salonPrice == null ? "—" : formatMoney(salonPrice)}
                    </strong>
                  </div>
                  <div>
                    <span className="block text-[10px] font-bold uppercase tracking-wide text-amber-700">
                      Precio manual
                    </span>
                    <strong className="text-amber-800">
                      {enteredPriceMinor == null
                        ? "—"
                        : formatMoney(enteredPriceMinor)}
                    </strong>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <Field
            label="PIN de autorización"
            hint="Debe pertenecer a un administrador o encargado autorizado."
          >
            <Input
              autoFocus
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={authorizerPin}
              onChange={(event) => {
                setAuthorizerPin(
                  event.target.value.replace(/\D/g, "").slice(0, 8),
                );
                setPriceAuthorizationError(null);
              }}
              placeholder="••••"
            />
          </Field>
          {priceAuthorizationError ? (
            <p
              role="alert"
              className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs font-semibold text-rose-700"
            >
              {priceAuthorizationError}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={cancelPriceOverride}
              disabled={addItem.isPending}
            >
              Volver sin modificar el precio
            </Button>
            <Button
              type="submit"
              disabled={!/^\d{4,8}$/.test(authorizerPin) || addItem.isPending}
            >
              {addItem.isPending
                ? "Autorizando…"
                : "Confirmar precio y agregar"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
