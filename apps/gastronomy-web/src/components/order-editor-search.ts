import type { ProductDto } from "@gastronomy/contracts";
import { normalizeSearch } from "../lib";

export type ProductSearchIndexEntry = {
  product: ProductDto;
  index: number;
  code: string;
  name: string;
  category: string;
  haystack: string;
  variants: readonly {
    product: ProductDto;
    code: string;
    name: string;
  }[];
};

// Catalog DTOs are immutable cache snapshots. A stock change replaces one
// product, not the other 2,999: reuse their normalized text across snapshots.
const searchText = new WeakMap<ProductDto, { code: string; name: string; category: string }>();
function textFor(product: ProductDto) {
  let text = searchText.get(product);
  if (!text) {
    text = { code: normalizeSearch(product.code ?? ""), name: normalizeSearch(product.name),
      category: normalizeSearch(product.categoryName) };
    searchText.set(product, text);
  }
  return text;
}

/** Builds the searchable base-product index once per catalog snapshot. */
export function buildProductSearchIndex(
  products: readonly ProductDto[],
): ProductSearchIndexEntry[] {
  const productIds = new Set(products.map((product) => product.id));
  const variantsByParent = new Map<
    string,
    Array<{ product: ProductDto; code: string; name: string }>
  >();
  for (const variant of products) {
    if (
      !variant.parentProductId ||
      !variant.active ||
      !productIds.has(variant.parentProductId)
    )
      continue;
    const variants = variantsByParent.get(variant.parentProductId) ?? [];
    const text = textFor(variant);
    variants.push({
      product: variant,
      code: text.code,
      name: text.name,
    });
    variantsByParent.set(variant.parentProductId, variants);
  }

  return products
    .map((product, index) => {
      if (product.parentProductId && productIds.has(product.parentProductId))
        return null;
      const { code, name, category } = textFor(product);
      const variants: ProductSearchIndexEntry["variants"] =
        variantsByParent.get(product.id) ?? [];
      return {
        product,
        index,
        code,
        name,
        category,
        variants,
        haystack: `${code} ${name} ${variants.map((v) => v.code + " " + v.name).join(" ")} ${category}`,
      };
    })
    .filter((entry): entry is ProductSearchIndexEntry => entry !== null);
}

/** Search preserving rankProducts/order-editor ranking semantics. */
export function searchProductIndex(
  index: readonly ProductSearchIndexEntry[],
  query: string,
  categoryId: string | null = null,
  limit = 30,
): ProductDto[] {
  if (!query.trim()) {
    const first: ProductDto[] = [];
    for (const { product } of index) {
      if (first.length >= limit) break;
      if (product.active && (!categoryId || product.categoryId === categoryId))
        first.push(product);
    }
    return first;
  }
  const normalizedQuery = normalizeSearch(query);
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  return index
    .filter(
      ({ product }) =>
        product.active && (!categoryId || product.categoryId === categoryId),
    )
    .map((entry) => {
      if (!tokens.every((token) => entry.haystack.includes(token))) return null;

      let bestScore = 5;
      const candidates = [
        { code: entry.code, name: entry.name },
        ...entry.variants,
      ];
      for (const candidate of candidates) {
        const score =
          candidate.code === normalizedQuery
            ? 0
            : candidate.code.startsWith(normalizedQuery)
              ? 1
              : candidate.name.startsWith(normalizedQuery)
                ? 2
                : candidate.name
                      .split(/\s+/)
                      .some((word) => word.startsWith(normalizedQuery))
                  ? 3
                  : 4;
        if (score < bestScore) bestScore = score;
      }
      return { product: entry.product, score: bestScore, index: entry.index };
    })
    .filter(
      (entry): entry is { product: ProductDto; score: number; index: number } =>
        entry !== null,
    )
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.product);
}
