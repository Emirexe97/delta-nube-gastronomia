import test from "node:test";
import assert from "node:assert/strict";
import type {
  BootstrapDto,
  CustomerDto,
  OrderDto,
  RepeatOrderInput,
} from "@gastronomy/contracts";
import { planRepeatOrder } from "./repeat-order";

const product = (id = "p1", comboDefinition?: any) => ({
  id,
  categoryId: "cat",
  categoryName: "Comida",
  name: id,
  code: id,
  sortOrder: 0,
  active: true,
  stockMinor: null,
  stockTargetMinor: null,
  stockMinMinor: null,
  stockCriticalMinor: null,
  imageDataUrl: null,
  prices: [
    { priceListId: "pl", priceListCode: "TAKEAWAY", amountMinor: 1250 },
    { priceListId: "pl2", priceListCode: "DELIVERY", amountMinor: 1300 },
  ],
  comboDefinition,
});
const item = (patch: Record<string, unknown> = {}) => ({
  id: "item1",
  productId: "p1",
  productNameSnapshot: "Nombre viejo",
  quantity: 2,
  unitPriceMinorSnapshot: 400,
  discountMinorSnapshot: 100,
  notes: "sin cebolla",
  halves: [],
  modifiers: [],
  lineTotalMinor: 700,
  ...patch,
});
function fixture() {
  const customer = {
    id: "c1",
    name: "Cliente actual",
    phone: "111",
    notes: null,
    preferences: null,
    tags: [],
    preferredPaymentMethodCode: null,
    active: true,
    mergedIntoCustomerId: null,
    updatedAt: "now",
    addresses: [
      {
        id: "a1",
        label: "Casa",
        address: "Calle 1",
        notes: "timbre",
        deliveryFeeMinor: 300,
      },
    ],
  } as CustomerDto;
  const source = {
    id: "o1",
    customerId: "c1",
    lifecycleStatus: "CONFIRMED",
    operationalStatus: "DELIVERED",
    items: [item()],
    type: "DINE_IN",
  } as unknown as OrderDto;
  const data = {
    products: [product()],
    modifiers: [
      {
        id: "m1",
        groupId: "g1",
        groupName: "Extras",
        name: "Queso",
        priceMinor: 9999,
        active: true,
      },
    ],
    settings: { halfAndHalfEnabled: true },
    categories: [
      {
        id: "cat",
        name: "Comida",
        sortOrder: 0,
        active: true,
        stockControlEnabled: false,
      },
    ],
    currentUser: { permissions: ["orders.create"] },
    cashSession: { status: "OPEN" },
  } as unknown as Pick<
    BootstrapDto,
    | "products"
    | "modifiers"
    | "settings"
    | "categories"
    | "currentUser"
    | "cashSession"
  >;
  const input: RepeatOrderInput = {
    sourceOrderId: "o1",
    customerId: "c1",
    type: "TAKEAWAY",
  };
  return { customer, source, data, input };
}

test("uses active customer/product identities and current order price, not historical money or state", () => {
  const f = fixture();
  const plan = planRepeatOrder(f.source, f.customer, f.data, f.input);
  assert.equal(plan.order.customerName, "Cliente actual");
  assert.equal(plan.order.notes, null);
  assert.equal(plan.order.deliveryFeeMinor, 0);
  assert.deepEqual(plan.lines[0]?.item, {
    kind: "PRODUCT",
    input: { productId: "p1", quantity: 2, notes: "sin cebolla" },
  });
  assert.equal("unitPriceMinorOverride" in plan.lines[0]!.item.input, false);
  assert.equal("payments" in plan.order, false);
});

