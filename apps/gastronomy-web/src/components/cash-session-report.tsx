import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  CashSessionHistoryItemDto,
  CashSessionReportFilters,
  CashSessionReportDto,
} from "@gastronomy/contracts";
import { Printer, Eye, Funnel, X } from "@phosphor-icons/react";
import { Badge, Button, Card, Field, Modal, Select } from "@gastronomy/ui";
import { formatMoney, statusLabels, typeLabels } from "../lib";
import { useApiMutation } from "../api";

export function CashSessionHistory({
  onReport,
}: {
  onReport: (id: string) => void;
}) {
  const history = useQuery({
    queryKey: ["cash-session-history"],
    queryFn: () => window.gastronomy.listCashSessionHistory(),
  });
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div>
          <h2 className="text-sm font-bold">Historial de cajas</h2>
          <p className="text-[11px] text-slate-400">
            Consultá cierres anteriores y el detalle reciente del turno.
          </p>
        </div>
        <Button variant="secondary" onClick={() => history.refetch()}>
          Actualizar
        </Button>
      </div>
      {history.isLoading ? (
        <p className="p-6 text-center text-xs text-slate-400">
          Cargando historial…
        </p>
      ) : history.isError ? (
        <p className="p-4 text-xs text-rose-600">
          No se pudo cargar el historial.
        </p>
      ) : !history.data?.length ? (
        <p className="p-6 text-center text-xs text-slate-500">
          Todavía no hay cajas cerradas.
        </p>
      ) : (
        <div className="overflow-auto">
          <table className="dn-table">
            <thead>
              <tr>
                <th>Caja</th>
                <th>Día comercial</th>
                <th>Apertura</th>
                <th>Cierre</th>
                <th>Total ventas</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {history.data.map((row: CashSessionHistoryItemDto) => (
                <tr key={row.session.id}>
                  <td className="font-bold">#{row.session.number}</td>
                  <td>{row.session.businessDate}</td>
                  <td>
                    {new Date(row.session.openedAt).toLocaleString("es-AR")}
                  </td>
                  <td>
                    {row.session.closedAt
                      ? new Date(row.session.closedAt).toLocaleString("es-AR")
                      : "—"}
                  </td>
                  <td>{formatMoney(row.session.salesTotalMinor ?? 0)}</td>
                  <td className="text-right">
                    <Button
                      variant="secondary"
                      onClick={() => onReport(row.session.id)}
                    >
                      <Eye />{" "}
                      {row.detailAvailable ? "Ver informe" : "Ver resumen"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

type FilterState = {
  tableId: string;
  waiterUserId: string;
  productId: string;
  categoryName: string;
  orderType: string;
  paymentMethodCode: string;
  operationalStatus: string;
};
const empty: FilterState = {
  tableId: "",
  waiterUserId: "",
  productId: "",
  categoryName: "",
  orderType: "",
  paymentMethodCode: "",
  operationalStatus: "",
};
export function CashSessionReportModal({
  open,
  sessionId,
  onClose,
}: {
  open: boolean;
  sessionId: string | null;
  onClose: () => void;
}) {
  const [filters, setFilters] = useState<FilterState>(empty);
  const [applied, setApplied] = useState<FilterState>(empty);
  const [printMessage, setPrintMessage] = useState<string | null>(null);
  useEffect(() => {
    setFilters(empty);
    setApplied(empty);
    setPrintMessage(null);
  }, [sessionId]);
  const report = useQuery({
    queryKey: ["cash-session-report", sessionId, applied],
    enabled: open && Boolean(sessionId),
    queryFn: () =>
      window.gastronomy.getCashSessionReport({
        cashSessionId: sessionId!,
        ...Object.fromEntries(Object.entries(applied).filter(([, v]) => v)),
      } as CashSessionReportFilters),
  });
  const print = useApiMutation(
    () =>
      window.gastronomy.printCashSessionReport({
        filters: {
          cashSessionId: sessionId!,
          ...Object.fromEntries(Object.entries(applied).filter(([, v]) => v)),
        } as CashSessionReportFilters,
      }),
    {
      onSuccess: (result) =>
        setPrintMessage(
          result.printed
            ? result.message || "Informe enviado a imprimir."
            : result.message || "Impresión cancelada.",
        ),
      onError: (error) => setPrintMessage(error.message),
    },
  );
  const data = report.data as CashSessionReportDto | undefined;
  const change = (key: keyof FilterState, value: string) =>
    setFilters((prev) => ({ ...prev, [key]: value }));
  const options = (key: keyof FilterState) =>
    data
      ? {
          tableId: data.byTable.map((x) => ({
            value: x.tableId ?? "",
            label: x.name,
          })),
          waiterUserId: data.byWaiter.map((x) => ({
            value: x.waiterUserId ?? "",
            label: x.name,
          })),
          productId: data.byProduct.map((x) => ({
            value: x.productId ?? "",
            label: x.name,
          })),
          categoryName: data.byCategory.map((x) => ({
            value: x.name,
            label: x.name,
          })),
          orderType: data.byType.map((x) => ({
            value: x.type,
            label: typeLabels[x.type],
          })),
          paymentMethodCode: data.byPaymentMethod.map((x) => ({
            value: x.code,
            label: x.name,
          })),
          operationalStatus: [],
        }[key]
      : [];
  return (
    <Modal
      open={open}
      onClose={onClose}
      width="max-w-6xl"
      title="Informe de caja"
      description="Ventas y movimientos asociados al turno"
    >
      <div className="grid max-h-[75vh] gap-4 overflow-y-auto">
        {data?.detailAvailable ? (
          <div className="grid gap-3 rounded-xl border border-slate-200 p-3 sm:grid-cols-2 lg:grid-cols-4">
            {(
              [
                "tableId",
                "waiterUserId",
                "productId",
                "categoryName",
                "orderType",
                "paymentMethodCode",
                "operationalStatus",
              ] as const
            ).map((key) => (
              <Field
                key={key}
                label={
                  {
                    tableId: "Mesa",
                    waiterUserId: "Mozo",
                    productId: "Producto",
                    categoryName: "Categoría",
                    orderType: "Tipo de pedido",
                    paymentMethodCode: "Medio de pago",
                    operationalStatus: "Estado",
                  }[key]
                }
              >
                <Select
                  value={filters[key]}
                  onChange={(e) => change(key, e.target.value)}
                >
                  <option value="">Todos</option>
                  {options(key).map((o, i) => (
                    <option key={`${o.value}-${i}`} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                  {key === "operationalStatus"
                    ? Object.entries(statusLabels).map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))
                    : null}
                </Select>
              </Field>
            ))}
            <div className="flex items-end gap-2">
              <Button onClick={() => setApplied({ ...filters })}>
                <Funnel /> Aplicar
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setFilters(empty);
                  setApplied(empty);
                }}
              >
                <X /> Limpiar
              </Button>
            </div>
          </div>
        ) : null}
        {report.isLoading ? (
          <p className="p-5 text-center text-xs text-slate-400">
            Calculando informe…
          </p>
        ) : report.isError ? (
          <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
            {report.error instanceof Error
              ? report.error.message
              : "No se pudo cargar el informe."}
          </p>
        ) : data ? (
          <>
            <Card className="p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-extrabold">
                    Caja #{data.session.number} · {data.session.businessDate}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {new Date(data.session.openedAt).toLocaleString("es-AR")} →{" "}
                    {data.session.closedAt
                      ? new Date(data.session.closedAt).toLocaleString("es-AR")
                      : "turno en curso"}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    Responsable: {data.session.openedByName}
                  </p>
                </div>
                <Badge
                  tone={data.session.status === "OPEN" ? "green" : "slate"}
                >
                  {data.session.status === "OPEN" ? "Abierta" : "Cerrada"}
                </Badge>
              </div>
            </Card>
            <div className="grid gap-2 sm:grid-cols-5">
              {[
                ["Ventas", data.totals.salesMinor],
                ["Pedidos", data.totals.orderCount],
                ["Ticket promedio", data.totals.averageTicketMinor],
                ["Descuentos", data.totals.discountsMinor],
                ["Devoluciones", data.totals.refundsMinor],
              ].map(([l, v]) => (
                <div key={String(l)} className="rounded-lg bg-slate-50 p-3">
                  <p className="text-[10px] uppercase text-slate-400">{l}</p>
                  <strong>
                    {String(l) === "Pedidos" ? v : formatMoney(v as number)}
                  </strong>
                </div>
              ))}
            </div>
            {data.detailAvailable ? (
              <>
                <Aggregates data={data} />
                <div className="overflow-auto">
                  <table className="dn-table">
                    <thead>
                      <tr>
                        <th>Pedido</th>
                        <th>Mesa</th>
                        <th>Mozo</th>
                        <th>Tipo</th>
                        <th>Estado</th>
                        <th className="text-right">Importe</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.orders.map((o) => (
                        <tr key={o.id}>
                          <td>#{o.number}</td>
                          <td>{o.tableNumber ?? "—"}</td>
                          <td>{o.waiterName ?? "—"}</td>
                          <td>{typeLabels[o.type]}</td>
                          <td>
                            <Badge tone="green">
                              {statusLabels[o.operationalStatus]}
                            </Badge>
                          </td>
                          <td className="text-right font-bold">
                            {formatMoney(o.paidMinor)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="overflow-auto">
                  <table className="dn-table">
                    <thead>
                      <tr>
                        <th>Movimiento</th>
                        <th>Motivo</th>
                        <th>Medio</th>
                        <th>Fecha</th>
                        <th className="text-right">Importe</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.movements.map((m) => (
                        <tr key={m.id}>
                          <td>{m.type}</td>
                          <td>{m.reason ?? "—"}</td>
                          <td>{m.paymentMethodCode ?? "—"}</td>
                          <td>
                            {new Date(m.createdAt).toLocaleString("es-AR")}
                          </td>
                          <td className="text-right font-bold">
                            {formatMoney(m.amountMinor)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                Este turno supera la retención de 2 meses: se muestra únicamente
                el resumen.
              </p>
            )}
            <div className="flex justify-end">
              <Button onClick={() => print.mutate()} disabled={print.isPending}>
                <Printer /> Imprimir informe
              </Button>
            </div>
            {printMessage ? (
              <p className="text-right text-xs text-slate-500">
                {printMessage}
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </Modal>
  );
}

function Aggregates({ data }: { data: CashSessionReportDto }) {
  const groups = [
    [
      "Por producto",
      data.byProduct.map((x) => `${x.name}: ${formatMoney(x.amountMinor)}`),
    ],
    [
      "Por categoría",
      data.byCategory.map((x) => `${x.name}: ${formatMoney(x.amountMinor)}`),
    ],
    [
      "Por mesa",
      data.byTable.map((x) => `${x.name}: ${formatMoney(x.amountMinor)}`),
    ],
    [
      "Por mozo",
      data.byWaiter.map((x) => `${x.name}: ${formatMoney(x.amountMinor)}`),
    ],
    [
      "Por tipo",
      data.byType.map(
        (x) => `${typeLabels[x.type]}: ${formatMoney(x.amountMinor)}`,
      ),
    ],
    [
      "Por medio de pago",
      data.byPaymentMethod.map(
        (x) => `${x.name}: ${formatMoney(x.amountMinor)}`,
      ),
    ],
  ] as const;
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {groups.map(([label, values]) => (
        <div key={label} className="rounded-lg border border-slate-100 p-3">
          <p className="text-[10px] font-bold uppercase text-slate-400">
            {label}
          </p>
          {values.length ? (
            values.map((v) => (
              <p key={v} className="mt-1 text-xs">
                {v}
              </p>
            ))
          ) : (
            <p className="mt-1 text-xs text-slate-400">Sin datos</p>
          )}
        </div>
      ))}
    </div>
  );
}
