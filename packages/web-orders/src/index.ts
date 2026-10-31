/** Checkout snapshots are untrusted quotations, never proof of payment or a sale. */
export interface WebOrderSubmission {
  schemaVersion: 1;
  currency: "ARS";
  customer: { name: string; phone: string };
  fulfillment: { type: "DELIVERY" | "TAKEAWAY"; address?: string };
  items: Array<{
    productRef: string;
    name: string;
    quantity: number;
    /** Final quoted unit price, including the selected options. */
    unitPriceMinor: number;
    options?: Array<{ group: string; name: string }>;
    notes?: string;
  }>;
  deliveryFeeMinor: number;
  paymentMethod: "CASH" | "TRANSFER" | "OTHER";
  notes?: string;
  requestedFor?: string;
}

export interface WebOrderRecord {
  id: string;
  reference: string;
  storeId: string;
  siteId: string;
  sequence: number;
  createdAt: string;
  receivedAt: string | null;
  status: "PENDING_CONFIRMATION";
  paymentStatus: "UNVERIFIED";
  quotedTotalMinor: number;
  submission: WebOrderSubmission;
}

export interface CreateWebOrderResult {
  order: WebOrderRecord;
  whatsappUrl: string;
}

export interface WebOrderPage {
  orders: WebOrderRecord[];
  nextCursor: number;
  hasMore: boolean;
}

export class WebOrderValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebOrderValidationError";
  }
}

const MAX_MONEY = 1_000_000_000_000;
const fail = (field: string): never => {
  throw new WebOrderValidationError(`Campo inválido: ${field}`);
};

function object(
  value: unknown,
  required: string[],
  optional: string[],
  field: string,
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    return fail(field);
  const row = value as Record<string, unknown>;
  const keys = Object.keys(row);
  if (
    required.some((key) => !Object.hasOwn(row, key)) ||
    keys.some((key) => !required.includes(key) && !optional.includes(key))
  )
    return fail(field);
  return row;
}

function text(
  value: unknown,
  max: number,
  field: string,
  multiline = false,
): string {
  if (typeof value !== "string") return fail(field);
  const result = value.trim();
  const controls = multiline
    ? /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/
    : /[\x00-\x1f\x7f]/;
  if (!result || result.length > max || controls.test(result))
    return fail(field);
  return result;
}

function integer(
  value: unknown,
  min: number,
  max: number,
  field: string,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  )
    return fail(field);
  return value;
}

function iso(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    return fail(field);
  return value;
}

/** Strict whitelist + canonical property ordering for durable idempotency hashes. */
export function parseWebOrderSubmission(value: unknown): WebOrderSubmission {
  const row = object(
    value,
    [
      "schemaVersion",
      "currency",
      "customer",
      "fulfillment",
      "items",
      "deliveryFeeMinor",
      "paymentMethod",
    ],
    ["notes", "requestedFor"],
    "pedido",
  );
  if (row.schemaVersion !== 1 || row.currency !== "ARS")
    return fail("schemaVersion/currency");
  const customer = object(row.customer, ["name", "phone"], [], "customer");
  const phone = text(customer.phone, 30, "customer.phone");
  if (
    !/^\+?[\d ()-]+$/.test(phone) ||
    !/^\d{8,15}$/.test(phone.replace(/\D/g, ""))
  )
    return fail("customer.phone");
  const fulfillment = object(
    row.fulfillment,
    ["type"],
    ["address"],
    "fulfillment",
  );
  if (fulfillment.type !== "DELIVERY" && fulfillment.type !== "TAKEAWAY")
    return fail("fulfillment.type");
  const delivery = fulfillment.type === "DELIVERY";
  if (!delivery && Object.hasOwn(fulfillment, "address"))
    return fail("fulfillment.address");
  if (!Array.isArray(row.items) || !row.items.length || row.items.length > 50)
    return fail("items");
  const items = row.items.map((value, index) => {
    const field = `items[${index}]`;
    const item = object(
      value,
      ["productRef", "name", "quantity", "unitPriceMinor"],
      ["options", "notes"],
      field,
    );
    const productRef = text(item.productRef, 128, `${field}.productRef`);
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(productRef))
      return fail(`${field}.productRef`);
    let options: Array<{ group: string; name: string }> | undefined;
    if (Object.hasOwn(item, "options")) {
      if (!Array.isArray(item.options) || item.options.length > 20)
        return fail(`${field}.options`);
      options = item.options.map((value) => {
        const option = object(value, ["group", "name"], [], `${field}.options`);
        return {
          group: text(option.group, 80, `${field}.options.group`),
          name: text(option.name, 120, `${field}.options.name`),
        };
      });
    }
    return {
      productRef,
      name: text(item.name, 120, `${field}.name`),
      quantity: integer(item.quantity, 1, 100, `${field}.quantity`),
      unitPriceMinor: integer(
        item.unitPriceMinor,
        0,
        MAX_MONEY,
        `${field}.unitPriceMinor`,
      ),
      ...(options !== undefined ? { options } : {}),
      ...(Object.hasOwn(item, "notes")
        ? { notes: text(item.notes, 500, `${field}.notes`, true) }
        : {}),
    };
  });
  if (
    row.paymentMethod !== "CASH" &&
    row.paymentMethod !== "TRANSFER" &&
    row.paymentMethod !== "OTHER"
  )
    return fail("paymentMethod");
  const deliveryFeeMinor = integer(
    row.deliveryFeeMinor,
    0,
    MAX_MONEY,
    "deliveryFeeMinor",
  );
  if (!delivery && deliveryFeeMinor !== 0) return fail("deliveryFeeMinor");
  const result: WebOrderSubmission = {
    schemaVersion: 1,
    currency: "ARS",
    customer: { name: text(customer.name, 120, "customer.name"), phone },
    fulfillment: {
      type: fulfillment.type,
      ...(delivery
        ? {
            address: text(
              fulfillment.address,
              500,
              "fulfillment.address",
              true,
            ),
          }
        : {}),
    },
    items,
    deliveryFeeMinor,
    paymentMethod: row.paymentMethod as WebOrderSubmission["paymentMethod"],
    ...(Object.hasOwn(row, "notes")
      ? { notes: text(row.notes, 1000, "notes", true) }
      : {}),
    ...(Object.hasOwn(row, "requestedFor")
      ? { requestedFor: iso(row.requestedFor, "requestedFor") }
      : {}),
  };
  quotedTotalMinor(result);
  return result;
}