test("requires active customer, a current delivery address, and source ownership", () => {
  const f = fixture();
  assert.throws(
    () =>
      planRepeatOrder(
        f.source,
        { ...f.customer, active: false },
        f.data,
        f.input,
      ),
    /archivado/,
  );
  assert.throws(
    () =>
      planRepeatOrder(f.source, f.customer, f.data, {
        ...f.input,
        type: "DELIVERY",
        customerAddressId: "old",
      }),
    /dirección/,
  );
  assert.equal(
    planRepeatOrder(f.source, f.customer, f.data, {
      ...f.input,
      type: "DELIVERY",
      customerAddressId: "a1",
    }).order.deliveryFeeMinor,
    300,
  );
  assert.throws(
    () =>
      planRepeatOrder(f.source, f.customer, f.data, {
        ...f.input,
        customerId: "other",
      }),
    /no pertenece/,
  );
});

test("requires create permission and open cash", () => {
  const f = fixture();
  assert.throws(
    () =>
      planRepeatOrder(
        f.source,
        f.customer,
        {
          ...f.data,
          currentUser: { permissions: [] },
        } as unknown as typeof f.data,
        f.input,
      ),
    /permiso/,
  );
  assert.throws(
    () =>
      planRepeatOrder(
        f.source,
        f.customer,
        { ...f.data, cashSession: null },
        f.input,
      ),
    /caja/,
  );
});

test("legacy extras without live ids fail closed", () => {
  const f = fixture();
  const source = {
    ...f.source,
    items: [
      item({
        modifiers: [
          {
            id: "legacy",
            nameSnapshot: "Queso",
            unitPriceMinorSnapshot: 200,
            scope: "FULL_PIZZA",
          },
        ],
      }),
    ],
  } as OrderDto;
  assert.throws(
    () => planRepeatOrder(source, f.customer, f.data, f.input),
    /referencia vigente/,
  );
  const withCurrentId = {
    ...f.data,
    modifiers: [
      {
        id: "different",
        groupId: "g1",
        groupName: "Extras",
        name: "Queso",
        priceMinor: 9999,
        active: true,
      },
    ],
  };
  assert.throws(
    () => planRepeatOrder(source, f.customer, withCurrentId, f.input),
    /referencia vigente/,
  );
});

test("refuses half-and-half when disabled and re-resolves current component identities", () => {
  const f = fixture();
  const source = {
    ...f.source,
    items: [
      item({
        productId: null,
        halves: [
          {
            productId: "p1",
            nameSnapshot: "Viejo",
            priceMinorSnapshot: 1,
            position: "FIRST",
          },
          {
            productId: "p1",
            nameSnapshot: "Viejo",
            priceMinorSnapshot: 1,
            position: "SECOND",
          },
        ],
      }),
    ],
  } as OrderDto;
  assert.throws(
    () =>
      planRepeatOrder(
        source,
        f.customer,
        { ...f.data, settings: { halfAndHalfEnabled: false } } as typeof f.data,
        f.input,
      ),
    /deshabilitadas/,
  );
  assert.equal(
    planRepeatOrder(source, f.customer, f.data, f.input).lines[0]?.item.kind,
    "HALF",
  );
});

test("repeats combo only if its current option set still permits every historical selection", () => {
  const definition = {
    slots: [{ id: "drink", name: "Bebida", quantity: 1, productIds: ["p1"] }],
  };
  const f = fixture();
  const source = {
    ...f.source,
    items: [
      item({
        productId: "combo",
        comboComponents: [
          {
            slotId: "drink",
            slotName: "Bebida",
            productId: "p1",
            nameSnapshot: "Antes",
            quantity: 1,
            modifiers: [],
          },
        ],
      }),
    ],
  } as unknown as OrderDto;
  const data = {
    ...f.data,
    products: [product("p1"), product("combo", definition)],
  } as typeof f.data;
  assert.equal(
    planRepeatOrder(source, f.customer, data, f.input).lines[0]?.item.kind,
    "COMBO",
  );
  const changed = {
    ...data,
    products: [
      product("p1"),
      product("combo", {
        slots: [{ ...definition.slots[0], productIds: ["another"] }],
      }),
    ],
  } as typeof f.data;
  assert.throws(
    () => planRepeatOrder(source, f.customer, changed, f.input),
    /opción del combo ya no está disponible/,
  );
});
