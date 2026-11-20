/** Estimated prefix heights; measurements replace only the relevant product. */
export function catalogOffsets(rows: readonly { product: { id: string } }[], heights: ReadonlyMap<string, number>) {
  const offsets = [0];
  for (const { product } of rows) offsets.push(offsets[offsets.length - 1]! + (heights.get(product.id) ?? 60));
  return offsets;
}

export function catalogWindow(offsets: number[], scroll: number, height: number) {
  const n = offsets.length - 1;
  if (n <= 60) return {start: 0, end: n, top: 0, bottom: 0};
  const total = offsets[n]!;
  const y = Math.max(0, Math.min(scroll, total - height));
  function rowAt(px: number) {
    let lo = 0, hi = n;
    while (lo < hi) {
      const mid = Math.floor((lo + hi + 1) / 2);
      if (offsets[mid]! <= px) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }
  const start = Math.max(0, rowAt(y) - 8);
  const end = Math.min(n, rowAt(y + height) + 9);
  return {start, end, top: offsets[start]!, bottom: total - offsets[end]!};
}