/** Arithmetic consistency only: these prices still require merchant verification. */
export function quotedTotalMinor(order: WebOrderSubmission): number {
  let total = integer(order.deliveryFeeMinor, 0, MAX_MONEY, "deliveryFeeMinor");
  for (const item of order.items) {
    total +=
      integer(item.unitPriceMinor, 0, MAX_MONEY, "unitPriceMinor") *
      integer(item.quantity, 1, 100, "quantity");
    integer(total, 0, MAX_MONEY, "quotedTotalMinor");
  }
  return total;
}

export function createWhatsAppUrl(
  phone: string,
  order: WebOrderSubmission,
  reference: string,
): string {
  if (!/^\d{8,15}$/.test(phone)) return fail("whatsappNumber");
  const safe = parseWebOrderSubmission(order);
  const money = (minor: number) =>
    new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: "ARS",
    }).format(minor / 100);
  const message = [
    `Solicitud ${text(reference, 64, "reference")} — pendiente de confirmación`,
    `Cliente: ${safe.customer.name} · ${safe.customer.phone}`,
    safe.fulfillment.type === "DELIVERY"
      ? `Envío: ${safe.fulfillment.address}`
      : "Para retirar",
    ...(safe.requestedFor ? [`Fecha solicitada: ${safe.requestedFor}`] : []),
    ...safe.items.flatMap((item) => [
      `${item.quantity} × ${item.name} — ${money(item.unitPriceMinor * item.quantity)}`,
      ...(item.options ?? []).map(
        (option) => `  ${option.group}: ${option.name}`,
      ),
      ...(item.notes ? [`  Nota: ${item.notes}`] : []),
    ]),
    `Envío: ${money(safe.deliveryFeeMinor)}`,
    `Total cotizado: ${money(quotedTotalMinor(safe))}`,
    `Forma de pago: ${{ CASH: "Efectivo", TRANSFER: "Transferencia", OTHER: "A coordinar" }[safe.paymentMethod]} (sin verificar)`,
    ...(safe.notes ? [`Observaciones: ${safe.notes}`] : []),
    "El negocio debe confirmar disponibilidad, importe y pago.",
  ].join("\n");
  const url = new URL(`https://wa.me/${phone}`);
  url.searchParams.set("text", message);
  return url.toString();
}

export function parseWebOrderRecord(value: unknown): WebOrderRecord {
  const row = object(
    value,
    [
      "id",
      "reference",
      "storeId",
      "siteId",
      "sequence",
      "createdAt",
      "receivedAt",
      "status",
      "paymentStatus",
      "quotedTotalMinor",
      "submission",
    ],
    [],
    "order",
  );
  const submission = parseWebOrderSubmission(row.submission);
  if (
    row.status !== "PENDING_CONFIRMATION" ||
    row.paymentStatus !== "UNVERIFIED" ||
    row.quotedTotalMinor !== quotedTotalMinor(submission)
  )
    return fail("order.status/paymentStatus/quotedTotalMinor");
  const id = text(row.id, 64, "order.id");
  if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id))
    return fail("order.id");
  return {
    id,
    reference: text(row.reference, 64, "order.reference"),
    storeId: text(row.storeId, 64, "order.storeId"),
    siteId: text(row.siteId, 64, "order.siteId"),
    sequence: integer(
      row.sequence,
      1,
      Number.MAX_SAFE_INTEGER,
      "order.sequence",
    ),
    createdAt: iso(row.createdAt, "order.createdAt"),
    receivedAt:
      row.receivedAt === null ? null : iso(row.receivedAt, "order.receivedAt"),
    status: "PENDING_CONFIRMATION",
    paymentStatus: "UNVERIFIED",
    quotedTotalMinor: quotedTotalMinor(submission),
    submission,
  };
}

export { WebOrdersClient, WebOrdersHttpError } from "./client.js";
