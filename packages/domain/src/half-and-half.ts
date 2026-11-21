import type {
  CategoryDto,
  CategoryHalfAndHalfConfig,
  HalfAndHalfAssignment,
  HalfAndHalfGroupDto,
  ProductDto,
} from "@gastronomy/contracts";

export function normalizeHalfAndHalfConfig(
  input: CategoryHalfAndHalfConfig,
  current?: CategoryHalfAndHalfConfig,
): Required<CategoryHalfAndHalfConfig> {
  const source = input.halfAndHalfGroups ?? current?.halfAndHalfGroups ?? [];
  if (!Array.isArray(source)) throw new Error("Los grupos de mitades no son válidos.");
  const ids = new Set<string>();
  const names = new Set<string>();
  const halfAndHalfGroups = source.map((group) => {
    const name = typeof group?.name === "string" ? group.name.trim() : "";
    if (!name || typeof group.id !== "string" || !group.id.trim())
      throw new Error("Cada grupo de mitades necesita un nombre válido.");
    const normalizedName = name.toLocaleLowerCase("es-AR");
    if (ids.has(group.id) || names.has(normalizedName))
      throw new Error("Los grupos de mitades deben tener nombres distintos.");
    if (group.pricingMode !== undefined && group.pricingMode !== "HALF_PLUS_HALF" && group.pricingMode !== "MOST_EXPENSIVE")
      throw new Error("La regla de precio del grupo de mitades no es válida.");
    ids.add(group.id);
    names.add(normalizedName);
    return { id: group.id, name, ...(group.pricingMode === undefined ? {} : { pricingMode: group.pricingMode }) };
  });
  const previousDefault = current?.defaultHalfAndHalfGroupId ?? null;
  const defaultHalfAndHalfGroupId = input.defaultHalfAndHalfGroupId !== undefined
    ? input.defaultHalfAndHalfGroupId
    : previousDefault && ids.has(previousDefault) ? previousDefault : null;
  if (defaultHalfAndHalfGroupId !== null && !ids.has(defaultHalfAndHalfGroupId))
    throw new Error("El grupo predeterminado debe pertenecer a la categoría.");
  return { halfAndHalfGroups, defaultHalfAndHalfGroupId };
}

export function validateHalfAndHalfAssignment(
  assignment: HalfAndHalfAssignment,
  groups: readonly HalfAndHalfGroupDto[],
) {
  if (assignment?.mode === "INHERIT" || assignment?.mode === "DISABLED") return;
  if (assignment?.mode !== "GROUP" || !groups.some(({ id }) => id === assignment.groupId))
    throw new Error("Elegí un grupo de mitades de la categoría del producto.");
}

export function resolveHalfAndHalfGroup(
  category: CategoryDto | undefined,
  product: Pick<ProductDto, "active" | "comboDefinition" | "halfAndHalf">,
): HalfAndHalfGroupDto | undefined {
  if (!category?.active || !product.active || product.comboDefinition || product.halfAndHalf?.mode === "DISABLED")
    return undefined;
  const id = product.halfAndHalf?.mode === "GROUP" ? product.halfAndHalf.groupId : category.defaultHalfAndHalfGroupId;
  return category.halfAndHalfGroups?.find((group) => group.id === id);
}

interface HalfAndHalfCandidate {
  id: string;
  categoryId: string;
  halfAndHalfGroupId?: string | null;
}

export function canCombineHalves(first: HalfAndHalfCandidate, second: HalfAndHalfCandidate) {
  return first.id !== second.id && first.categoryId === second.categoryId
    && Boolean(first.halfAndHalfGroupId) && first.halfAndHalfGroupId === second.halfAndHalfGroupId;
}

export function halfAndHalfItemName(groupName: string, firstName: string, secondName: string) {
  return `${groupName} mitad y mitad · ${firstName} / ${secondName}`;
}

interface LegacyHalfProduct {
  id: string;
  name: string;
  parentProductId?: string | null;
}

// Used once for existing catalogs. Mixed or unrecognized formats stay unassigned.
export function legacyPizzaGroups(categoryName: string, products: LegacyHalfProduct[]) {
  const isPizzaCategory = /^pizzas?$/i.test(categoryName.trim());
  const pizzaProducts = products.filter((product) => isPizzaCategory || /\bpizzas?\b/i.test(product.name));
  const formatsByProduct = pizzaProducts.map((product) => ({
    product,
    format: product.name.toLocaleLowerCase("es-AR")
      .match(/\b(?:individual|chic[ao]|median[ao]|grande|familiar|\d+\s*(?:cm|porciones))\b/g)
      ?.map((part) => part.replace(/(\d+)\s*(cm|porciones)/, "$1 $2").replace(/chico|mediano/, (size) => size.slice(0, -1) + "a"))
      .sort().join(" · "),
  }));
  const isSingleUnspecifiedFormat = isPizzaCategory && !formatsByProduct.some(({ product, format }) => format || product.parentProductId);
  const plans = new Map<string, string[]>();
  for (const { product, format } of formatsByProduct) {
    if (!format && !isSingleUnspecifiedFormat) continue;
    const name = format ? `Pizza ${format}` : "Pizza";
    const ids = plans.get(name) ?? [];
    ids.push(product.id);
    plans.set(name, ids);
  }
  return [...plans].map(([name, productIds], index) => ({
    group: { id: `legacy-pizza-${index + 1}`, name },
    productIds,
  }));
}
