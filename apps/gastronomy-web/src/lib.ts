import type {
  CashSessionDto,
  OrderDto,
  OrderOperationalStatus,
  OrderType,
  PaymentStatus,
  ProductDto,
} from "@gastronomy/contracts";
import { formatMoney as domainFormatMoney } from "@gastronomy/domain";

export const formatMoney = domainFormatMoney;

export function formatTime(value: string | null) {
  return value
    ? new Date(value).toLocaleTimeString("es-AR", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
}

export function formatElapsed(value: string | null) {
  if (!value) return "";
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - new Date(value).valueOf()) / 60_000),
  );
  return `${minutes} min`;
}

export const typeLabels: Record<OrderType, string> = {
  DINE_IN: "Salón",
  TAKEAWAY: "Para retirar",
  DELIVERY: "Envío",
};

export const halfAndHalfLabels = {
  HALF_PLUS_HALF: "50% + 50%",
  MOST_EXPENSIVE: "Variedad más cara",
} as const;

const auditLabels: Record<string, string> = {
  ORDER_DRAFT_CREATED: "Borrador creado",
  ORDER_DRAFT_UPDATED: "Datos del borrador actualizados",
  ORDER_DRAFT_DISCARDED: "Borrador descartado",
  ORDER_CONFIRMED: "Pedido confirmado",
  ORDER_CREATED: "Pedido creado",
  ORDER_PAID: "Pedido cobrado",
  PAYMENT_REFUNDED: "Pago devuelto",
  PAGO_DEVUELTO: "Pago devuelto",
  ORDER_CANCELLED: "Pedido cancelado",
  ORDER_STATUS_CHANGED: "Estado actualizado",
  ORDER_PRINT_QUEUED: "Impresión solicitada",
  ORDER_REPRINT_QUEUED: "Reimpresión solicitada",
  PRINT_RETRY_QUEUED: "Reintento de impresión solicitado",
  PRINT_QUEUED_RECOVERED: "Impresión pendiente reanudada",
  ORDER_EDITED_AFTER_PRINT: "Editado después de imprimir",
  ORDER_ITEM_REMOVED: "Producto quitado",
  ORDER_ITEM_PRICE_OVERRIDDEN: "Precio manual autorizado",
  ORDER_MODIFIER_ADDED: "Modificador agregado",
  ORDER_MODIFIER_REMOVED: "Modificador quitado",
  ORDER_DISCOUNT_APPLIED: "Descuento aplicado",
  TABLE_CREATED: "Mesa creada",
  TABLE_REACTIVATED: "Mesa reactivada",
  TABLE_UPDATED: "Mesa actualizada",
  TABLES_CONFIGURED: "Mesas configuradas",
  TABLE_SECTOR_DELETED: "Sector eliminado",
  SECTOR_ELIMINADO: "Sector eliminado",
  DELIVERY_SETTLED: "Rendición liquidada",
  SETTINGS_UPDATED: "Configuración actualizada",
  STOCK_ADJUSTED: "Stock ajustado",
  PURCHASE_CREATED: "Ingreso de mercadería registrado",
  USER_CREATED: "Usuario creado",
  USER_UPDATED: "Usuario actualizado",
  CUSTOMER_CREATED: "Cliente creado",
  CUSTOMER_UPDATED: "Cliente actualizado",
  DRIVER_CREATED: "Repartidor creado",
  PRODUCT_CREATED: "Producto creado",
  PRODUCT_UPDATED: "Producto actualizado",
  PRODUCTS_BULK_UPDATED: "Productos actualizados en lote",
  PRODUCTOS_ACTUALIZADOS_EN_LOTE: "Productos actualizados en lote",
  CATEGORY_CREATED: "Categoría creada",
  MODIFIER_CREATED: "Modificador creado",
  CASH_OPENED: "Caja abierta",
  CASH_CLOSED: "Caja cerrada",
  CASH_FORCE_CLOSED: "Caja cerrada forzosamente",
};
const entityLabels: Record<string, string> = {
  ORDER: "Pedido",
  RESTAURANT_TABLE: "Mesa",
  DELIVERY_LEDGER: "Rendición",
  SETTINGS: "Configuración",
  PRODUCT: "Producto",
  PRODUCT_BATCH: "Lote de productos",
  PURCHASE: "Compra",
  PAYMENT: "Pago",
  USER: "Usuario",
  CASH_SESSION: "Caja",
  PRINT_JOB: "Impresión",
  CUSTOMER: "Cliente",
  TABLE_SECTOR: "Sector",
};
const permissionLabels: Record<string, string> = {
  "orders.cancel": "Cancelar pedidos",
  "orders.discount": "Aplicar descuentos",
  "orders.reprint": "Reimprimir",
  "orders.override_price": "Modificar precio de una línea",
  "payments.refund": "Devolver pagos",
  "prices.bulk_update": "Actualizar productos y precios en lote",
  "cash.close": "Cerrar caja",
  "cash.expense": "Movimientos de caja",
  "settings.manage": "Administrar configuración",
  "stock.adjust": "Ajustar stock",
  "purchases.manage": "Registrar compras e ingresos",
  "users.manage": "Administrar usuarios",
  "tables.manage": "Administrar mesas y sectores",
};
export const auditActionLabel = (value: string) =>
  auditLabels[value] ??
  value
    .toLocaleLowerCase("es-AR")
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
export const auditEntityLabel = (value: string) => entityLabels[value] ?? value;
export const permissionLabel = (value: string | null) =>
  value ? (permissionLabels[value] ?? value) : "—";

