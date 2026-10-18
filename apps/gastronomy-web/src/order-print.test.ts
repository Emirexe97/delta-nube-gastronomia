import { describe, expect, it, vi } from "vitest";
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

describe("printing survives navigation without locking other work", () => {
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
    expect(coordinator.store.getState().jobs[request.orderId]).toBeUndefined();
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
