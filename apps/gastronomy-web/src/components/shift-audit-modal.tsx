import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  CashSessionDto,
  OrderDto,
  ShiftAuditEvent,
  ShiftAuditOrder,
  ShiftAuditSection,
  ShiftOrderAuditDto,
} from "@gastronomy/contracts";
import { Button, Field, Input, Modal } from "@gastronomy/ui";
import {
  formatMoney,
  humanError,
  paymentStatusLabels,
  statusLabels,
  typeLabels,
} from "../lib";

const when = (value: string | null) =>
  value ? new Date(value).toLocaleString("es-AR") : "—";
const money = (value: number | null | undefined) =>
  value == null ? "—" : formatMoney(value);
const label = (value: string) =>
  statusLabels[value as keyof typeof statusLabels] ?? value;
const tabs = [
  ["closing", "Cierre"],
  ["orders", "Pedidos"],
  ["movements", "Cobros y movimientos"],
  ["deliveries", "Repartidores"],
] as const;
export function ShiftAuditModal({
  open,
  sessionId,
  onClose,
}: {
  open: boolean;
  sessionId: string | null;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Auditar turno">
      {open && sessionId && <Audit key={sessionId} sessionId={sessionId} />}
    </Modal>
  );
}
function Audit({ sessionId }: { sessionId: string }) {
  const [section, setSection] = useState<"closing" | ShiftAuditSection>(
    "closing",
  );
  const [query, setQuery] = useState(""),
    [page, setPage] = useState(1),
    [orderId, setOrderId] = useState<string | null>(null);
  const result = useQuery({
    queryKey: ["shift-audit", sessionId, section, query, page],
    queryFn: () =>
      window.gastronomy.getShiftAudit({
        cashSessionId: sessionId,
        section: section === "closing" ? "movements" : section,
        search: query,
        page,
        pageSize: section === "closing" ? 1 : 12,
      }),
    networkMode: "always",
  });
  const session = result.data?.session;
  return (
    <div className="space-y-4">
      {session && (
        <p className="text-sm font-bold">
          Caja #{session.number} · {session.businessDate} ·{" "}
          {session.status === "OPEN" ? "Abierta" : "Cerrada"}
        </p>
      )}
      {orderId ? (
        <>
          <Button variant="secondary" onClick={() => setOrderId(null)}>
            Volver al turno
          </Button>
          <OrderDetail sessionId={sessionId} orderId={orderId} />
        </>
      ) : (
        <>
          <nav
            role="tablist"
            aria-label="Vistas de auditoría"
            className="flex flex-wrap gap-1"
          >
            {tabs.map(([id, name]) => (
              <Button
                key={id}
                role="tab"
                aria-selected={section === id}
                variant={section === id ? "primary" : "secondary"}
                onClick={() => {
                  setSection(id);
                  setQuery("");
                  setPage(1);
                }}
              >
                {name}
              </Button>
            ))}
          </nav>
          {section !== "closing" && (
            <Field
              label={
                section === "movements"
                  ? "Buscar por pedido, movimiento, medio u operador"
                  : "Buscar por pedido, cliente o repartidor"
              }
            >
              <Input
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
              />
            </Field>
          )}
          {result.isError ? (
            <p role="alert">
              {humanError(result.error)}{" "}
              <Button variant="secondary" onClick={() => void result.refetch()}>
                Reintentar
              </Button>
            </p>
          ) : !result.data ? (
            <p role="status">Cargando turno…</p>
          ) : section === "closing" ? (
            <Closing session={result.data.session} />
          ) : (
            <>
              {result.data.totalCount === 0 ? (
                <p className="py-5 text-sm text-slate-600">
                  No se encontraron registros.
                </p>
              ) : section === "movements" ? (
                <Events rows={result.data.movements} select={setOrderId} />
              ) : (
                <OrderList
                  rows={result.data.orders}
                  deliveries={section === "deliveries"}
                  closed={session?.status === "CLOSED"}
                  select={setOrderId}
                />
              )}
              <div className="flex items-center justify-between gap-2 text-xs">
                <span>
                  {result.data.totalCount} registros · Página {result.data.page}{" "}
                  de{" "}
                  {Math.max(
                    1,
                    Math.ceil(result.data.totalCount / result.data.pageSize),
                  )}
                </span>
                <div className="flex gap-1">
                  <Button
                    variant="secondary"
                    disabled={result.data.page <= 1}
                    onClick={() => setPage(page - 1)}
                  >
                    Anterior
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={
                      result.data.page * result.data.pageSize >=
                      result.data.totalCount
                    }
                    onClick={() => setPage(page + 1)}
                  >
                    Siguiente
                  </Button>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
function Facts({ values }: { values: Array<[string, string]> }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl bg-slate-50 p-4 text-sm md:grid-cols-3">
      {values.map(([key, value]) => (
        <div key={key}>
          <dt className="text-xs text-slate-600">{key}</dt>
          <dd className="font-semibold">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
function Closing({ session: s }: { session: CashSessionDto }) {
  return (
    <Facts
      values={[
        ["Abrió", s.openedByName],
        ["Apertura", when(s.openedAt)],
        ["Cambio inicial", money(s.openingAmountMinor)],
        ["Cerró", s.closedByName ?? "—"],
        ["Cierre", when(s.closedAt)],
        ["Ventas del turno", money(s.salesTotalMinor)],
        ["Efectivo esperado", money(s.expectedAmountMinor)],
        ["Efectivo contado", money(s.countedAmountMinor)],
        ["Diferencia", money(s.differenceMinor)],
        ["Cambio final", money(s.closingFloatAmountMinor)],
        ["Efectivo retirado", money(s.cashRemovedAmountMinor)],
        ...(s.forcedClose
          ? ([["Tipo de cierre", "Forzado"]] as Array<[string, string]>)
          : []),
        ...(s.closingReason
          ? ([["Motivo del cierre", s.closingReason]] as Array<
              [string, string]
            >)
          : []),
        ...(s.closingAuthorizedBy
          ? ([["Autorizó", s.closingAuthorizedBy]] as Array<[string, string]>)
          : []),
      ]}
    />
  );
}
function OrderList({
  rows,
  deliveries,
  closed,
  select,
}: {
  rows: ShiftAuditOrder[];
  deliveries: boolean;
  closed: boolean;
  select: (id: string) => void;
}) {
  return (
    <div className="max-h-[46vh] overflow-auto">
      <table className="dn-table w-full">
        <thead>
          <tr>
            <th>Pedido</th>
            <th>{deliveries ? "Repartidor" : "Cliente y canal"}</th>
            <th>{deliveries ? "Envío al cliente" : "Total del pedido"}</th>
            <th>{deliveries ? "Pago al repartidor" : "Cobrado en el turno"}</th>
            <th>{deliveries ? "Rendición" : "Actividad en el turno"}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.orderId}>
              <td>
                <strong>#{r.number}</strong>
                <small className="block">{label(r.status)}</small>
                {closed && !r.hasClosingSnapshot && (
                  <small>Estado actual</small>
                )}
              </td>
              <td>
                {deliveries
                  ? (r.driverName ?? "Sin asignar")
                  : (r.customerName ?? "Sin cliente")}
                <small className="block">
                  {deliveries ? r.customerName : typeLabels[r.type]}
                </small>
              </td>
              <td>{money(deliveries ? r.deliveryFeeMinor : r.totalMinor)}</td>
              <td>{money(deliveries ? r.driverPayMinor : r.collectedMinor)}</td>
              <td>
                {deliveries ? r.settlementLabel : r.reasons.join(" · ") || "—"}
              </td>
              <td>
                <Button
                  variant="secondary"
                  aria-label={`Ver pedido #${r.number}`}
                  onClick={() => select(r.orderId)}
                >
                  Ver pedido
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function Events({
  rows,
  select,
}: {
  rows: ShiftAuditEvent[];
  select?: (id: string) => void;
}) {
  if (!rows.length)
    return <p className="text-xs text-slate-500">Sin eventos registrados.</p>;
  return (
    <div className="max-h-[42vh] overflow-auto">
      <table className="dn-table w-full">
        <thead>
          <tr>
            <th>Fecha y turno</th>
            <th>Operación</th>
            <th>Importe</th>
            <th>Efectivo en caja</th>
            <th>Responsable</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id}>
              <td>
                {when(e.occurredAt)}
                <small className="block">
                  {e.sessionNumber == null
                    ? "Turno sin identificar"
                    : `Caja #${e.sessionNumber}`}
                </small>
              </td>
              <td>
                <strong>{e.label}</strong>
                {e.method && <small className="block">{e.method}</small>}
                {e.reason && <small className="block">{e.reason}</small>}
                {e.reference && (
                  <small className="block">Ref. {e.reference}</small>
                )}
                {select && e.orderId && (
                  <button
                    type="button"
                    className="block font-bold underline"
                    onClick={() => select(e.orderId!)}
                  >
                    Pedido #{e.orderNumber}
                  </button>
                )}
              </td>
              <td>
                {money(e.amountMinor)}
                {e.receivedMinor != null && (
                  <small className="block">
                    Recibido {money(e.receivedMinor)}
                  </small>
                )}
              </td>
              <td>{money(e.cashEffectMinor)}</td>
              <td>
                {e.operator ?? "—"}
                {e.authorizer && (
                  <small className="block">Autorizó {e.authorizer}</small>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function OrderDetail({
  sessionId,
  orderId,
}: {
  sessionId: string;
  orderId: string;
}) {
  const query = useQuery({
    queryKey: ["shift-order-audit", sessionId, orderId],
    queryFn: () =>
      window.gastronomy.getShiftOrderAudit({
        cashSessionId: sessionId,
        orderId,
      }),
    networkMode: "always",
  });
  if (query.isError) return <p role="alert">{humanError(query.error)}</p>;
  return query.data ? (
    <Detail data={query.data} />
  ) : (
    <p role="status">Cargando pedido…</p>
  );
}
function Detail({ data }: { data: ShiftOrderAuditDto }) {
  const order: OrderDto = data.orderAtClose ?? data.order;
  const inShift = data.events.filter(
    (e) => e.cashSessionId === data.session.id,
  );
  const outside = data.events.filter(
    (e) => e.cashSessionId !== data.session.id,
  );
  return (
    <div className="space-y-3">
      <h3 className="font-bold">
        Pedido #{order.number} · {typeLabels[order.type]}
      </h3>
      <p className="text-sm">
        {data.orderAtClose
          ? "Detalle guardado al cierre."
          : data.session.status === "OPEN"
            ? "Estado actual del pedido."
            : "Este cierre es anterior al guardado de copias. Se muestra el pedido actual."}
      </p>
      <Facts
        values={[
          ["Estado", label(order.operationalStatus)],
          ["Pago", paymentStatusLabels[order.paymentStatus]],
          ["Cliente", order.customerNameSnapshot ?? "—"],
          ["Subtotal", money(order.subtotalMinor)],
          ["Descuento", money(order.discountMinor)],
          ["Total", money(order.totalMinor)],
          ["Seña", money(order.depositMinor)],
          ["Cobrado", money(order.paidMinor)],
          ["Vuelto", money(order.changeAmountMinor ?? 0)],
          ...(order.type === "DELIVERY"
            ? ([
                ["Repartidor", order.driverName ?? "Sin asignar"],
                ["Cargo al cliente", money(order.deliveryFeeMinor)],
                [
                  "Pago al repartidor",
                  money(
                    order.driverRemunerationMinor ??
                      (order.deliveryFeeBelongsToDriver === undefined &&
                      order.deliveryFeeMinor > 0
                        ? null
                        : order.deliveryFeeBelongsToDriver
                          ? order.deliveryFeeMinor
                          : 0),
                  ),
                ],
                [
                  "Cobró el pedido",
                  order.paidMinor === 0
                    ? "—"
                    : order.collectedByDriver
                      ? "Repartidor"
                      : "Local",
                ],
                ["Dirección", order.deliveryAddressSnapshot ?? "—"],
              ] as Array<[string, string]>)
            : []),
        ]}
      />
      <h4 className="text-sm font-bold">Productos</h4>
      {order.items.length ? (
        <ul className="divide-y text-sm">
          {order.items.map((i) => (
            <li className="flex justify-between gap-2 py-1" key={i.id}>
              <span>
                {i.quantity} × {i.productNameSnapshot}
                {i.halves.map((h) => (
                  <small className="block" key={h.position}>
                    {h.nameSnapshot}
                  </small>
                ))}
                {i.modifiers.map((m) => (
                  <small className="block" key={m.id}>
                    {m.nameSnapshot}
                  </small>
                ))}
                {i.notes && <small className="block">{i.notes}</small>}
              </span>
              <strong>{money(i.lineTotalMinor)}</strong>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm">Sin productos.</p>
      )}
      <h4 className="text-sm font-bold">Pagos del pedido</h4>
      {order.payments.length ? (
        <ul className="divide-y text-sm">
          {order.payments.map((p) => (
            <li key={p.id} className="py-1">
              <strong>
                {p.methodName} · {money(p.amountMinor)}
              </strong>{" "}
              · {when(p.createdAt)}
              {p.receivedMinor != null && (
                <span> · Recibido {money(p.receivedMinor)}</span>
              )}
              {p.refundedMinor > 0 && (
                <span> · Devuelto {money(p.refundedMinor)}</span>
              )}
              {p.reference && <span> · Ref. {p.reference}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm">Sin pagos registrados.</p>
      )}
      <h4 className="text-sm font-bold">
        Actividad en la caja #{data.session.number}
      </h4>
      <Events rows={inShift} />
      {outside.length > 0 && (
        <>
          <h4 className="text-sm font-bold">Actividad en otros turnos</h4>
          <Events rows={outside} />
        </>
      )}
    </div>
  );
}
