import type {
  BootstrapDto,
  ProductDto,
  WebOrderDraft,
} from "@gastronomy/contracts";

export function resolveWebOrderProduct(
  data: BootstrapDto,
  productRef: string,
): ProductDto | undefined {
  return data.products.find((product) => product.id === productRef);
}

export function currentPosUnitPrice(
  product: ProductDto | undefined,
  type: WebOrderDraft["type"],
): number {
  return (
    product?.prices.find((price) => price.priceListCode === type)
      ?.amountMinor ?? 0
  );
}

export function hasCurrentPosPrice(
  product: ProductDto | undefined,
  type: WebOrderDraft["type"],
): boolean {
  return product?.prices.some((price) => price.priceListCode === type) ?? false;
}

export function webDraftTotal(
  data: BootstrapDto,
  draft: WebOrderDraft,
): number {
  return (
    draft.items.reduce(
      (total, item) =>
        total +
        currentPosUnitPrice(
          resolveWebOrderProduct(data, item.productRef),
          draft.type,
        ) *
          item.quantity,
      0,
    ) + (draft.type === "DELIVERY" ? draft.deliveryFeeMinor : 0)
  );
}
