import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HashRouter } from "react-router-dom";
import { sharedThemeCss } from "@gastronomy/ui/theme";
import { App } from "./app";
import { installDemoApi } from "./demo/install-demo";
import { initializeRenderer } from "./demo/startup";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5_000, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
});

const root = ReactDOM.createRoot(document.getElementById("root")!);
const renderApp = () => root.render(
  <React.StrictMode>
    <style>{sharedThemeCss}</style>
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <App />
      </HashRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
const start = () => void initializeRenderer({
  installApi: installDemoApi,
  renderApp,
  renderError: () => root.render(
    <main role="alert" className="m-8 max-w-lg rounded-xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-950">
      <h1 className="text-lg font-bold">No se pudo iniciar Gastronomía</h1>
      <p className="mt-2">Falló la preparación del modo demostración. Revisá la conexión y volvé a intentar.</p>
      <button type="button" className="mt-4 rounded-lg bg-rose-800 px-4 py-2 font-semibold text-white" onClick={start}>Reintentar</button>
    </main>,
  ),
});
start();
