import type {
  AuditEntryDto,
  BootstrapDto,
  CategoryDto,
  CustomerDto,
  DeliveryLedgerDto,
  DriverDeliveryActivityDto,
  DesktopApi,
  DetailedReportDto,
  CashSessionDto,
  CashSessionReportDto,
  CashSessionReportFilters,
  CashSessionHistoryItemDto,
  CashMovementType,
  OrderDto,
  OrderItemDto,
  ProductDto,
  ReportFilters,
  UserDto,
} from "@gastronomy/contracts";
import { createDemoBootstrap, emptyDashboard } from "./demo-data";
import {
  assertOffPremiseCustomer,
  assertAppSettings,
  assertOperationalTransition,
  assertOrderAction,
} from "@gastronomy/domain";

export const DEMO_STORAGE_KEY = "delta-nube-gastronomia.demo.v5";
const DEMO_PIN = "1234";

export interface DemoStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface DemoState {
  version: 9;
  data: BootstrapDto;
  historicalSessions: CashSessionDto[];
  movements: Array<{
    id: string;
    sessionId: string;
    type: CashMovementType;
    amountMinor: number;
    affectsCash: boolean;
    paymentMethodCode: string | null;
    orderId: string | null;
    userId: string;
    reason: string | null;
    createdAt: string;
  }>;
  customers: CustomerDto[];
  audit: AuditEntryDto[];
  sequence: number;
}

const clone = <T>(value: T): T => structuredClone(value);
const now = () => new Date().toISOString();
const today = () => now().slice(0, 10);
const normalizePhone = (value: string) => value.replace(/\D/g, "");
const uid = (prefix: string, state: DemoState) =>
  `${prefix}-demo-${++state.sequence}`;
const legacySeedStock = new Map<string, number>([
  ["prod-muzza", 35],
  ["prod-napo", 24],
  ["prod-especial", 18],
  ["prod-emp-carne", 80],
  ["prod-emp-jyq", 64],
  ["prod-gaseosa", 28],
  ["prod-agua", 42],
  ["prod-flan", 12],
]);

function normalizeProductPrices(
  prices: Array<{
    priceListCode: "SALON" | "TAKEAWAY" | "DELIVERY";
    amountMinor: number;
  }>,
) {
  const salon = prices.find((price) => price.priceListCode === "SALON");
  const offPremise =
    prices.find((price) => price.priceListCode === "TAKEAWAY") ??
    prices.find((price) => price.priceListCode === "DELIVERY");
  if (!salon || !offPremise)
    throw new Error("Completá los precios de Salón y Delivery / Para retirar.");
  if (
    ![salon.amountMinor, offPremise.amountMinor].every(
      (amount) => Number.isSafeInteger(amount) && amount >= 0,
    )
  )
    throw new Error("Ingresá precios válidos y dentro del rango permitido.");
  return [
    { priceListCode: "SALON" as const, amountMinor: salon.amountMinor },
    {
      priceListCode: "TAKEAWAY" as const,
      amountMinor: offPremise.amountMinor,
    },
    {
      priceListCode: "DELIVERY" as const,
      amountMinor: offPremise.amountMinor,
    },
  ];
}

function validateCustomerInput(input: {
  name: string;
  phone: string;
  notes?: string | null;
  preferences?: string | null;
  tags?: string[];
  addresses?: Array<{
    label: string;
    address: string;
    notes?: string | null;
    deliveryFeeMinor?: number;
  }>;
}) {
  const name = input.name.trim();
  const phone = input.phone.trim();
  if (name.length < 2 || name.length > 120)
    throw new Error("El nombre debe tener entre 2 y 120 caracteres.");
  if (phone.length > 40 || phone.replace(/\D/g, "").length < 6)
    throw new Error("Ingresá un teléfono válido de hasta 40 caracteres.");
  if ((input.notes?.trim().length ?? 0) > 1_000)
    throw new Error("Las notas del cliente admiten hasta 1000 caracteres.");
  if ((input.preferences?.trim().length ?? 0) > 1_000)
    throw new Error("Las preferencias admiten hasta 1000 caracteres.");
  const tags = [...new Set((input.tags ?? []).map((tag) => tag.trim()))].filter(
    Boolean,
  );
  if (tags.length > 12 || tags.some((tag) => tag.length > 30))
    throw new Error("Usá hasta 12 etiquetas de 30 caracteres como máximo.");
  if ((input.addresses?.length ?? 0) > 20)
    throw new Error("Un cliente puede tener hasta 20 direcciones.");
  for (const address of input.addresses ?? []) {
    if (
      address.label.trim().length > 60 ||
      address.address.trim().length > 240 ||
      (address.notes?.trim().length ?? 0) > 500
    )
      throw new Error(
        "Revisá las direcciones: etiqueta 60, dirección 240 y referencia 500 caracteres como máximo.",
      );
    if (
      !Number.isSafeInteger(address.deliveryFeeMinor ?? 0) ||
      (address.deliveryFeeMinor ?? 0) < 0
    )
      throw new Error("El valor de envío de una dirección no es válido.");
  }
}

function seedState(): DemoState {
  const updatedAt = now();
  const oldDate = new Date();
  oldDate.setDate(oldDate.getDate() - 120);
  const oldBusinessDate = oldDate.toISOString().slice(0, 10);
  return {
    version: 9,
    data: createDemoBootstrap(),
    historicalSessions: [
      {
        id: "cash-demo-old",
        number: 1,
        businessDate: oldBusinessDate,
        openedAt: `${oldBusinessDate}T12:00:00.000Z`,
        closedAt: `${oldBusinessDate}T23:00:00.000Z`,
        openedByUserId: "user-admin",
        openedByName: "Administrador Demo",
        openingAmountMinor: 2_000_000,
        expectedAmountMinor: 8_500_000,
        countedAmountMinor: 8_500_000,
        differenceMinor: 0,
        closingFloatAmountMinor: 2_000_000,
        cashRemovedAmountMinor: 6_500_000,
        floatDifferenceMinor: 0,
        cashSalesMinor: 6_000_000,
        cashIncomeMinor: 500_000,
        cashExpenseMinor: 0,
        cashWithdrawalMinor: 0,
        cashRefundMinor: 0,
        salesTotalMinor: 8_000_000,
        salesByType: {
          DINE_IN: 5_000_000,
          TAKEAWAY: 1_000_000,
          DELIVERY: 2_000_000,
        },
        salesByPaymentMethod: [
          { code: "CASH", name: "Efectivo", amountMinor: 6_000_000 },
          { code: "TRANSFER", name: "Transferencia", amountMinor: 2_000_000 },
        ],
        status: "CLOSED",
      },
    ],
    movements: [],
    customers: [
      {
        id: "customer-ana",
        name: "Ana Rodríguez",
        phone: "11 4444-9080",
        notes: "Timbre 4° B",
        preferences: "Prefiere contacto por WhatsApp.",
        tags: ["Frecuente"],
        preferredPaymentMethodCode: "TRANSFER",
        active: true,
        mergedIntoCustomerId: null,
        updatedAt,
        addresses: [
          {
            id: "address-ana",
            label: "Casa",
            address: "Av. Rivadavia 3250, 4° B",
            notes: null,
            deliveryFeeMinor: 250_000,
          },
        ],
      },
      {
        id: "customer-mariana",
        name: "Mariana Pérez",
        phone: "11 5555-0182",
        notes: null,
        preferences: null,
        tags: [],
        preferredPaymentMethodCode: null,
        active: true,
        mergedIntoCustomerId: null,
        updatedAt,
        addresses: [
          {
            id: "address-mariana",
            label: "Casa",
            address: "Av. San Martín 1420",
            notes: "Portón negro",
            deliveryFeeMinor: 320_000,
          },
        ],
      },
    ],
    audit: [
      {
        id: "audit-seed",
        timestamp: new Date(Date.now() - 52 * 60_000).toISOString(),
        businessDate: today(),
        operatorName: "Administrador Demo",
        authorizerName: null,
        permissionUsed: null,
        entityType: "ORDER",
        entityId: "order-1000",
        action: "PEDIDO_COBRADO",
        reason: null,
        beforeJson: null,
        afterJson: JSON.stringify({ estadoPago: "PAGADO" }),
      },
    ],
    sequence: 2000,
  };
}

function loadState(storage: DemoStorage): DemoState {
  try {
    const raw = storage.getItem(DEMO_STORAGE_KEY);
    if (!raw) return seedState();
    const parsed = JSON.parse(raw) as Omit<DemoState, "version"> & {
      version: number;
    };
    if (
      ![5, 6, 7, 8, 9].includes(parsed.version) ||
      !parsed.data?.settings?.printing
    )
      return seedState();
    if (parsed.version === 5) {
      for (const product of parsed.data.products) {
        if (product.stockMinor === legacySeedStock.get(product.id))
          product.stockMinor *= 1000;
      }
      parsed.version = 6;
    }
    parsed.historicalSessions ??= [];
    parsed.movements ??= [];
    for (const customer of parsed.customers) {
      if (
        !customer.updatedAt ||
        !Number.isFinite(Date.parse(customer.updatedAt))
      )
        customer.updatedAt = now();
      for (const address of customer.addresses) address.deliveryFeeMinor ??= 0;
      customer.preferences ??= null;
      customer.tags ??= [];
      customer.preferredPaymentMethodCode ??= null;
      customer.active ??= true;
      customer.mergedIntoCustomerId ??= null;
    }
    for (const ledger of parsed.data.deliveryLedger) {
      if (
        ledger.status === "PENDING" &&
        ledger.amountDueMinor <= ledger.settledAmountMinor
      ) {
        ledger.status = "SETTLED";
        ledger.settledAmountMinor = ledger.amountDueMinor;
        ledger.settledAt ??= ledger.createdAt;
      }
    }
    parsed.version = 9;
    return parsed as DemoState;
  } catch {
    return seedState();
  }
}

function requirePin(pin: string) {
  if (pin !== DEMO_PIN)
    throw new Error("PIN incorrecto. En la demostración usá 1234.");
}

function roleName(role: UserDto["roleCode"]) {
  return (
    {
      ADMIN: "Administrador",
      MANAGER: "Encargado",
      CASHIER: "Cajero",
      WAITER: "Mozo",
      DELIVERY_DRIVER: "Repartidor",
    } as const
  )[role];
}

function nextAvailableStaffNumber(users: UserDto[]) {
  const used = new Set(users.map((user) => user.staffNumber));
  let candidate = 1;
  while (used.has(candidate)) candidate += 1;
  return candidate;
}

function methodName(data: BootstrapDto, code: string) {
  return (
    data.paymentMethods.find((method) => method.code === code)?.name ?? code
  );
}

function orderPrice(product: ProductDto, type: OrderDto["type"]) {
  const code = type === "DINE_IN" ? "SALON" : type;
  return (
    product.prices.find((price) => price.priceListCode === code)?.amountMinor ??
    0
  );
}

function refreshOrder(order: OrderDto) {
  for (const item of order.items) {
    const modifiers = item.modifiers.reduce(
      (sum, modifier) => sum + modifier.unitPriceMinorSnapshot,
      0,
    );
    item.lineTotalMinor = Math.max(
      0,
      (item.unitPriceMinorSnapshot + modifiers) * item.quantity -
        item.discountMinorSnapshot,
    );
  }
  order.subtotalMinor = order.items.reduce(
    (sum, item) => sum + item.lineTotalMinor,
    0,
  );
  order.totalMinor = Math.max(
    0,
    order.subtotalMinor + order.deliveryFeeMinor - order.discountMinor,
  );
  order.paidMinor = order.payments.reduce(
    (sum, payment) => sum + payment.amountMinor - payment.refundedMinor,
    0,
  );
  order.paymentStatus =
    order.paidMinor === 0
      ? "UNPAID"
      : order.paidMinor >= order.totalMinor
        ? "PAID"
        : "PARTIALLY_PAID";
  order.updatedAt = now();
}