export const statusLabels: Record<OrderOperationalStatus, string> = {
  PENDING: "Pendiente",
  IN_PREPARATION: "En preparación",
  READY: "Listo",
  OUT_FOR_DELIVERY: "En reparto",
  DELIVERED: "Entregado",
  CANCELLED: "Cancelado",
};

export const paymentStatusLabels: Record<PaymentStatus, string> = {
  UNPAID: "Impago",
  PARTIALLY_PAID: "Pago parcial",
  PAID: "Pagado",
};

export function parseMoneyInput(value: string) {
  const normalized = value.trim().replace(/\./g, "").replace(",", ".");
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0) return null;
  const amountMinor = Math.round(amount * 100);
  return Number.isSafeInteger(amountMinor) ? amountMinor : null;
}

export function parseStockInput(value: string) {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d{0,3})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0) return null;
  const stockMinor = Math.round(amount * 1000);
  return Number.isSafeInteger(stockMinor) ? stockMinor : null;
}

export function humanError(error: unknown) {
  return error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': /, "")
    : "Ocurrió un error inesperado.";
}

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es-AR")
    .trim();
}

export function rankProducts(
  products: ProductDto[],
  query: string,
  categoryId: string | null = null,
) {
  const normalizedQuery = normalizeSearch(query);
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  return products
    .filter(
      (product) =>
        product.active && (!categoryId || product.categoryId === categoryId),
    )
    .map((product, index) => {
      const code = normalizeSearch(product.code ?? "");
      const name = normalizeSearch(product.name);
      const haystack = `${code} ${name} ${normalizeSearch(product.categoryName)}`;
      if (!tokens.every((token) => haystack.includes(token))) return null;
      const score = !normalizedQuery
        ? 5
        : code === normalizedQuery
          ? 0
          : code.startsWith(normalizedQuery)
            ? 1
            : name.startsWith(normalizedQuery)
              ? 2
              : name
                    .split(/\s+/)
                    .some((word) => word.startsWith(normalizedQuery))
                ? 3
                : 4;
      return { product, score, index };
    })
    .filter(
      (entry): entry is { product: ProductDto; score: number; index: number } =>
        Boolean(entry),
    )
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((entry) => entry.product);
}

export function promisedTiming(value: string | null, now = Date.now()) {
  if (!value) return { label: "Sin horario", tone: "slate" as const };
  const minutes = Math.round((new Date(value).valueOf() - now) / 60_000);
  if (minutes < 0)
    return {
      label: `Atrasado ${Math.abs(minutes)} min`,
      tone: "rose" as const,
    };
  if (minutes <= 10)
    return {
      label: minutes === 0 ? "Es ahora" : `Faltan ${minutes} min`,
      tone: "amber" as const,
    };
  return { label: `Faltan ${minutes} min`, tone: "green" as const };
}

/** Ventas cobradas y vigentes de una caja; evita mezclar cajas históricas. */
export function paidOrdersForSession(
  orders: OrderDto[],
  session: CashSessionDto | null,
) {
  return orders
    .filter(
      (order) =>
        order.lifecycleStatus === "CONFIRMED" &&
        order.operationalStatus !== "CANCELLED" &&
        order.paidMinor > 0 &&
        (!session || order.cashSessionPaidId === session.id),
    )
    .sort(
      (a, b) =>
        new Date(b.updatedAt).valueOf() - new Date(a.updatedAt).valueOf(),
    );
}

export function salesByChannel(orders: OrderDto[]) {
  return {
    DINE_IN: orders
      .filter((o) => o.type === "DINE_IN")
      .reduce((s, o) => s + o.paidMinor, 0),
    TAKEAWAY: orders
      .filter((o) => o.type === "TAKEAWAY")
      .reduce((s, o) => s + o.paidMinor, 0),
    DELIVERY: orders
      .filter((o) => o.type === "DELIVERY")
      .reduce((s, o) => s + o.paidMinor, 0),
  };
}

export function paymentText(order: OrderDto) {
  return (
    order.payments
      .filter((p) => p.status !== "REFUNDED" && p.amountMinor > p.refundedMinor)
      .map((p) => p.methodName || p.methodCode)
      .join(" · ") || "Sin detalle"
  );
}
