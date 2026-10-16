import type { ComboDefinitionDto } from "@gastronomy/contracts";

export function assertComboDefinition(
  definition: ComboDefinitionDto,
  comboProductId?: string,
  products?: Array<{
    id: string;
    parentProductId?: string | null;
    comboDefinition?: ComboDefinitionDto | null;
  }>,
): void {
  if (
    !definition ||
    !Array.isArray(definition.slots) ||
    definition.slots.length < 1 ||
    definition.slots.length > 12
  ) {
    throw new Error("Un combo debe tener entre 1 y 12 opciones.");
  }
  const slotIds = new Set<string>();
  for (const slot of definition.slots) {
    if (!slot.id || slot.id.length > 80 || slotIds.has(slot.id))
      throw new Error("Cada opción del combo necesita un identificador único.");
    slotIds.add(slot.id);
    if (!slot.name?.trim() || slot.name.trim().length > 80)
      throw new Error(
        "El nombre de cada opción debe tener entre 1 y 80 caracteres.",
      );
    if (
      !Number.isInteger(slot.quantity) ||
      slot.quantity < 1 ||
      slot.quantity > 99
    )
      throw new Error(
        "La cantidad de cada opción debe ser un entero entre 1 y 99.",
      );
    if (
      !Array.isArray(slot.productIds) ||
      slot.productIds.length < 1 ||
      slot.productIds.length > 100
    )
      throw new Error("Cada opción debe incluir entre 1 y 100 productos.");
    const ids = new Set<string>();
    for (const productId of slot.productIds) {
      if (!productId || ids.has(productId))
        throw new Error(
          "No se pueden repetir productos en una opción del combo.",
        );
      ids.add(productId);
      if (comboProductId === productId)
        throw new Error("Un combo no puede incluirse a sí mismo.");
      const product = products?.find((candidate) => candidate.id === productId);
      if (product?.comboDefinition)
        throw new Error("No se permiten combos anidados.");
    }
  }
}

export function calculateComboPrice(
  basePriceMinor: number,
  components: Array<{
    quantity: number;
    modifiers: Array<{ unitPriceMinorSnapshot: number }>;
  }>,
): number {
  if (!Number.isSafeInteger(basePriceMinor) || basePriceMinor < 0)
    throw new Error("El precio base debe ser un entero válido.");
  let total = basePriceMinor;
  for (const component of components) {
    if (
      !Number.isSafeInteger(component.quantity) ||
      component.quantity < 1 ||
      component.quantity > 99
    )
      throw new Error("La cantidad del componente no es válida.");
    for (const modifier of component.modifiers) {
      if (
        !Number.isSafeInteger(modifier.unitPriceMinorSnapshot) ||
        modifier.unitPriceMinorSnapshot < 0
      )
        throw new Error("El precio extra no es válido.");
      total += component.quantity * modifier.unitPriceMinorSnapshot;
      if (!Number.isSafeInteger(total))
        throw new Error("El precio total del combo excede el máximo seguro.");
    }
  }
  return total;
}

/** Check the line AND its order before stock or persistence can change. */
export function assertComboLineAmount(
  unitPriceMinor: number,
  quantity: number,
  otherSubtotalMinor = 0,
  deliveryFeeMinor = 0,
): void {
  for (const value of [
    unitPriceMinor,
    quantity,
    otherSubtotalMinor,
    deliveryFeeMinor,
  ])
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error("El importe del combo excede el rango seguro.");
  const maximum = BigInt(Number.MAX_SAFE_INTEGER);
  if (
    quantity < 1 ||
    BigInt(quantity) * 99n * 1000n > maximum ||
    BigInt(unitPriceMinor) * BigInt(quantity) +
      BigInt(otherSubtotalMinor) +
      BigInt(deliveryFeeMinor) >
      maximum
  )
    throw new Error("El importe del combo excede el rango seguro.");
}
