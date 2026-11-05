import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { BootstrapDto, DelayedWaiterBatch } from "@gastronomy/contracts";
import { Button } from "@gastronomy/ui";
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
  if (!canReviewDelayedWaiters(data)) return <p className="p-4">Sólo caja o un responsable puede revisar tandas demoradas.</p>;
  async function resolve(entry: DelayedWaiterBatch, accept: boolean) {
    setBusy(true); setError(""); setNotice("");
    try {
      if (accept) {
        await window.gastronomy.confirmDelayedWaiterBatch({ requestId: entry.requestId });
        setNotice("Tanda incorporada al pedido. Revisá el estado de la comanda si hubo un fallo de impresión.");
      } else {
        await window.gastronomy.rejectDelayedWaiterBatch({ requestId: entry.requestId });
        setNotice("Tanda descartada. No se creó pedido ni comanda.");
      }
      select(null);
      await client.invalidateQueries({ queryKey: delayedWaiterKey });
      await client.invalidateQueries({ queryKey: ["bootstrap"] });
    } catch (e) { setError(humanError(e)); }
    finally { setBusy(false); }
  }
  return <section className="space-y-3 p-4" aria-label="Tandas de mozos demoradas">
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
      <h3 className="font-extrabold">Demorados · pendientes de confirmar en caja</h3>
      <p>Estas tandas llegaron más de 60 segundos después del envío o sin una hora verificable. No se incorporaron a la mesa ni se imprimieron.</p>
      <p className="mt-1 font-semibold">Consultá con el mozo si ya se cargaron manualmente antes de confirmar.</p>
    </div>
    <p className="text-xs text-slate-600">La revisión es local y no necesita Internet. Si cambió el turno o la mesa, no se confirma automáticamente.</p>
    {entries.isLoading && <p>Cargando tandas…</p>}
    {entries.error && <p role="alert">{humanError(entries.error)} <Button onClick={() => void entries.refetch()}>Reintentar</Button></p>}
    {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
    {notice && <p role="status" className="text-sm text-emerald-800">{notice}</p>}
    {entries.data?.length === 0 && <p>No hay tandas demoradas pendientes.</p>}
    <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_2fr]">
      <ul className="space-y-2" aria-label="Mozos demorados">
        {entries.data?.map((entry) => <li key={entry.requestId}>
          <button type="button" disabled={busy} aria-pressed={entry.requestId === selectedId}
            className="w-full rounded-lg border p-3 text-left hover:bg-amber-50"
            onClick={() => { select(entry.requestId); setError(""); setNotice(""); }}>
            <strong>Mesa {entry.tableNumber} · {entry.waiterName}</strong>
            <p className="text-xs">Enviado: {date(entry.submittedAt)}</p>
            <p className="text-xs">Recibido: {date(entry.receivedAt)}</p>
          </button>
        </li>)}
      </ul>
      {selected && <article className="space-y-3 rounded-lg border p-4">
        <h4 className="font-bold">Mesa {selected.tableNumber} · {selected.waiterName}</h4>
        <p className="text-xs">Enviado: {date(selected.submittedAt)} · Recibido: {date(selected.receivedAt)}</p>
        <ul className="space-y-2">
          {selected.lines.map((line, index) => <li key={index}>
            <strong>{line.quantity} × {line.name}</strong>
            {line.note && <p className="text-sm text-slate-600">{line.note}</p>}
          </li>)}
        </ul>
        <p className="text-xs text-slate-600">Al confirmar se validan la mesa, el turno, los productos y los precios actuales de caja.</p>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || data.cashSession?.status !== "OPEN"} onClick={() => void resolve(selected, true)}>Confirmar e imprimir tanda</Button>
          <Button variant="secondary" disabled={busy} onClick={() => void resolve(selected, false)}>Descartar · ya se resolvió / no corresponde</Button>
        </div>
        {data.cashSession?.status !== "OPEN" && <p className="text-sm">No se puede confirmar una tanda con la caja cerrada.</p>}
      </article>}
    </div>
  </section>;
}
