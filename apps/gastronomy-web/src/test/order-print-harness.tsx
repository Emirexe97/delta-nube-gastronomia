import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter, useNavigate } from "react-router-dom";
import { OrderEditor } from "../components/order-editor";
import { OrderPrintStatus } from "../components/order-print-status";
import { createDemoApi } from "../demo/demo-api";
import "../styles.css";
import type { BootstrapDto } from "@gastronomy/contracts";

declare global {
  interface Window {
    __printControl: { calls: number; finish: (error?: string) => void };
  }
}

function Harness({ data, orderId }: { data: BootstrapDto; orderId: string }) {
  const [open, setOpen] = useState(true);
  const navigate = useNavigate();
  return (
    <>
      <div data-testid="global-print-status">
        <OrderPrintStatus />
      </div>
      <nav>
        <button
          onClick={() => {
            setOpen(false);
            navigate("/elsewhere");
          }}
        >
          Ir a otra pantalla
        </button>
        <button
          onClick={() => {
            navigate("/pedido");
            setOpen(true);
          }}
        >
          Abrir pedido
        </button>
      </nav>
      {open && (
        <OrderEditor
          data={data}
          orderId={orderId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

async function mount() {
  const api = createDemoApi(window.localStorage);
  const initialData = await api.bootstrap();
  const order = await api.createOrder({
    type: "TAKEAWAY",
    customerName: "Prueba impresión de fondo",
    customerPhone: "1100000000",
  });
  await api.addOrderItem({
    orderId: order.id,
    productId: initialData.products[0]!.id,
    quantity: 1,
  });
  await api.confirmOrder({ orderId: order.id });
  const data: BootstrapDto = await api.bootstrap();
  window.gastronomy = {
    ...api,
    printOrder: () =>
      new Promise((resolve, reject) => {
        window.__printControl.calls += 1;
        window.__printControl.finish = (error?: string) =>
          error
            ? reject(new Error(error))
            : resolve({ jobId: "synthetic-print", status: "PRINTED" });
      }),
  };
  window.__printControl = { calls: 0, finish: () => undefined };
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <QueryClientProvider client={client}>
      <HashRouter>
        <Harness data={data} orderId={order.id} />
      </HashRouter>
    </QueryClientProvider>,
  );
}

void mount();
