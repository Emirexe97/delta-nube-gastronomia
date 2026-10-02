export function formatPromisedAt(promisedAt: string): { date: string; time: string } | null;
export function scheduledOrderBadge(order: { scheduled: boolean; promisedAt: string | null }): string;
