/** Finance subledger contract. Source references point at POS/purchase records; they never copy their stock or P&L effects. */
export type FinanceAccountKind = "cash" | "bank" | "wallet";
export interface FinanceAccountDto {
  id: string;
  name: string;
  kind: FinanceAccountKind;
  openingBalanceMinor: number;
  balanceMinor: number;
  active: boolean;
}
export interface FinancePaymentDto {
  id: string;
  obligationId: string;
  occurredAt: string;
  amountMinor: number;
  accountId: string;
  actorId: string;
  sourceRef?: FinanceSourceRef;
}
export interface FinanceSourceRef {
  type:
    | "purchase"
    | "pos_order"
    | "pos_payment"
    | "settlement_batch"
    | "expense"
    | "delivery";
  id: string;
}
export interface FinanceObligationDto {
  id: string;
  supplierId: string;
  supplierName: string;
  description: string;
  documentNumber?: string;
  purchaseRef: FinanceSourceRef;
  incurredAt: string;
  dueAt?: string;
  amountMinor: number;
  paidMinor: number;
  outstandingMinor: number;
  status: "open" | "partial" | "paid";
  currentPurchaseAmountMinor?: number;
  purchaseVarianceMinor?: number;
  creditBalanceMinor?: number;
  payments: FinancePaymentDto[];
}
export interface FinanceSettlementDto {
  id: string;
  sourceRef: FinanceSourceRef;
  paymentIds: string[];
  accountId: string;
  occurredAt: string;
  paymentAmountsMinor?: Record<string, number>;
  grossMinor: number;
  deductionsMinor: number;
  withheldMinor?: number;
  commissionMinor?: number;
  expectedNetMinor: number;
  actualNetMinor?: number;
  differenceMinor?: number;
  creditedAt?: string;
  reconciledAt?: string;
  status: "expected" | "credited" | "reconciled";
}
export interface FinanceInventoryCountDto {
  id: string;
  occurredAt: string;
  items: Array<{
    itemId: string;
    theoreticalQuantity: number;
    actualQuantity: number;
    wasteQuantity: number;
    unit: string;
    receivedQuantity?: number;
    actualUsage?: number;
    theoreticalUsage?: number;
    unexplainedUsage?: number;
  }>;
}
export interface FinanceAdjustmentDto {
  id: string;
  occurredAt: string;
  actorId: string;
  reason: string;
  amountMinor: number;
  targetRef: FinanceSourceRef;
}
export interface FinanceMonthlyClosureDto {
  id: string;
  month: string;
  closedAt: string;
  actorId: string;
  reason: string;
  adjustmentIds: string[];
  accountBalances: Record<string, number>;
  pnlSnapshot: {
    salesMinor: number;
    costOfGoodsMinor: number;
    payrollMinor: number;
    operatingExpensesMinor: number;
    netMinor: number;
  };
  status: "closed" | "adjusted";
}
export interface FinanceBooksDto {
  accounts: FinanceAccountDto[];
  obligations: FinanceObligationDto[];
  settlements: FinanceSettlementDto[];
  inventoryCounts: FinanceInventoryCountDto[];
  adjustments: FinanceAdjustmentDto[];
  monthlyClosures: FinanceMonthlyClosureDto[];
  appliedEventIds: string[];
  reversedEventIds: string[];
  entries: FinanceBookEvent[];
  sources: FinanceBookSources;
}
/** Server-resolved operational records. Adapters must fill these from POS/purchases, never client values. */
export interface FinanceBookSources {
  purchases: Array<{
    id: string;
    supplierId: string;
    supplierName: string;
    documentNumber?: string;
    occurredAt: string;
    totalMinor: number;
    status: "confirmed" | "cancelled";
    alreadyLinked?: boolean;
  }>;
  posPayments: Array<{
    id: string;
    orderId: string;
    orderNumber?: number;
    occurredAt: string;
    amountMinor: number;
    method: string;
    status: "captured" | "refunded" | "voided";
    alreadySettled: boolean;
  }>;
  theoreticalInventory: Array<{
    itemId: string;
    quantity: number;
    unit: string;
    name?: string;
    receivedQuantity?: number;
  }>;
  customerBalances?: Array<{
    id: string;
    name: string;
    outstandingMinor: number;
  }>;
  pnlByMonth?: Record<string, FinanceMonthlyClosureDto["pnlSnapshot"]>;
  adjustmentTargets?: Array<FinanceSourceRef & { occurredAt?: string }>;
  cashCategories?: Record<string, string>;
  recurringAmountsMinor?: Record<string, number>;
}
type WithoutPin<T> = T extends unknown ? Omit<T, "authorizerPin"> : never;
export interface FinanceBookEvent {
  id: string;
  idempotencyKey: string;
  actorId: string;
  actorName: string;
  createdAt: string;
  input: WithoutPin<FinanceEntryInput>;
  pnlSnapshot?: FinanceMonthlyClosureDto["pnlSnapshot"];
  accountBalancesSnapshot?: Record<string, number>;
}
export type FinanceEntryInput =
  | {
      idempotencyKey: string;
      authorizerPin: string;
      kind: "account_open";
      date: string;
      reason: string;
      account: Omit<FinanceAccountDto, "balanceMinor">;
    }
  | {
      idempotencyKey: string;
      authorizerPin: string;
      kind: "transfer";
      date: string;
      reason: string;
      fromAccountId: string;
      toAccountId: string;
      amountMinor: number;
    }
  | {
      idempotencyKey: string;
      authorizerPin: string;
      kind: "obligation";
      date: string;
      reason: string;
      obligation: Omit<
        FinanceObligationDto,
        "paidMinor" | "outstandingMinor" | "status" | "payments"
      >;
    }
  | {
      idempotencyKey: string;
      authorizerPin: string;
      kind: "obligation_payment";
      date: string;
      reason: string;
      obligationId: string;
      accountId: string;
      amountMinor: number;
    }
  | {
      idempotencyKey: string;
      authorizerPin: string;
      kind: "settlement_expected";
      date: string;
      reason: string;
      settlement: Omit<
        FinanceSettlementDto,
        | "actualNetMinor"
        | "differenceMinor"
        | "creditedAt"
        | "reconciledAt"
        | "status"
      >;
    }
  | {
      idempotencyKey: string;
      authorizerPin: string;
      kind: "settlement_credit";
      date: string;
      reason: string;
      settlementId: string;
      accountId: string;
      actualNetMinor: number;
    }
  | {
      idempotencyKey: string;
      authorizerPin: string;
      kind: "settlement_reconcile";
      date: string;
      reason: string;
      settlementId: string;
    }
  | {
      idempotencyKey: string;
      authorizerPin: string;
      kind: "inventory_count";
      date: string;
      reason: string;
      count: FinanceInventoryCountDto;
    }
  | {
      idempotencyKey: string;
      authorizerPin: string;
      kind: "adjustment";
      date: string;
      reason: string;
      amountMinor: number;
      targetRef: FinanceSourceRef;
      accountId?: string;
    }
  | {
      idempotencyKey: string;
      authorizerPin: string;
      kind: "month_close";
      date: string;
      reason: string;
      month: string;
    }
  | {
      idempotencyKey: string;
      authorizerPin: string;
      kind: "cash_category";
      date: string;
      reason: string;
      movementId: string;
      category: string;
      expectedCategory: string;
    }
  | {
      idempotencyKey: string;
      authorizerPin: string;
      kind: "recurring_rate";
      date: string;
      reason: string;
      recurringId: string;
      startMonth: string;
      amountMinor: number;
      expectedAmountMinor: number;
    }
  | {
      idempotencyKey: string;
      authorizerPin: string;
      kind: "reverse";
      date: string;
      reason: string;
      targetEventId: string;
    };
export interface FinanceBooksInput {
  from: string;
  to: string;
}
