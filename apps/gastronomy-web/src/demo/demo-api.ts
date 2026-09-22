import type {
  AuditEntryDto,
  BootstrapDto,
  CategoryDto,
  CustomerDto,
  DeliveryLedgerDto,
  DriverDeliveryActivityDto,
  DesktopApi,
  DetailedReportDto,
  FloorPlanShapeDto,
  CashSessionDto,
  CashSessionReportDto,
  CashSessionReportFilters,
  CashSessionHistoryItemDto,
  CashMovementType,
  OrderDto,
  OrderItemDto,
  ProductDto,
  PurchaseDto,
  FinanceExpenseDto,
  FinanceRecurringDto,
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

const SENSITIVE_DEMO_AUDIT_ACTIONS = new Set([
  "CAJA_ABIERTA",
  "CAJA_INCOME",
  "CAJA_EXPENSE",
  "CAJA_WITHDRAWAL",
  "CAJA_ADJUSTMENT",
  "CAJA_CERRADA",
  "ORDER_ITEM_PRICE_OVERRIDDEN",
  "ORDER_EDITED_AFTER_PRINT",
  "PRODUCTO_QUITADO",
  "MODIFICADOR_QUITADO",
  "DESCUENTO_APLICADO",
  "PAGO_DEVUELTO",
  "PEDIDO_CANCELADO",
  "CUSTOMER_ARCHIVED",
  "CUSTOMER_MERGED",
  "CUSTOMER_MERGE_RECEIVED",
  "CATEGORY_DELETED",
  "PRODUCT_DELETED",
  "PRODUCTO_ACTUALIZADO",
  "PRODUCTOS_ACTUALIZADOS_EN_LOTE",
  "STOCK_AJUSTADO",
  "PURCHASE_CREATED",
  "USUARIO_CREADO",
  "DRIVER_CREATED",
  "USUARIO_ACTUALIZADO",
  "USER_DELETED",
  "RENDICION_LIQUIDADA",
  "MESA_ELIMINADA",
  "SECTOR_ELIMINADO",
  "CONFIGURACION_GUARDADA",
]);

export interface DemoStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface DemoState {
  version: 12;
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
  accountReceipts?: Array<{ id: string; customerId: string; movementId: string; createdAt: string; amountMinor: number; methodCode: string; methodName: string; reference: string | null; allocations: Array<{ orderId: string; orderNumber: number; amountMinor: number }> }>;
  audit: AuditEntryDto[];
  purchases: PurchaseDto[];
  purchaseReceipts: Record<string, { purchaseId: string; requestJson: string }>;
  financeExpenses?: FinanceExpenseDto[];
  financeRecurring?: FinanceRecurringDto[];
  financeManualCosts?: Record<string, number>;
  financeItemCosts?: Record<string, {unitCostMinor: number | null; quantity: number}>;
  financeExpenseMovements?: Record<string, string>;
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

function validateProductInventory(input: {
  stockMinor?: number | null;
  stockTargetMinor?: number | null;
  stockMinMinor?: number | null;
  stockCriticalMinor?: number | null;
  imageDataUrl?: string | null;
}) {
  for (const [label, value] of [
    ["stock inicial", input.stockMinor],
    ["stock objetivo", input.stockTargetMinor],
    ["stock mínimo", input.stockMinMinor],
    ["stock crítico", input.stockCriticalMinor],
  ] as const) {
    if (value != null && (!Number.isSafeInteger(value) || value < 0))
      throw new Error(`El ${label} no es válido.`);
  }
  if (
    (input.stockCriticalMinor != null &&
      input.stockMinMinor != null &&
      input.stockCriticalMinor > input.stockMinMinor) ||
    (input.stockMinMinor != null &&
      input.stockTargetMinor != null &&
      input.stockMinMinor > input.stockTargetMinor) ||
    (input.stockCriticalMinor != null &&
      input.stockTargetMinor != null &&
      input.stockCriticalMinor > input.stockTargetMinor)
  ) {
    throw new Error(
      "El stock debe respetar: crítico menor o igual al mínimo, y mínimo menor o igual al objetivo.",
    );
  }
  if (
    input.imageDataUrl != null &&
    (!/^data:image\/webp;base64,[a-z0-9+/]+=*$/i.test(input.imageDataUrl) ||
      input.imageDataUrl.length > 2_100_000)
  ) {
    throw new Error("La foto del producto debe ser una imagen WebP válida.");
  }
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

function validateFloorPlanShapeInput(input: {
  sectorId: string;
  kind: string;
  label?: string | null;
  color: string;
  layoutX: number;
  layoutY: number;
  layoutWidth: number;
  layoutHeight: number;
  points?: Array<{ x: number; y: number }>;
  strokeColor?: string;
  strokeWidth?: number;
  fillOpacity?: number;
}) {
  if (
    !["RECTANGLE", "ELLIPSE", "LINE", "POLYGON", "POLYLINE"].includes(
      input.kind,
    )
  )
    throw new Error("El tipo de figura no es válido.");
  if (!/^#[0-9A-F]{6}$/i.test(input.color))
    throw new Error("El color de la figura no es válido.");
  if ((input.label?.trim().length ?? 0) > 60)
    throw new Error("La etiqueta admite hasta 60 caracteres.");
  const points = input.points ?? [];
  const minimumPoints =
    input.kind === "POLYGON" ? 3 : input.kind === "POLYLINE" ? 2 : 0;
  const maximumPoints = minimumPoints ? 64 : 0;
  if (points.length < minimumPoints || points.length > maximumPoints)
    throw new Error("La cantidad de nodos de la figura no es válida.");
  if (
    !points.every(
      (point) =>
        Number.isFinite(point.x) &&
        Number.isFinite(point.y) &&
        point.x >= 0 &&
        point.x <= 100 &&
        point.y >= 0 &&
        point.y <= 100,
    )
  )
    throw new Error("Las coordenadas de la figura no son válidas.");
  if (!/^#[0-9A-F]{6}$/i.test(input.strokeColor ?? input.color))
    throw new Error("El color del borde no es válido.");
  if (
    !Number.isFinite(input.strokeWidth ?? 2) ||
    (input.strokeWidth ?? 2) < 1 ||
    (input.strokeWidth ?? 2) > 12
  )
    throw new Error("El grosor del borde no es válido.");
  if (
    !Number.isFinite(input.fillOpacity ?? 1) ||
    (input.fillOpacity ?? 1) < 0 ||
    (input.fillOpacity ?? 1) > 1
  )
    throw new Error("La opacidad del relleno no es válida.");
  if (
    ![
      input.layoutX,
      input.layoutY,
      input.layoutWidth,
      input.layoutHeight,
    ].every(Number.isFinite) ||
    input.layoutX < 0 ||
    input.layoutY < 0 ||
    input.layoutWidth < 2 ||
    input.layoutWidth > 100 ||
    input.layoutHeight < 2 ||
    input.layoutHeight > 100 ||
    input.layoutX + input.layoutWidth > 100 ||
    input.layoutY + input.layoutHeight > 100
  )
    throw new Error("La posición o el tamaño de la figura no es válido.");
}

function seedState(): DemoState {
  const updatedAt = now();
  const oldDate = new Date();
  oldDate.setDate(oldDate.getDate() - 120);
  const oldBusinessDate = oldDate.toISOString().slice(0, 10);
  return {
    version: 12,
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
    audit: [],
    purchases: [],
    purchaseReceipts: {},
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
      ![5, 6, 7, 8, 9, 10, 11, 12].includes(parsed.version) ||
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
    parsed.purchases ??= [];
    parsed.purchaseReceipts ??= {};
    parsed.data.tableSectors ??= [
      { id: "sector-main", name: "Salón", sortOrder: 1 },
    ];
    parsed.data.floorPlanShapes ??= [];
    for (const shape of parsed.data.floorPlanShapes) {
      shape.points ??= [];
      shape.strokeColor ??= shape.color;
      shape.strokeWidth ??= 2;
      shape.fillOpacity ??= 1;
    }
    for (const table of parsed.data.tables) {
      table.sectorId ??= parsed.data.tableSectors[0]!.id;
      table.layoutX ??= 5 + ((table.number - 1) % 10) * 9.2;
      table.layoutY ??= 5 + (Math.floor((table.number - 1) / 10) % 10) * 9.2;
      table.layoutWidth ??= 7;
      table.layoutHeight ??= 7;
      table.shape ??= "SQUARE";
    }
    for (const product of parsed.data.products) {
      product.stockTargetMinor ??= null;
      product.stockMinMinor ??= null;
      product.stockCriticalMinor ??= null;
      product.imageDataUrl ??= null;
    }
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
    parsed.version = 12;
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
    order.subtotalMinor +
      order.deliveryFeeMinor -
      order.discountMinor -
      (order.depositMinor ?? 0),
  );
  order.paidMinor = Math.max(
    0,
    order.payments.reduce(
      (sum, payment) => sum + payment.amountMinor - payment.refundedMinor,
      0,
    ) - (order.changeAmountMinor ?? 0),
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
  sessions: CashSessionDto[],
): DriverDeliveryActivityDto[] {
  const byDriver = new Map<string, DriverDeliveryActivityDto>();
  const sessionsById = new Map(
    sessions.map((session) => [session.id, session]),
  );
  for (const order of orders) {
    if (
      order.type !== "DELIVERY" ||
      order.operationalStatus !== "DELIVERED" ||
      !order.driverUserId
    )
      continue;
    const cashSessionId = order.cashSessionPaidId ?? order.cashSessionCreatedId;
    const businessDate =
      sessionsById.get(cashSessionId)?.businessDate ?? today();
    const activityKey = `${order.driverUserId}:${cashSessionId}`;
    const current = byDriver.get(activityKey);
    if (current) {
      current.deliveryCount += 1;
      current.earningsMinor += order.deliveryFeeMinor;
      if (order.updatedAt > current.lastDeliveryAt)
        current.lastDeliveryAt = order.updatedAt;
    } else {
      byDriver.set(activityKey, {
        driverUserId: order.driverUserId,
        cashSessionId,
        businessDate,
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
  if (!state.data.paymentMethods.some((method) => method.code === "ACCOUNT"))
    state.data.paymentMethods.push({id: "payment-account", code: "ACCOUNT", name: "Cuenta corriente", affectsCash: false, active: true});
  for (const order of state.data.orders) refreshOrder(order);
  state.data.tables.sort((left, right) => left.number - right.number);
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
    state.data.cashSession.movements = state.movements
      .filter((m) => m.sessionId === state.data.cashSession?.id)
      .map((m) => {
        const method = state.data.paymentMethods.find(
          (p) => p.code === m.paymentMethodCode,
        );
        return {
          id: m.id,
          type: m.type,
          amountMinor: m.amountMinor,
          affectsCash: m.affectsCash,
          paymentMethodCode: m.paymentMethodCode,
          paymentMethodName:
            method?.name ??
            (m.paymentMethodCode === "CASH" ? "Efectivo" : m.paymentMethodCode),
          orderId: m.orderId,
          userId: m.userId,
          reason: m.reason,
          createdAt: m.createdAt,
          referenceId: (m as any).referenceId ?? null,
          reversedById:
            state.movements.find(
              (other) => (other as any).referenceId === m.id,
            )?.id ?? null,
        };
      })
      .reverse();
  }
  refreshTables(state.data);
  state.data.dashboard = makeDashboard(state.data);
  state.data.driverDeliveryActivity = makeDriverDeliveryActivity(
    state.data.orders,
    [
      ...(state.data.cashSession ? [state.data.cashSession] : []),
      ...state.historicalSessions,
    ],
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
  if (!SENSITIVE_DEMO_AUDIT_ACTIONS.has(action)) return;
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
  ).map(({ key, ...v }) => {
    const waiterOrders = orders.filter((o) => (o.waiterUserId ?? "") === key);
    const tables = grouped(
      waiterOrders.map((o) => ({
        key: o.tableId ?? "",
        name:
          state.data.tables.find((t) => t.id === o.tableId)?.name ??
          (o.tableId
            ? `Mesa ${state.data.tables.find((t) => t.id === o.tableId)?.number ?? ""}`
            : "Sin mesa"),
        amount: o.paidMinor,
        count: 1,
      })),
    ).map(({ key: tKey, ...tVal }) => ({
      tableId: tKey || null,
      ...tVal,
    }));
    return {
      waiterUserId: key || null,
      ...v,
      tables,
    };
  });
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
      ? state.movements
          .filter((m) => m.sessionId === session.id)
          .map((m) => ({
            ...m,
            paymentMethodName:
              state.data.paymentMethods.find(
                (p) => p.code === m.paymentMethodCode,
              )?.name ??
              (m.paymentMethodCode === "CASH"
                ? "Efectivo"
                : m.paymentMethodCode),
          }))
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
  // Existing confirmed demo orders predate cost tracking. Keep their cost unknown
  // rather than applying a newly entered unit cost retroactively.
  const initialCosts = state.financeItemCosts ??= {};
  for (const order of state.data.orders.filter((candidate) => candidate.lifecycleStatus === "CONFIRMED")) {
    for (const item of order.items) initialCosts[item.id] ??= {unitCostMinor: null, quantity: item.quantity};
  }
  const currentFinanceCost = (productId: string) => {
    const manual = state.financeManualCosts?.[productId];
    if (manual != null) return {unitCostMinor: manual, source: "MANUAL" as const};
    const purchase = [...state.purchases].sort((a,b) => b.createdAt.localeCompare(a.createdAt))
      .flatMap((entry) => entry.items).find((item) => item.productId === productId);
    return purchase ? {unitCostMinor: purchase.unitCostMinor, source: "PURCHASE" as const} : {unitCostMinor: null, source: "UNKNOWN" as const};
  };
  const save = () => {
    for (const order of state.data.orders.filter((candidate) => candidate.lifecycleStatus === "CONFIRMED")) {
      for (const item of order.items) {
        const costs = state.financeItemCosts ??= {};
        if (!costs[item.id]) {
          const unitCostMinor = item.productId ? currentFinanceCost(item.productId).unitCostMinor :
            item.halves.length === 2 ? (() => {const halves = item.halves.map((half) => currentFinanceCost(half.productId).unitCostMinor); return halves.every((value) => value != null) ? Math.round((halves[0]! + halves[1]!) / 2) : null;})() : null;
          costs[item.id] = {unitCostMinor, quantity: item.quantity};
        } else costs[item.id]!.quantity = item.quantity;
      }
    }
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
      const data = output(state.data);
      data.orders = data.cashSession
        ? data.orders.filter(
            (order) => order.cashSessionCreatedId === data.cashSession?.id,
          )
        : [];
      refreshTables(data);
      return data;
    },

    async ensureTable({ number }) {
      if (!Number.isInteger(number) || number <= 0)
        throw new Error("Ingresá un número de mesa válido.");
      let table = state.data.tables.find(
        (candidate) => candidate.number === number,
      );
      if (!table) {
        const sector = state.data.tableSectors[0];
        if (!sector) throw new Error("No hay un sector disponible.");
        table = {
          id: uid("table", state),
          number,
          name: null,
          active: true,
          sortOrder: number,
          sectorId: sector.id,
          layoutX: 5 + ((number - 1) % 10) * 9.2,
          layoutY: 5 + (Math.floor((number - 1) / 10) % 10) * 9.2,
          layoutWidth: 7,
          layoutHeight: 7,
          shape: "SQUARE",
          currentOrderId: null,
          currentTotalMinor: 0,
          waiterName: null,
          openedAt: null,
        };
        state.data.tables.push(table);
        state.data.tables.sort((a, b) => a.number - b.number);
        audit(state, "TABLE", table.id, "MESA_CREADA");
        save();
      } else if (!table.active) {
        table.active = true;
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
      const methodCode = input.paymentMethodCode || "CASH";
      if (methodCode === "ACCOUNT") throw new Error("Cuenta corriente no registra un movimiento de caja manual.");
      const method = state.data.paymentMethods.find(
        (m) => m.code === methodCode && m.active,
      );
      if (!method) {
        throw new Error(`El medio de pago ${methodCode} no está disponible.`);
      }
      const affectsCash = method.affectsCash;
      if (
        affectsCash &&
        ["EXPENSE", "WITHDRAWAL"].includes(input.type) &&
        input.amountMinor > cash.expectedAmountMinor
      )
        throw new Error(
          "La caja no tiene efectivo suficiente. Registrá un ingreso o corregí el importe antes de continuar.",
        );
      if (affectsCash) {
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
      }
      state.movements.push({
        id: uid("movement", state),
        sessionId: cash.id,
        type: input.type,
        amountMinor: input.amountMinor,
        affectsCash,
        paymentMethodCode: method.code,
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
        depositMinor: 0,
        depositNotes: null,
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
      if (["DELIVERED", "CANCELLED"].includes(order.operationalStatus))
        throw new Error(
          "No se pueden editar los datos de un pedido finalizado.",
        );
      if (order.type === "DINE_IN" || input.type !== order.type)
        throw new Error("El tipo del pedido no se puede modificar.");
      assertOffPremiseCustomer(input);
      const fee = input.deliveryFeeMinor ?? 0;
      if (!Number.isSafeInteger(fee) || fee < 0)
        throw new Error("El costo de delivery no es válido.");
      if (order.paidMinor > 0)
        throw new Error("Un pedido con pagos no admite esta edición.");
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
      audit(
        state,
        "ORDER",
        order.id,
        order.printedAt
          ? "ORDER_EDITED_AFTER_PRINT"
          : order.lifecycleStatus === "DRAFT"
            ? "ORDER_DRAFT_UPDATED"
            : "ORDER_DETAILS_UPDATED",
        order.printedAt
          ? "Datos del cliente o envío editados después de imprimir"
          : undefined,
      );
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
      const normalizedNotes = input.notes?.trim() || null;
      const existingItem = order.items.find(
        (candidate) =>
          candidate.productId === product.id &&
          candidate.unitPriceMinorSnapshot === unit &&
          candidate.modifiers.length === 0 &&
          candidate.halves.length === 0 &&
          ((candidate.notes == null && normalizedNotes == null) ||
            candidate.notes === normalizedNotes),
      );
      if (existingItem) {
        existingItem.quantity += quantity;
        refreshOrder(order);
      } else {
        const item: OrderItemDto = {
          id: uid("item", state),
          productId: product.id,
          productNameSnapshot: product.name,
          quantity,
          unitPriceMinorSnapshot: unit,
          discountMinorSnapshot: 0,
          notes: normalizedNotes,
          halves: [],
          modifiers: [],
          lineTotalMinor: unit * quantity,
        };
        order.items.push(item);
        refreshOrder(order);
      }
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
      audit(
        state,
        "ORDER",
        order.id,
        existingItem ? "PRODUCTO_CANTIDAD_INCREMENTADA" : "PRODUCTO_AGREGADO",
      );
      save();
      return output(order);
    },

    async updateOrderItemQuantity(input) {
      const order = orderById(input.orderId);
      assertOrderAction(order, "EDIT");
      const item = order.items.find(
        (candidate) => candidate.id === input.itemId,
      );
      if (!item) throw new Error("No se encontró el producto del pedido.");
      const newQty = input.quantity;
      if (!Number.isInteger(newQty) || newQty <= 0) {
        throw new Error("La cantidad debe ser mayor que cero.");
      }
      const oldQty = item.quantity;
      if (newQty === oldQty) return output(order);
      const delta = newQty - oldQty;

      if (
        order.lifecycleStatus === "CONFIRMED" &&
        state.data.settings.stockEnabled
      ) {
        if (item.productId) {
          const product = state.data.products.find(
            (p) => p.id === item.productId,
          );
          if (product && product.stockMinor != null) {
            const required = delta * 1000;
            if (delta > 0 && product.stockMinor < required) {
              throw new Error(`Stock insuficiente para ${product.name}.`);
            }
            product.stockMinor -= required;
          }
        }
      }
      item.quantity = newQty;
      refreshOrder(order);
      audit(
        state,
        "ORDER_ITEM",
        item.id,
        order.printedAt
          ? "ORDER_EDITED_AFTER_PRINT"
          : "ORDER_ITEM_QUANTITY_UPDATED",
        `Cantidad modificada de ${oldQty} a ${newQty}`,
      );
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
      refreshOrder(order);
      refreshTables(state.data);
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

    async applyOrderDeposit(input) {
      requirePin(input.authorizerPin);
      const order = orderById(input.orderId);
      assertOrderAction(order, "EDIT");
      order.depositMinor = Math.max(0, input.depositMinor);
      order.depositNotes = input.notes?.trim() || null;
      refreshOrder(order);
      refreshTables(state.data);
      audit(
        state,
        "ORDER",
        order.id,
        "ORDER_DEPOSIT_APPLIED",
        input.notes ? `Seña: ${input.notes}` : "Seña descontada del pedido",
        "orders.deposit",
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
            cashSessionId:
              order.cashSessionPaidId ?? order.cashSessionCreatedId,
            businessDate: state.data.cashSession?.businessDate ?? today(),
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
      const accountPayment = input.payments.find((payment) => payment.methodCode === "ACCOUNT");
      if (accountPayment) {
        const customerId = input.customerId ?? order.customerId;
        const customer = state.customers.find((candidate) => candidate.id === customerId && candidate.active);
        if (!customer) throw new Error("Seleccioná un cliente activo para usar cuenta corriente.");
        if (order.customerId && order.customerId !== customer.id) throw new Error("El pedido ya pertenece a otro cliente.");
        if (input.change?.amountMinor) throw new Error("No se puede entregar vuelto de una cuenta corriente.");
        order.customerId = customer.id;
        order.customerNameSnapshot = customer.name;
        order.customerPhoneSnapshot = customer.phone;
      }
      if (!input.payments.length)
        throw new Error("Agregá al menos un medio de pago.");
      const changeAmountMinor = input.change?.amountMinor ?? 0;
      const amount = input.payments.reduce(
        (sum, payment) => sum + payment.amountMinor,
        0,
      );
      const remaining = order.totalMinor - order.paidMinor;
      const netPayment = amount - changeAmountMinor;
      if (netPayment !== remaining)
        throw new Error(
          "La suma de los pagos menos el vuelto debe coincidir con el saldo pendiente.",
        );
      if (changeAmountMinor > 0 && amount <= remaining) {
        throw new Error(
          "El vuelto sólo corresponde si el pago supera el saldo pendiente.",
        );
      }
      let changeMethod: (typeof state.data.paymentMethods)[number] | undefined;
      if (changeAmountMinor > 0) {
        if (!input.change?.methodCode)
          throw new Error("Indicá el medio de pago para el vuelto.");
        changeMethod = state.data.paymentMethods.find(
          (m) => m.code === input.change!.methodCode && m.active,
        );
        if (!changeMethod)
          throw new Error("El medio de pago para vuelto no está disponible.");
      }
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
      order.changeAmountMinor = changeAmountMinor > 0 ? changeAmountMinor : null;
      order.changeMethodCode =
        changeAmountMinor > 0 && input.change ? input.change.methodCode : null;
      order.changeMethodName = changeMethod ? changeMethod.name : null;
      refreshOrder(order);
      order.cashSessionPaidId = state.data.cashSession?.id ?? null;
      order.collectedByDriver = input.collectedByDriver === true;
      const cashAmount = input.payments
        .filter((payment) => payment.methodCode === "CASH")
        .reduce((sum, payment) => sum + payment.amountMinor, 0);
      const availableCash =
        (state.data.cashSession?.expectedAmountMinor ?? 0) +
        (input.collectedByDriver ? 0 : cashAmount);
      if (
        changeAmountMinor > 0 &&
        changeMethod?.affectsCash &&
        !input.collectedByDriver &&
        changeAmountMinor > availableCash
      ) {
        throw new Error(
          "La caja no tiene efectivo suficiente para entregar este vuelto.",
        );
      }
      if (state.data.cashSession) {
        state.data.cashSession.expectedAmountMinor += cashAmount;
        state.data.cashSession.cashSalesMinor =
          (state.data.cashSession.cashSalesMinor ?? 0) + cashAmount;
        if (changeAmountMinor > 0 && changeMethod) {
          if (changeMethod.affectsCash && !input.collectedByDriver) {
            state.data.cashSession.expectedAmountMinor -= changeAmountMinor;
            state.data.cashSession.cashRefundMinor =
              (state.data.cashSession.cashRefundMinor ?? 0) + changeAmountMinor;
          }
          state.movements.push({
            id: uid("movement", state),
            sessionId: state.data.cashSession.id,
            type: "REFUND",
            amountMinor: changeAmountMinor,
            affectsCash: input.collectedByDriver ? false : changeMethod.affectsCash,
            paymentMethodCode: changeMethod.code,
            orderId: order.id,
            userId: state.data.currentUser.id,
            reason: `Vuelto cobro pedido #${order.number} (${changeMethod.name})`,
            createdAt: now(),
          });
        }
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
      }
      if (
        order.type === "DELIVERY" &&
        order.driverUserId &&
        state.data.settings.deliverySettlementEnabled
      ) {
        const driverCollected = input.collectedByDriver === true;
        const restaurantAmount = Math.max(
          0,
          order.totalMinor - order.deliveryFeeMinor,
        );
        const shouldPayDriverNow =
          input.payDriverNow === true &&
          !driverCollected &&
          order.deliveryFeeMinor > 0;
        if (shouldPayDriverNow) {
          if (
            state.data.cashSession &&
            order.deliveryFeeMinor > state.data.cashSession.expectedAmountMinor
          ) {
            throw new Error(
              "La caja no tiene efectivo suficiente para pagar el envío al repartidor.",
            );
          }
          if (state.data.cashSession) {
            state.data.cashSession.expectedAmountMinor -= order.deliveryFeeMinor;
            state.data.cashSession.cashExpenseMinor =
              (state.data.cashSession.cashExpenseMinor ?? 0) +
              order.deliveryFeeMinor;
            state.movements.push({
              id: uid("movement", state),
              sessionId: state.data.cashSession.id,
              type: "EXPENSE",
              amountMinor: order.deliveryFeeMinor,
              affectsCash: true,
              paymentMethodCode: "CASH",
              orderId: order.id,
              userId: state.data.currentUser.id,
              reason: `Pago de envío a repartidor: Pedido #${order.number}`,
              createdAt: now(),
            });
          }
          const existingLedger = state.data.deliveryLedger.find(
            (l) => l.orderId === order.id,
          );
          if (existingLedger) {
            existingLedger.status = "SETTLED";
            existingLedger.settledAmountMinor = order.deliveryFeeMinor;
            existingLedger.settledAt = now();
          } else {
            state.data.deliveryLedger.unshift({
              id: uid("ledger", state),
              orderId: order.id,
              orderNumber: order.number,
              cashSessionId:
                order.cashSessionPaidId ?? order.cashSessionCreatedId,
              businessDate: state.data.cashSession?.businessDate ?? today(),
              driverUserId: order.driverUserId,
              driverName:
                state.data.users.find((u) => u.id === order.driverUserId)
                  ?.fullName ?? "Repartidor",
              restaurantAmountMinor: restaurantAmount,
              deliveryFeeMinor: order.deliveryFeeMinor,
              direction: "BUSINESS_OWES_DRIVER",
              amountDueMinor: order.deliveryFeeMinor,
              settledAmountMinor: order.deliveryFeeMinor,
              status: "SETTLED",
              createdAt: now(),
              settledAt: now(),
            });
          }
        }
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
      if (payment.methodCode === "ACCOUNT" && (state.accountReceipts ?? []).some((receipt) => receipt.allocations.some((allocation) => allocation.orderId === order.id)))
        throw new Error("La cuenta corriente ya tiene cobros aplicados; no se puede devolver este cargo.");
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

    async changeOrderTable(input) {
      requirePin(input.authorizerPin);
      const order = orderById(input.orderId);
      if (["DELIVERED", "CANCELLED"].includes(order.operationalStatus)) {
        throw new Error("El pedido ya no admite modificaciones.");
      }
      const targetTable = state.data.tables.find(
        (t) => t.id === input.targetTableId && t.active,
      );
      if (!targetTable) {
        throw new Error("La mesa de destino no existe o está inactiva.");
      }
      if (order.tableId === input.targetTableId) {
        throw new Error("El pedido ya se encuentra en esa mesa.");
      }
      const isOccupied = state.data.orders.some(
        (o) =>
          o.id !== order.id &&
          o.tableId === input.targetTableId &&
          !["DELIVERED", "CANCELLED"].includes(o.operationalStatus),
      );
      if (isOccupied) {
        throw new Error("La mesa de destino ya está ocupada.");
      }

      const previousTableNumber = order.tableNumber;
      order.tableId = targetTable.id;
      order.tableNumber = targetTable.number;
      order.type = "DINE_IN";
      order.updatedAt = new Date().toISOString();

      refreshTables(state.data);
      audit(
        state,
        "ORDER",
        order.id,
        "ORDER_TABLE_CHANGED",
        `Cambio de mesa de ${previousTableNumber ?? "s/n"} a ${targetTable.number}. ${input.reason ?? ""}`.trim(),
        "orders.edit",
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
      const accountCharges = metricOrders.flatMap((order) => {
        const amountMinor = order.payments.filter((payment) => payment.methodCode === "ACCOUNT").reduce((sum, payment) => sum + payment.amountMinor - payment.refundedMinor, 0);
        if (!amountMinor) return [];
        const settledMinor = (state.accountReceipts ?? []).reduce((sum, receipt) => sum + receipt.allocations.filter((allocation) => allocation.orderId === order.id).reduce((part, allocation) => part + allocation.amountMinor, 0), 0);
        return [{orderId: order.id, orderNumber: order.number, createdAt: order.createdAt, amountMinor, settledMinor, outstandingMinor: amountMinor - settledMinor}];
      });
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
        accountCharges,
        accountReceipts: (state.accountReceipts ?? []).filter((receipt) => receipt.customerId === customer.id).sort((a,b) => b.createdAt.localeCompare(a.createdAt)),
        metrics: {
          orderCount: metricOrders.length,
          totalSpentMinor,
          averageTicketMinor: metricOrders.length
            ? Math.round(totalSpentMinor / metricOrders.length)
            : 0,
          outstandingMinor: accountCharges.reduce((sum, charge) => sum + charge.outstandingMinor, 0),
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

    async settleCustomerAccount(input) {
      if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw new Error("Ingresá un importe mayor que cero.");
      if (!state.data.cashSession) throw new Error("Abrí una caja antes de registrar el cobro.");
      const method = state.data.paymentMethods.find((candidate) => candidate.code === input.methodCode && candidate.active && candidate.code !== "ACCOUNT");
      if (!method) throw new Error("Seleccioná un medio de pago válido.");
      const profile = await this.getCustomerProfile({customerId: input.customerId, page: 1, pageSize: 10});
      const charges = profile.accountCharges.filter((charge) => charge.outstandingMinor > 0 && (!input.orderIds || input.orderIds.includes(charge.orderId)));
      if (input.orderIds && (new Set(input.orderIds).size !== input.orderIds.length || charges.length !== input.orderIds.length)) throw new Error("Seleccioná pedidos con deuda vigente.");
      if (input.amountMinor > charges.reduce((sum, charge) => sum + charge.outstandingMinor, 0)) throw new Error("El importe supera la deuda seleccionada.");
      let remaining = input.amountMinor;
      const allocations: Array<{orderId: string; orderNumber: number; amountMinor: number}> = [];
      for (const charge of charges) {
        if (!remaining) break;
        const amountMinor = Math.min(remaining, charge.outstandingMinor);
        allocations.push({orderId: charge.orderId, orderNumber: charge.orderNumber, amountMinor});
        remaining -= amountMinor;
      }
      const id = uid("account-receipt", state);
      const movementId = uid("movement", state);
      (state.accountReceipts ??= []).push({id, customerId: input.customerId, movementId, createdAt: now(), amountMinor: input.amountMinor, methodCode: method.code, methodName: method.name, reference: input.reference?.trim() || null, allocations});
      state.movements.push({id: movementId, sessionId: state.data.cashSession.id, type: "INCOME", amountMinor: input.amountMinor, affectsCash: method.affectsCash, paymentMethodCode: method.code, orderId: null, userId: state.data.currentUser.id, reason: `Cobro cuenta corriente · recibo ${id}`, createdAt: now()});
      if (method.affectsCash) {
        state.data.cashSession.expectedAmountMinor += input.amountMinor;
        state.data.cashSession.cashIncomeMinor = (state.data.cashSession.cashIncomeMinor ?? 0) + input.amountMinor;
      }
      audit(state, "CUSTOMER", input.customerId, "CUSTOMER_ACCOUNT_SETTLED", `Recibo ${id}`);
      save();
      return this.getCustomerProfile({customerId: input.customerId, page: 1, pageSize: 10});
    },

    async setCustomerActive(input) {
      requirePin(input.authorizerPin);
      const customer = state.customers.find(
        (candidate) => candidate.id === input.customerId,
      );
      if (!input.active) {
        const profile = await this.getCustomerProfile({customerId: input.customerId, page: 1, pageSize: 10});
        if (profile.metrics.outstandingMinor > 0) throw new Error("El cliente tiene deuda de cuenta corriente; cobrá o fusioná la ficha antes de archivarla.");
      }
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
      for (const receipt of state.accountReceipts ?? [])
        if (receipt.customerId === source.id) receipt.customerId = target.id;
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
        stockControlEnabled: input.stockControlEnabled ?? true,
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
      const previousStockControl = category.stockControlEnabled ?? true;
      category.name = input.name.trim();
      category.active = input.active;
      category.sortOrder = input.sortOrder;
      if (input.stockControlEnabled !== undefined) {
        category.stockControlEnabled = input.stockControlEnabled;
      }
      if (
        input.stockControlEnabled !== undefined &&
        input.stockControlEnabled !== previousStockControl
      ) {
        if (!input.stockControlEnabled) {
          for (const product of state.data.products) {
            if (product.categoryId === category.id) {
              product.stockMinor = null;
              product.stockTargetMinor = null;
              product.stockMinMinor = null;
              product.stockCriticalMinor = null;
            }
          }
        } else {
          for (const product of state.data.products) {
            if (
              product.categoryId === category.id &&
              product.stockMinor == null
            ) {
              product.stockMinor = 0;
            }
          }
        }
      }
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
      validateProductInventory(input);
      if (input.parentProductId) {
        const parent = state.data.products.find(
          (p) => p.id === input.parentProductId,
        );
        if (!parent) throw new Error("El producto base indicado no existe.");
        if (parent.parentProductId)
          throw new Error("Una variante no puede tener variantes.");
      }
      const product: ProductDto = {
        id: uid("product", state),
        categoryId: category.id,
        categoryName: category.name,
        name: input.name.trim(),
        code: input.code?.trim() || null,
        parentProductId: input.parentProductId ?? null,
        sortOrder:
          state.data.products.filter(
            (candidate) => candidate.categoryId === category.id,
          ).length + 1,
        active: true,
        stockMinor: input.stockMinor ?? null,
        stockTargetMinor: input.stockTargetMinor ?? null,
        stockMinMinor: input.stockMinMinor ?? null,
        stockCriticalMinor: input.stockCriticalMinor ?? null,
        imageDataUrl: input.imageDataUrl ?? null,
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
      validateProductInventory(input);
      const product = productById(input.productId);
      const category = categoryById(input.categoryId);
      const nextParentId =
        input.parentProductId === undefined
          ? product.parentProductId
          : input.parentProductId;
      if (nextParentId) {
        if (nextParentId === product.id)
          throw new Error("Un producto no puede ser variante de sí mismo.");
        const parent = state.data.products.find((p) => p.id === nextParentId);
        if (!parent) throw new Error("El producto base indicado no existe.");
        if (parent.parentProductId)
          throw new Error("Una variante no puede tener variantes.");
        const hasChildren = state.data.products.some(
          (p) => p.parentProductId === product.id,
        );
        if (hasChildren)
          throw new Error(
            "Un producto con variantes no puede convertirse en variante.",
          );
      }
      Object.assign(product, {
        categoryId: category.id,
        categoryName: category.name,
        name: input.name.trim(),
        code: input.code?.trim() || null,
        parentProductId: nextParentId,
        active: input.active,
        stockMinor:
          input.stockMinor === undefined
            ? product.stockMinor
            : input.stockMinor,
        stockTargetMinor:
          input.stockTargetMinor === undefined
            ? product.stockTargetMinor
            : input.stockTargetMinor,
        stockMinMinor:
          input.stockMinMinor === undefined
            ? product.stockMinMinor
            : input.stockMinMinor,
        stockCriticalMinor:
          input.stockCriticalMinor === undefined
            ? product.stockCriticalMinor
            : input.stockCriticalMinor,
        imageDataUrl:
          input.imageDataUrl === undefined
            ? product.imageDataUrl
            : input.imageDataUrl,
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

    async deleteProduct(input) {
      requirePin(input.authorizerPin);
      if (!input.reason.trim())
        throw new Error("La eliminación requiere un motivo.");
      const index = state.data.products.findIndex(
        (candidate) => candidate.id === input.productId,
      );
      if (index < 0) throw new Error("El producto no existe.");
      const product = state.data.products[index]!;
      const hasOrder = state.data.orders.some((order) =>
        order.items.some(
          (item) =>
            item.productId === input.productId ||
            item.halves.some((half) => half.productId === input.productId),
        ),
      );
      const hasPurchase = (state.purchases ?? []).some((purchase) =>
        purchase.items.some((item) => item.productId === input.productId),
      );
      const hasChildren = state.data.products.some(
        (child) => child.parentProductId === input.productId,
      );
      if (hasOrder || hasPurchase || hasChildren) {
        throw new Error(
          "El producto tiene ventas, compras o variantes asociadas. Podés desactivarlo desde Editar.",
        );
      }
      state.data.products.splice(index, 1);
      audit(
        state,
        "PRODUCT",
        product.id,
        "PRODUCT_DELETED",
        input.reason.trim(),
        "prices.bulk_update",
      );
      save();
      return { deleted: true as const };
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

    async listPurchases() {
      return output(state.purchases);
    },

    async getFinanceReport(input) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.from) || !/^\d{4}-\d{2}-\d{2}$/.test(input.to) || input.from > input.to ||
        Number.isNaN(Date.parse(input.from)) || Number.isNaN(Date.parse(input.to)) || (Date.parse(input.to) - Date.parse(input.from)) / 86_400_000 > 1096)
        throw new Error("Elegí un período válido de hasta tres años.");
      const expenses = state.financeExpenses ??= [];
      const recurring = state.financeRecurring ??= [];
      let month = input.from.slice(0,7);
      while (month <= input.to.slice(0,7)) {
        const [year, number] = month.split("-").map(Number);
        for (const rule of recurring.filter((item) => item.startMonth <= month && (!item.stopMonth || item.stopMonth >= month))) {
          const day = Math.min(rule.dayOfMonth, new Date(Date.UTC(year!, number!, 0)).getUTCDate());
          const date = `${month}-${String(day).padStart(2,"0")}`;
          if (!expenses.some((item) => item.recurringId === rule.id && item.incurredOn === date))
            expenses.push({id: uid("finance-expense", state), title: rule.title, category: rule.category, kind: rule.kind,
              amountMinor: rule.amountMinor, incurredOn: date, dueOn: date, paidAt: null, paymentMethodCode: null,
              employeeId: rule.employeeId, employeeName: state.data.users.find((user) => user.id === rule.employeeId)?.fullName ?? null,
              recurringId: rule.id, note: null});
        }
        month = new Date(Date.UTC(year!, number!, 1)).toISOString().slice(0,7);
      }
      const periodOrders = state.data.orders.filter((order) => order.lifecycleStatus === "CONFIRMED" && order.operationalStatus !== "CANCELLED" && order.createdAt.slice(0,10) >= input.from && order.createdAt.slice(0,10) <= input.to);
      const paidFinanceMovementIds = new Set(Object.values(state.financeExpenseMovements ?? {}));
      const cashExpenses: FinanceExpenseDto[] = state.movements.filter((movement) => movement.type === "EXPENSE" && movement.createdAt.slice(0,10) >= input.from && movement.createdAt.slice(0,10) <= input.to &&
        !(movement as any).referenceId && !state.movements.some((other) => (other as any).referenceId === movement.id) && !paidFinanceMovementIds.has(movement.id))
        .map((movement) => ({id: `cash-${movement.id}`,title: movement.reason || "Gasto de caja",category: "Caja sin clasificar",kind: "GENERAL",
          amountMinor: movement.amountMinor,incurredOn: movement.createdAt.slice(0,10),dueOn: movement.createdAt.slice(0,10),paidAt: movement.createdAt,
          paymentMethodCode: movement.paymentMethodCode,employeeId: null,employeeName: null,recurringId: null,note: "Movimiento de caja existente"}));
      const periodExpenses = [...expenses.filter((item) => item.incurredOn >= input.from && item.incurredOn <= input.to), ...cashExpenses].sort((a,b) => b.incurredOn.localeCompare(a.incurredOn));
      const costRows = periodOrders.flatMap((order) => order.items.map((item) => ({month: order.createdAt.slice(0,7), cost: state.financeItemCosts?.[item.id]?.unitCostMinor == null ? null : state.financeItemCosts[item.id]!.unitCostMinor! * item.quantity})));
      const refundsMinor = periodOrders.reduce((sum, order) => sum + order.payments.reduce((part, payment) => part + (payment.refundedMinor ?? 0), 0), 0);
      const salesMinor = periodOrders.reduce((sum, order) => sum + order.totalMinor + (order.depositMinor ?? 0), 0) - refundsMinor;
      const cogsMinor = costRows.reduce((sum, row) => sum + (row.cost ?? 0), 0);
      const expensesMinor = periodExpenses.reduce((sum, item) => sum + item.amountMinor, 0);
      const monthlyMap = new Map<string, {month: string; salesMinor: number; cogsMinor: number; expensesMinor: number}>();
      const monthly = (month: string) => {let row = monthlyMap.get(month); if (!row) {row = {month,salesMinor:0,cogsMinor:0,expensesMinor:0}; monthlyMap.set(month,row);} return row;};
      for (const order of periodOrders) monthly(order.createdAt.slice(0,7)).salesMinor += order.totalMinor + (order.depositMinor ?? 0) - order.payments.reduce((sum,payment) => sum + (payment.refundedMinor ?? 0),0);
      for (const row of costRows) monthly(row.month).cogsMinor += row.cost ?? 0;
      for (const item of periodExpenses) monthly(item.incurredOn.slice(0,7)).expensesMinor += item.amountMinor;
      save();
      return output({from: input.from,to: input.to,salesMinor,refundsMinor,cogsMinor,
        unknownCostItems: costRows.filter((row) => row.cost == null).length,costedItems: costRows.filter((row) => row.cost != null).length,
        expensesMinor,payrollMinor: periodExpenses.filter((item) => item.kind === "PAYROLL").reduce((sum,item) => sum + item.amountMinor,0),
        fixedMinor: periodExpenses.filter((item) => item.kind === "FIXED").reduce((sum,item) => sum + item.amountMinor,0),
        unpaidMinor: periodExpenses.filter((item) => !item.paidAt).reduce((sum,item) => sum + item.amountMinor,0),
        purchasesMinor: state.purchases.filter((purchase) => purchase.createdAt.slice(0,10) >= input.from && purchase.createdAt.slice(0,10) <= input.to).reduce((sum,purchase) => sum + purchase.totalMinor,0),
        grossProfitMinor: salesMinor - cogsMinor,estimatedOperatingProfitMinor: salesMinor - cogsMinor - expensesMinor,
        expenses: periodExpenses,recurring,productCosts: state.data.products.filter((product) => product.active).map((product) => ({productId: product.id,productName: product.name,...currentFinanceCost(product.id)})),
        monthly: [...monthlyMap.values()].sort((a,b) => a.month.localeCompare(b.month))});
    },

    async createFinanceExpense(input) {
      if (!input.title.trim() || !input.category.trim() || !["GENERAL","FIXED","PAYROLL"].includes(input.kind) ||
        !Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(input.incurredOn) || Number.isNaN(Date.parse(input.incurredOn))) throw new Error("Completá un gasto válido.");
      if (input.kind === "PAYROLL" && !input.employeeId) throw new Error("Seleccioná un empleado para el sueldo.");
      const employee = input.employeeId ? state.data.users.find((user) => user.id === input.employeeId) : undefined;
      if (input.employeeId && !employee) throw new Error("El empleado no existe.");
      const expense: FinanceExpenseDto = {id: uid("finance-expense", state),title: input.title.trim(),category: input.category.trim(),kind: input.kind,
        amountMinor: input.amountMinor,incurredOn: input.incurredOn,dueOn: input.dueOn ?? input.incurredOn,paidAt: null,paymentMethodCode: null,
        employeeId: input.employeeId ?? null,employeeName: employee?.fullName ?? null,recurringId: null,note: input.note?.trim() || null};
      (state.financeExpenses ??= []).push(expense); save(); return output(expense);
    },

    async payFinanceExpense(input) {
      const expense = state.financeExpenses?.find((item) => item.id === input.expenseId);
      if (!expense) throw new Error("El gasto no existe.");
      if (expense.paidAt) throw new Error("El gasto ya está pagado.");
      const method = state.data.paymentMethods.find((item) => item.code === input.paymentMethodCode && item.active && item.code !== "ACCOUNT");
      if (!method) throw new Error("El medio de pago no está disponible.");
      if (input.fromCash) {
        const cash = state.data.cashSession;
        if (!cash) throw new Error("Abrí la caja antes de pagar desde caja.");
        if (method.affectsCash && expense.amountMinor > cash.expectedAmountMinor) throw new Error("La caja no tiene efectivo suficiente.");
        const movementId = uid("movement",state);
        state.movements.push({id: movementId,sessionId: cash.id,type: "EXPENSE",amountMinor: expense.amountMinor,affectsCash: method.affectsCash,
          paymentMethodCode: method.code,orderId: null,userId: state.data.currentUser.id,reason: `Gasto finanzas: ${expense.title}`,createdAt: now()});
        (state.financeExpenseMovements ??= {})[expense.id] = movementId;
        if (method.affectsCash) {cash.expectedAmountMinor -= expense.amountMinor; cash.cashExpenseMinor = (cash.cashExpenseMinor ?? 0) + expense.amountMinor;}
      }
      expense.paidAt = now(); expense.paymentMethodCode = method.code; save(); return output(expense);
    },

    async createFinanceRecurring(input) {
      if (!input.title.trim() || !input.category.trim() || !["FIXED","PAYROLL"].includes(input.kind) || !Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0 ||
        !Number.isInteger(input.dayOfMonth) || input.dayOfMonth < 1 || input.dayOfMonth > 31 || !/^\d{4}-(0[1-9]|1[0-2])$/.test(input.startMonth)) throw new Error("Completá un gasto fijo válido.");
      if (input.kind === "PAYROLL" && !input.employeeId) throw new Error("Seleccioná un empleado para el sueldo fijo.");
      const rule: FinanceRecurringDto = {id: uid("finance-recurring",state),title: input.title.trim(),category: input.category.trim(),kind: input.kind,
        amountMinor: input.amountMinor,dayOfMonth: input.dayOfMonth,startMonth: input.startMonth,employeeId: input.employeeId ?? null,active: true};
      (state.financeRecurring ??= []).push(rule); save(); return output(rule);
    },

    async stopFinanceRecurring(input) {
      const rule = state.financeRecurring?.find((item) => item.id === input.recurringId && item.active);
      if (!rule) throw new Error("El gasto fijo no está activo.");
      rule.active = false;
      const now = new Date();
      rule.stopMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0,7);
      const today = new Date().toISOString().slice(0,10);
      state.financeExpenses = state.financeExpenses?.filter((item) => item.recurringId !== rule.id || item.paidAt || item.incurredOn <= today);
      save(); return output(rule);
    },

    async setFinanceProductCost(input) {
      if (input.unitCostMinor != null && (!Number.isSafeInteger(input.unitCostMinor) || input.unitCostMinor < 0)) throw new Error("El costo no es válido.");
      productById(input.productId);
      if (input.unitCostMinor == null) delete (state.financeManualCosts ??= {})[input.productId];
      else (state.financeManualCosts ??= {})[input.productId] = input.unitCostMinor;
      save();
    },

    async createPurchase(input) {
      requirePin(input.authorizerPin);
      const requestJson = JSON.stringify({
        supplierName: input.supplierName,
        invoiceNumber: input.invoiceNumber ?? null,
        notes: input.notes ?? null,
        items: input.items,
      });
      const receipt = input.idempotencyKey
        ? state.purchaseReceipts[input.idempotencyKey]
        : undefined;
      if (receipt) {
        if (receipt.requestJson !== requestJson)
          throw new Error(
            "La clave de idempotencia fue reutilizada con datos diferentes.",
          );
        const previous = state.purchases.find(
          (purchase) => purchase.id === receipt.purchaseId,
        );
        if (previous) return output(previous);
      }
      const supplierName = input.supplierName.trim();
      if (supplierName.length < 2)
        throw new Error("Ingresá el proveedor de la compra.");
      if (!input.items.length || input.items.length > 100)
        throw new Error("La compra debe tener entre 1 y 100 productos.");
      if (
        new Set(input.items.map((item) => item.productId)).size !==
        input.items.length
      )
        throw new Error(
          "Cada producto puede aparecer una sola vez por compra.",
        );
      const before = clone(state);
      try {
        let totalMinor = 0;
        const items = input.items.map((item) => {
          if (
            !Number.isSafeInteger(item.quantityMinor) ||
            item.quantityMinor <= 0 ||
            !Number.isSafeInteger(item.unitCostMinor) ||
            item.unitCostMinor < 0
          )
            throw new Error("Un ítem de la compra no es válido.");
          const product = productById(item.productId);
          if (!product.active)
            throw new Error(`El producto ${product.name} está inactivo.`);
          const stockBeforeMinor = product.stockMinor ?? 0;
          const stockAfterMinor = stockBeforeMinor + item.quantityMinor;
          const lineTotalMinor = Math.round(
            (item.quantityMinor * item.unitCostMinor) / 1000,
          );
          if (
            !Number.isSafeInteger(stockAfterMinor) ||
            !Number.isSafeInteger(lineTotalMinor) ||
            !Number.isSafeInteger(totalMinor + lineTotalMinor)
          )
            throw new Error("La compra excede el rango permitido.");
          product.stockMinor = stockAfterMinor;
          totalMinor += lineTotalMinor;
          return {
            id: uid("purchase-item", state),
            productId: product.id,
            productName: product.name,
            quantityMinor: item.quantityMinor,
            unitCostMinor: item.unitCostMinor,
            lineTotalMinor,
            stockBeforeMinor,
            stockAfterMinor,
          };
        });
        const purchase: PurchaseDto = {
          id: uid("purchase", state),
          supplierName,
          invoiceNumber: input.invoiceNumber?.trim() || null,
          notes: input.notes?.trim() || null,
          totalMinor,
          createdByUserId: state.data.currentUser.id,
          createdByUserName: state.data.currentUser.fullName,
          createdAt: now(),
          items,
        };
        state.purchases.unshift(purchase);
        if (input.idempotencyKey)
          state.purchaseReceipts[input.idempotencyKey] = {
            purchaseId: purchase.id,
            requestJson,
          };
        audit(
          state,
          "PURCHASE",
          purchase.id,
          "PURCHASE_CREATED",
          purchase.notes,
          "purchases.manage",
        );
        save();
        return output(purchase);
      } catch (error) {
        state = before;
        throw error;
      }
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
      const staffNumber =
        input.staffNumber ?? nextAvailableStaffNumber(state.data.users);
      if (
        !Number.isInteger(staffNumber) ||
        staffNumber <= 0 ||
        staffNumber > 9999
      ) {
        throw new Error(
          "El número de usuario debe ser un entero entre 1 y 9999.",
        );
      }
      if (state.data.users.some((user) => user.staffNumber === staffNumber)) {
        throw new Error(`El número de usuario ${staffNumber} ya está ocupado.`);
      }
      const user: UserDto = {
        id: uid("driver", state),
        staffNumber,
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
            order.lifecycleStatus === "CONFIRMED" &&
            order.cashSessionCreatedId === state.data.cashSession?.id &&
            state.data.cashSession?.status === "OPEN" &&
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

    async createTableSector(input) {
      const name = input.name.trim();
      if (name.length < 2 || name.length > 60)
        throw new Error("El sector debe tener entre 2 y 60 caracteres.");
      if (
        state.data.tableSectors.some(
          (sector) =>
            sector.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
        )
      )
        throw new Error("Ya existe un sector con ese nombre.");
      const sector = {
        id: uid("sector", state),
        name,
        sortOrder:
          Math.max(
            0,
            ...state.data.tableSectors.map((item) => item.sortOrder),
          ) + 1,
      };
      state.data.tableSectors.push(sector);
      save();
      return output(sector);
    },

    async updateTableSector(input) {
      const sector = state.data.tableSectors.find(
        (candidate) => candidate.id === input.sectorId,
      );
      if (!sector) throw new Error("El sector no existe.");
      const name = input.name.trim();
      if (name.length < 2 || name.length > 60)
        throw new Error("El sector debe tener entre 2 y 60 caracteres.");
      if (
        state.data.tableSectors.some(
          (candidate) =>
            candidate.id !== sector.id &&
            candidate.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
        )
      )
        throw new Error("Ya existe un sector con ese nombre.");
      sector.name = name;
      sector.sortOrder = input.sortOrder ?? sector.sortOrder;
      save();
      return output(sector);
    },

    async deleteTableSector(input) {
      if (state.data.tableSectors.length <= 1)
        throw new Error("El salón debe conservar al menos un sector.");
      const index = state.data.tableSectors.findIndex(
        (sector) => sector.id === input.sectorId,
      );
      if (index < 0) throw new Error("El sector no existe.");
      const [removed] = state.data.tableSectors.splice(index, 1);
      const fallback = state.data.tableSectors[0]!;
      for (const table of state.data.tables)
        if (table.sectorId === input.sectorId) table.sectorId = fallback.id;
      state.data.floorPlanShapes = state.data.floorPlanShapes.filter(
        (shape) => shape.sectorId !== input.sectorId,
      );
      audit(
        state,
        "TABLE_SECTOR",
        input.sectorId,
        "SECTOR_ELIMINADO",
        `Las mesas de ${removed?.name ?? "sector"} pasaron a ${fallback.name}`,
        "tables.manage",
      );
      save();
      return { deleted: true as const, fallbackSectorId: fallback.id };
    },

    async createFloorPlanShape(input) {
      if (
        !state.data.tableSectors.some((sector) => sector.id === input.sectorId)
      )
        throw new Error("El sector seleccionado no existe.");
      validateFloorPlanShapeInput(input);
      const shape: FloorPlanShapeDto = {
        id: uid("floor-shape", state),
        sectorId: input.sectorId,
        kind: input.kind,
        label: input.label?.trim() || null,
        color: input.color.toUpperCase(),
        points: input.points ?? [],
        strokeColor: (input.strokeColor ?? input.color).toUpperCase(),
        strokeWidth: input.strokeWidth ?? 2,
        fillOpacity: input.fillOpacity ?? 1,
        layoutX: input.layoutX,
        layoutY: input.layoutY,
        layoutWidth: input.layoutWidth,
        layoutHeight: input.layoutHeight,
        sortOrder:
          Math.max(
            0,
            ...state.data.floorPlanShapes
              .filter((item) => item.sectorId === input.sectorId)
              .map((item) => item.sortOrder),
          ) + 1,
      };
      state.data.floorPlanShapes.push(shape);
      save();
      return output(shape);
    },

    async updateFloorPlanShape(input) {
      const shape = state.data.floorPlanShapes.find(
        (candidate) => candidate.id === input.shapeId,
      );
      if (!shape) throw new Error("La figura no existe.");
      if (
        !state.data.tableSectors.some((sector) => sector.id === input.sectorId)
      )
        throw new Error("El sector seleccionado no existe.");
      const next = {
        ...input,
        points: input.points ?? shape.points,
        strokeColor: input.strokeColor ?? shape.strokeColor,
        strokeWidth: input.strokeWidth ?? shape.strokeWidth,
        fillOpacity: input.fillOpacity ?? shape.fillOpacity,
      };
      validateFloorPlanShapeInput(next);
      Object.assign(shape, {
        sectorId: input.sectorId,
        kind: input.kind,
        label: input.label?.trim() || null,
        color: input.color.toUpperCase(),
        points: next.points,
        strokeColor: next.strokeColor.toUpperCase(),
        strokeWidth: next.strokeWidth,
        fillOpacity: next.fillOpacity,
        layoutX: input.layoutX,
        layoutY: input.layoutY,
        layoutWidth: input.layoutWidth,
        layoutHeight: input.layoutHeight,
        sortOrder: input.sortOrder ?? shape.sortOrder,
      });
      save();
      return output(shape);
    },

    async deleteFloorPlanShape(input) {
      const index = state.data.floorPlanShapes.findIndex(
        (shape) => shape.id === input.shapeId,
      );
      if (index < 0) throw new Error("La figura no existe.");
      state.data.floorPlanShapes.splice(index, 1);
      save();
      return { deleted: true as const };
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
      const sectorId = input.sectorId ?? table.sectorId;
      if (!state.data.tableSectors.some((sector) => sector.id === sectorId))
        throw new Error("El sector seleccionado no existe.");
      const layout = {
        x: input.layoutX ?? table.layoutX,
        y: input.layoutY ?? table.layoutY,
        width: input.layoutWidth ?? table.layoutWidth,
        height: input.layoutHeight ?? table.layoutHeight,
      };
      if (
        ![layout.x, layout.y, layout.width, layout.height].every(
          Number.isFinite,
        ) ||
        layout.x < 0 ||
        layout.y < 0 ||
        layout.width < 6 ||
        layout.width > 40 ||
        layout.height < 8 ||
        layout.height > 40 ||
        layout.x + layout.width > 100 ||
        layout.y + layout.height > 100
      )
        throw new Error("La posición o el tamaño de la mesa no es válido.");
      const shape = input.shape ?? table.shape;
      if (!["ROUND", "SQUARE", "RECTANGLE"].includes(shape))
        throw new Error("La forma de la mesa no es válida.");
      Object.assign(table, {
        number: input.number,
        name: input.name?.trim() || null,
        active: input.active,
        sortOrder: input.sortOrder ?? table.sortOrder,
        sectorId,
        layoutX: layout.x,
        layoutY: layout.y,
        layoutWidth: layout.width,
        layoutHeight: layout.height,
        shape,
      });
      state.data.tables.sort((left, right) => left.number - right.number);
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
      const reportCashSessions = [
        ...(state.data.cashSession ? [state.data.cashSession] : []),
        ...state.historicalSessions,
      ].filter(
        (session) =>
          session.businessDate >= filters.dateFrom &&
          session.businessDate <= filters.dateTo,
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
          differencesMinor: reportCashSessions.reduce(
            (sum, session) => sum + (session.differenceMinor ?? 0),
            0,
          ),
          sessions: reportCashSessions,
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
              SENSITIVE_DEMO_AUDIT_ACTIONS.has(entry.action) &&
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
    async reverseCashMovement(input) {
      const cash = state.data.cashSession;
      if (!cash || cash.status !== "OPEN")
        throw new Error("Abrí una caja antes de anular movimientos.");
      const original = state.movements.find((m) => m.id === input.movementId);
      if (!original) throw new Error("El movimiento no existe.");
      if ((state.accountReceipts ?? []).some((receipt) => receipt.movementId === original.id))
        throw new Error("Este ingreso corresponde a un cobro de cuenta corriente y no puede anularse como movimiento suelto.");
      if (
        state.movements.some(
          (m) => (m as any).referenceId === input.movementId,
        )
      ) {
        throw new Error("Este movimiento ya fue anulado.");
      }
      if (["OPENING", "CLOSING", "SALE", "REFUND"].includes(original.type)) {
        throw new Error(
          "No podés anular este tipo de movimiento directamente.",
        );
      }
      const reversedType =
        original.type === "INCOME"
          ? "EXPENSE"
          : original.type === "EXPENSE"
            ? "INCOME"
            : original.type === "WITHDRAWAL"
              ? "INCOME"
              : "EXPENSE";
      if (original.affectsCash) {
        cash.expectedAmountMinor += [
          "EXPENSE",
          "WITHDRAWAL",
        ].includes(reversedType)
          ? -original.amountMinor
          : original.amountMinor;
      }
      const newMovement = {
        id: uid("movement", state),
        sessionId: cash.id,
        type: reversedType as CashMovementType,
        amountMinor: original.amountMinor,
        affectsCash: original.affectsCash,
        paymentMethodCode: original.paymentMethodCode,
        orderId: original.orderId,
        userId: state.data.currentUser.id,
        reason: `Anulación: ${input.reason.trim()}`,
        createdAt: now(),
        referenceId: input.movementId,
      };
      state.movements.push(newMovement);
      audit(
        state,
        "CASH_MOVEMENT",
        newMovement.id,
        "CASH_REVERSED",
        input.reason,
      );
      save();
      return output(cash);
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
