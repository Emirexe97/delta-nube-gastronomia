import type {
  AddComboItemInput,
  AddHalfAndHalfItemInput,
  AddOrderItemInput,
  BootstrapDto,
  CreateOrderInput,
  CustomerDto,
  ModifierScope,
  OrderDto,
  RepeatOrderInput,
} from "@gastronomy/contracts";
import { assertPermission } from "./permissions";

export type RepeatOrderLine = {
  item:
    | { kind: "PRODUCT"; input: Omit<AddOrderItemInput, "orderId"> }
    | { kind: "HALF"; input: Omit<AddHalfAndHalfItemInput, "orderId"> }
    | { kind: "COMBO"; input: Omit<AddComboItemInput, "orderId"> };
  modifiers: Array<{ modifierId: string; scope: ModifierScope }>;
};

/** Resolve identities now; never use historical prices, payments or fees. */
export function planRepeatOrder(
  source: OrderDto,
  customer: CustomerDto,
  data: Pick<
    BootstrapDto,
    | "products"
    | "modifiers"
    | "settings"
    | "categories"
    | "currentUser"
    | "cashSession"
  >,
  input: RepeatOrderInput,
): { order: CreateOrderInput; lines: RepeatOrderLine[] } {
  if (!data.currentUser.permissions.includes("*"))
    assertPermission(data.currentUser.permissions, "orders.create");
  if (!data.cashSession || data.cashSession.status !== "OPEN")
    throw new Error("Abrí la caja antes de repetir el pedido.");
  if (input.type !== "TAKEAWAY" && input.type !== "DELIVERY")
    throw new Error("Elegí Para retirar o Envío.");
  if (
    source.id !== input.sourceOrderId ||
    source.customerId !== input.customerId ||
    customer.id !== input.customerId
  )
    throw new Error("El pedido no pertenece al cliente seleccionado.");
  if (!customer.active || customer.mergedIntoCustomerId)
    throw new Error("El cliente está archivado o fue unificado.");
  if (
    source.lifecycleStatus !== "CONFIRMED" ||
    source.operationalStatus === "CANCELLED" ||
    !source.items.length
  )
    throw new Error(
      "Sólo se pueden repetir pedidos confirmados, no anulados y con productos.",
    );
  const address =
    input.type === "DELIVERY"
      ? customer.addresses.find(
          (candidate) => candidate.id === input.customerAddressId,
        )
      : undefined;
  if (input.type === "DELIVERY" && !address?.address.trim())
    throw new Error("Elegí una dirección vigente del cliente.");
  const product = (id: string) => {
    const found = data.products.find(
      (candidate) => candidate.id === id && candidate.active,
    );
    if (
      !found ||
      !data.categories.some(
        (category) => category.id === found.categoryId && category.active,
      )
    )
      throw new Error(
        "Un producto del pedido ya no está disponible. Cargalo manualmente.",
      );
    if (
      !found.prices.some(
        (price) =>
          price.priceListCode === input.type &&
          Number.isSafeInteger(price.amountMinor) &&
          price.amountMinor >= 0,
      )
    )
      throw new Error(
        `${found.name} no tiene un precio vigente para esta modalidad.`,
      );
    return found;
  };
  const modifier = (id: string | null | undefined, name: string) => {
    const found = data.modifiers.find(
      (candidate) => candidate.id === id && candidate.active,
    );
    if (!found)
      throw new Error(
        `El extra «${name}» no tiene una referencia vigente. Revisá el pedido manualmente.`,
      );
    return found.id;
  };
  const lines = source.items.map((old): RepeatOrderLine => {
    if (!Number.isSafeInteger(old.quantity) || old.quantity <= 0)
      throw new Error("La cantidad histórica del pedido no es válida.");
    const common = { quantity: old.quantity, notes: old.notes };
    const modifiers = old.modifiers.map((extra) => ({
      modifierId: modifier(extra.modifierId, extra.nameSnapshot),
      scope: extra.scope,
    }));
    if (old.comboComponents?.length) {
      if (!old.productId)
        throw new Error("El combo histórico no tiene producto de referencia.");
      const combo = product(old.productId);
      const slots = combo.comboDefinition?.slots;
      if (!slots || slots.length !== old.comboComponents.length)
        throw new Error(
          "Cambió la configuración del combo. Armalo nuevamente desde el catálogo.",
        );
      const selections = old.comboComponents.map((component) => {
        const slot = slots.find(
          (candidate) => candidate.id === component.slotId,
        );
        if (!slot || !slot.productIds.includes(component.productId))
          throw new Error(
            "Una opción del combo ya no está disponible. Armalo nuevamente.",
          );
        if (product(component.productId).comboDefinition)
          throw new Error("No se admiten combos dentro de otros combos.");
        return {
          slotId: slot.id,
          productId: component.productId,
          modifierIds: component.modifiers.map((extra) =>
            modifier(extra.modifierId, extra.nameSnapshot),
          ),
        };
      });
      if (
        new Set(selections.map((selection) => selection.slotId)).size !==
        slots.length
      )
        throw new Error("Las opciones históricas del combo no son válidas.");
      return {
        item: {
          kind: "COMBO",
          input: { ...common, comboProductId: combo.id, selections },
        },
        modifiers,
      };
    }
    if (old.halves.length) {
      if (data.settings.halfAndHalfEnabled === false)
        throw new Error(
          "Las pizzas mitad y mitad están deshabilitadas. Armá el pedido manualmente.",
        );
      const first = old.halves.find((half) => half.position === "FIRST");
      const second = old.halves.find((half) => half.position === "SECOND");
      if (
        !first ||
        !second ||
        old.halves.length !== 2 ||
        product(first.productId).comboDefinition ||
        product(second.productId).comboDefinition
      )
        throw new Error("Las mitades originales ya no están disponibles.");
      return {
        item: {
          kind: "HALF",
          input: {
            ...common,
            firstProductId: first.productId,
            secondProductId: second.productId,
          },
        },
        modifiers,
      };
    }
    if (!old.productId || product(old.productId).comboDefinition)
      throw new Error(
        "Cambió el producto del pedido. Cargalo nuevamente desde el catálogo.",
      );
    if (modifiers.some((extra) => extra.scope !== "FULL_PIZZA"))
      throw new Error(
        "Un extra histórico requiere revisar sus mitades. Cargalo manualmente.",
      );
    return {
      item: { kind: "PRODUCT", input: { ...common, productId: old.productId } },
      modifiers,
    };
  });
  return {
    order: {
      type: input.type,
      customerId: customer.id,
      customerName: customer.name,
      customerPhone: customer.phone,
      customerAddressId: address?.id ?? null,
      deliveryAddress: address?.address ?? null,
      deliveryFeeMinor: address?.deliveryFeeMinor ?? 0,
      notes: null,
      scheduled: false,
    },
    lines,
  };
}
