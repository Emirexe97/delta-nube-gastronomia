import type { CashSessionDto, OrderDto, OrderType } from "./index";

export type ShiftAuditSection = "orders" | "movements" | "deliveries";
export interface ShiftAuditInput {
  cashSessionId: string;
  section: ShiftAuditSection;
  search?: string;
  page?: number;
  pageSize?: number;
}
export interface ShiftOrderAuditInput {
  cashSessionId: string;
  orderId: string;
}
export interface ShiftAuditOrder {
  orderId: string;
  number: number;
  type: OrderType;
  status: string;
  customerName: string | null;
  driverName: string | null;
  totalMinor: number;
  collectedMinor: number;
  reasons: string[];
  deliveryFeeMinor?: number;
  driverPayMinor?: number;
  settlementLabel?: string;
  hasClosingSnapshot?: boolean;
}
export interface ShiftAuditEvent {
  id: string;
  occurredAt: string;
  cashSessionId: string | null;
  sessionNumber: number | null;
  orderId: string | null;
  orderNumber: number | null;
  label: string;
  method: string | null;
  amountMinor: number | null;
  cashEffectMinor: number | null;
  operator: string | null;
  authorizer?: string | null;
  receivedMinor?: number | null;
  reference?: string | null;
  reason: string | null;
}
export interface ShiftAuditDto {
  session: CashSessionDto;
  orders: ShiftAuditOrder[];
  movements: ShiftAuditEvent[];
  page: number;
  pageSize: number;
  totalCount: number;
}
export interface ShiftOrderAuditDto {
  session: CashSessionDto;
  order: OrderDto;
  /** Copy stored on closing. Legacy shifts with insufficient evidence return null. */
  orderAtClose: OrderDto | null;
  events: ShiftAuditEvent[];
}
