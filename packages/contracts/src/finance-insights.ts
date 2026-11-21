import type { FinanceExpenseDto } from "./index";

/** A payment or refund event attached to the originating commercial order. */
export interface FinanceMoneyMovementDto {
  id: string;
  kind: "PAYMENT" | "REFUND" | "CHANGE";
  amountMinor: number;
  businessDate: string;
  occurredAt: string;
  paymentMethodCode: string | null;
  paymentMethodName: string | null;
  reason: string | null;
}

export interface FinanceOrderMoneyDetailDto {
  orderId: string;
  orderNumber: number;
  businessDate: string;
  type: string;
  totalMinor: number;
  depositMinor: number;
  discountMinor: number;
  collectedMinor: number;
  refundedMinor: number;
  recoveredMinor: number;
  effectiveRefundMinor?: number;
  netCollectedMinor: number;
  netSalesMinor: number;
  movements: FinanceMoneyMovementDto[];
  productSales?: Array<{
    productId: string | null;
    productName: string;
    salesMinor: number;
  }>;
}

export interface FinanceProductMarginDto {
  productId: string | null;
  productName: string;
  quantity: number;
  salesMinor: number;
  cogsMinor: number;
  grossMarginMinor: number;
  unknownCostSalesMinor: number;
  lineCount: number;
}

export interface FinanceChannelMarginDto {
  channel: string;
  salesMinor: number;
  cogsMinor: number;
  deliveryCostsMinor: number;
  grossMarginMinor: number;
  orderCount: number;
}

export interface FinanceUnknownCostOrderDto {
  orderId: string;
  orderNumber: number;
  businessDate: string;
  unknownCostSalesMinor: number;
  lineIds: string[];
  productNames: string[];
}

export interface FinanceInsightsDto {
  orderMoneyDetails: FinanceOrderMoneyDetailDto[];
  productMargins: FinanceProductMarginDto[];
  channelMargins: FinanceChannelMarginDto[];
  unknownCostSalesMinor: number;
  commercialRefundsMinor?: number;
  unknownCostOrders: FinanceUnknownCostOrderDto[];
  /** Unpaid items due before or shortly after the selected period, regardless of incurred date. */
  dueAgenda: FinanceExpenseDto[];
  paidAgenda: FinanceExpenseDto[];
}
