import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationOptions,
} from "@tanstack/react-query";
import { useRef } from "react";
import type { BootstrapDto, DeliveryProjectionDto, OrderDto } from "@gastronomy/contracts";
import { bootstrapKey, updateDraftOrderCache } from "./order-entry-cache";
import { applySecondRoundOrderCache } from "./order-round-cache";
import { applyDeliveryProjection, type DeliveryAction } from "./delivery-operation-cache";
import { applyTakeawayFinanceProjection } from "./finance-reconciliation-cache";

export { bootstrapKey } from "./order-entry-cache";

type ApiMutationOptions<TData, TVariables> = Omit<
  UseMutationOptions<TData, Error, TVariables>,
  "mutationFn"
> & {
  applyBootstrapResult?: (
    data: TData,
    variables: TVariables,
  ) => boolean | Promise<boolean>;
};

export function useBootstrap() {
  return useQuery<BootstrapDto>({
    queryKey: bootstrapKey,
    // Bootstrap reads the on-device store, even when the network is offline.
    networkMode: "always",
    queryFn: () => {
      if (!window.gastronomy)
        throw new Error(
          "Abrí esta interfaz desde la aplicación de escritorio.",
        );
      return window.gastronomy.bootstrap({ deliveryScope: "OPERATIONAL" });
    },
  });
}

/** Reconcile a confirmed DINE_IN payment that keeps the table open (tables row unchanged). */
function applyDineInPaymentProjection(
  client: QueryClient,
  before: BootstrapDto,
  old: OrderDto,
  saved: OrderDto,
  delta: DeliveryProjectionDto,
): boolean {
  const state = client.getQueryState<BootstrapDto>(bootstrapKey);
  const cashId = before.cashSession?.id;
  const paymentChanged =
    old.paymentStatus !== saved.paymentStatus ||
    old.paidMinor !== saved.paidMinor;
  const statusChanged = old.operationalStatus !== saved.operationalStatus;
  if (
    state?.data !== before ||
    state.isInvalidated ||
    state.fetchStatus !== "idle" ||
    old.type !== "DINE_IN" ||
    old.lifecycleStatus !== "CONFIRMED" ||
    old.version === undefined ||
    saved.id !== old.id ||
    saved.type !== "DINE_IN" ||
    saved.lifecycleStatus !== "CONFIRMED" ||
    saved.version === undefined ||
    saved.version !== old.version + 1 ||
    !paymentChanged ||
    statusChanged ||
    saved.operationalStatus === "DELIVERED" ||
    saved.operationalStatus === "CANCELLED" ||
    saved.tableId !== old.tableId ||
    saved.totalMinor !== old.totalMinor ||
    saved.waiterUserId !== old.waiterUserId ||
    saved.customerId !== old.customerId ||
    (old.tableId != null &&
      !before.tables.some(
        (table) =>
          table.id === old.tableId &&
          table.currentOrderId === old.id &&
          table.currentTotalMinor === saved.totalMinor,
      )) ||
    delta.order.id !== old.id ||
    JSON.stringify(saved) !== JSON.stringify(delta.order) ||
    !cashId ||
    before.cashSession?.status !== "OPEN" ||
    delta.openCashSessionId !== cashId ||
    delta.cashSessionId !== cashId ||
    (old.cashSessionPaidId ?? old.cashSessionCreatedId) !== cashId ||
    saved.cashSessionPaidId !== cashId ||
    delta.financials?.cashSession.id !== cashId
  ) {
    return false;
  }
  const index = before.orders.indexOf(old);
  if (index < 0) return false;
  const orders = before.orders.slice();
  orders[index] = saved;
  client.setQueryData<BootstrapDto>(bootstrapKey, {
    ...before,
    orders,
    cashSession: delta.financials.cashSession,
    dashboard: delta.financials.dashboard,
  });
  return true;
}