function refreshTables(data: BootstrapDto) {
  for (const table of data.tables) {
    const order = data.orders.find(
      (candidate) =>
        candidate.tableId === table.id &&
        !["DELIVERED", "CANCELLED"].includes(candidate.operationalStatus),
    );
    table.currentOrderId = order?.id ?? null;
    table.currentTotalMinor = order?.totalMinor ?? 0;
    table.waiterName = order?.waiterName ?? null;
    table.openedAt = order?.createdAt ?? null;
  }
}

function makeDashboard(data: BootstrapDto) {
  const currentSessionId = data.cashSession?.id;
  const valid = data.orders.filter(
    (order) =>
      order.lifecycleStatus === "CONFIRMED" &&
      order.operationalStatus !== "CANCELLED" &&
      (currentSessionId ? order.cashSessionPaidId === currentSessionId : true),
  );
  const paid = valid.filter((order) => order.paidMinor > 0);
  const result = emptyDashboard();
  // El contador de ventas debe representar operaciones cobradas, no pedidos
  // confirmados todavía impagos. Los pedidos abiertos conservan su métrica.
  result.orderCount = paid.length;
  result.openOrderCount = valid.filter(
    (order) => order.operationalStatus !== "DELIVERED",
  ).length;
  result.salesTotalMinor = paid.reduce(
    (sum, order) => sum + order.paidMinor,
    0,
  );
  result.averageTicketMinor = paid.length
    ? Math.round(result.salesTotalMinor / paid.length)
    : 0;
  for (const order of paid) result.byType[order.type] += order.paidMinor;
  const paymentTotals = new Map<string, number>();
  for (const order of paid)
    for (const payment of order.payments)
      paymentTotals.set(
        payment.methodCode,
        (paymentTotals.get(payment.methodCode) ?? 0) +
          payment.amountMinor -
          payment.refundedMinor,
      );
  result.byPaymentMethod = [...paymentTotals].map(([code, amountMinor]) => ({
    code,
    name: methodName(data, code),
    amountMinor,
  }));
  return result;
}

function makeDriverDeliveryActivity(
  orders: OrderDto[],
): DriverDeliveryActivityDto[] {
  const byDriver = new Map<string, DriverDeliveryActivityDto>();
  for (const order of orders) {
    if (
      order.type !== "DELIVERY" ||
      order.operationalStatus !== "DELIVERED" ||
      !order.driverUserId
    )
      continue;
    const current = byDriver.get(order.driverUserId);
    if (current) {
      current.deliveryCount += 1;
      current.earningsMinor += order.deliveryFeeMinor;
      if (order.updatedAt > current.lastDeliveryAt)
        current.lastDeliveryAt = order.updatedAt;
    } else {
      byDriver.set(order.driverUserId, {
        driverUserId: order.driverUserId,
        deliveryCount: 1,
        earningsMinor: order.deliveryFeeMinor,
        lastDeliveryAt: order.updatedAt,
      });
    }
  }
  return [...byDriver.values()].sort((a, b) =>
    b.lastDeliveryAt.localeCompare(a.lastDeliveryAt),
  );
}

function normalize(state: DemoState) {
  for (const order of state.data.orders) refreshOrder(order);
  if (state.data.cashSession) {
    const paid = state.data.orders.filter(
      (order) =>
        order.cashSessionPaidId === state.data.cashSession?.id &&
        order.lifecycleStatus === "CONFIRMED" &&
        order.operationalStatus !== "CANCELLED" &&
        order.paidMinor > 0,
    );
    state.data.cashSession.salesTotalMinor = paid.reduce(
      (sum, order) => sum + order.paidMinor,
      0,
    );
    state.data.cashSession.salesByType = {
      DINE_IN: 0,
      TAKEAWAY: 0,
      DELIVERY: 0,
    };
    for (const order of paid)
      state.data.cashSession.salesByType[order.type] += order.paidMinor;
    const byMethod = new Map<
      string,
      { code: string; name: string; amountMinor: number }
    >();
    for (const order of paid)
      for (const payment of order.payments) {
        const item = byMethod.get(payment.methodCode) ?? {
          code: payment.methodCode,
          name: payment.methodName,
          amountMinor: 0,
        };
        item.amountMinor += payment.amountMinor - payment.refundedMinor;
        byMethod.set(payment.methodCode, item);
      }
    state.data.cashSession.salesByPaymentMethod = [...byMethod.values()];
  }
  refreshTables(state.data);
  state.data.dashboard = makeDashboard(state.data);
  state.data.driverDeliveryActivity = makeDriverDeliveryActivity(
    state.data.orders,
  );
}

function audit(
  state: DemoState,
  entityType: string,
  entityId: string,
  action: string,
  reason: string | null = null,
  permissionUsed: string | null = null,
) {
  state.audit.unshift({
    id: uid("audit", state),
    timestamp: now(),
    businessDate: today(),
    operatorName: state.data.currentUser.fullName,
    authorizerName: permissionUsed ? state.data.currentUser.fullName : null,
    permissionUsed,
    entityType,
    entityId,
    action,
    reason,
    beforeJson: null,
    afterJson: null,
  });
}

function retentionCutoff() {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() - 2);
  return date.toISOString().slice(0, 10);
}

function sessionReport(
  state: DemoState,
  filters: CashSessionReportFilters,
): CashSessionReportDto {
  const session = [state.data.cashSession, ...state.historicalSessions].find(
    (candidate) => candidate?.id === filters.cashSessionId,
  );
  if (!session) throw new Error("No se encontró la caja.");
  const detailAvailable =
    session.status === "OPEN" ||
    (session.closedAt ?? session.openedAt).slice(0, 10) >= retentionCutoff();
  const base = state.data.orders.filter(
    (order) =>
      order.cashSessionPaidId === session.id &&
      order.paidMinor > 0 &&
      order.operationalStatus !== "CANCELLED",
  );
  const orders = detailAvailable
    ? base.filter(
        (order) =>
          (!filters.tableId || order.tableId === filters.tableId) &&
          (!filters.waiterUserId ||
            order.waiterUserId === filters.waiterUserId) &&
          (!filters.productId ||
            order.items.some((item) => item.productId === filters.productId)) &&
          (!filters.categoryName ||
            order.items.some(
              (item) =>
                state.data.products.find((p) => p.id === item.productId)
                  ?.categoryName === filters.categoryName,
            )) &&
          (!filters.orderType || order.type === filters.orderType) &&
          (!filters.paymentMethodCode ||
            order.payments.some(
              (p) => p.methodCode === filters.paymentMethodCode,
            )) &&
          (!filters.operationalStatus ||
            order.operationalStatus === filters.operationalStatus),
      )
    : base;
  const totals = {
    salesMinor: detailAvailable
      ? orders.reduce((n, o) => n + o.paidMinor, 0)
      : (session.salesTotalMinor ?? 0),
    orderCount: detailAvailable ? orders.length : 0,
    averageTicketMinor: 0,
    discountsMinor: 0,
    refundsMinor: detailAvailable ? 0 : (session.cashRefundMinor ?? 0),
  };
  totals.averageTicketMinor = totals.orderCount
    ? Math.round(totals.salesMinor / totals.orderCount)
    : 0;
  const grouped = <T extends string>(
    values: Array<{ key: T; name: string; amount: number; count: number }>,
  ) => {
    const map = new Map<T, { name: string; amount: number; count: number }>();
    for (const value of values) {
      const row = map.get(value.key) ?? {
        name: value.name,
        amount: 0,
        count: 0,
      };
      row.amount += value.amount;
      row.count += value.count;
      map.set(value.key, row);
    }
    return [...map].map(([key, value]) => ({
      key,
      name: value.name,
      orderCount: value.count,
      amountMinor: value.amount,
    }));
  };
  const byTable = grouped(
    orders.map((o) => ({
      key: o.tableId ?? "",
      name:
        state.data.tables.find((t) => t.id === o.tableId)?.name ??
        (o.tableId
          ? `Mesa ${state.data.tables.find((t) => t.id === o.tableId)?.number ?? ""}`
          : "Sin mesa"),
      amount: o.paidMinor,
      count: 1,
    })),
  ).map(({ key, ...v }) => ({ tableId: key || null, ...v }));
  const byWaiter = grouped(
    orders.map((o) => ({
      key: o.waiterUserId ?? "",
      name: o.waiterName ?? "Sin mozo",
      amount: o.paidMinor,
      count: 1,
    })),
  ).map(({ key, ...v }) => ({ waiterUserId: key || null, ...v }));
  const byType = (["DINE_IN", "TAKEAWAY", "DELIVERY"] as const).map((type) => ({
    type,
    orderCount: detailAvailable
      ? orders.filter((o) => o.type === type).length
      : 0,
    amountMinor: detailAvailable
      ? orders
          .filter((o) => o.type === type)
          .reduce((n, o) => n + o.paidMinor, 0)
      : (session.salesByType?.[type] ?? 0),
  }));
  const productMap = new Map<
    string,
    { productId: string | null; quantity: number; amountMinor: number }
  >();
  for (const o of orders)
    for (const item of o.items) {
      const row = productMap.get(item.productNameSnapshot) ?? {
        productId: item.productId,
        quantity: 0,
        amountMinor: 0,
      };
      row.quantity += item.quantity;
      row.amountMinor += item.lineTotalMinor;
      productMap.set(item.productNameSnapshot, row);
    }
  const byProduct = [...productMap].map(([name, v]) => ({ name, ...v }));
  const categoryMap = new Map<
    string,
    { quantity: number; amountMinor: number }
  >();
  for (const row of byProduct) {
    const category =
      state.data.products.find((p) => p.id === row.productId)?.categoryName ??
      "Otros";
    const current = categoryMap.get(category) ?? {
      quantity: 0,
      amountMinor: 0,
    };
    current.quantity += row.quantity;
    current.amountMinor += row.amountMinor;
    categoryMap.set(category, current);
  }
  const byPaymentMethod = detailAvailable
    ? [
        ...new Set(orders.flatMap((o) => o.payments.map((p) => p.methodCode))),
      ].map((code) => ({
        code,
        name: methodName(state.data, code),
        amountMinor: orders
          .flatMap((o) => o.payments)
          .filter((p) => p.methodCode === code)
          .reduce((n, p) => n + p.amountMinor - p.refundedMinor, 0),
      }))
    : (session.salesByPaymentMethod ?? []);
  return outputReport({
    session,
    detailAvailable,
    retentionCutoff: retentionCutoff(),
    totals,
    byTable,
    byWaiter,
    byProduct,
    byCategory: [...categoryMap].map(([name, v]) => ({ name, ...v })),
    byType,
    byPaymentMethod,
    orders: detailAvailable ? orders : [],
    movements: detailAvailable
      ? state.movements.filter((m) => m.sessionId === session.id)
      : [],
    filters,
  });
}

const outputReport = <T>(value: T): T => clone(value);

export function resetDemoData(storage: DemoStorage = window.localStorage) {
  storage.removeItem(DEMO_STORAGE_KEY);
}

