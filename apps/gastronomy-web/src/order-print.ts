import { createStore } from "zustand/vanilla";
import type { DesktopApi, KitchenPrintScope } from "@gastronomy/contracts";

export type OrderPrintRequest = {
  orderId: string;
  orderNumber: number;
  kind: "KITCHEN_ORDER" | "CUSTOMER_BILL";
  kitchenScope?: KitchenPrintScope;
  confirmFirst?: boolean;
  retryJobId?: string;
};
export type OrderPrintState = OrderPrintRequest & {
  status: "PREPARING" | "PRINTING" | "PRINTED" | "SKIPPED" | "FAILED";
  error?: string;
  resultJobId?: string;
  notificationDismissed?: boolean;
};
export function isOrderPrintActive(job?: OrderPrintState) {
  return job?.status === "PREPARING" || job?.status === "PRINTING";
}

/** Lives beyond any editor/page. Closing a dialog never cancels a native print. */
export function createOrderPrintCoordinator(
  api: Pick<DesktopApi, "confirmOrder" | "printOrder" | "retryPrint">,
) {
  const store = createStore<{ jobs: Record<string, OrderPrintState> }>(() => ({
    jobs: {},
  }));
  const active = new Map<string, Promise<{ jobId: string; status: string }>>();
  const setJob = (job: OrderPrintState) =>
    store.setState(({ jobs }) => {
      const completed = Object.values(jobs).filter(
        (item) => !isOrderPrintActive(item) && item.orderId !== job.orderId,
      );
      const remove = new Set(
        completed
          .slice(0, Math.max(0, completed.length - 19))
          .map((item) => item.orderId),
      );
      return {
        jobs: {
          ...Object.fromEntries(
            Object.entries(jobs)
              .filter(([id]) => !remove.has(id) && id !== job.orderId)
              .map(([id, previous]) => [
                id,
                !isOrderPrintActive(job) && !isOrderPrintActive(previous)
                  ? { ...previous, notificationDismissed: true }
                  : previous,
              ]),
          ),
          [job.orderId]: job,
        },
      };
    });
  return {
    store,
    dismiss(orderId: string) {
      store.setState(({ jobs }) => {
        const job = jobs[orderId];
        if (!job || isOrderPrintActive(job)) return { jobs };
        return {
          jobs: { ...jobs, [orderId]: { ...job, notificationDismissed: true } },
        };
      });
    },
    run(input: OrderPrintRequest, afterConfirmation?: () => void) {
      const existing = active.get(input.orderId);
      if (existing) return existing;
      setJob({
        ...input,
        status: input.confirmFirst ? "PREPARING" : "PRINTING",
      });
      // Defer execution until the single-flight guard is registered, even for synchronous errors.
      const result = Promise.resolve()
        .then(async () => {
          if (input.confirmFirst) {
            await api.confirmOrder({ orderId: input.orderId });
            afterConfirmation?.();
            setJob({ ...input, status: "PRINTING" });
          }
          const result = input.retryJobId
            ? await api.retryPrint({ jobId: input.retryJobId })
            : await api.printOrder({
                orderId: input.orderId,
                kind: input.kind,
                ...(input.kitchenScope
                  ? { kitchenScope: input.kitchenScope }
                  : {}),
              });
          setJob({
            ...input,
            resultJobId: result.jobId,
            status: result.status === "SKIPPED" ? "SKIPPED" : "PRINTED",
          });
          return result;
        })
        .catch((error: unknown) => {
          setJob({
            ...input,
            status: "FAILED",
            error:
              error instanceof Error ? error.message : "Falló la impresión.",
          });
          throw error;
        })
        .finally(() => active.delete(input.orderId));
      active.set(input.orderId, result);
      return result;
    },
  };
}

export const orderPrintCoordinator = createOrderPrintCoordinator({
  confirmOrder: (input) => window.gastronomy.confirmOrder(input),
  printOrder: (input) => window.gastronomy.printOrder(input),
  retryPrint: (input) => window.gastronomy.retryPrint(input),
});
