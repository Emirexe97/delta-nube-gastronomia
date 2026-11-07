import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { BootstrapDto, DelayedWaiterBatch } from "@gastronomy/contracts";
import { Button, HelpTip } from "@gastronomy/ui";
import { humanError } from "../lib";

export const delayedWaiterKey = ["delayed-waiter-batches"] as const;
export function canReviewDelayedWaiters(data: BootstrapDto) {
  return ["ADMIN", "MANAGER", "CASHIER"].includes(data.currentUser.roleCode) &&
    data.currentUser.permissions.includes("orders.create");
}
export function useDelayedWaiters(data: BootstrapDto, active: boolean) {
  return useQuery({
    queryKey: [...delayedWaiterKey, data.currentUser.id],
    queryFn: () => window.gastronomy.listDelayedWaiterBatches(),
    enabled: active && canReviewDelayedWaiters(data),
    refetchInterval: active ? 5000 : false,
    retry: false,
  });
}
export function DelayedWaiterCount({ data, active }: { data: BootstrapDto; active: boolean }) {
  const entries = useDelayedWaiters(data, active);
  return entries.data?.length ? <span className="ml-1 rounded bg-amber-100 px-1.5 text-amber-950">{entries.data.length}</span> : null;
}
function date(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Hora no verificable";
  return new Date(value).toLocaleString("es-AR");
}
export function DelayedWaiterInbox({ data, active }: { data: BootstrapDto; active: boolean }) {
  const entries = useDelayedWaiters(data, active);
  const client = useQueryClient();
  const [selectedId, select] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const selected = entries.data?.find((e) => e.requestId === selectedId);
  if (!canReviewDelayedWaiters(data)) return null;
  async function resolve(entry: DelayedWaiterBatch, accept: boolean) {
    setBusy(true); setError(""); setNotice("");
    try {
      if (accept) {
        await window.gastronomy.confirmDelayedWaiterBatch({ requestId: entry.requestId });
        setNotice("Pedido incorporado a la mesa. Revisá que haya salido la comanda.");
      } else {
        await window.gastronomy.rejectDelayedWaiterBatch({ requestId: entry.requestId });
        setNotice("Pedido descartado. No se creó el pedido.");
      }
      select(null);
      await client.invalidateQueries({ queryKey: delayedWaiterKey });
      await client.invalidateQueries({ queryKey: ["bootstrap"] });
    } catch (e) { setError(humanError(e)); }
    finally { setBusy(false); }
  }
  return <section className="space-y-3 p-4" aria-label="Pedidos de mozos">
    <div className="space-y-1">
      <h3 className="text-sm font-bold">Pedidos de mozos <HelpTip label="Pedidos enviados desde el teléfono">Revisalos antes de agregarlos a la mesa.</HelpTip></h3>
    </div>
    {!!entries.data?.length && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
      <h3 className="font-extrabold">Revisá antes de confirmar</h3>
      <p>Estos pedidos todavía no se agregaron a la mesa ni se enviaron a cocina.</p>
      <p className="mt-1 font-semibold">Antes de confirmar, consultá con el mozo si ya los cargó manualmente.</p>
    </div>}
    {entries.isLoading && <p>Cargando pedidos…</p>}
    {entries.error && <p role="alert">{humanError(entries.error)} <Button onClick={() => void entries.refetch()}>Reintentar</Button></p>}
    {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
    {notice && <p role="status" className="text-sm text-emerald-800">{notice}</p>}
    {entries.data?.length === 0 && <div className="rounded-lg border border-dashed p-4 text-sm text-slate-600"><p>No hay pedidos pendientes de revisión.</p><p className="mt-1">Los pedidos ya aceptados aparecen dentro de su mesa.</p></div>}
    <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_2fr]">
      <ul className="space-y-2" aria-label="Pedidos por aprobar">
        {entries.data?.map((entry) => <li key={entry.requestId}>
          <button type="button" disabled={busy} aria-pressed={entry.requestId === selectedId}
            className="w-full rounded-lg border p-3 text-left hover:bg-amber-50"
            onClick={() => { select(entry.requestId); setError(""); setNotice(""); }}>
            <strong>Mesa {entry.tableNumber} · {entry.waiterName}</strong>
            <p className="text-xs">Enviado: {date(entry.submittedAt)}</p>
            <span className="mt-2 inline-block text-xs font-bold text-brand-700">Ver detalle →</span>
          </button>
        </li>)}
      </ul>
      {!selected && !!entries.data?.length && <p className="rounded-lg border border-dashed p-4 text-sm text-slate-600">Elegí un pedido para ver sus productos.</p>}
      {selected && <article className="space-y-3 rounded-lg border p-4">
        <h4 className="font-bold">Mesa {selected.tableNumber} · {selected.waiterName}</h4>
        <p className="text-xs">Enviado: {date(selected.submittedAt)} · Recibido: {date(selected.receivedAt)}</p>
        <ul className="space-y-2">
          {selected.lines.map((line, index) => <li key={index}>
            <strong>{line.quantity} × {line.name}</strong>
            {line.note && <p className="text-sm text-slate-600">{line.note}</p>}
          </li>)}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || data.cashSession?.status !== "OPEN"} onClick={() => void resolve(selected, true)}>Aprobar y enviar a cocina</Button>
          <Button variant="secondary" disabled={busy} onClick={() => void resolve(selected, false)}>Descartar pedido</Button>
        </div>
        {data.cashSession?.status !== "OPEN" && <p className="text-sm">Abrí caja para aprobar pedidos.</p>}
      </article>}
    </div>
  </section>;
}
