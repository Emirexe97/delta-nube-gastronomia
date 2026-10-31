import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createOrderPrintCoordinator,
  isOrderPrintActive,
  type OrderPrintRequest,
} from "./order-print";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const request: OrderPrintRequest = {
  orderId: "order-812",
  orderNumber: 812,
  kind: "KITCHEN_ORDER",
};
const result = { jobId: "job-1", status: "PRINTED" };
function fixture() {
  const pending = deferred<typeof result>();
  const api = {
    confirmOrder: vi.fn().mockResolvedValue({}),
    printOrder: vi.fn().mockReturnValue(pending.promise),
    retryPrint: vi.fn().mockReturnValue(pending.promise),
  };
  return { pending, api, coordinator: createOrderPrintCoordinator(api) };
}

describe("print notification timeout", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it.each(["PRINTED", "SKIPPED", "FAILED"])(
    "hides %s after six seconds without deleting the print result",
    async (status) => {
      const { coordinator, api } = fixture();
      if (status === "FAILED") {
        api.printOrder.mockRejectedValue(new Error("Impresora sin respuesta"));
        await expect(coordinator.run(request)).rejects.toThrow();
      } else {
        api.printOrder.mockResolvedValue({ ...result, status });
        await coordinator.run(request);
      }
      vi.advanceTimersByTime(5_999);
      expect(
        coordinator.store.getState().jobs[request.orderId]
          ?.notificationDismissed,
      ).not.toBe(true);
      vi.advanceTimersByTime(1);
      expect(coordinator.store.getState().jobs[request.orderId]).toMatchObject({
        status,
        notificationDismissed: true,
      });
    },
  );

  it("gives a repeated notice a fresh six seconds and preserves active printing", async () => {
    const { coordinator, api, pending } = fixture();
    api.printOrder.mockResolvedValueOnce(result);
    await coordinator.run(request);
    vi.advanceTimersByTime(4_000);
    const repeat = coordinator.run(request);
    vi.advanceTimersByTime(10_000);
    expect(coordinator.store.getState().jobs[request.orderId]).toMatchObject({
      status: "PRINTING",
    });
    expect(
      coordinator.store.getState().jobs[request.orderId]?.notificationDismissed,
    ).not.toBe(true);
    pending.resolve(result);
    await repeat;
    vi.advanceTimersByTime(5_999);
    expect(
      coordinator.store.getState().jobs[request.orderId]?.notificationDismissed,
    ).not.toBe(true);
    vi.advanceTimersByTime(1);
    expect(
      coordinator.store.getState().jobs[request.orderId]?.notificationDismissed,
    ).toBe(true);
  });

  it("restarts the timer even when the same result is printed again", async () => {
    const { coordinator, api } = fixture();
    api.printOrder.mockResolvedValue(result);
    await coordinator.run(request);
    vi.advanceTimersByTime(4_000);
    await coordinator.run(request);
    vi.advanceTimersByTime(2_000);
    expect(
      coordinator.store.getState().jobs[request.orderId]?.notificationDismissed,
    ).not.toBe(true);
    vi.advanceTimersByTime(4_000);
    expect(
      coordinator.store.getState().jobs[request.orderId]?.notificationDismissed,
    ).toBe(true);
  });
});

