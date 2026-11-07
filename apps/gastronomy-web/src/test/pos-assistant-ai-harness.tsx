import { createElement } from "react";
import { createRoot } from "react-dom/client";
import type {
  BootstrapDto,
  DetailedReportDto,
  PosAssistantAiInput,
  PosAssistantAiResult,
  ReportFilters,
} from "@gastronomy/contracts";
import { PosAssistantMenu } from "../components/pos-assistant-menu";

const permissions = new URLSearchParams(location.search).get("permissions");
const data = {
  currentUser: {
    id: "harness-cashier",
    roleCode: "CASHIER",
    permissions: permissions === "limited" ? [] : ["reports.view"],
  },
  cashSession: {
    id: "harness-session",
    status: "OPEN",
    businessDate: "2026-11-07",
  },
  orders: [],
} as unknown as BootstrapDto;

const localReport = {
  salesTotalMinor: 12_345_600,
  orderCount: 3,
  averageTicketMinor: 4_115_200,
  byPaymentMethod: [],
  byProduct: [],
  cash: { sessions: [] },
} as unknown as DetailedReportDto;

type Harness = {
  aiCalls: PosAssistantAiInput[];
  reportCalls: ReportFilters[];
  queue: PosAssistantAiResult[];
  enqueue(...responses: PosAssistantAiResult[]): void;
};
const harness: Harness = {
  aiCalls: [],
  reportCalls: [],
  queue: [],
  enqueue(...responses) {
    this.queue.push(...responses);
  },
};
Object.defineProperty(window, "__posAssistantHarness", {
  configurable: false,
  value: harness,
});

window.gastronomy = {
  askPosAssistantAi: async (input: PosAssistantAiInput) => {
    harness.aiCalls.push(input);
    return harness.queue.shift() ?? { ok: false, code: "unavailable" };
  },
  getDetailedReport: async (filters: ReportFilters) => {
    harness.reportCalls.push(filters);
    return localReport;
  },
  getCashSessionReport: async () => {
    throw new Error("Unexpected cash report call in this harness");
  },
} as unknown as typeof window.gastronomy;

createRoot(document.getElementById("root")!).render(
  createElement(PosAssistantMenu, { data }),
);
