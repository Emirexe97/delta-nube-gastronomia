import { useStore } from "zustand";
import { isOrderPrintActive, orderPrintCoordinator } from "../order-print";
import { humanError } from "../lib";

export function OrderPrintStatus() {
  const jobs = useStore(orderPrintCoordinator.store, (state) => state.jobs);
  const all = Object.values(jobs).filter((job) => !job.notificationDismissed);
  const visible = [
    ...all.filter(isOrderPrintActive),
    ...all.filter((job) => !isOrderPrintActive(job)).slice(-1),
  ];
  return (
    <div className="shrink-0" aria-live="polite">
      {visible.map((job) => (
        <div
          key={job.orderId}
          role={job.status === "FAILED" ? "alert" : "status"}
          className={`flex items-center justify-between gap-3 border-b px-5 py-2 text-xs ${job.status === "FAILED" ? "border-rose-200 bg-rose-50 text-rose-950" : "border-sky-200 bg-sky-50 text-sky-950"}`}
        >
          <p>
            <strong>
              Pedido #{job.orderNumber} ·{" "}
              {job.kind === "KITCHEN_ORDER" ? "Comanda" : "Cuenta"}.
            </strong>{" "}
            {job.status === "PREPARING"
              ? "Guardando el pedido…"
              : job.status === "PRINTING"
                ? "Enviando a la impresora. Podés cerrar el pedido y seguir trabajando."
                : job.status === "FAILED"
                  ? `${humanError(new Error(job.error))} Revisá si el ticket salió antes de reintentar desde el pedido.`
                  : job.status === "SKIPPED"
                    ? "No se imprimió."
                    : "Enviada a la impresora."}
          </p>
          {!isOrderPrintActive(job) && (
            <button
              type="button"
              onClick={() => orderPrintCoordinator.dismiss(job.orderId)}
              className="shrink-0 rounded border border-current/20 px-2 py-1 font-bold"
            >
              Ocultar
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