describe("printing survives navigation without locking other work", () => {
  it("forwards the selected kitchen scope and preserves it in the background state", async () => {
    const { coordinator, api, pending } = fixture();
    const print = coordinator.run({ ...request, kitchenScope: "ADDED" });
    await Promise.resolve();
    expect(api.printOrder).toHaveBeenCalledWith({
      orderId: request.orderId,
      kind: "KITCHEN_ORDER",
      kitchenScope: "ADDED",
    });
    pending.resolve(result);
    await print;
    expect(
      coordinator.store.getState().jobs[request.orderId]?.kitchenScope,
    ).toBe("ADDED");
  });
  it("keeps the pending request after editor unsubscribe/reopen and suppresses a second dispatch", async () => {
    const { coordinator, api, pending } = fixture();
    const unsubscribe = coordinator.store.subscribe(() => {});
    const first = coordinator.run(request);
    unsubscribe(); // closing/unmounting the editor must not cancel or forget a job
    expect(
      isOrderPrintActive(coordinator.store.getState().jobs[request.orderId]),
    ).toBe(true);
    expect(coordinator.run({ ...request, kind: "CUSTOMER_BILL" })).toBe(first);
    expect(coordinator.run({ ...request, retryJobId: "job-1" })).toBe(first);
    coordinator.dismiss(request.orderId);
    expect(coordinator.store.getState().jobs[request.orderId]).toBeDefined();
    await Promise.resolve();
    expect(api.printOrder).toHaveBeenCalledTimes(1);
    expect(api.retryPrint).not.toHaveBeenCalled();
    pending.resolve(result);
    await first;
    expect(coordinator.store.getState().jobs[request.orderId]?.status).toBe(
      "PRINTED",
    );
    coordinator.dismiss(request.orderId);
    expect(coordinator.store.getState().jobs[request.orderId]).toMatchObject({
      status: "PRINTED",
      notificationDismissed: true,
    });
  });

  it("hides an older result when replaced and never resurrects it after dismissal", async () => {
    const { coordinator, api } = fixture();
    api.printOrder.mockResolvedValue(result);
    await coordinator.run(request);
    await coordinator.run({
      ...request,
      orderId: "next-order",
      orderNumber: 813,
    });
    expect(
      coordinator.store.getState().jobs[request.orderId]?.notificationDismissed,
    ).toBe(true);
    coordinator.dismiss("next-order");
    expect(
      Object.values(coordinator.store.getState().jobs).filter(
        (job) => !job.notificationDismissed,
      ),
    ).toEqual([]);
    expect(coordinator.store.getState().jobs["next-order"]?.status).toBe(
      "PRINTED",
    );
    await coordinator.run({
      ...request,
      orderId: "next-order",
      orderNumber: 813,
    });
    expect(
      coordinator.store.getState().jobs["next-order"]?.notificationDismissed,
    ).toBeUndefined();
  });

  it("keeps saving protected until confirmation finishes, then releases the editor while printing", async () => {
    const { coordinator, api, pending } = fixture();
    const confirmation = deferred<never>();
    api.confirmOrder.mockReturnValue(confirmation.promise);
    const print = coordinator.run({ ...request, confirmFirst: true });
    expect(coordinator.store.getState().jobs[request.orderId]?.status).toBe(
      "PREPARING",
    );
    await Promise.resolve();
    expect(api.printOrder).not.toHaveBeenCalled();
    confirmation.resolve({} as never);
    await Promise.resolve();
    expect(coordinator.store.getState().jobs[request.orderId]?.status).toBe(
      "PRINTING",
    );
    pending.resolve(result);
    await print;
  });

  it("reports failure after navigation and permits only an explicit retry", async () => {
    const { coordinator, api, pending } = fixture();
    const print = coordinator.run(request);
    const failure = new Error("La impresora no respondió.");
    pending.reject(failure);
    await expect(print).rejects.toBe(failure);
    expect(coordinator.store.getState().jobs[request.orderId]).toMatchObject({
      status: "FAILED",
      error: failure.message,
    });
    expect(api.printOrder).toHaveBeenCalledTimes(1);
    api.retryPrint.mockResolvedValue(result);
    await coordinator.run({ ...request, retryJobId: "job-1" });
    expect(api.retryPrint).toHaveBeenCalledTimes(1);
    expect(api.retryPrint).toHaveBeenCalledWith({ jobId: "job-1" });
  });

  it("never prints if saving fails", async () => {
    const { coordinator, api } = fixture();
    api.confirmOrder.mockRejectedValue(new Error("No se pudo guardar."));
    await expect(
      coordinator.run({ ...request, confirmFirst: true }),
    ).rejects.toThrow("No se pudo guardar.");
    expect(api.printOrder).not.toHaveBeenCalled();
    expect(coordinator.store.getState().jobs[request.orderId]?.status).toBe(
      "FAILED",
    );
  });

  it("allows another order while one print awaits the driver and preserves cancellation", async () => {
    const { coordinator, api, pending } = fixture();
    api.printOrder
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce({ ...result, status: "SKIPPED" });
    const first = coordinator.run(request);
    await coordinator.run({ ...request, orderId: "other", orderNumber: 813 });
    expect(coordinator.store.getState().jobs.other?.status).toBe("SKIPPED");
    expect(
      isOrderPrintActive(coordinator.store.getState().jobs[request.orderId]),
    ).toBe(true);
    pending.resolve(result);
    await first;
  });
});