export function useOrderDispatchMutation<T extends { orderId: string }>(
  mutationFn: (variables: T) => Promise<OrderDto>,
  action: DeliveryAction | "payment" | null,
  options: Omit<ApiMutationOptions<OrderDto, T>, "applyBootstrapResult"> = {},
) {
  const client = useQueryClient();
  const snapshots = useRef(new WeakMap<T, BootstrapDto>());
  return useApiMutation(mutationFn, {
    ...options,
    retry: false,
    onMutate: (variables, context) => {
      const state = client.getQueryState<BootstrapDto>(bootstrapKey);
      if (action && state?.data && !state.isInvalidated && state.fetchStatus === "idle")
        snapshots.current.set(variables, state.data);
      return options.onMutate?.(variables, context);
    },
    applyBootstrapResult: async (saved, variables) => {
      const before = snapshots.current.get(variables);
      snapshots.current.delete(variables);
      const old = before?.orders.find(order => order.id === variables.orderId);
      if (!action || !before || before !== client.getQueryData(bootstrapKey) ||
          old?.lifecycleStatus !== "CONFIRMED" || old.version === undefined) return false;
      const handoff = action === "state" && saved.operationalStatus === "DELIVERED";
      if (old.type === "TAKEAWAY" && (action === "payment" || action === "complete" || handoff)) {
        const delta = await window.gastronomy.getDeliveryProjection({ orderId: old.id, includeFinancials: true });
        const operation = action === "state" ? "deliver" : action === "payment" ? "payment" : "complete";
        if (!applyTakeawayFinanceProjection(client, before, old, saved, delta, operation)) return false;
      } else if (old.type === "DINE_IN" && action === "payment") {
        const delta = await window.gastronomy.getDeliveryProjection({ orderId: old.id, includeFinancials: true });
        if (!applyDineInPaymentProjection(client, before, old, saved, delta)) return false;
      } else if (old.type === "DELIVERY" && action !== "payment") {
        const delta = await window.gastronomy.getDeliveryProjection({
          orderId: old.id, previousDriverId: old.driverUserId, includeFinancials: action === "complete" || handoff,
        });
        if (!applyDeliveryProjection(client, before, old, saved, delta, action)) return false;
      } else return false;
      // No delivery ledger/history changed for a pickup or dine-in payment.
      if (old.type === "TAKEAWAY" || old.type === "DINE_IN")
        await client.invalidateQueries({ queryKey: [...bootstrapKey, "historical-editor", old.id], exact: true });
      else
        await client.invalidateQueries({ queryKey: bootstrapKey, predicate: query => query.queryKey.length > 1 });
      return true;
    },
  });
}

export function useApiMutation<TData, TVariables>(
  mutationFn: (variables: TVariables) => Promise<TData>,
  options: ApiMutationOptions<TData, TVariables> = {},
) {
  const queryClient = useQueryClient();
  const { applyBootstrapResult, ...mutationOptions } = options;
  return useMutation<TData, Error, TVariables>({
    mutationFn: (variables) => {
      if (
        variables &&
        typeof variables === "object" &&
        !("idempotencyKey" in variables)
      ) {
        (variables as any).idempotencyKey = crypto.randomUUID();
      }
      return mutationFn(variables);
    },
    ...mutationOptions,
    onSuccess: async (data, variables, onMutateResult, context) => {
      // Cache reconciliation happens after the write committed. Never retry a
      // successful sale because an old bridge or a targeted read failed.
      let applied = false;
      if (applyBootstrapResult) {
        try {
          applied = await applyBootstrapResult(data, variables);
        } catch {
          /* fall back to the authoritative full read */
        }
      }
      if (!applied) {
        await queryClient.invalidateQueries({ queryKey: bootstrapKey });
      }
      await options.onSuccess?.(data, variables, onMutateResult, context);
    },
    onError: async (error, variables, onMutateResult, context) => {
      await queryClient.invalidateQueries({ queryKey: bootstrapKey });
      await options.onError?.(error, variables, onMutateResult, context);
    },
  });
}

/** Opt-in ONLY for item add/remove/quantity/notes/modifiers. The same hook keeps
 * a full refresh for ambiguous edits. Only a simple confirmed dine-in addition
 * opts in to its authoritative second-round projection. */
export function useOrderEntryMutation<TVariables extends { orderId: string }>(
  mutationFn: (variables: TVariables) => Promise<OrderDto>,
  options: Omit<
    ApiMutationOptions<OrderDto, TVariables>,
    "applyBootstrapResult"
  > & { secondRound?: boolean } = {},
) {
  const queryClient = useQueryClient();
  const snapshots = useRef(
    new WeakMap<TVariables, { order?: OrderDto; bootstrap?: BootstrapDto }>(),
  );
  const { secondRound, ...mutationOptions } = options;
  return useApiMutation(mutationFn, {
    ...mutationOptions,
    onMutate: (variables, context) => {
      const bootstrap = queryClient.getQueryData<BootstrapDto>(bootstrapKey);
      snapshots.current.set(variables, {
        bootstrap,
        order: bootstrap?.orders.find(
          (order) => order.id === variables.orderId,
        ),
      });
      return options.onMutate?.(variables, context);
    },
    applyBootstrapResult: async (updated, variables) => {
      const snapshot = snapshots.current.get(variables);
      snapshots.current.delete(variables);
      if (
        secondRound &&
        snapshot?.bootstrap &&
        snapshot.order?.type === "DINE_IN" &&
        snapshot.order.lifecycleStatus === "CONFIRMED" &&
        snapshot.order.version !== undefined &&
        snapshot.bootstrap === queryClient.getQueryData(bootstrapKey)
      ) {
        const delta = await window.gastronomy.getOrderPrintState({
          orderId: variables.orderId,
          includeConfirmation: true,
        });
        return applySecondRoundOrderCache(
          queryClient,
          snapshot.bootstrap,
          snapshot.order,
          delta,
          updated,
          variables as TVariables & { productId: string },
        );
      }
      return updateDraftOrderCache(queryClient, snapshot?.order, updated);
    },
  });
}
