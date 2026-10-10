export type SalonServiceOrder = {
  id: string;
  createdAt: string;
  servicePendingSince?: string | null;
  servedAt?: string | null;
  serviceRevision?: number;
};

export type ServiceAge = "neutral" | "pending" | "late";

/** Orders by original creation time (not the resettable service clock); equal timestamps preserve input order. */
export function sortByOldestService<T extends SalonServiceOrder>(orders: T[]): T[] {
  return orders
    .map((order, index) => ({ order, index }))
    .sort((left, right) => {
      const leftAt = Date.parse(left.order.createdAt);
      const rightAt = Date.parse(right.order.createdAt);
      const leftValid = Number.isFinite(leftAt);
      const rightValid = Number.isFinite(rightAt);
      if (leftValid !== rightValid) return leftValid ? -1 : 1;
      if (leftValid && rightValid && leftAt !== rightAt) return leftAt - rightAt;
      return left.index - right.index;
    })
    .map(({ order }) => order);
}

export function getServiceAge(order: SalonServiceOrder, now: number): ServiceAge {
  if (!order.servicePendingSince || order.servedAt) return "neutral";
  const pendingAt = Date.parse(order.servicePendingSince);
  if (!Number.isFinite(pendingAt)) return "neutral";
  const age = Math.max(0, now - pendingAt);
  if (age >= 35 * 60_000) return "late";
  if (age >= 15 * 60_000) return "pending";
  return "neutral";
}

export function formatServiceAge(order: SalonServiceOrder, now: number): string {
  if (!order.servicePendingSince || order.servedAt) return "Sin consumo";
  const pendingAt = Date.parse(order.servicePendingSince);
  if (!Number.isFinite(pendingAt)) return "Sin consumo";
  const minutes = Math.floor(Math.max(0, now - pendingAt) / 60_000);
  return `${minutes} min`;
}
