import { describe, expect, it, vi } from "vitest";
import type {
  BootstrapDto,
  CashSessionReportDto,
  DetailedReportDto,
} from "@gastronomy/contracts";
import { answerPosQuestion, POS_ASSISTANT_QUESTIONS } from "./pos-assistant";

const makeData = (
  permissions: string[] = ["reports.view", "cash.close", "payments.refund"],
  sessionValues: Record<string, unknown> = {},
) =>
  ({
    currentUser: { permissions },
    cashSession: {
      id: "session-1",
      number: 7,
      status: "OPEN",
      businessDate: "2026-11-06",
      ...sessionValues,
    },
    dashboard: {
      salesTotalMinor: 999999,
      orderCount: 100,
      averageTicketMinor: 9999,
      openOrderCount: 99,
    },
    orders: [
      {
        id: "a",
        cashSessionCreatedId: "session-1",
        lifecycleStatus: "CONFIRMED",
        operationalStatus: "IN_PREPARATION",
      },
      {
        id: "b",
        cashSessionCreatedId: "session-other",
        lifecycleStatus: "CONFIRMED",
        operationalStatus: "READY",
      },
      {
        id: "c",
        cashSessionCreatedId: "session-1",
        lifecycleStatus: "CONFIRMED",
        operationalStatus: "DELIVERED",
      },
      {
        id: "d",
        cashSessionCreatedId: "session-1",
        lifecycleStatus: "DRAFT",
        operationalStatus: "PENDING",
      },
    ],
  }) as unknown as BootstrapDto;
const detailed = (overrides: Partial<DetailedReportDto> = {}) =>
  ({
    salesTotalMinor: 125000,
    orderCount: 5,
    averageTicketMinor: 25000,
    byPaymentMethod: [{ name: "Efectivo", amountMinor: 10000 }],
    byProduct: [
      { name: "Pizza", quantity: 4, amountMinor: 40000 },
      { name: "Empanada", quantity: 2, amountMinor: 5000 },
    ],
    cash: { sessions: [] },
    ...overrides,
  }) as DetailedReportDto;
const cashReport = (differenceMinor: number | null): CashSessionReportDto =>
  ({
    totals: { salesMinor: 50000 },
    session: { number: 7, differenceMinor },
  }) as unknown as CashSessionReportDto;

describe("POS assistant", () => {
  it("offers ten questions across caja, ventas, operación and guía", () => {
    expect(POS_ASSISTANT_QUESTIONS).toHaveLength(10);
    expect(
      new Set(POS_ASSISTANT_QUESTIONS.map((item) => item.category)),
    ).toEqual(new Set(["caja", "ventas", "operacion", "guia"]));
  });

  it("requires the listed permissions before every monetary query, including inline session totals", async () => {
    const detailedReport = vi.fn(async () => detailed());
    const cashReportFn = vi.fn(async () => cashReport(0));
    for (const id of [
      "cash-sales",
      "cash-difference",
      "sales-today",
      "sales-ticket",
      "sales-payment",
      "sales-products",
    ]) {
      const answer = await answerPosQuestion(id, {
        data: makeData([]),
        getDetailedReport: detailedReport,
        getCashSessionReport: cashReportFn,
      });
      expect(answer.source, id).toBe("permission");
    }
    expect(detailedReport).not.toHaveBeenCalled();
    expect(cashReportFn).not.toHaveBeenCalled();
  });

  it("uses the selected session's sales, not dashboard aggregate, after authorization", async () => {
    const getCashSessionReport = vi.fn(async () => cashReport(0));
    const result = await answerPosQuestion("cash-sales", {
      data: makeData(),
      getCashSessionReport,
    });
    expect(result.answer).toContain("$ 500");
    expect(getCashSessionReport).toHaveBeenCalledWith({
      cashSessionId: "session-1",
    });
  });

  it("uses business date reports, never a possibly stale dashboard date", async () => {
    const getDetailedReport = vi.fn(async () => detailed());
    const context = { data: makeData(), getDetailedReport };
    await answerPosQuestion("sales-today", context);
    await answerPosQuestion("sales-ticket", context);
    expect(getDetailedReport).toHaveBeenNthCalledWith(1, {
      dateFrom: "2026-11-06",
      dateTo: "2026-11-06",
    });
    expect(getDetailedReport).toHaveBeenNthCalledWith(2, {
      dateFrom: "2026-11-06",
      dateTo: "2026-11-06",
    });
  });

  it("uses the shared POS count semantics for orders associated with the current cash session", async () => {
    const result = await answerPosQuestion("ops-pending", { data: makeData() });
    expect(result.answer).toContain("2 pedidos");
  });

  it("summarizes closed cash sessions as short, over or exact", async () => {
    const sessions = [
      {
        number: 7,
        businessDate: "2026-11-06",
        status: "CLOSED",
        differenceMinor: -250,
      },
      {
        number: 8,
        businessDate: "2026-11-06",
        status: "CLOSED",
        differenceMinor: 300,
      },
      {
        number: 9,
        businessDate: "2026-11-06",
        status: "CLOSED",
        differenceMinor: 0,
      },
      {
        number: 10,
        businessDate: "2026-11-06",
        status: "OPEN",
        differenceMinor: null,
      },
    ];
    const getDetailedReport = vi.fn(async () =>
      detailed({ cash: { sessions } } as unknown as Partial<DetailedReportDto>),
    );
    const result = await answerPosQuestion("cash-difference", {
      data: makeData(),
      getDetailedReport,
    });
    expect(result.answer).toContain("faltante");
    expect(result.answer).toContain("sobrante");
    expect(result.answer).toContain("sin diferencia");
    expect(result.answer).not.toContain("Caja #10");
  });

  it("reports the seven-day product date range and keeps guide permissions precise", async () => {
    const getDetailedReport = vi.fn(async () => detailed());
    const result = await answerPosQuestion("sales-products", {
      data: makeData(),
      getDetailedReport,
    });
    expect(result.answer).toContain("31/10/2026 a 06/11/2026");
    expect(getDetailedReport).toHaveBeenCalledWith({
      dateFrom: "2026-10-31",
      dateTo: "2026-11-06",
    });
    expect(
      (await answerPosQuestion("guide-close", { data: makeData([]) })).source,
    ).toBe("permission");
    expect(
      (
        await answerPosQuestion("guide-refund", {
          data: makeData(["cash.income"]),
        })
      ).source,
    ).toBe("permission");
    expect(
      (
        await answerPosQuestion("guide-refund", {
          data: makeData(["payments.refund"]),
        })
      ).answer,
    ).toContain("PIN de autorización");
  });

  it("handles no session without requesting its report and unknown IDs", async () => {
    const data = makeData();
    data.cashSession = null;
    const getCashSessionReport = vi.fn(async () => cashReport(null));
    expect(
      (await answerPosQuestion("cash-sales", { data, getCashSessionReport }))
        .answer,
    ).toContain("No hay una caja actual");
    expect(getCashSessionReport).not.toHaveBeenCalled();
    expect((await answerPosQuestion("unsupported", { data })).source).toBe(
      "not_found",
    );
  });
});
