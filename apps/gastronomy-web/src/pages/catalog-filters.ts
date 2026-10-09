import type { ProductDto } from "@gastronomy/contracts";

export type CatalogFilters = {
  categoryId: string;
  status: "all" | "active" | "inactive";
  cost: "all" | "with" | "without";
  stock: "all" | "out" | "low" | "untracked";
};

export type ProductCost = {
  unitCostMinor: number | null;
  source: "MANUAL" | "PURCHASE" | "UNKNOWN";
};
export type CatalogGroup = {
  parent: ProductDto;
  variants: ProductDto[];
  hasMatchingVariant: boolean;
  matchingIds: string[];
};

export function hasKnownCost(cost: ProductCost | undefined): boolean {
  return Boolean(
    cost && cost.source !== "UNKNOWN" && cost.unitCostMinor != null,
  );
}

export function matchesCatalogFilters(
  product: ProductDto,
  filters: CatalogFilters,
  costs: Map<string, ProductCost>,
): boolean {
  if (filters.categoryId && product.categoryId !== filters.categoryId)
    return false;
  if (filters.status === "active" && !product.active) return false;
  if (filters.status === "inactive" && product.active) return false;
  if (
    filters.cost !== "all" &&
    (!costs.has(product.id) ||
      hasKnownCost(costs.get(product.id)) !== (filters.cost === "with"))
  )
    return false;
  if (filters.stock === "untracked" && product.stockMinor != null) return false;
  if (
    filters.stock === "out" &&
    (product.stockMinor == null || product.stockMinor > 0)
  )
    return false;
  if (
    filters.stock === "low" &&
    (product.stockMinor == null ||
      product.stockMinMinor == null ||
      product.stockMinor >= product.stockMinMinor)
  )
    return false;
  return true;
}

export function buildFilteredCatalogGroups(
  products: ProductDto[],
  query: string,
  filters: CatalogFilters,
  costs: Map<string, ProductCost> = new Map(),
): CatalogGroup[] {
  const allIds = new Set(products.map((p) => p.id));
  const variantsByParent = new Map<string, ProductDto[]>();
  const parents: ProductDto[] = [];
  for (const product of products) {
    if (product.parentProductId && allIds.has(product.parentProductId)) {
      const siblings = variantsByParent.get(product.parentProductId) ?? [];
      siblings.push(product);
      variantsByParent.set(product.parentProductId, siblings);
    } else parents.push(product);
  }
  const groups: CatalogGroup[] = [];
  const hasStructuredFilters =
    Boolean(filters.categoryId) ||
    filters.status !== "all" ||
    filters.cost !== "all" ||
    filters.stock !== "all";
  for (const parent of parents) {
    const variants = variantsByParent.get(parent.id) ?? [];
    const parentMatches =
      matchesCatalogFilters(parent, filters, costs) &&
      matchesProductQuery(parent, query);
    const matchingVariants = variants.filter(
      (v) =>
        matchesCatalogFilters(v, filters, costs) &&
        matchesProductQuery(v, query),
    );
    const hasMatchingVariant = matchingVariants.length > 0;
    if (parentMatches || hasMatchingVariant) {
      const variantsToShow = parentMatches
        ? hasStructuredFilters
          ? variants.filter((v) => matchesCatalogFilters(v, filters, costs))
          : variants
        : matchingVariants;
      groups.push({
        parent,
        variants: variantsToShow,
        hasMatchingVariant: hasStructuredFilters
          ? !parentMatches && hasMatchingVariant
          : Boolean(query.trim()) && hasMatchingVariant,
        matchingIds: [
          ...(parentMatches ? [parent.id] : []),
          ...variantsToShow.map((v) => v.id),
        ],
      });
    }
  }
  return groups;
}

export function matchesProductQuery(
  product: ProductDto,
  query: string,
): boolean {
  if (!query.trim()) return true;
  return `${product.code ?? ""} ${product.name} ${product.categoryName}`
    .toLocaleLowerCase()
    .includes(query.trim().toLocaleLowerCase());
}
