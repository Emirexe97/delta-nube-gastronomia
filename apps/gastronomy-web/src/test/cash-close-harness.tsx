import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter } from "react-router-dom";
import type { BootstrapDto } from "@gastronomy/contracts";
import { CashPage } from "../pages/cash-page";
import { createDemoApi } from "../demo/demo-api";
import "../styles.css";

declare global {
  interface Window {
    __cashCloseTest: { calls: number; setPending(pending: boolean): void };
  }
}

async function mount() {
  const api = createDemoApi(localStorage);
  const original = await api.bootstrap();
  const session = {
    ...original.cashSession!,
    expectedAmountMinor: 10_000,
    openingAmountMinor: 1_000,
    salesTotalMinor: 0,
    cashSalesMinor: 0,
    cashIncomeMinor: 9_000,
    cashExpenseMinor: 0,
    cashWithdrawalMinor: 0,
    cashRefundMinor: 0,
    movements: [],
    salesByPaymentMethod: [],
  };
  const pendingOrder = {
    ...original.orders[0]!,
    cashSessionCreatedId: session.id,
    cashSessionPaidId: null,
    operationalStatus: "IN_PREPARATION" as const,
  };
  const clean: BootstrapDto = {
    ...original,
    cashSession: session,
    orders: [],
    deliveryLedger: [],
  };
  window.__cashCloseTest = { calls: 0, setPending: () => {} };
  window.gastronomy = {
    ...api,
    bootstrap: async () => clean,
    closeCashSession: async () => {
      window.__cashCloseTest.calls++;
      throw new Error("This fixture never closes a cash session.");
    },
  };
  function Harness() {
    const [data, setData] = useState<BootstrapDto>({
      ...clean,
      orders: location.search.includes("pending=order") ? [pendingOrder] : [],
    });
    window.__cashCloseTest.setPending = (pending) =>
      setData({ ...clean, orders: pending ? [pendingOrder] : [] });
    return <CashPage data={data} />;
  }
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { mutations: { retry: false } } })
      }
    >
      <HashRouter>
        <Harness />
      </HashRouter>
    </QueryClientProvider>,
  );
}
void mount();
