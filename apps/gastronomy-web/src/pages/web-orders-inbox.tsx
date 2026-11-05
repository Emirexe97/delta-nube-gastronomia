import { useEffect, useMemo, useState } from "react";
import type {
  BootstrapDto,
  ProductDto,
  WebInboxEntry,
  WebOrderDraft,
} from "@gastronomy/contracts";
import { Badge, Button, Card, Input, Textarea } from "@gastronomy/ui";
import { useQueryClient } from "@tanstack/react-query";
import { bootstrapKey } from "../api";
import { orderPrintCoordinator } from "../order-print";
import { humanError } from "../lib";
import {
  currentPosUnitPrice as itemPrice,
  hasCurrentPosPrice,
  resolveWebOrderProduct as productForRef,
  webDraftTotal,
} from "./web-order-ui";

const money = (value: number) =>
  (value / 100).toLocaleString("es-AR", { style: "currency", currency: "ARS" });
function draftFrom(entry: WebInboxEntry): WebOrderDraft {
  return {
    ...entry.draft,
    items: entry.draft.items.map((item) => ({ ...item })),
  };
}

export function WebOrdersInbox({
  data,
  active,
}: {
  data: BootstrapDto;
  active: boolean;
}) {
  const [entries, setEntries] = useState<WebInboxEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<WebOrderDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [printOrderId, setPrintOrderId] = useState<string | null>(null);
  const [printOrderNumber, setPrintOrderNumber] = useState<number | null>(null);
  const [printJobId, setPrintJobId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const canReview =
    data.currentUser.permissions.includes("*") ||
    data.currentUser.permissions.includes("orders.edit") ||
    data.currentUser.permissions.includes("orders.create");
  const canEdit =
    data.currentUser.permissions.includes("*") ||
    data.currentUser.permissions.includes("orders.edit");
  const canConfirm =
    (data.currentUser.permissions.includes("*") ||
      data.currentUser.permissions.includes("orders.create")) &&
    data.cashSession?.status === "OPEN";
  const queryClient = useQueryClient();
  const mergeInbox = (fresh: WebInboxEntry[]) =>
    setEntries((current) => {
      const freshIds = new Set(fresh.map((entry) => entry.original.id));
      const rows = fresh.map((entry) =>
        entry.original.id === selectedId
          ? (current.find((row) => row.original.id === selectedId) ?? entry)
          : entry,
      );
      const selectedSnapshot = current.find(
        (entry) => entry.original.id === selectedId,
      );
      return selectedSnapshot && !freshIds.has(selectedSnapshot.original.id)
        ? [selectedSnapshot, ...rows]
        : rows;
    });
  const reload = async () => {
    try {
      mergeInbox(await window.gastronomy.listWebOrders());
      setError(null);
    } catch (e) {
      setError(humanError(e));
    }
  };
  useEffect(() => {
    if (!active || !canReview) return;
    void reload();
    const timer = window.setInterval(() => {
      if (!selectedId) void reload();
      else
        void window.gastronomy
          .listWebOrders()
          .then(mergeInbox)
          .catch(() => undefined);
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [active, canReview, selectedId]);
  const selected =
    entries.find((entry) => entry.original.id === selectedId) ?? null;
  useEffect(() => {
    setDraft(selected ? draftFrom(selected) : null);
  }, [selectedId]);
  const pendingCount = entries.filter(
    (entry) => entry.status === "PENDING",
  ).length;
  const prices = useMemo(
    () =>
      draft?.items.map(
        (item) =>
          itemPrice(productForRef(data, item.productRef), draft.type) *
          item.quantity,
      ) ?? [],
    [draft, data.products],
  );
  const estimatedTotal = draft
    ? webDraftTotal(data, draft)
    : prices.reduce((sum, v) => sum + v, 0);
  const savedTotal = selected
    ? selected.draft.items.reduce(
        (sum, item) =>
          sum +
          itemPrice(productForRef(data, item.productRef), selected.draft.type) *
            item.quantity,
        0,
      ) + selected.draft.deliveryFeeMinor
    : 0;
  const originalTotal = selected?.original.quotedTotalMinor ?? 0;
  const deltaOriginal = estimatedTotal - originalTotal;
  const deltaSaved = estimatedTotal - savedTotal;
  const draftChanged = Boolean(
    selected &&
    draft &&
    JSON.stringify(draft) !== JSON.stringify(selected.draft),
  );
  const saveDraft = async () => {
    if (!selected || !draft) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await window.gastronomy.saveWebOrderDraft({
        id: selected.original.id,
        revision: selected.revision,
        draft,
      });
      setEntries((prev) =>
        prev.map((entry) =>
          entry.original.id === updated.original.id ? updated : entry,
        ),
      );
      setNotice("Borrador guardado. El pedido todavía no está confirmado.");
    } catch (e) {
      setError(humanError(e));
    } finally {
      setBusy(false);
    }
  };
  const printKitchen = async (orderId: string, orderNumber: number) => {
    setPrintOrderId(orderId);
    setPrintOrderNumber(orderNumber);
    setBusy(true);
    setError(null);
    try {
      const result = await orderPrintCoordinator.run({
        orderId,
        orderNumber,
        kind: "KITCHEN_ORDER",
      });
      setPrintOrderId(
        result.status === "SKIPPED" || result.status === "PRINTED"
          ? null
          : orderId,
      );
      setNotice(
        result.status === "SKIPPED"
          ? "Pedido creado. Impresión omitida por configuración."
          : "Pedido creado y enviado a impresión.",
      );
    } catch (e) {
      setError(
        `El pedido ya existe; falló la impresión. Reintentá sin volver a confirmar. ${humanError(e)}`,
      );
    } finally {
      setBusy(false);
      try {
        const latest = await queryClient.fetchQuery({
          queryKey: bootstrapKey,
          queryFn: () => window.gastronomy.bootstrap(),
        });
        const failedJob = latest.printJobs.find(
          (job) =>
            job.orderId === orderId &&
            job.kind === "KITCHEN_ORDER" &&
            ["FAILED", "QUEUED", "RECOVERING"].includes(job.status),
        );
        setPrintJobId(failedJob?.id ?? null);
      } catch {
        /* Keep the already-created order; the global print status remains available. */
      }
    }
  };
  const confirm = async () => {
    if (!selected || !draft || !canConfirm) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      // Persist explicitly before confirm; a revision conflict must never duplicate a POS order.
      const saved = draftChanged
        ? await window.gastronomy.saveWebOrderDraft({
            id: selected.original.id,
            revision: selected.revision,
            draft,
          })
        : selected;
      if (draftChanged)
        setEntries((prev) =>
          prev.map((entry) =>
            entry.original.id === saved.original.id ? saved : entry,
          ),
        );
      const total = webDraftTotal(data, draft);
      const result = await window.gastronomy.confirmWebOrder({
        id: saved.original.id,
        revision: saved.revision,
        expectedTotalMinor: total,
      });
      setEntries((prev) =>
        prev.map((entry) =>
          entry.original.id === saved.original.id
            ? { ...entry, status: "CONFIRMED", orderId: result.order.id }
            : entry,
        ),
      );
      if (result.created) {
        await queryClient.invalidateQueries({ queryKey: bootstrapKey });
        await printKitchen(result.order.id, result.order.number);
      } else setNotice("El pedido POS ya estaba creado; no se duplicó.");
    } catch (e) {
      setError(humanError(e));
    } finally {
      setBusy(false);
    }
  };
  const reject = async () => {
    if (!selected || !rejectReason.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await window.gastronomy.rejectWebOrder({
        id: selected.original.id,
        revision: selected.revision,
        reason: rejectReason.trim(),
      });
      setEntries((prev) =>
        prev.map((entry) =>
          entry.original.id === selected.original.id
            ? { ...entry, status: "REJECTED" }
            : entry,
        ),
      );
      setSelectedId(null);
      setRejectReason("");
      setNotice("Pedido rechazado.");
    } catch (e) {
      setError(humanError(e));
    } finally {
      setBusy(false);
    }
  };
  if (!canReview)
    return (
      <p className="p-4 text-sm text-slate-600">
        No tenés autorización para revisar pedidos web.
      </p>
    );
  return (
    <div className="grid gap-3 p-3 xl:grid-cols-[minmax(250px,0.8fr)_minmax(0,1.7fr)]">
      {error && !selected ? (
        <p
          role="alert"
          className="xl:col-span-2 rounded-lg bg-rose-50 p-3 text-sm text-rose-800"
        >
          {error}
        </p>
      ) : null}
      <Card className="overflow-hidden">
        <header className="flex items-center justify-between border-b p-3">
          <h3 className="font-extrabold">Pedidos recibidos</h3>
          <Button
            variant="secondary"
            className="h-8 px-2 text-xs"
            onClick={() => void reload()}
          >
            Actualizar
          </Button>
        </header>
        <ul className="max-h-[65vh] overflow-auto" aria-label="Pedidos web">
          {entries.map((entry) => (
            <li key={entry.original.id}>
              <button
                type="button"
                aria-current={
                  entry.original.id === selectedId ? "true" : undefined
                }
                onClick={() => {
                  setSelectedId(entry.original.id);
                  setError(null);
                }}
                className="focus-ring w-full border-b p-3 text-left hover:bg-slate-50"
              >
                <span className="flex justify-between gap-2 font-bold">
                  <span>
                    {entry.original.reference} ·{" "}
                    {entry.draft.customerName ||
                      entry.original.submission.customer.name}
                  </span>
                  <Badge
                    tone={
                      entry.status === "PENDING"
                        ? "amber"
                        : entry.status === "CONFIRMED"
                          ? "green"
                          : "slate"
                    }
                  >
                    {entry.status === "PENDING"
                      ? "Pendiente"
                      : entry.status === "CONFIRMED"
                        ? "Confirmado"
                        : entry.status === "REVIEW_RESTORE"
                          ? "Revisar copia"
                          : "Rechazado"}
                  </Badge>
                </span>
                <span className="mt-1 block text-xs text-slate-600">
                  {money(entry.original.quotedTotalMinor)} ·{" "}
                  {entry.draft.type === "DELIVERY" ? "Envío" : "Retiro"}
                </span>
              </button>
            </li>
          ))}
          {!entries.length ? (
            <li className="p-4 text-sm text-slate-500">No hay pedidos web.</li>
          ) : null}
        </ul>
      </Card>
      {selected && draft ? (
        <Card className="space-y-3 p-4">
          <header className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-extrabold">{selected.original.reference}</h3>
              <p className="text-xs text-slate-600">
                Original recibido{" "}
                {new Date(
                  selected.original.receivedAt ?? selected.original.createdAt,
                ).toLocaleString("es-AR")}
              </p>
            </div>
            <Badge tone={selected.status === "PENDING" ? "amber" : "slate"}>
              {selected.status === "REVIEW_RESTORE"
                ? "Revisar copia"
                : selected.status}
            </Badge>
          </header>
          {selected.status === "REVIEW_RESTORE" ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
              La solicitud pudo haberse recibido en el servidor, pero esta copia
              local no tiene el pedido original. Revisá manualmente antes de
              crear otro pedido para evitar duplicados. Este registro es de solo
              lectura.
            </p>
          ) : null}
          <details>
            <summary className="cursor-pointer font-bold">
              Ver pedido original · {money(originalTotal)}
            </summary>
            <div className="mt-2 space-y-2 rounded bg-slate-50 p-3 text-xs">
              <p>
                <b>Cliente:</b> {selected.original.submission.customer.name} ·{" "}
                {selected.original.submission.customer.phone}
              </p>
              <p>
                <b>Modalidad:</b>{" "}
                {selected.original.submission.fulfillment.type}
                {selected.original.submission.fulfillment.address
                  ? ` · ${selected.original.submission.fulfillment.address}`
                  : ""}
              </p>
              <ul className="list-disc pl-5">
                {selected.original.submission.items.map((item, i) => (
                  <li key={`${i}-${item.productRef}`}>
                    {item.quantity} × {item.name} — {money(item.unitPriceMinor)}
                    {item.options?.length
                      ? ` (${item.options.map((option) => `${option.group}: ${option.name}`).join(", ")})`
                      : ""}
                    {item.notes ? ` · ${item.notes}` : ""}
                  </li>
                ))}
              </ul>
              <p>
                <b>Envío:</b>{" "}
                {money(selected.original.submission.deliveryFeeMinor)}
              </p>
              <p>
                <b>Notas:</b> {selected.original.submission.notes || "—"}
              </p>
              <p>
                <b>Solicitado para:</b>{" "}
                {selected.original.submission.requestedFor ||
                  "Lo antes posible"}
              </p>
              <p>
                <b>Pago informado (no verificado):</b>{" "}
                {selected.original.submission.paymentMethod}
              </p>
            </div>
          </details>
          <fieldset
            disabled={selected.status !== "PENDING" || !canEdit}
            className="space-y-3 disabled:opacity-75"
          >
            <legend className="sr-only">Edición del pedido</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-xs font-bold">
                Cliente
                <Input
                  aria-label="Cliente del pedido web"
                  value={draft.customerName}
                  onChange={(e) =>
                    setDraft({ ...draft, customerName: e.target.value })
                  }
                />
              </label>
              <label className="text-xs font-bold">
                Teléfono
                <Input
                  aria-label="Teléfono del pedido web"
                  value={draft.customerPhone}
                  onChange={(e) =>
                    setDraft({ ...draft, customerPhone: e.target.value })
                  }
                />
              </label>
            </div>
            {draft.type === "DELIVERY" ? (
              <label className="text-xs font-bold">
                Dirección
                <Textarea
                  aria-label="Dirección de entrega"
                  value={draft.deliveryAddress}
                  onChange={(e) =>
                    setDraft({ ...draft, deliveryAddress: e.target.value })
                  }
                />
              </label>
            ) : null}
            <fieldset className="space-y-2">
              <legend className="font-bold">
                Productos · referencia original y producto POS
              </legend>
              {draft.items.map((item, index) => (
                <div
                  key={`${selected.original.id}-${index}`}
                  className="grid gap-2 rounded-lg border p-2 sm:grid-cols-[minmax(0,1fr)_84px_minmax(0,1fr)_minmax(120px,0.8fr)_auto]"
                >
                  <span className="text-xs">
                    {selected.original.submission.items[index]?.name ??
                      "Producto recibido"}
                    <small className="block text-slate-500">
                      {selected.original.submission.items[index]?.quantity ??
                        item.quantity}{" "}
                      × precio web{" "}
                      {money(
                        selected.original.submission.items[index]
                          ?.unitPriceMinor ?? 0,
                      )}
                    </small>
                  </span>
                  <Input
                    aria-label={`Cantidad artículo ${index + 1}`}
                    type="number"
                    min="1"
                    value={item.quantity}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        items: draft.items.map((row, i) =>
                          i === index
                            ? {
                                ...row,
                                quantity: Math.max(
                                  1,
                                  Number(e.target.value) || 1,
                                ),
                              }
                            : row,
                        ),
                      })
                    }
                  />
                  <select
                    aria-label={`Producto POS para artículo ${index + 1}`}
                    className="rounded-lg border px-2 text-xs"
                    value={item.productRef}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        items: draft.items.map((row, i) =>
                          i === index
                            ? { ...row, productRef: e.target.value }
                            : row,
                        ),
                      })
                    }
                  >
                    <option value="">Seleccionar producto…</option>
                    {data.products
                      .filter((product) => product.active)
                      .map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.name}
                        </option>
                      ))}
                  </select>
                  <Input
                    aria-label={`Nota artículo ${index + 1}`}
                    placeholder="Nota"
                    value={item.notes}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        items: draft.items.map((row, i) =>
                          i === index ? { ...row, notes: e.target.value } : row,
                        ),
                      })
                    }
                  />
                  <Button
                    variant="secondary"
                    aria-label={`Quitar artículo ${index + 1}`}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        items: draft.items.filter((_, i) => i !== index),
                      })
                    }
                  >
                    Quitar
                  </Button>
                </div>
              ))}
              <label className="text-xs font-bold">
                Agregar producto POS
                <select
                  aria-label="Agregar producto POS"
                  className="ml-2 rounded-lg border p-2"
                  value=""
                  onChange={(e) => {
                    if (e.target.value)
                      setDraft({
                        ...draft,
                        items: [
                          ...draft.items,
                          {
                            productRef: e.target.value,
                            quantity: 1,
                            notes: "",
                          },
                        ],
                      });
                  }}
                >
                  <option value="">Seleccionar…</option>
                  {data.products
                    .filter((product) => product.active)
                    .map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name}
                      </option>
                    ))}
                </select>
              </label>
            </fieldset>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-xs font-bold">
                Notas del pedido
                <Textarea
                  aria-label="Notas del pedido"
                  value={draft.notes}
                  onChange={(e) =>
                    setDraft({ ...draft, notes: e.target.value })
                  }
                />
              </label>
              {draft.type === "DELIVERY" ? (
                <label className="text-xs font-bold">
                  Costo de envío
                  <Input
                    aria-label="Costo de envío en pesos"
                    type="number"
                    min="0"
                    step="0.01"
                    value={(draft.deliveryFeeMinor / 100).toFixed(2)}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        deliveryFeeMinor: Math.round(
                          (Number(e.target.value) || 0) * 100,
                        ),
                      })
                    }
                  />
                </label>
              ) : null}
            </div>
            <section
              className="rounded-lg bg-slate-50 p-3 text-sm"
              aria-live="polite"
            >
              <p>
                Original web: <b>{money(originalTotal)}</b>
              </p>
              <p>
                Con precios POS actuales: <b>{money(estimatedTotal)}</b> ·
                diferencia original{" "}
                <b>
                  {deltaOriginal >= 0 ? "+" : "−"}
                  {money(Math.abs(deltaOriginal))}
                </b>
              </p>
              {selected.status === "PENDING" ? (
                <p>
                  Diferencia respecto del borrador guardado:{" "}
                  {deltaSaved >= 0 ? "+" : "−"}
                  {money(Math.abs(deltaSaved))}
                </p>
              ) : null}
            </section>
          </fieldset>
          {error ? (
            <p
              role="alert"
              className="rounded-lg bg-rose-50 p-2 text-sm text-rose-800"
            >
              {error}
            </p>
          ) : null}
          {notice ? (
            <p role="status" className="text-sm text-emerald-800">
              {notice}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {selected.status === "PENDING" ? (
              <>
                {canEdit ? (
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void saveDraft()}
                  >
                    Guardar borrador
                  </Button>
                ) : null}
                <Button
                  disabled={
                    busy ||
                    !canConfirm ||
                    !draft.items.length ||
                    draft.items.some((item) => {
                      const product = productForRef(data, item.productRef);
                      return (
                        !hasCurrentPosPrice(product, draft.type) ||
                        Boolean(product?.comboDefinition)
                      );
                    })
                  }
                  title={
                    !canConfirm
                      ? "Se necesita permiso y caja abierta para confirmar"
                      : undefined
                  }
                  onClick={() => void confirm()}
                >
                  Confirmar y crear pedido POS
                </Button>
                <label className="flex items-center gap-2">
                  <Input
                    aria-label="Motivo de rechazo"
                    placeholder="Motivo para rechazar"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                  />
                  <Button
                    variant="secondary"
                    disabled={busy || !canEdit || !rejectReason.trim()}
                    onClick={() => void reject()}
                  >
                    Rechazar
                  </Button>
                </label>
              </>
            ) : null}
            {printOrderId &&
            selected.orderId === printOrderId &&
            printJobId &&
            printOrderNumber ? (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    await orderPrintCoordinator.run({
                      orderId: printOrderId,
                      orderNumber: printOrderNumber,
                      kind: "KITCHEN_ORDER",
                      retryJobId: printJobId,
                    });
                    setPrintJobId(null);
                    setPrintOrderId(null);
                    setNotice("Impresión reintentada.");
                  } catch (e) {
                    setError(humanError(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Reintentar impresión de comanda
              </Button>
            ) : null}
          </div>
          {!data.cashSession && selected.status === "PENDING" ? (
            <p className="text-xs text-amber-800">
              Caja cerrada: podés revisar y editar, pero no confirmar.
            </p>
          ) : null}
        </Card>
      ) : (
        <div className="grid min-h-64 place-items-center text-sm text-slate-500">
          Elegí un pedido para revisar · {pendingCount} pendientes
        </div>
      )}
    </div>
  );
}
