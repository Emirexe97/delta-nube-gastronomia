import type {
  BootstrapDto,
  DeliveryLedgerDto,
  DriverDeliveryActivityDto,
} from "@gastronomy/contracts";

export type DeliveryHistoryScope = "CURRENT_SHIFT" | "DATE" | "ALL";

export function localDateKey(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function filterDriverDeliveryActivity(
  activity: DriverDeliveryActivityDto[],
  cashSession: BootstrapDto["cashSession"],
  scope: DeliveryHistoryScope,
  selectedDate: string,
) {
  if (scope === "ALL") return activity;
  if (scope === "DATE")
    return activity.filter((row) => row.businessDate === selectedDate);
  if (!cashSession) return [];
  return activity.filter((row) => row.cashSessionId === cashSession.id);
}

export function filterDeliveryLedger(
  ledger: DeliveryLedgerDto[],
  cashSession: BootstrapDto["cashSession"],
  scope: DeliveryHistoryScope,
  selectedDate: string,
) {
  if (scope === "ALL") return ledger;
  if (scope === "DATE")
    return ledger.filter((row) => row.businessDate === selectedDate);
  if (!cashSession) return [];
  return ledger.filter((row) => row.cashSessionId === cashSession.id);
}
