import { describe, expect, it } from "vitest";
import type {
  CashSessionDto,
  DeliveryLedgerDto,
  DriverDeliveryActivityDto,
} from "@gastronomy/contracts";
import {
  filterDeliveryLedger,
  filterDriverDeliveryActivity,
} from "./delivery-history";

const ledger = (id: string, cashSessionId: string, businessDate: string) =>
  ({ id, cashSessionId, businessDate }) as DeliveryLedgerDto;

describe("historial de repartidores", () => {
  const rows = [
    ledger("current", "cash-current", "2026-09-13"),
    ledger("previous", "cash-previous", "2026-09-12"),
  ];
  const cashSession = { id: "cash-current" } as CashSessionDto;

  it("muestra por defecto solamente movimientos cobrados en el turno actual", () => {
    expect(
      filterDeliveryLedger(rows, cashSession, "CURRENT_SHIFT", ""),
    ).toEqual([rows[0]]);
  });

  it("permite consultar una fecha o todo el historial", () => {
    expect(
      filterDeliveryLedger(rows, cashSession, "DATE", "2026-09-12"),
    ).toEqual([rows[1]]);
    expect(filterDeliveryLedger(rows, cashSession, "ALL", "")).toEqual(rows);
  });

  it("no mezcla el historial cuando no hay una caja abierta", () => {
    expect(filterDeliveryLedger(rows, null, "CURRENT_SHIFT", "")).toEqual([]);
  });

  it("aplica el mismo período a entregas aunque no tengan rendición", () => {
    const activity = rows as unknown as DriverDeliveryActivityDto[];
    expect(
      filterDriverDeliveryActivity(activity, cashSession, "CURRENT_SHIFT", ""),
    ).toEqual([activity[0]]);
  });
});
