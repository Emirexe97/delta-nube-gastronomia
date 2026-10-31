import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createWhatsAppUrl,
  parseWebOrderSubmission,
  quotedTotalMinor,
  WebOrdersClient,
} from "../dist/index.js";

const payload = () => ({
  schemaVersion: 1,
  currency: "ARS",
  customer: { name: " Ana ", phone: "+54 9 11 1234-5678" },
  fulfillment: { type: "DELIVERY", address: "Calle 123" },
  items: [
    {
      productRef: "pizza-1",
      name: "Pizza",
      quantity: 2,
      unitPriceMinor: 125000,
      options: [{ group: "Mitades", name: "Muzzarella / Jamón" }],
      notes: "Sin aceitunas",
    },
  ],
  deliveryFeeMinor: 10000,
  paymentMethod: "TRANSFER",
});

test("canonical checkout keeps snapshots and calculates an integer quotation, options included", () => {
  const p = payload();
  const parsed = parseWebOrderSubmission(p);
  assert.equal(parsed.customer.name, "Ana");
  assert.equal(quotedTotalMinor(parsed), 260000);
  assert.equal(parsed.items[0].options[0].name, "Muzzarella / Jamón");
  assert.notEqual(p.customer, parsed.customer);
  const reversed = Object.fromEntries(Object.entries(p).reverse());
  assert.equal(
    JSON.stringify(parsed),
    JSON.stringify(parseWebOrderSubmission(reversed)),
  );
});

test("pickup has no delivery fee/address and requestedFor requires canonical UTC", () => {
  const p = payload();
  p.fulfillment = { type: "TAKEAWAY" };
  p.deliveryFeeMinor = 0;
  p.requestedFor = "2026-11-02T22:00:00.000Z";
  assert.equal(parseWebOrderSubmission(p).requestedFor, p.requestedFor);
  assert.throws(() => parseWebOrderSubmission({ ...p, deliveryFeeMinor: 1 }));
  assert.throws(() =>
    parseWebOrderSubmission({
      ...p,
      fulfillment: { type: "TAKEAWAY", address: "ignored" },
    }),
  );
  for (const requestedFor of [
    "tomorrow",
    "2026-02-30T00:00:00.000Z",
    "2026-11-02T19:00:00-03:00",
    null,
  ])
    assert.throws(() => parseWebOrderSubmission({ ...p, requestedFor }));
});

test("rejects missing, unknown, paid, routing, prototype and sensitive fields", () => {
  const p = payload();
  for (const value of [
    null,
    [],
    {},
    { ...p, schemaVersion: 2 },
    { ...p, currency: "USD" },
    { ...p, storeId: "other" },
    { ...p, paymentStatus: "PAID" },
    { ...p, cardNumber: "fake" },
    { ...p, paymentMethod: "CARD" },
    JSON.parse(
      JSON.stringify(p).replace(
        '"schemaVersion":1',
        '"__proto__":{},"schemaVersion":1',
      ),
    ),
  ])
    assert.throws(() => parseWebOrderSubmission(value));
  assert.throws(() =>
    parseWebOrderSubmission({
      ...p,
      customer: { ...p.customer, email: "not-in-v1" },
    }),
  );
  assert.throws(() =>
    parseWebOrderSubmission({ ...p, fulfillment: { type: "DELIVERY" } }),
  );
});

test("bounds item counts, quantities, cents, total and free-text lengths", () => {
  const p = payload();
  for (const quantity of [0, -1, 1.5, 101, "2", NaN, Infinity])
    assert.throws(() =>
      parseWebOrderSubmission({ ...p, items: [{ ...p.items[0], quantity }] }),
    );
  for (const unitPriceMinor of [
    -1,
    0.1,
    "100",
    Number.MAX_SAFE_INTEGER,
    Infinity,
  ])
    assert.throws(() =>
      parseWebOrderSubmission({
        ...p,
        items: [{ ...p.items[0], unitPriceMinor }],
      }),
    );
  assert.throws(() => parseWebOrderSubmission({ ...p, items: [] }));
  assert.throws(() =>
    parseWebOrderSubmission({ ...p, items: Array(51).fill(p.items[0]) }),
  );
  assert.throws(() =>
    parseWebOrderSubmission({
      ...p,
      items: [
        { ...p.items[0], quantity: 100, unitPriceMinor: 1_000_000_000_000 },
      ],
    }),
  );
  assert.throws(() =>
    parseWebOrderSubmission({ ...p, notes: "x".repeat(1001) }),
  );
  assert.throws(() =>
    parseWebOrderSubmission({
      ...p,
      items: [{ ...p.items[0], name: "Pizza\nPagado" }],
    }),
  );
  assert.throws(() =>
    parseWebOrderSubmission({
      ...p,
      items: [
        { ...p.items[0], options: Array(21).fill({ group: "x", name: "y" }) },
      ],
    }),
  );
  assert.throws(() =>
    parseWebOrderSubmission({
      ...p,
      customer: { ...p.customer, phone: "+123" },
    }),
  );
});

test("WhatsApp destination is merchant-configured and message includes reference and unverified quotation", () => {
  const url = new URL(
    createWhatsAppUrl(
      "5491112345678",
      parseWebOrderSubmission(payload()),
      "WEB-test",
    ),
  );
  assert.equal(url.origin, "https://wa.me");
  assert.equal(url.pathname, "/5491112345678");
  const message = url.searchParams.get("text");
  for (const part of [
    "WEB-test",
    "pendiente de confirmación",
    "Total cotizado",
    "sin verificar",
    "Sin aceitunas",
    "Muzzarella / Jamón",
  ])
    assert.ok(message.includes(part), part);
  assert.throws(() =>
    createWhatsAppUrl("https://evil.example", payload(), "x"),
  );
});

test("client refuses insecure remote endpoints, embedded credentials and malformed tokens", () => {
  const token = "a".repeat(43);
  for (const url of [
    "http://api.example",
    "https://user:pass@api.example",
    "https://api.example?token=x",
    "https://api.example/#x",
  ])
    assert.throws(() => new WebOrdersClient(url, token));
  assert.throws(() => new WebOrdersClient("https://api.example", "short"));
  assert.ok(new WebOrdersClient("http://127.0.0.1:8098", token));
  assert.ok(new WebOrdersClient("https://api.example/orders", token));
});
