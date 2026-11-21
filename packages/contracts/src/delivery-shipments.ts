import type { BusinessDate, Id, IsoDateTime, MoneyMinor } from "./index";

export type DeliveryShipmentScope = "OPERATIONAL" | "DATE" | "ALL";
export type DeliveryShipmentStatus = "PENDING" | "SETTLED" | "NO_SETTLEMENT";

export interface DeliveryShipmentsInput {
  scope?: DeliveryShipmentScope;
  cashSessionId?: Id | null;
  businessDate?: BusinessDate;
  query?: string;
  driverUserId?: Id | "UNASSIGNED" | "ALL";
  status?: DeliveryShipmentStatus | "ALL";
  direction?: "DRIVER_OWES_BUSINESS" | "BUSINESS_OWES_DRIVER" | "ALL";
  page?: number;
  pageSize?: number;
}

export interface DeliveryShipmentDto {
  id: Id;
  orderId: Id;
  orderNumber: number;
  cashSessionId: Id | null;
  businessDate: BusinessDate | null;
  driverUserId: Id | null;
  driverName: string | null;
  customerName: string | null;
  deliveryAddress: string | null;
  orderCreatedAt: IsoDateTime;
  operationalStatus:
    | "PENDING"
    | "IN_PREPARATION"
    | "READY"
    | "OUT_FOR_DELIVERY"
    | "DELIVERED"
    | "CANCELLED";
  lifecycleStatus: "DRAFT" | "CONFIRMED";
  paymentStatus: "UNPAID" | "PARTIALLY_PAID" | "PAID";
  deliveryFeeMinor: MoneyMinor;
  /** Fee charged to the customer, independent from who receives it. */
  customerChargeMinor: MoneyMinor;
  /** Driver remuneration snapshot; never inferred from settlement movements. */
  /** Null means legacy order: apply the historical fee policy. */
  driverRemunerationMinor: MoneyMinor | null;
  agreedRemunerationMinor?: MoneyMinor | null;
  /** Sale funds physically collected by the driver, if applicable. */
  collectedByDriverMinor: MoneyMinor;
  restaurantAmountMinor: MoneyMinor;
  direction: "DRIVER_OWES_BUSINESS" | "BUSINESS_OWES_DRIVER";
  amountDueMinor: MoneyMinor;
  settledAmountMinor: MoneyMinor;
  status: DeliveryShipmentStatus;
  createdAt: IsoDateTime;
  settledAt: IsoDateTime | null;
}

export interface DeliveryShipmentsDto {
  items: DeliveryShipmentDto[];
  page: number;
  pageSize: number;
  totalCount: number;
  pageCount: number;
  hasNextPage: boolean;
  totals: {
    pendingCount: number;
    pendingAmountMinor: MoneyMinor;
    settledCount: number;
    settledAmountMinor: MoneyMinor;
    customerChargesMinor: MoneyMinor;
    driverRemunerationMinor: MoneyMinor;
    collectedByDriverMinor: MoneyMinor;
  };
}