export function createDemoApi(
  storage: DemoStorage = window.localStorage,
): DesktopApi {
  let state = loadState(storage);
  const save = () => {
    normalize(state);
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
  };
  const output = <T>(value: T) => clone(value);
  const orderById = (id: string) => {
    const order = state.data.orders.find((candidate) => candidate.id === id);
    if (!order) throw new Error("No se encontró el pedido.");
    return order;
  };
  const productById = (id: string) => {
    const product = state.data.products.find(
      (candidate) => candidate.id === id,
    );
    if (!product) throw new Error("No se encontró el producto.");
    return product;
  };
  const categoryById = (id: string) => {
    const category = state.data.categories.find(
      (candidate) => candidate.id === id,
    );
    if (!category) throw new Error("No se encontró la categoría.");
    return category;
  };
  const matchingCustomers = (
    query: string,
    status: "ACTIVE" | "ARCHIVED" | "ALL" = "ACTIVE",
  ) => {
    const normalized = query.trim().toLocaleLowerCase("es");
    const digits = query.replace(/\D/g, "");
    const hasPhoneQuery = digits.length > 0 && !/[a-záéíóúñü]/i.test(query);
    return state.customers
      .filter(
        (customer) =>
          (status === "ALL" ||
            (status === "ACTIVE" ? customer.active : !customer.active)) &&
          (!normalized ||
            (hasPhoneQuery &&
              customer.phone.replace(/\D/g, "").includes(digits)) ||
            `${customer.name} ${customer.phone} ${customer.addresses.map((address) => `${address.address} ${address.notes ?? ""}`).join(" ")}`
              .toLocaleLowerCase("es")
              .includes(normalized)),
      )
      .sort((left, right) => {
        if (hasPhoneQuery) {
          const leftPhone = left.phone.replace(/\D/g, "").includes(digits);
          const rightPhone = right.phone.replace(/\D/g, "").includes(digits);
          if (leftPhone !== rightPhone) return leftPhone ? -1 : 1;
        }
        const byName = left.name.localeCompare(right.name, "es-AR", {
          sensitivity: "base",
        });
        return byName || left.id.localeCompare(right.id);
      });
  };
  const stockRequirements = (order: OrderDto) => {
    const requiredByProduct = new Map<string, number>();
    const add = (productId: string, amount: number) =>
      requiredByProduct.set(
        productId,
        (requiredByProduct.get(productId) ?? 0) + amount,
      );
    for (const item of order.items) {
      if (item.productId) add(item.productId, item.quantity * 1000);
      else
        for (const half of item.halves)
          add(half.productId, item.quantity * 500);
    }
    return requiredByProduct;
  };
  const reserveOrderStock = (order: OrderDto) => {
    if (!state.data.settings.stockEnabled) return;
    const requirements = stockRequirements(order);
    for (const [productId, required] of requirements) {
      const product = productById(productId);
      if (product.stockMinor != null && product.stockMinor < required)
        throw new Error(`Stock insuficiente para ${product.name}.`);
    }
    for (const [productId, required] of requirements) {
      const product = productById(productId);
      if (product.stockMinor != null) product.stockMinor -= required;
    }
  };
  const releaseOrderStock = (order: OrderDto) => {
    if (!state.data.settings.stockEnabled) return;
    for (const [productId, amount] of stockRequirements(order)) {
      const product = productById(productId);
      if (product.stockMinor != null) product.stockMinor += amount;
    }
  };

  save();

  return {
    async bootstrap() {
      save();
      return output(state.data);
    },

    async ensureTable({ number }) {
      if (!Number.isInteger(number) || number <= 0)
        throw new Error("Ingresá un número de mesa válido.");
      let table = state.data.tables.find(
        (candidate) => candidate.number === number,
      );
      if (!table) {
        table = {
          id: uid("table", state),
          number,
          name: null,
          active: true,
          sortOrder: number,
          currentOrderId: null,
          currentTotalMinor: 0,
          waiterName: null,
          openedAt: null,
        };
        state.data.tables.push(table);
        state.data.tables.sort((a, b) => a.number - b.number);
        audit(state, "TABLE", table.id, "MESA_CREADA");
        save();
      }
      return output(table);
    },

    async openCashSession(input) {
      if (state.data.cashSession?.status === "OPEN")
        throw new Error("Ya hay una caja abierta.");
      const cashSession = {
        id: uid("cash", state),
        number: 19,
        businessDate: today(),
        openedAt: now(),
        closedAt: null,
        openedByUserId: state.data.currentUser.id,
        openedByName: state.data.currentUser.fullName,
        openingAmountMinor: input.openingAmountMinor,
        expectedAmountMinor: input.openingAmountMinor,
        countedAmountMinor: null,
        differenceMinor: null,
        closingFloatAmountMinor: null,
        cashRemovedAmountMinor: null,
        floatDifferenceMinor: null,
        cashSalesMinor: 0,
        cashIncomeMinor: 0,
        cashExpenseMinor: 0,
        cashWithdrawalMinor: 0,
        cashRefundMinor: 0,
        status: "OPEN" as const,
      };
      state.data.cashSession = cashSession;
      audit(
        state,
        "CASH_SESSION",
        cashSession.id,
        "CAJA_ABIERTA",
        input.note ?? null,
      );
      save();
      return output(cashSession);
    },

    async registerCashMovement(input) {
      const cash = state.data.cashSession;
      if (!cash || cash.status !== "OPEN")
        throw new Error("Abrí una caja antes de registrar movimientos.");
      if (input.amountMinor <= 0)
        throw new Error("El importe debe ser mayor que cero.");
      if (
        ["EXPENSE", "WITHDRAWAL"].includes(input.type) &&
        input.amountMinor > cash.expectedAmountMinor
      )
        throw new Error(
          "La caja no tiene efectivo suficiente. Registrá un ingreso o corregí el importe antes de continuar.",
        );
      cash.expectedAmountMinor += ["EXPENSE", "WITHDRAWAL"].includes(input.type)
        ? -input.amountMinor
        : input.amountMinor;
      if (input.type === "INCOME")
        cash.cashIncomeMinor = (cash.cashIncomeMinor ?? 0) + input.amountMinor;
      if (input.type === "EXPENSE")
        cash.cashExpenseMinor =
          (cash.cashExpenseMinor ?? 0) + input.amountMinor;
      if (input.type === "WITHDRAWAL")
        cash.cashWithdrawalMinor =
          (cash.cashWithdrawalMinor ?? 0) + input.amountMinor;
      state.movements.push({
        id: uid("movement", state),
        sessionId: cash.id,
        type: input.type,
        amountMinor: input.amountMinor,
        affectsCash: true,
        paymentMethodCode: null,
        orderId: null,
        userId: state.data.currentUser.id,
        reason: input.reason ?? null,
        createdAt: now(),
      });
      audit(state, "CASH_SESSION", cash.id, `CAJA_${input.type}`, input.reason);
      save();
      return output(cash);
    },

    async closeCashSession(input) {
      const cash = state.data.cashSession;
      if (!cash || cash.status !== "OPEN")
        throw new Error("No hay una caja abierta.");
      const pending = state.data.orders.some(
        (order) =>
          !["DELIVERED", "CANCELLED"].includes(order.operationalStatus),
      );
      if (
        pending &&
        !input.force &&
        !state.data.settings.allowCloseWithPendingOrders
      )
        throw new Error(
          "Hay pedidos pendientes. Revisalos o usá el cierre forzado.",
        );
      const pendingSettlements = state.data.deliveryLedger.filter(
        (ledger) =>
          ledger.status === "PENDING" &&
          ledger.amountDueMinor > ledger.settledAmountMinor,
      ).length;
      if (pendingSettlements > 0 && !input.force)
        throw new Error(
          `Hay ${pendingSettlements} rendición(es) de delivery pendiente(s). Liquidá los saldos o usá el cierre forzado.`,
        );
      if (input.force) {
        requirePin(input.authorizerPin ?? "");
        if (!input.reason?.trim())
          throw new Error("Indicá el motivo del cierre forzado.");
      }
      if (input.countedAmountMinor < 0)
        throw new Error("El efectivo contado no puede ser negativo.");
      const differenceMinor =
        input.countedAmountMinor - cash.expectedAmountMinor;
      if (differenceMinor !== 0 && !input.reason?.trim())
        throw new Error(
          "Explicá la diferencia entre lo esperado y lo contado.",
        );
      const closingFloatAmountMinor =
        input.closingFloatAmountMinor ?? cash.openingAmountMinor;
      if (closingFloatAmountMinor < 0)
        throw new Error("El cambio final no puede ser negativo.");
      if (closingFloatAmountMinor > input.countedAmountMinor)
        throw new Error(
          "El cambio final no puede superar el efectivo contado.",
        );
      const closed = {
        ...cash,
        status: "CLOSED" as const,
        closedAt: now(),
        countedAmountMinor: input.countedAmountMinor,
        differenceMinor,
        closingFloatAmountMinor,
        cashRemovedAmountMinor:
          input.countedAmountMinor - closingFloatAmountMinor,
        floatDifferenceMinor: closingFloatAmountMinor - cash.openingAmountMinor,
      };
      audit(
        state,
        "CASH_SESSION",
        cash.id,
        "CAJA_CERRADA",
        input.reason ?? null,
        input.force ? "cash.close" : null,
      );
      state.historicalSessions.unshift(clone(closed));
      state.data.cashSession = null;
      save();
      return output(closed);
    },

    async createOrder(input) {
      const cash = state.data.cashSession;
      if (!cash || cash.status !== "OPEN")
        throw new Error("Abrí una caja antes de crear pedidos.");
      assertOffPremiseCustomer(input);
      if (
        !Number.isSafeInteger(input.deliveryFeeMinor ?? 0) ||
        (input.deliveryFeeMinor ?? 0) < 0
      )
        throw new Error("El costo de delivery no es válido.");
      const table = input.tableId
        ? state.data.tables.find((candidate) => candidate.id === input.tableId)
        : null;
      if (input.type === "DINE_IN" && !table)
        throw new Error("Seleccioná una mesa válida.");
      if (table?.currentOrderId) return output(orderById(table.currentOrderId));
      const waiter = input.waiterUserId
        ? state.data.users.find(
            (user) => user.id === input.waiterUserId && user.active,
          )
        : null;
      if (input.waiterUserId && !waiter)
        throw new Error("El mozo seleccionado no está activo.");
      const customer = input.customerId
        ? state.customers.find((candidate) => candidate.id === input.customerId)
        : null;
      if (input.customerId && !customer)
        throw new Error("El cliente no existe.");
      const selectedAddress = input.customerAddressId
        ? customer?.addresses.find(
            (candidate) => candidate.id === input.customerAddressId,
          )
        : customer?.addresses.find(
            (candidate) => candidate.address === input.deliveryAddress?.trim(),
          );
      if (input.customerAddressId && !selectedAddress)
        throw new Error("La dirección seleccionada no pertenece al cliente.");
      if (input.type === "DELIVERY" && selectedAddress)
        selectedAddress.deliveryFeeMinor = input.deliveryFeeMinor ?? 0;
      const driver = input.driverUserId
        ? state.data.users.find(
            (user) =>
              user.id === input.driverUserId &&
              user.active &&
              user.roleCode === "DELIVERY_DRIVER",
          )
        : null;
      if (input.driverUserId && !driver)
        throw new Error(
          "El repartidor no existe, está inactivo o no tiene el rol de repartidor.",
        );
      const order: OrderDto = {
        id: uid("order", state),
        number:
          Math.max(
            1002,
            ...state.data.orders.map((candidate) => candidate.number),
          ) + 1,
        type: input.type,
        operationalStatus: "PENDING",
        paymentStatus: "UNPAID",
        lifecycleStatus: "DRAFT",
        cashSessionCreatedId: cash.id,
        cashSessionPaidId: null,
        tableId: table?.id ?? null,
        tableNumber: table?.number ?? null,
        customerId: input.customerId ?? null,
        customerNameSnapshot:
          input.customerName?.trim() || customer?.name || null,
        customerPhoneSnapshot:
          input.customerPhone?.trim() || customer?.phone || null,
        deliveryAddressSnapshot:
          selectedAddress?.address ?? input.deliveryAddress?.trim() ?? null,
        deliveryAddressNotesSnapshot: selectedAddress?.notes ?? null,
        deliveryFeeMinor: input.deliveryFeeMinor ?? 0,
        promisedAt: input.promisedAt ?? null,
        scheduled: input.scheduled ?? false,
        waiterUserId: waiter?.id ?? null,
        waiterName: waiter?.fullName ?? null,
        driverUserId: driver?.id ?? null,
        driverName: driver?.fullName ?? null,
        collectedByDriver: false,
        notes: input.notes ?? null,
        subtotalMinor: 0,
        discountMinor: 0,
        totalMinor: input.deliveryFeeMinor ?? 0,
        paidMinor: 0,
        printedAt: null,
        printCount: 0,
        createdAt: now(),
        updatedAt: now(),
        items: [],
        payments: [],
      };
      state.data.orders.unshift(order);
      audit(state, "ORDER", order.id, "PEDIDO_CREADO");
      save();
      return output(order);
    },

    async updateDraftOrder(input) {
      const order = orderById(input.orderId);
      if (order.lifecycleStatus !== "DRAFT")
        throw new Error(
          "Solo se pueden volver a editar los datos de un borrador.",
        );
      if (order.type === "DINE_IN" || input.type !== order.type)
        throw new Error("El tipo del borrador no se puede modificar.");
      assertOffPremiseCustomer(input);
      const fee = input.deliveryFeeMinor ?? 0;
      if (!Number.isSafeInteger(fee) || fee < 0)
        throw new Error("El costo de delivery no es válido.");
      const customer = input.customerId
        ? state.customers.find((candidate) => candidate.id === input.customerId)
        : null;
      if (input.customerId && !customer)
        throw new Error("El cliente no existe.");
      const selectedAddress = input.customerAddressId
        ? customer?.addresses.find(
            (candidate) => candidate.id === input.customerAddressId,
          )
        : customer?.addresses.find(
            (candidate) => candidate.address === input.deliveryAddress?.trim(),
          );
      if (input.customerAddressId && !selectedAddress)
        throw new Error("La dirección seleccionada no pertenece al cliente.");
      if (order.type === "DELIVERY" && selectedAddress)
        selectedAddress.deliveryFeeMinor = fee;
      const driver = input.driverUserId
        ? state.data.users.find(
            (user) =>
              user.id === input.driverUserId &&
              user.active &&
              user.roleCode === "DELIVERY_DRIVER",
          )
        : null;
      if (input.driverUserId && !driver)
        throw new Error("El repartidor seleccionado no está activo.");
      Object.assign(order, {
        customerId: customer?.id ?? null,
        customerNameSnapshot:
          input.customerName?.trim() || customer?.name || null,
        customerPhoneSnapshot:
          input.customerPhone?.trim() || customer?.phone || null,
        deliveryAddressSnapshot:
          selectedAddress?.address ?? input.deliveryAddress?.trim() ?? null,
        deliveryAddressNotesSnapshot: selectedAddress?.notes ?? null,
        deliveryFeeMinor: fee,
        promisedAt: input.promisedAt ?? null,
        scheduled: input.scheduled ?? false,
        driverUserId: driver?.id ?? null,
        driverName: driver?.fullName ?? null,
        notes: input.notes?.trim() || null,
        updatedAt: now(),
      });
      audit(state, "ORDER", order.id, "ORDER_DRAFT_UPDATED");
      save();
      return output(order);
    },

    async confirmOrder({ orderId }) {
      const order = orderById(orderId);
      assertOrderAction(order, "CONFIRM");
      reserveOrderStock(order);
      order.lifecycleStatus = "CONFIRMED";
      order.operationalStatus = "IN_PREPARATION";
      audit(state, "ORDER", order.id, "PEDIDO_CONFIRMADO");
      save();
      return output(order);
    },

    async discardDraftOrder({ orderId }) {
      const order = orderById(orderId);
      assertOrderAction(order, "DISCARD_DRAFT");
      state.data.orders = state.data.orders.filter(
        (candidate) => candidate.id !== orderId,
      );
      audit(state, "ORDER", order.id, "BORRADOR_DESCARTADO");
      save();
      return { discarded: true };
    },

    async addOrderItem(input) {
      const order = orderById(input.orderId);
      assertOrderAction(order, "EDIT");
      const product = productById(input.productId);
      if (!product.active) throw new Error("El producto está inactivo.");
      const quantity = input.quantity ?? 1;
      if (quantity <= 0)
        throw new Error("La cantidad debe ser mayor que cero.");
      const catalogUnit = orderPrice(product, order.type);
      const unit = input.unitPriceMinorOverride ?? catalogUnit;
      if (!Number.isInteger(unit) || unit < 0)
        throw new Error("El precio manual no es válido.");
      const priceWasOverridden = unit !== catalogUnit;
      if (priceWasOverridden) requirePin(input.authorizerPin ?? "");
      if (
        order.lifecycleStatus === "CONFIRMED" &&
        state.data.settings.stockEnabled &&
        product.stockMinor != null
      ) {
        const required = quantity * 1000;
        if (product.stockMinor < required)
          throw new Error(`Stock insuficiente para ${product.name}.`);
        product.stockMinor -= required;
      }
      const item: OrderItemDto = {
        id: uid("item", state),
        productId: product.id,
        productNameSnapshot: product.name,
        quantity,
        unitPriceMinorSnapshot: unit,
        discountMinorSnapshot: 0,
        notes: input.notes ?? null,
        halves: [],
        modifiers: [],
        lineTotalMinor: unit * quantity,
      };
      order.items.push(item);
      if (priceWasOverridden) {
        audit(
          state,
          "ORDER",
          order.id,
          "ORDER_ITEM_PRICE_OVERRIDDEN",
          "Precio manual al cargar el producto en la mesa",
          "orders.override_price",
        );
      }
      audit(state, "ORDER", order.id, "PRODUCTO_AGREGADO");
      save();
      return output(order);
    },

    async updateOrderItemNotes(input) {
      const order = orderById(input.orderId);
      assertOrderAction(order, "EDIT");
      const item = order.items.find(
        (candidate) => candidate.id === input.itemId,
      );
      if (!item) throw new Error("No se encontró el producto del pedido.");
      const notes = input.notes?.trim() || null;
      if (notes && notes.length > 500)
        throw new Error("Las observaciones admiten hasta 500 caracteres.");
      const before = item.notes;
      item.notes = notes;
      order.updatedAt = now();
      audit(
        state,
        "ORDER_ITEM",
        item.id,
        "ORDER_ITEM_NOTES_UPDATED",
        `Pedido ${order.number}: observaciones ${before ? "actualizadas" : notes ? "agregadas" : "eliminadas"}`,
      );
      save();
      return output(order);
    },

    async addHalfAndHalfItem(input) {
      const order = orderById(input.orderId);
      assertOrderAction(order, "EDIT");
      const first = productById(input.firstProductId);
      const second = productById(input.secondProductId);
      const firstPrice = orderPrice(first, order.type);
      const secondPrice = orderPrice(second, order.type);
      const unit =
        state.data.settings.halfAndHalfPricingMode === "MOST_EXPENSIVE"
          ? Math.max(firstPrice, secondPrice)
          : Math.round((firstPrice + secondPrice) / 2);
      const quantity = input.quantity ?? 1;
      if (quantity <= 0)
        throw new Error("La cantidad debe ser mayor que cero.");
      if (
        order.lifecycleStatus === "CONFIRMED" &&
        state.data.settings.stockEnabled
      ) {
        const requirements = new Map<string, number>();
        requirements.set(
          first.id,
          (requirements.get(first.id) ?? 0) + quantity * 500,
        );
        requirements.set(
          second.id,
          (requirements.get(second.id) ?? 0) + quantity * 500,
        );
        for (const [productId, required] of requirements) {
          const product = productById(productId);
          if (product.stockMinor != null && product.stockMinor < required)
            throw new Error(`Stock insuficiente para ${product.name}.`);
        }
        for (const [productId, required] of requirements) {
          const product = productById(productId);
          if (product.stockMinor != null) product.stockMinor -= required;
        }
      }
      order.items.push({
        id: uid("item", state),
        productId: null,
        productNameSnapshot: `Mitad ${first.name} / mitad ${second.name}`,
        quantity,
        unitPriceMinorSnapshot: unit,
        discountMinorSnapshot: 0,
        notes: input.notes ?? null,
        halves: [
          {
            productId: first.id,
            nameSnapshot: first.name,
            priceMinorSnapshot: firstPrice,
            position: "FIRST",
          },
          {
            productId: second.id,
            nameSnapshot: second.name,
            priceMinorSnapshot: secondPrice,
            position: "SECOND",
          },
        ],
        modifiers: [],
        lineTotalMinor: unit * quantity,
      });
      audit(state, "ORDER", order.id, "MITAD_Y_MITAD_AGREGADA");
      save();
      return output(order);
    },

    async removeOrderItem(input) {
      const order = orderById(input.orderId);
      assertOrderAction(order, "EDIT");
      if (order.lifecycleStatus === "CONFIRMED" && order.items.length <= 1)
        throw new Error(
          "Un pedido confirmado no puede quedar vacío. Cancelalo si ya no corresponde.",
        );
      const removed = order.items.find((item) => item.id === input.itemId);
      if (!removed) throw new Error("No se encontró el producto del pedido.");
      if (
        order.lifecycleStatus === "CONFIRMED" &&
        state.data.settings.stockEnabled
      ) {
        const removedOrder = { ...order, items: [removed] };
        releaseOrderStock(removedOrder);
      }
      order.items = order.items.filter((item) => item.id !== input.itemId);
      audit(state, "ORDER", order.id, "PRODUCTO_QUITADO");
      save();
      return output(order);
    },

    async addOrderItemModifier(input) {
      const order = orderById(input.orderId);
      assertOrderAction(order, "EDIT");
      const item = order.items.find(
        (candidate) => candidate.id === input.itemId,
      );
      const modifier = state.data.modifiers.find(
        (candidate) => candidate.id === input.modifierId && candidate.active,
      );
      if (!item || !modifier)
        throw new Error("No se encontró el producto o modificador.");
      item.modifiers.push({
        id: uid("item-modifier", state),
        nameSnapshot: modifier.name,
        unitPriceMinorSnapshot: modifier.priceMinor,
        scope: input.scope,
      });
      audit(state, "ORDER", order.id, "MODIFICADOR_AGREGADO");
      save();
      return output(order);
    },

    async removeOrderItemModifier(input) {
      const order = orderById(input.orderId);
      for (const item of order.items)
        item.modifiers = item.modifiers.filter(
          (modifier) => modifier.id !== input.modifierId,
        );
      audit(state, "ORDER", order.id, "MODIFICADOR_QUITADO");
      save();
      return output(order);
    },

    async applyOrderDiscount(input) {
      requirePin(input.authorizerPin);
      if (!input.reason.trim())
        throw new Error("Indicá el motivo del descuento.");
      const order = orderById(input.orderId);
      assertOrderAction(order, "EDIT");
      order.discountMinor =
        input.mode === "PERCENTAGE"
          ? Math.round((order.subtotalMinor * input.value) / 100)
          : input.value;
      audit(
        state,
        "ORDER",
        order.id,
        "DESCUENTO_APLICADO",
        input.reason,
        "orders.discount",
      );
      save();
      return output(order);
    },

    async updateOrderStatus(input) {
      const order = orderById(input.orderId);
      assertOperationalTransition(order, input.status);
      if (
        order.type === "DELIVERY" &&
        ["OUT_FOR_DELIVERY", "DELIVERED"].includes(input.status) &&
        !state.data.users.some(
          (user) =>
            user.id === order.driverUserId &&
            user.active &&
            user.roleCode === "DELIVERY_DRIVER",
        )
      )
        throw new Error(
          "El repartidor no existe, está inactivo o no tiene el rol de repartidor.",
        );
      order.operationalStatus = input.status;
      if (
        input.status === "DELIVERED" &&
        order.type === "DELIVERY" &&
        order.paymentStatus === "PAID" &&
        order.driverUserId &&
        state.data.settings.deliverySettlementEnabled &&
        !state.data.deliveryLedger.some((row) => row.orderId === order.id)
      ) {
        const restaurantAmount = Math.max(
          0,
          order.totalMinor - order.deliveryFeeMinor,
        );
        const amountDue = order.collectedByDriver
          ? restaurantAmount
          : order.deliveryFeeMinor;
        if (amountDue > 0)
          state.data.deliveryLedger.unshift({
            id: uid("ledger", state),
            orderId: order.id,
            orderNumber: order.number,
            driverUserId: order.driverUserId,
            driverName: order.driverName ?? "Repartidor",
            restaurantAmountMinor: restaurantAmount,
            deliveryFeeMinor: order.deliveryFeeMinor,
            direction: order.collectedByDriver
              ? "DRIVER_OWES_BUSINESS"
              : "BUSINESS_OWES_DRIVER",
            amountDueMinor: amountDue,
            settledAmountMinor: 0,
            status: "PENDING",
            createdAt: now(),
            settledAt: null,
          });
      }
      audit(state, "ORDER", order.id, "ESTADO_ACTUALIZADO");
      save();
      return output(order);
    },

    async assignDeliveryDriver(input) {
      const order = orderById(input.orderId);
      if (order.type !== "DELIVERY")
        throw new Error("Sólo los envíos admiten repartidor.");
      if (["DELIVERED", "CANCELLED"].includes(order.operationalStatus))
        throw new Error(
          "No se puede cambiar el repartidor de un pedido finalizado.",
        );
      if (!input.driverUserId && order.operationalStatus === "OUT_FOR_DELIVERY")
        throw new Error(
          "Un pedido en reparto debe conservar un repartidor asignado.",
        );
      if (input.driverUserId) {
        const driver = state.data.users.find(
          (user) =>
            user.id === input.driverUserId &&
            user.active &&
            user.roleCode === "DELIVERY_DRIVER",
        );
        if (!driver)
          throw new Error("El repartidor no existe o está inactivo.");
      }
      const previousDriverUserId = order.driverUserId;
      order.driverUserId = input.driverUserId;
      order.driverName = input.driverUserId
        ? (state.data.users.find((user) => user.id === input.driverUserId)
            ?.fullName ?? null)
        : null;
      order.updatedAt = now();
      audit(
        state,
        "ORDER",
        order.id,
        input.driverUserId ? "REPARTIDOR_ASIGNADO" : "REPARTIDOR_DESASIGNADO",
        `${previousDriverUserId ?? "Sin asignar"} → ${input.driverUserId ?? "Sin asignar"}`,
      );
      save();
      return output(order);
    },

    async payOrder(input) {
      const order = orderById(input.orderId);
      assertOrderAction(order, "PAY");
      if (!input.payments.length)
        throw new Error("Agregá al menos un medio de pago.");
      const amount = input.payments.reduce(
        (sum, payment) => sum + payment.amountMinor,
        0,
      );
      const remaining = order.totalMinor - order.paidMinor;
      if (amount !== remaining)
        throw new Error(
          "La suma de los pagos debe coincidir con el saldo pendiente.",
        );
      for (const payment of input.payments) {
        if (payment.amountMinor <= 0)
          throw new Error("Los importes deben ser mayores que cero.");
        if (
          payment.methodCode === "CASH" &&
          (payment.receivedMinor ?? payment.amountMinor) < payment.amountMinor
        )
          throw new Error(
            "El efectivo recibido no alcanza para cubrir el importe.",
          );
        order.payments.push({
          id: uid("payment", state),
          methodCode: payment.methodCode,
          methodName: methodName(state.data, payment.methodCode),
          amountMinor: payment.amountMinor,
          receivedMinor: payment.receivedMinor ?? null,
          reference: payment.reference ?? null,
          createdAt: now(),
          refundedMinor: 0,
          refundableMinor: payment.amountMinor,
          status: "ACTIVE",
        });
      }
      refreshOrder(order);
      order.cashSessionPaidId = state.data.cashSession?.id ?? null;
      order.collectedByDriver = input.collectedByDriver === true;
      const cashAmount = input.payments
        .filter((payment) => payment.methodCode === "CASH")
        .reduce((sum, payment) => sum + payment.amountMinor, 0);
      if (state.data.cashSession)
        state.data.cashSession.expectedAmountMinor += cashAmount;
      if (state.data.cashSession)
        state.data.cashSession.cashSalesMinor =
          (state.data.cashSession.cashSalesMinor ?? 0) + cashAmount;
      if (state.data.cashSession)
        for (const payment of input.payments) {
          const method = state.data.paymentMethods.find(
            (m) => m.code === payment.methodCode,
          );
          state.movements.push({
            id: uid("movement", state),
            sessionId: state.data.cashSession.id,
            type: "SALE",
            amountMinor: payment.amountMinor,
            affectsCash: method?.affectsCash ?? false,
            paymentMethodCode: payment.methodCode,
            orderId: order.id,
            userId: state.data.currentUser.id,
            reason: null,
            createdAt: now(),
          });
        }
      audit(state, "ORDER", order.id, "PEDIDO_COBRADO");
      save();
      return output(order);
    },

    async refundPayment(input) {
      requirePin(input.authorizerPin);
      if (!input.reason.trim())
        throw new Error("Indicá el motivo de la devolución.");
      const order = orderById(input.orderId);
      if (order.operationalStatus === "CANCELLED")
        throw new Error("No se puede devolver un pago de un pedido cancelado.");
      if (state.data.deliveryLedger.some((row) => row.orderId === order.id))
        throw new Error(
          "No se puede devolver este pago porque el envío ya generó una rendición; su anulación todavía no está disponible.",
        );
      const payment = order.payments.find(
        (candidate) => candidate.id === input.paymentId,
      );
      if (!payment) throw new Error("No se encontró el pago.");
      if (payment.refundableMinor <= 0)
        throw new Error("El pago ya fue devuelto.");
      const amountMinor = payment.refundableMinor;
      const method = state.data.paymentMethods.find(
        (candidate) => candidate.code === payment.methodCode,
      );
      if (
        method?.affectsCash &&
        !order.collectedByDriver &&
        (!state.data.cashSession ||
          amountMinor > state.data.cashSession.expectedAmountMinor)
      )
        throw new Error(
          "La caja no tiene efectivo suficiente para esta devolución. Registrá un ingreso de fondos antes de continuar.",
        );
      payment.refundedMinor += amountMinor;
      payment.refundableMinor = 0;
      payment.status = "REFUNDED";
      refreshOrder(order);
      if (
        state.data.cashSession &&
        method?.affectsCash &&
        !order.collectedByDriver
      ) {
        state.data.cashSession.expectedAmountMinor -= amountMinor;
        state.data.cashSession.cashRefundMinor =
          (state.data.cashSession.cashRefundMinor ?? 0) + amountMinor;
        state.movements.push({
          id: uid("movement", state),
          sessionId: state.data.cashSession.id,
          type: "REFUND",
          amountMinor,
          affectsCash: true,
          paymentMethodCode: payment.methodCode,
          orderId: order.id,
          userId: state.data.currentUser.id,
          reason: input.reason,
          createdAt: now(),
        });
      }
      audit(
        state,
        "PAYMENT",
        payment.id,
        "PAGO_DEVUELTO",
        input.reason,
        "payments.refund",
      );
      save();
      return output(order);
    },

    async completeOrder(input) {
      const before = clone(state);
      try {
        let order = orderById(input.orderId);
        let paymentInput = input;
        if (order.type === "DELIVERY" && order.paymentStatus !== "PAID") {
          const cashMinor = input.payments
            .filter((payment) => payment.methodCode === "CASH")
            .reduce((sum, payment) => sum + payment.amountMinor, 0);
          const nonCashMinor = input.payments
            .filter((payment) => payment.methodCode !== "CASH")
            .reduce((sum, payment) => sum + payment.amountMinor, 0);
          if (cashMinor > 0 && nonCashMinor > 0)
            throw new Error(
              "Para cobrar y entregar un envío, elegí efectivo contra entrega o un medio anticipado, sin combinarlos.",
            );
          paymentInput = { ...input, collectedByDriver: cashMinor > 0 };
        }
        if (order.lifecycleStatus === "DRAFT")
          order = await this.confirmOrder({ orderId: order.id });
        if (order.paymentStatus !== "PAID")
          order = await this.payOrder(paymentInput);
        assertOrderAction(order, "DELIVER");
        return this.updateOrderStatus({
          orderId: order.id,
          status: input.finalStatus,
        });
      } catch (error) {
        state = before;
        save();
        throw error;
      }
    },

    async cancelOrder(input) {
      requirePin(input.authorizerPin);
      if (!input.reason.trim())
        throw new Error("Indicá el motivo de la cancelación.");
      const order = orderById(input.orderId);
      assertOrderAction(order, "CANCEL");
      if (order.lifecycleStatus === "CONFIRMED") releaseOrderStock(order);
      order.operationalStatus = "CANCELLED";
      audit(
        state,
        "ORDER",
        order.id,
        "PEDIDO_CANCELADO",
        input.reason,
        "orders.cancel",
      );
      save();
      return output(order);
    },

    async printOrder(input) {
      const order = orderById(input.orderId);
      assertOrderAction(
        order,
        input.kind === "KITCHEN_ORDER" ? "PRINT_KITCHEN" : "PRINT_BILL",
      );
      const job = {
        id: uid("print", state),
        orderId: order.id,
        orderNumber: order.number,
        kind: input.kind,
        status: "PRINTED" as const,
        printerName:
          (input.kind === "KITCHEN_ORDER"
            ? state.data.settings.printing.kitchen.deviceName
            : state.data.settings.printing.bill.deviceName) || null,
        copies:
          input.kind === "KITCHEN_ORDER"
            ? state.data.settings.printing.kitchen.copies
            : state.data.settings.printing.bill.copies,
        attempts: 1,
        lastError: null,
        createdAt: now(),
        printedAt: now(),
      };
      state.data.printJobs.unshift(job);
      order.printCount += 1;
      order.printedAt = job.printedAt;
      audit(state, "PRINT_JOB", job.id, "IMPRESION_SIMULADA");
      save();
      return { jobId: job.id, status: job.status };
    },

    async retryPrint(input) {
      const job = state.data.printJobs.find(
        (candidate) => candidate.id === input.jobId,
      );
      if (!job) throw new Error("No se encontró el trabajo de impresión.");
      if (!["FAILED", "QUEUED"].includes(job.status))
        throw new Error(
          "Sólo se puede reintentar una impresión fallida o pendiente.",
        );
      job.status = "PRINTED";
      job.attempts += 1;
      job.lastError = null;
      job.printedAt = now();
      audit(state, "PRINT_JOB", job.id, "REIMPRESION_SIMULADA");
      save();
      return { jobId: job.id, status: job.status };
    },

    async printCashSessionReport(input) {
      const report = sessionReport(state, input.filters);
      return {
        printed: true,
        message: `Informe de caja ${report.session.number} enviado a la impresora demo.`,
      };
    },

    async searchCustomers(query) {
      return output(matchingCustomers(query).slice(0, query.trim() ? 50 : 200));
    },

    async searchCustomersPage(input) {
      const pageSize = Number.isFinite(input.pageSize)
        ? Math.min(100, Math.max(1, Math.trunc(input.pageSize)))
        : 24;
      const matches = matchingCustomers(input.query, input.status ?? "ACTIVE");
      const total = matches.length;
      const pageCount = total ? Math.ceil(total / pageSize) : 0;
      const requestedPage = Number.isFinite(input.page)
        ? Math.max(1, Math.trunc(input.page))
        : 1;
      const page = pageCount ? Math.min(requestedPage, pageCount) : 1;
      return output({
        items: matches.slice((page - 1) * pageSize, page * pageSize),
        total,
        page,
        pageSize,
        pageCount,
      });
    },

    async createCustomer(input) {
      validateCustomerInput(input);
      const duplicate = state.customers.find(
        (customer) =>
          normalizePhone(customer.phone) === normalizePhone(input.phone) &&
          customer.name.trim().toLocaleLowerCase("es-AR") ===
            input.name.trim().toLocaleLowerCase("es-AR"),
      );
      if (duplicate)
        throw new Error(
          `Ya existe una ficha de ${duplicate.name} con ese teléfono. Abrila en lugar de crear un duplicado exacto.`,
        );
      const addresses = input.addresses?.length
        ? input.addresses
        : input.address?.trim()
          ? [{ label: "Principal", address: input.address }]
          : [];
      const customer: CustomerDto = {
        id: uid("customer", state),
        name: input.name.trim(),
        phone: input.phone.trim(),
        notes: input.notes?.trim() || null,
        preferences: input.preferences?.trim() || null,
        tags: [...new Set((input.tags ?? []).map((tag) => tag.trim()))].filter(
          Boolean,
        ),
        preferredPaymentMethodCode:
          input.preferredPaymentMethodCode?.trim() || null,
        active: true,
        mergedIntoCustomerId: null,
        updatedAt: now(),
        addresses: addresses
          .filter((address) => address.address.trim())
          .map((address) => ({
            id: uid("address", state),
            label: address.label.trim() || "Dirección",
            address: address.address.trim(),
            notes: address.notes?.trim() || null,
            deliveryFeeMinor: address.deliveryFeeMinor ?? 0,
          })),
      };
      state.customers.unshift(customer);
      audit(state, "CUSTOMER", customer.id, "CUSTOMER_CREATED");
      save();
      return output(customer);
    },

    async updateCustomer(input) {
      // Otra pestaña puede haber persistido una versión más nueva. Recargar antes
      // de comparar evita que dos formularios pisen silenciosamente la ficha.
      state = loadState(storage);
      const customer = state.customers.find(
        (candidate) => candidate.id === input.customerId,
      );
      if (!customer) throw new Error("El cliente no existe.");
      validateCustomerInput(input);
      if (input.expectedUpdatedAt !== customer.updatedAt)
        throw new Error(
          "El cliente fue modificado en otra ventana. Recargá la ficha antes de guardar para no pisar cambios.",
        );
      const duplicate = state.customers.find(
        (candidate) =>
          candidate.id !== customer.id &&
          normalizePhone(candidate.phone) === normalizePhone(input.phone) &&
          candidate.name.trim().toLocaleLowerCase("es-AR") ===
            input.name.trim().toLocaleLowerCase("es-AR"),
      );
      if (duplicate)
        throw new Error(
          `Ya existe otra ficha de ${duplicate.name} con ese teléfono. Revisá o fusioná el duplicado exacto antes de guardar.`,
        );
      customer.name = input.name.trim();
      customer.phone = input.phone.trim();
      customer.notes = input.notes?.trim() || null;
      customer.preferences = input.preferences?.trim() || null;
      customer.tags = [
        ...new Set((input.tags ?? []).map((tag) => tag.trim())),
      ].filter(Boolean);
      customer.preferredPaymentMethodCode =
        input.preferredPaymentMethodCode?.trim() || null;
      const previousTimestamp = Date.parse(customer.updatedAt ?? "");
      customer.updatedAt = new Date(
        Math.max(
          Date.now(),
          Number.isFinite(previousTimestamp)
            ? previousTimestamp + 1
            : Date.now(),
        ),
      ).toISOString();
      const existingAddressIds = new Set(
        customer.addresses.map((address) => address.id),
      );
      if (
        input.addresses.some(
          (address) => address.id && !existingAddressIds.has(address.id),
        )
      )
        throw new Error(
          "Una dirección cambió desde que abriste la ficha. Recargá el cliente antes de guardar.",
        );
      customer.addresses = input.addresses
        .filter((address) => address.address.trim())
        .map((address) => ({
          id:
            address.id && existingAddressIds.has(address.id)
              ? address.id
              : uid("address", state),
          label: address.label.trim() || "Dirección",
          address: address.address.trim(),
          notes: address.notes?.trim() || null,
          deliveryFeeMinor: address.deliveryFeeMinor ?? 0,
        }));
      audit(state, "CUSTOMER", customer.id, "CUSTOMER_UPDATED");
      save();
      return output(customer);
    },

    async getCustomerProfile(input) {
      const customer = state.customers.find(
        (candidate) => candidate.id === input.customerId,
      );
      if (!customer) throw new Error("El cliente no existe.");
      const allOrders = state.data.orders
        .filter((order) => order.customerId === customer.id)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
      const metricOrders = allOrders
        .filter(
          (order) =>
            order.lifecycleStatus === "CONFIRMED" &&
            order.operationalStatus !== "CANCELLED",
        )
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
      const totalSpentMinor = metricOrders.reduce(
        (total, order) => total + order.totalMinor,
        0,
      );
      const gaps = metricOrders
        .slice(1)
        .map((order, index) =>
          Math.max(
            0,
            Date.parse(order.createdAt) -
              Date.parse(metricOrders[index]!.createdAt),
          ),
        );
      const productTotals = new Map<
        string,
        {
          productId: string | null;
          name: string;
          quantity: number;
          totalMinor: number;
        }
      >();
      for (const order of metricOrders)
        for (const item of order.items) {
          const key = item.productId ?? item.productNameSnapshot;
          const current = productTotals.get(key) ?? {
            productId: item.productId,
            name: item.productNameSnapshot,
            quantity: 0,
            totalMinor: 0,
          };
          current.quantity += item.quantity;
          current.totalMinor += item.lineTotalMinor;
          productTotals.set(key, current);
        }
      const addressTotals = new Map<
        string,
        { address: string; orderCount: number; lastUsedAt: string }
      >();
      for (const order of metricOrders) {
        const address = order.deliveryAddressSnapshot?.trim();
        if (!address) continue;
        const key = address.toLocaleLowerCase("es-AR");
        const current = addressTotals.get(key) ?? {
          address,
          orderCount: 0,
          lastUsedAt: order.createdAt,
        };
        current.orderCount += 1;
        if (order.createdAt > current.lastUsedAt)
          current.lastUsedAt = order.createdAt;
        addressTotals.set(key, current);
      }
      const paymentUses = new Map<
        string,
        { code: string; name: string; uses: number; amountMinor: number }
      >();
      for (const order of allOrders)
        for (const payment of order.payments) {
          const current = paymentUses.get(payment.methodCode) ?? {
            code: payment.methodCode,
            name: payment.methodName,
            uses: 0,
            amountMinor: 0,
          };
          current.uses += 1;
          current.amountMinor += payment.amountMinor - payment.refundedMinor;
          paymentUses.set(payment.methodCode, current);
        }
      const usualPayment = [...paymentUses.values()].sort(
        (left, right) =>
          right.uses - left.uses || right.amountMinor - left.amountMinor,
      )[0];
      const pageSize = Math.min(50, Math.max(1, Math.trunc(input.pageSize)));
      const pageCount = allOrders.length
        ? Math.ceil(allOrders.length / pageSize)
        : 0;
      const page = pageCount
        ? Math.min(Math.max(1, Math.trunc(input.page)), pageCount)
        : 1;
      return output({
        customer,
        metrics: {
          orderCount: metricOrders.length,
          totalSpentMinor,
          averageTicketMinor: metricOrders.length
            ? Math.round(totalSpentMinor / metricOrders.length)
            : 0,
          outstandingMinor: metricOrders.reduce(
            (total, order) =>
              total + Math.max(0, order.totalMinor - order.paidMinor),
            0,
          ),
          frequencyDays: gaps.length
            ? Math.round(
                (gaps.reduce((total, gap) => total + gap, 0) /
                  gaps.length /
                  86_400_000) *
                  10,
              ) / 10
            : null,
          lastOrderAt: metricOrders.at(-1)?.createdAt ?? null,
          usualPaymentMethodCode: usualPayment?.code ?? null,
          usualPaymentMethodName: usualPayment?.name ?? null,
        },
        topProducts: [...productTotals.values()]
          .sort(
            (left, right) =>
              right.quantity - left.quantity ||
              right.totalMinor - left.totalMinor,
          )
          .slice(0, 8),
        topAddresses: [...addressTotals.values()]
          .sort(
            (left, right) =>
              right.orderCount - left.orderCount ||
              right.lastUsedAt.localeCompare(left.lastUsedAt),
          )
          .slice(0, 8)
          .map((address) => ({
            ...address,
            addressId:
              customer.addresses.find(
                (saved) =>
                  saved.address.trim().toLocaleLowerCase("es-AR") ===
                  address.address.trim().toLocaleLowerCase("es-AR"),
              )?.id ?? null,
          })),
        history: {
          items: allOrders.slice((page - 1) * pageSize, page * pageSize),
          total: allOrders.length,
          page,
          pageSize,
          pageCount,
        },
      });
    },

    async setCustomerActive(input) {
      requirePin(input.authorizerPin);
      const customer = state.customers.find(
        (candidate) => candidate.id === input.customerId,
      );
      if (!customer) throw new Error("El cliente no existe.");
      if (input.active && customer.mergedIntoCustomerId)
        throw new Error(
          "Una ficha fusionada no se puede reactivar; abrí la ficha receptora.",
        );
      if (
        !input.active &&
        state.data.orders.some(
          (order) =>
            order.customerId === customer.id &&
            (order.lifecycleStatus === "DRAFT" ||
              !["DELIVERED", "CANCELLED"].includes(order.operationalStatus)),
        )
      )
        throw new Error(
          "El cliente tiene pedidos pendientes. Cerrarlos antes de archivar.",
        );
      customer.active = input.active;
      customer.updatedAt = now();
      audit(
        state,
        "CUSTOMER",
        customer.id,
        input.active ? "CUSTOMER_REACTIVATED" : "CUSTOMER_ARCHIVED",
        input.reason,
        "customers.manage",
      );
      save();
      return output(customer);
    },

    async mergeCustomers(input) {
      requirePin(input.authorizerPin);
      if (input.sourceCustomerId === input.targetCustomerId)
        throw new Error("Elegí dos fichas distintas para fusionar.");
      const source = state.customers.find(
        (candidate) => candidate.id === input.sourceCustomerId,
      );
      const target = state.customers.find(
        (candidate) => candidate.id === input.targetCustomerId,
      );
      if (!source || !target)
        throw new Error("No se encontraron ambas fichas.");
      if (!source.active || !target.active)
        throw new Error("Sólo se pueden fusionar fichas activas.");
      for (const address of source.addresses) {
        const duplicate = target.addresses.find(
          (candidate) =>
            candidate.address
              .trim()
              .localeCompare(address.address.trim(), "es-AR", {
                sensitivity: "base",
              }) === 0,
        );
        if (duplicate) {
          duplicate.deliveryFeeMinor = Math.max(
            duplicate.deliveryFeeMinor,
            address.deliveryFeeMinor,
          );
          duplicate.notes ??= address.notes;
        } else target.addresses.push({ ...address, id: uid("address", state) });
      }
      for (const order of state.data.orders)
        if (order.customerId === source.id) order.customerId = target.id;
      target.tags = [...new Set([...target.tags, ...source.tags])];
      if (!target.preferredPaymentMethodCode)
        target.preferredPaymentMethodCode = source.preferredPaymentMethodCode;
      if (source.notes)
        target.notes = [
          target.notes,
          `Ficha fusionada de ${source.name}: ${source.notes}`,
        ]
          .filter(Boolean)
          .join("\n");
      if (source.preferences && source.preferences !== target.preferences)
        target.preferences = [target.preferences, source.preferences]
          .filter(Boolean)
          .join("\n");
      target.updatedAt = now();
      source.active = false;
      source.mergedIntoCustomerId = target.id;
      source.updatedAt = target.updatedAt;
      audit(
        state,
        "CUSTOMER",
        source.id,
        "CUSTOMER_MERGED",
        input.reason,
        "customers.manage",
      );
      audit(
        state,
        "CUSTOMER",
        target.id,
        "CUSTOMER_MERGE_RECEIVED",
        input.reason,
        "customers.manage",
      );
      save();
      return output(target);
    },

    async createCategory(input) {
      if (!input.name.trim())
        throw new Error("Ingresá un nombre de categoría.");
      const normalizedName = input.name.trim().toLocaleLowerCase("es-AR");
      if (
        state.data.categories.some(
          (category) =>
            category.name.toLocaleLowerCase("es-AR") === normalizedName,
        )
      )
        throw new Error("Ya existe una categoría con ese nombre.");
      const category: CategoryDto = {
        id: uid("category", state),
        name: input.name.trim(),
        sortOrder: state.data.categories.length + 1,
        active: true,
      };
      state.data.categories.push(category);
      audit(state, "CATEGORY", category.id, "CATEGORY_CREATED");
      save();
      return output(category);
    },

    async updateCategory(input) {
      requirePin(input.authorizerPin);
      if (!input.reason.trim())
        throw new Error("El cambio de categoría requiere un motivo.");
      const category = state.data.categories.find(
        (candidate) => candidate.id === input.categoryId,
      );
      if (!category) throw new Error("La categoría no existe.");
      if (
        state.data.categories.some(
          (candidate) =>
            candidate.id !== category.id &&
            candidate.name.localeCompare(input.name.trim(), "es-AR", {
              sensitivity: "base",
            }) === 0,
        )
      )
        throw new Error("Ya existe una categoría con ese nombre.");
      if (
        !input.active &&
        state.data.products.some(
          (product) => product.categoryId === category.id && product.active,
        )
      )
        throw new Error(
          "La categoría tiene productos activos. Reasignalos o desactivalos antes.",
        );
      const before = { ...category };
      category.name = input.name.trim();
      category.active = input.active;
      category.sortOrder = input.sortOrder;
      for (const product of state.data.products)
        if (product.categoryId === category.id)
          product.categoryName = category.name;
      audit(
        state,
        "CATEGORY",
        category.id,
        "CATEGORY_UPDATED",
        `${input.reason.trim()} · ${before.name} → ${category.name}`,
        "prices.bulk_update",
      );
      save();
      return output(category);
    },

    async deleteCategory(input) {
      requirePin(input.authorizerPin);
      if (!input.reason.trim())
        throw new Error("La eliminación requiere un motivo.");
      const index = state.data.categories.findIndex(
        (candidate) => candidate.id === input.categoryId,
      );
      if (index < 0) throw new Error("La categoría no existe.");
      if (
        state.data.products.some(
          (product) => product.categoryId === input.categoryId,
        )
      )
        throw new Error(
          "La categoría tiene productos o historial asociado. Podés desactivarla desde Editar.",
        );
      const category = state.data.categories[index]!;
      state.data.categories.splice(index, 1);
      audit(
        state,
        "CATEGORY",
        category.id,
        "CATEGORY_DELETED",
        input.reason.trim(),
        "prices.bulk_update",
      );
      save();
      return { deleted: true as const };
    },

    async createProduct(input) {
      const category = categoryById(input.categoryId);
      const prices = normalizeProductPrices(input.prices);
      if (
        input.stockMinor != null &&
        (!Number.isSafeInteger(input.stockMinor) || input.stockMinor < 0)
      )
        throw new Error("El stock inicial no es válido.");
      const product: ProductDto = {
        id: uid("product", state),
        categoryId: category.id,
        categoryName: category.name,
        name: input.name.trim(),
        code: input.code?.trim() || null,
        sortOrder:
          state.data.products.filter(
            (candidate) => candidate.categoryId === category.id,
          ).length + 1,
        active: true,
        stockMinor: input.stockMinor ?? null,
        prices: prices.map((price) => ({
          priceListId: `price-${price.priceListCode.toLowerCase()}`,
          ...price,
        })),
      };
      if (!product.name) throw new Error("Ingresá el nombre del producto.");
      state.data.products.push(product);
      audit(state, "PRODUCT", product.id, "PRODUCTO_CREADO");
      save();
      return output(product);
    },

    async updateProduct(input) {
      requirePin(input.authorizerPin);
      const product = productById(input.productId);
      const category = categoryById(input.categoryId);
      Object.assign(product, {
        categoryId: category.id,
        categoryName: category.name,
        name: input.name.trim(),
        code: input.code?.trim() || null,
        active: input.active,
        prices: normalizeProductPrices(input.prices).map((price) => ({
          priceListId: `price-${price.priceListCode.toLowerCase()}`,
          ...price,
        })),
      });
      audit(
        state,
        "PRODUCT",
        product.id,
        "PRODUCTO_ACTUALIZADO",
        input.reason,
        "catalog.edit",
      );
      save();
      return output(product);
    },

    async bulkUpdateProducts(input) {
      requirePin(input.authorizerPin);
      const before = clone(state);
      try {
        const ids = [...new Set(input.productIds)];
        const products = ids.map(productById);
        const category = input.categoryId
          ? categoryById(input.categoryId)
          : null;
        for (const product of products) {
          if (category) {
            product.categoryId = category.id;
            product.categoryName = category.name;
          }
          if (input.active != null) product.active = input.active;
          if (input.priceAdjustment) {
            const priceListCodes = new Set(
              input.priceAdjustment.priceListCodes,
            );
            if (
              priceListCodes.has("TAKEAWAY") ||
              priceListCodes.has("DELIVERY")
            ) {
              priceListCodes.add("TAKEAWAY");
              priceListCodes.add("DELIVERY");
            }
            for (const code of priceListCodes) {
              const price = product.prices.find(
                (candidate) => candidate.priceListCode === code,
              );
              if (!price) continue;
              const next =
                input.priceAdjustment.mode === "PERCENTAGE"
                  ? Math.round(
                      price.amountMinor *
                        (1 + input.priceAdjustment.value / 100),
                    )
                  : price.amountMinor + input.priceAdjustment.value;
              if (next < 0)
                throw new Error(
                  `El ajuste dejaría con precio negativo a ${product.name}.`,
                );
              if (!Number.isSafeInteger(next))
                throw new Error(
                  `El ajuste dejaría un precio fuera del rango válido en ${product.name}.`,
                );
              price.amountMinor = next;
            }
            if (priceListCodes.has("TAKEAWAY")) {
              const takeaway = product.prices.find(
                (price) => price.priceListCode === "TAKEAWAY",
              );
              const delivery = product.prices.find(
                (price) => price.priceListCode === "DELIVERY",
              );
              if (takeaway && delivery)
                delivery.amountMinor = takeaway.amountMinor;
            }
          }
        }
        audit(
          state,
          "PRODUCT_BATCH",
          ids.join(","),
          "PRODUCTOS_ACTUALIZADOS_EN_LOTE",
          input.reason,
          "prices.bulk_update",
        );
        save();
        return output(products);
      } catch (error) {
        state = before;
        throw error;
      }
    },

    async createModifier(input) {
      const modifier = {
        id: uid("modifier", state),
        groupId: `group-${input.groupName.toLocaleLowerCase("es").replace(/\s+/g, "-")}`,
        groupName: input.groupName.trim(),
        name: input.name.trim(),
        priceMinor: input.priceMinor,
        active: true,
      };
      state.data.modifiers.push(modifier);
      audit(state, "MODIFIER", modifier.id, "MODIFICADOR_CREADO");
      save();
      return output(modifier);
    },

    async adjustStock(input) {
      requirePin(input.authorizerPin);
      if (!Number.isSafeInteger(input.newStockMinor) || input.newStockMinor < 0)
        throw new Error("El stock no es válido.");
      const product = productById(input.productId);
      product.stockMinor = input.newStockMinor;
      audit(
        state,
        "PRODUCT",
        product.id,
        "STOCK_AJUSTADO",
        input.reason,
        "stock.adjust",
      );
      save();
      return output(product);
    },

    async createUser(input) {
      requirePin(input.authorizerPin);
      if (!/^\d{4,6}$/.test(input.pin))
        throw new Error("El PIN debe tener entre 4 y 6 dígitos.");
      const staffNumber =
        input.staffNumber ?? nextAvailableStaffNumber(state.data.users);
      if (
        state.data.users.some(
          (candidate) => candidate.staffNumber === staffNumber,
        )
      )
        throw new Error(`El número de usuario ${staffNumber} ya está ocupado.`);
      const user: UserDto = {
        id: uid("user", state),
        staffNumber,
        fullName: input.fullName.trim(),
        roleCode: input.roleCode,
        roleName: roleName(input.roleCode),
        permissions: [],
        active: true,
      };
      state.data.users.push(user);
      audit(state, "USER", user.id, "USUARIO_CREADO", null, "users.manage");
      save();
      return output(user);
    },

    async createDriver(input) {
      requirePin(input.authorizerPin);
      if (!input.fullName.trim())
        throw new Error("Ingresá el nombre del repartidor.");
      const user: UserDto = {
        id: uid("driver", state),
        staffNumber: nextAvailableStaffNumber(state.data.users),
        fullName: input.fullName.trim(),
        roleCode: "DELIVERY_DRIVER",
        roleName: "Repartidor",
        permissions: ["deliveries.view"],
        active: true,
      };
      state.data.users.push(user);
      audit(state, "USER", user.id, "DRIVER_CREATED", null, "users.manage");
      save();
      return output(user);
    },

    async updateUser(input) {
      requirePin(input.authorizerPin);
      const user = state.data.users.find(
        (candidate) => candidate.id === input.userId,
      );
      if (!user) throw new Error("No se encontró el usuario.");
      const staffNumber = input.staffNumber ?? user.staffNumber;
      if (
        state.data.users.some(
          (candidate) =>
            candidate.id !== input.userId &&
            candidate.staffNumber === staffNumber,
        )
      )
        throw new Error(`El número de usuario ${staffNumber} ya está ocupado.`);
      if (
        user.roleCode === "DELIVERY_DRIVER" &&
        (!input.active || input.roleCode !== "DELIVERY_DRIVER")
      ) {
        const activeDeliveries = state.data.orders.filter(
          (order) =>
            order.driverUserId === user.id &&
            order.type === "DELIVERY" &&
            !["DELIVERED", "CANCELLED"].includes(order.operationalStatus),
        );
        if (activeDeliveries.length)
          throw new Error(
            `El repartidor tiene ${activeDeliveries.length} envío(s) activo(s): ${activeDeliveries.map((order) => `#${order.number}`).join(", ")}. Reasignalos antes de desactivarlo o cambiar su rol.`,
          );
      }
      user.roleCode = input.roleCode;
      user.roleName = roleName(input.roleCode);
      user.staffNumber = staffNumber;
      user.active = input.active;
      audit(
        state,
        "USER",
        user.id,
        "USUARIO_ACTUALIZADO",
        input.reason,
        "users.manage",
      );
      save();
      return output(user);
    },

    async deleteUser(input) {
      requirePin(input.authorizerPin);
      const index = state.data.users.findIndex(
        (candidate) => candidate.id === input.userId,
      );
      if (index < 0) throw new Error("No se encontró el usuario.");
      if (state.data.users[index]?.id === "user-admin")
        throw new Error(
          "El administrador operativo inicial no puede eliminarse.",
        );
      const hasHistory = state.data.orders.some(
        (order) =>
          order.waiterUserId === input.userId ||
          order.driverUserId === input.userId,
      );
      if (hasHistory)
        throw new Error(
          "El usuario tiene actividad o historial asociado. Podés marcarlo inactivo desde Editar.",
        );
      const [deleted] = state.data.users.splice(index, 1);
      audit(
        state,
        "USER",
        input.userId,
        "USER_DELETED",
        input.reason,
        "users.manage",
      );
      save();
      return output({ deleted: Boolean(deleted) as true });
    },

    async settleDelivery(input) {
      if (!input.ledgerIds.length)
        throw new Error("Seleccioná al menos una liquidación.");
      if (new Set(input.ledgerIds).size !== input.ledgerIds.length)
        throw new Error("La selección contiene liquidaciones repetidas.");
      if (!input.reason.trim())
        throw new Error("La liquidación requiere un motivo.");
      if (!state.data.cashSession || state.data.cashSession.status !== "OPEN")
        throw new Error("Abrí una caja antes de liquidar repartos.");
      requirePin(input.authorizerPin);
      const selected = input.ledgerIds.map((id) => {
        const ledger = state.data.deliveryLedger.find(
          (candidate) => candidate.id === id && candidate.status === "PENDING",
        );
        if (!ledger) throw new Error("La liquidación ya no está pendiente.");
        return ledger;
      });
      if (new Set(selected.map((ledger) => ledger.driverUserId)).size !== 1)
        throw new Error(
          "Liquidá un repartidor por vez para conservar una rendición clara y auditable.",
        );
      const incomingMinor = selected
        .filter((ledger) => ledger.direction === "DRIVER_OWES_BUSINESS")
        .reduce((total, ledger) => total + ledger.amountDueMinor, 0);
      const outgoingMinor = selected
        .filter((ledger) => ledger.direction === "BUSINESS_OWES_DRIVER")
        .reduce((total, ledger) => total + ledger.amountDueMinor, 0);
      if (
        outgoingMinor >
        state.data.cashSession.expectedAmountMinor + incomingMinor
      )
        throw new Error(
          "La caja no tiene efectivo suficiente para pagar esta rendición.",
        );
      state.data.cashSession.expectedAmountMinor +=
        incomingMinor - outgoingMinor;
      state.data.cashSession.cashIncomeMinor =
        (state.data.cashSession.cashIncomeMinor ?? 0) + incomingMinor;
      state.data.cashSession.cashExpenseMinor =
        (state.data.cashSession.cashExpenseMinor ?? 0) + outgoingMinor;
      for (const ledger of selected) {
        ledger.status = "SETTLED";
        ledger.settledAmountMinor = ledger.amountDueMinor;
        ledger.settledAt = now();
      }
      audit(
        state,
        "DELIVERY_LEDGER",
        input.ledgerIds.join(","),
        "RENDICION_LIQUIDADA",
        input.reason.trim(),
        "delivery.settle",
      );
      save();
      return output(selected);
    },

    async configureTables({ count }) {
      if (!Number.isInteger(count) || count < 1 || count > 200)
        throw new Error("La cantidad de mesas debe estar entre 1 y 200.");
      for (let number = 1; number <= count; number += 1)
        await this.ensureTable({ number });
      for (const table of state.data.tables)
        if (table.number > count && !table.currentOrderId) table.active = false;
      audit(state, "RESTAURANT_TABLE", "configuration", "MESAS_CONFIGURADAS");
      save();
      return output(state.data.tables);
    },

    async updateTable(input) {
      const table = state.data.tables.find(
        (candidate) => candidate.id === input.tableId,
      );
      if (!table) throw new Error("La mesa no existe.");
      if (!input.active && table.currentOrderId)
        throw new Error("No se puede desactivar una mesa ocupada.");
      if (
        state.data.tables.some(
          (candidate) =>
            candidate.id !== table.id && candidate.number === input.number,
        )
      )
        throw new Error("Ya existe otra mesa con ese número.");
      Object.assign(table, {
        number: input.number,
        name: input.name?.trim() || null,
        active: input.active,
        sortOrder: input.sortOrder ?? table.sortOrder,
      });
      audit(state, "RESTAURANT_TABLE", table.id, "MESA_ACTUALIZADA");
      save();
      return output(table);
    },

    async deleteTable({ tableId }) {
      if (
        !state.data.currentUser.permissions.includes("tables.manage") &&
        !state.data.currentUser.permissions.includes("*")
      )
        throw new Error("El usuario no tiene permiso para esta operación.");
      const table = state.data.tables.find(
        (candidate) => candidate.id === tableId,
      );
      if (!table) throw new Error("La mesa no existe.");
      const order = table.currentOrderId
        ? orderById(table.currentOrderId)
        : null;
      if (order) {
        const hasPrintHistory = state.data.printJobs.some(
          (job) => job.orderId === order.id,
        );
        if (
          order.items.length > 0 ||
          order.payments.length > 0 ||
          order.printCount > 0 ||
          order.printAttemptCount ||
          hasPrintHistory
        )
          throw new Error(
            "No se puede eliminar una mesa con consumo, pagos o impresiones.",
          );
        order.operationalStatus = "CANCELLED";
        audit(state, "ORDER", order.id, "PEDIDO_VACIO_CANCELADO");
      }
      table.active = false;
      audit(state, "RESTAURANT_TABLE", table.id, "MESA_ELIMINADA");
      save();
      return { deleted: true } as const;
    },

    async exportSalesCsv() {
      return {
        path: "Demostración: exportación simulada (no se creó ningún archivo)",
      };
    },

    async listCashSessionHistory(): Promise<CashSessionHistoryItemDto[]> {
      return output(
        state.historicalSessions.map((session) => ({
          session,
          detailAvailable:
            session.status === "OPEN" ||
            (session.closedAt ?? session.openedAt).slice(0, 10) >=
              retentionCutoff(),
        })),
      );
    },

    async getCashSessionReport(
      filters: CashSessionReportFilters,
    ): Promise<CashSessionReportDto> {
      if (!filters?.cashSessionId) throw new Error("La caja no es válida.");
      return sessionReport(state, filters);
    },

    async getDetailedReport(
      filters: ReportFilters,
    ): Promise<DetailedReportDto> {
      const orders = state.data.orders.filter(
        (order) =>
          order.operationalStatus !== "CANCELLED" &&
          order.paidMinor > 0 &&
          order.createdAt.slice(0, 10) >= filters.dateFrom &&
          order.createdAt.slice(0, 10) <= filters.dateTo,
      );
      const salesTotalMinor = orders.reduce(
        (sum, order) => sum + order.paidMinor,
        0,
      );
      const byType = (["DINE_IN", "TAKEAWAY", "DELIVERY"] as const).map(
        (type) => {
          const rows = orders.filter((order) => order.type === type);
          return {
            type,
            amountMinor: rows.reduce((sum, order) => sum + order.paidMinor, 0),
            orderCount: rows.length,
          };
        },
      );
      const byPayment = new Map<string, number>();
      const byProduct = new Map<
        string,
        { quantity: number; amountMinor: number }
      >();
      const byCategory = new Map<
        string,
        { quantity: number; amountMinor: number }
      >();
      for (const order of orders) {
        for (const payment of order.payments)
          byPayment.set(
            payment.methodCode,
            (byPayment.get(payment.methodCode) ?? 0) +
              payment.amountMinor -
              payment.refundedMinor,
          );
        for (const item of order.items) {
          const paidRatio =
            order.totalMinor > 0
              ? Math.max(0, Math.min(1, order.paidMinor / order.totalMinor))
              : 0;
          const productRow = byProduct.get(item.productNameSnapshot) ?? {
            quantity: 0,
            amountMinor: 0,
          };
          productRow.quantity += item.quantity;
          productRow.amountMinor += Math.round(item.lineTotalMinor * paidRatio);
          byProduct.set(item.productNameSnapshot, productRow);
          const category =
            state.data.products.find((product) => product.id === item.productId)
              ?.categoryName ?? "Otros";
          const categoryRow = byCategory.get(category) ?? {
            quantity: 0,
            amountMinor: 0,
          };
          categoryRow.quantity += item.quantity;
          categoryRow.amountMinor += Math.round(
            item.lineTotalMinor * paidRatio,
          );
          byCategory.set(category, categoryRow);
        }
      }
      return output({
        filters,
        salesTotalMinor,
        orderCount: orders.length,
        averageTicketMinor: orders.length
          ? Math.round(salesTotalMinor / orders.length)
          : 0,
        byType,
        byPaymentMethod: [...byPayment].map(([code, amountMinor]) => ({
          code,
          name: methodName(state.data, code),
          amountMinor,
        })),
        byProduct: [...byProduct].map(([name, value]) => ({ name, ...value })),
        byCategory: [...byCategory].map(([name, value]) => ({
          name,
          ...value,
        })),
        byHour: [],
        byWaiter: state.data.users
          .filter((user) => user.roleCode === "WAITER")
          .map((user) => {
            const rows = orders.filter(
              (order) => order.waiterUserId === user.id,
            );
            return {
              name: user.fullName,
              orderCount: rows.length,
              amountMinor: rows.reduce(
                (sum, order) => sum + order.paidMinor,
                0,
              ),
            };
          }),
        cash: {
          openingMinor: state.data.cashSession?.openingAmountMinor ?? 0,
          incomeMinor: 0,
          expenseMinor: 0,
          withdrawalMinor: 0,
          refundMinor:
            state.data.cashSession &&
            state.data.cashSession.businessDate >= filters.dateFrom &&
            state.data.cashSession.businessDate <= filters.dateTo
              ? (state.data.cashSession.cashRefundMinor ?? 0)
              : 0,
          differencesMinor: 0,
        },
        delivery: {
          orderCount: orders.filter((order) => order.type === "DELIVERY")
            .length,
          feesMinor: orders
            .filter((order) => order.type === "DELIVERY")
            .reduce((sum, order) => sum + order.deliveryFeeMinor, 0),
          pendingDriverOwesMinor: state.data.deliveryLedger
            .filter(
              (row) =>
                row.status === "PENDING" &&
                row.direction === "DRIVER_OWES_BUSINESS",
            )
            .reduce((sum, row) => sum + row.amountDueMinor, 0),
          pendingBusinessOwesMinor: state.data.deliveryLedger
            .filter(
              (row) =>
                row.status === "PENDING" &&
                row.direction === "BUSINESS_OWES_DRIVER",
            )
            .reduce((sum, row) => sum + row.amountDueMinor, 0),
        },
      });
    },

    async getAuditLog(input) {
      return output(
        state.audit
          .filter(
            (entry) =>
              (!input.dateFrom ||
                (entry.businessDate ?? "") >= input.dateFrom) &&
              (!input.dateTo || (entry.businessDate ?? "") <= input.dateTo) &&
              (!input.action || entry.action === input.action),
          )
          .slice(0, input.limit ?? 200),
      );
    },

    async createBackup() {
      return { path: "Demostración: copia simulada en memoria del navegador" };
    },
    async restoreBackup() {
      return { path: null, restored: false };
    },

    async listPrinters() {
      return [
        {
          name: "Impresora cocina (demo)",
          displayName: "Impresora cocina (demo)",
          isDefault: false,
        },
        {
          name: "Impresora caja (demo)",
          displayName: "Impresora caja (demo)",
          isDefault: true,
        },
      ];
    },

    async testPrinter(input) {
      const settings = input.settings ?? state.data.settings;
      assertAppSettings(settings);
      const profile =
        input.kind === "KITCHEN_ORDER"
          ? settings.printing.kitchen
          : settings.printing.bill;
      return {
        printed: true,
        message: `Prueba simulada enviada a ${profile.deviceName || "el diálogo del sistema"}.`,
      };
    },

    async saveSettings(settings) {
      assertAppSettings(settings);
      state.data.settings = clone(settings);
      audit(state, "SETTINGS", "general", "CONFIGURACION_GUARDADA");
      save();
      return output(state.data.settings);
    },
    async reverseCashMovement() {
      throw new Error("No implementado en modo demo.");
    },
    async reverseDeliverySettlement() {
      throw new Error("No implementado en modo demo.");
    },
    async getDashboard() {
      save();
      return output(state.data.dashboard);
    },
  };
}
