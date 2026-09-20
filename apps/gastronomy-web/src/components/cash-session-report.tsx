import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  CashSessionHistoryItemDto,
  CashSessionReportFilters,
  CashSessionReportDto,
  CashSessionReportPrintSections,
} from "@gastronomy/contracts";
import { Printer, Eye, Funnel, X, Check, Receipt } from "@phosphor-icons/react";
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
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
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
        <div className="overflow-x-auto">
          <table className="dn-table min-w-[720px]">
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
                  <td className="whitespace-nowrap">{formatMoney(row.session.salesTotalMinor ?? 0)}</td>
                  <td className="text-right whitespace-nowrap">
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
  const [printModalOpen, setPrintModalOpen] = useState(false);
  const print = useApiMutation(
    (sections?: CashSessionReportPrintSections) =>
      window.gastronomy.printCashSessionReport({
        filters: {
          cashSessionId: sessionId!,
          ...Object.fromEntries(Object.entries(applied).filter(([, v]) => v)),
        } as CashSessionReportFilters,
        sections,
      }),
    {
      onSuccess: (result) => {
        setPrintMessage(
          result.printed
            ? result.message || "Informe enviado a imprimir."
            : result.message || "Impresión cancelada.",
        );
        setPrintModalOpen(false);
      },
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
            <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
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
            <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
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
                <div className="overflow-x-auto">
                  <table className="dn-table min-w-[640px]">
                    <thead>
                      <tr>
                        <th>Pedido</th>
                        <th>Mesa</th>
                        <th>Mozo</th>
                        <th>Tipo</th>
                        <th>Estado</th>
                        <th className="text-right whitespace-nowrap">Importe</th>
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
                          <td className="whitespace-nowrap text-right font-bold">
                            {formatMoney(o.paidMinor)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="overflow-x-auto">
                  <table className="dn-table min-w-[640px]">
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
                          <td>
                            {m.paymentMethodName ??
                              (m.paymentMethodCode === "CASH"
                                ? "Efectivo"
                                : m.paymentMethodCode ?? "—")}
                          </td>
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
              <Button onClick={() => setPrintModalOpen(true)}>
                <Printer /> Imprimir informe
              </Button>
            </div>
            {printMessage ? (
              <p className="text-right text-xs text-slate-500">
                {printMessage}
              </p>
            ) : null}
            {data ? (
              <PrintCashSessionReportModal
                open={printModalOpen}
                onClose={() => setPrintModalOpen(false)}
                data={data}
                appliedFilters={applied}
                isPrinting={print.isPending}
                onPrint={(sections) => print.mutate(sections)}
              />
            ) : null}
          </>
        ) : null}
      </div>
    </Modal>
  );
}

function Aggregates({ data }: { data: CashSessionReportDto }) {
  const standardGroups = [
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
      {standardGroups.map(([label, values]) => (
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
      <div className="rounded-lg border border-slate-100 p-3">
        <p className="text-[10px] font-bold uppercase text-slate-400">
          Por mozo
        </p>
        {data.byWaiter.length ? (
          <div className="mt-1 space-y-2">
            {data.byWaiter.map((w) => (
              <div
                key={w.waiterUserId ?? w.name}
                className="border-b border-slate-100 pb-1.5 last:border-b-0 last:pb-0"
              >
                <div className="flex justify-between text-xs font-bold">
                  <span>{w.name}</span>
                  <span>{formatMoney(w.amountMinor)}</span>
                </div>
                {w.tables && w.tables.length > 0 ? (
                  <div className="mt-0.5 space-y-0.5 pl-2 text-[11px] text-slate-500">
                    {w.tables.map((t, idx) => (
                      <div key={idx} className="flex justify-between">
                        <span>{t.name}</span>
                        <span>{formatMoney(t.amountMinor)}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-1 text-xs text-slate-400">Sin datos</p>
        )}
      </div>
    </div>
  );
}

export function PrintCashSessionReportModal({
  open,
  onClose,
  data,
  appliedFilters,
  onPrint,
  isPrinting,
}: {
  open: boolean;
  onClose: () => void;
  data: CashSessionReportDto;
  appliedFilters: FilterState;
  onPrint: (sections: CashSessionReportPrintSections) => void;
  isPrinting: boolean;
}) {
  const [sections, setSections] = useState<CashSessionReportPrintSections>({
    byProduct: true,
    byCategory: true,
    byTable: true,
    byWaiter: true,
    orderDetails: false,
  });

  const toggle = (key: keyof CashSessionReportPrintSections) => {
    setSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const selectAll = () => {
    setSections({
      byProduct: true,
      byCategory: true,
      byTable: true,
      byWaiter: true,
      orderDetails: true,
    });
  };

  const selectMandatoryOnly = () => {
    setSections({
      byProduct: false,
      byCategory: false,
      byTable: false,
      byWaiter: false,
      orderDetails: false,
    });
  };

  const appliedFilterCount = Object.values(appliedFilters).filter(Boolean).length;

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="max-w-4xl"
      title="Imprimir informe de caja"
      description="Seleccioná qué secciones incluir y revisá la vista previa del ticket antes de imprimir"
    >
      <div className="grid gap-6 lg:grid-cols-12 max-h-[75vh] overflow-y-auto pr-1">
        {/* Columna Izquierda: Configuración de secciones */}
        <div className="space-y-4 lg:col-span-6">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
              Secciones obligatorias (siempre incluidas)
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {[
                "Resumen de ventas",
                "Arqueo de caja",
                "Por tipo (canales)",
                "Por medio de pago",
              ].map((name) => (
                <div
                  key={name}
                  className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-xs font-medium text-emerald-900"
                >
                  <Check className="h-4 w-4 text-emerald-600 shrink-0" weight="bold" />
                  <span>{name}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-slate-200 pt-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Secciones opcionales
              </h3>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={selectAll}
                  className="text-[11px] font-semibold text-brand-600 hover:text-brand-700 underline"
                >
                  Todas
                </button>
                <span className="text-slate-300">·</span>
                <button
                  type="button"
                  onClick={selectMandatoryOnly}
                  className="text-[11px] font-semibold text-slate-500 hover:text-slate-700 underline"
                >
                  Solo obligatorias
                </button>
              </div>
            </div>

            <div className="space-y-2">
              {[
                {
                  key: "byProduct" as const,
                  label: "Por producto",
                  desc: "Cantidades y ventas desglosadas por cada artículo",
                  count: data.byProduct.length,
                },
                {
                  key: "byCategory" as const,
                  label: "Por categoría",
                  desc: "Ventas agrupadas por rubro o categoría",
                  count: data.byCategory.length,
                },
                {
                  key: "byTable" as const,
                  label: "Por mesa",
                  desc: "Ventas y pedidos agrupados por mesa",
                  count: data.byTable.length,
                },
                {
                  key: "byWaiter" as const,
                  label: "Por mozo",
                  desc: "Mesas atendidas de cada mozo y total acumulado",
                  count: data.byWaiter.length,
                },
                {
                  key: "orderDetails" as const,
                  label: "Detalle de pedidos",
                  desc: "Listado correlativo de comandas individuales",
                  count: data.orders.length,
                },
              ].map(({ key, label, desc, count }) => (
                <label
                  key={key}
                  className={`flex items-start gap-3 rounded-xl border p-3 cursor-pointer transition-colors ${
                    sections[key]
                      ? "border-brand-300 bg-brand-50/30"
                      : "border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={Boolean(sections[key])}
                    onChange={() => toggle(key)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-300"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-800">
                        {label}
                      </span>
                      <span className="text-[10px] font-medium text-slate-400">
                        {count} {count === 1 ? "ítem" : "ítems"}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5">{desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Columna Derecha: Vista previa en vivo del ticket */}
        <div className="lg:col-span-6 flex flex-col items-center">
          <div className="w-full flex items-center justify-between mb-2 px-1">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <Receipt className="h-4 w-4 text-slate-600" />
              Vista previa del ticket
            </span>
            <span className="text-[11px] text-slate-400">
              {appliedFilterCount > 0 ? `${appliedFilterCount} filtro(s) activo(s)` : "Sin filtros"}
            </span>
          </div>

          <div className="w-full max-w-[340px] rounded-lg border border-slate-300 bg-white p-4 shadow-sm text-black font-mono text-[11px] leading-tight select-none overflow-y-auto max-h-[50vh]">
            <div className="text-center font-bold">
              <p className="text-xs uppercase tracking-wider">DELTA GASTRONOMÍA</p>
              <p className="text-sm font-black">INFORME DE CAJA #{data.session.number}</p>
              <p className="text-[10px] font-normal text-slate-600">CAJA PRINCIPAL</p>
            </div>
            <div className="my-2 border-t border-dashed border-slate-400" />
            <div className="space-y-0.5 text-[10px]">
              <div><strong>Día comercial:</strong> {data.session.businessDate}</div>
              <div><strong>Apertura:</strong> {new Date(data.session.openedAt).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}</div>
              <div><strong>Cierre:</strong> {data.session.closedAt ? new Date(data.session.closedAt).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) : "En curso"}</div>
              <div><strong>Responsable:</strong> {data.session.openedByName}</div>
            </div>

            <div className="my-2 border-t border-dashed border-slate-400" />
            <div className="font-bold uppercase text-[10px] tracking-wide mb-1">RESUMEN</div>
            <div className="space-y-0.5">
              <div className="flex justify-between font-black text-xs border-y border-black py-0.5">
                <span>Ventas</span>
                <span>{formatMoney(data.totals.salesMinor)}</span>
              </div>
              <div className="flex justify-between">
                <span>Pedidos</span>
                <span>{data.totals.orderCount}</span>
              </div>
              <div className="flex justify-between">
                <span>Ticket promedio</span>
                <span>{formatMoney(data.totals.averageTicketMinor)}</span>
              </div>
              <div className="flex justify-between">
                <span>Descuentos</span>
                <span>{formatMoney(data.totals.discountsMinor)}</span>
              </div>
              <div className="flex justify-between">
                <span>Devoluciones</span>
                <span>{formatMoney(data.totals.refundsMinor)}</span>
              </div>
            </div>

            <div className="my-2 border-t border-dashed border-slate-400" />
            <div className="font-bold uppercase text-[10px] tracking-wide mb-1">ARQUEO</div>
            <div className="space-y-0.5">
              <div className="flex justify-between"><span>Apertura</span><span>{formatMoney(data.session.openingAmountMinor)}</span></div>
              <div className="flex justify-between"><span>Esperado</span><span>{formatMoney(data.session.expectedAmountMinor)}</span></div>
              <div className="flex justify-between"><span>Contado</span><span>{data.session.countedAmountMinor != null ? formatMoney(data.session.countedAmountMinor) : "—"}</span></div>
              <div className="flex justify-between font-bold"><span>Diferencia</span><span>{data.session.differenceMinor != null ? formatMoney(data.session.differenceMinor) : "—"}</span></div>
            </div>

            <div className="my-2 border-t border-dashed border-slate-400" />
            <div className="font-bold uppercase text-[10px] tracking-wide mb-1">POR TIPO</div>
            <div className="space-y-0.5">
              {data.byType.map((row) => (
                <div key={row.type} className="flex justify-between">
                  <span>{typeLabels[row.type] ?? row.type}</span>
                  <strong>{formatMoney(row.amountMinor)}</strong>
                </div>
              ))}
            </div>

            <div className="my-2 border-t border-dashed border-slate-400" />
            <div className="font-bold uppercase text-[10px] tracking-wide mb-1">POR MEDIO DE PAGO</div>
            <div className="space-y-0.5">
              {data.byPaymentMethod.map((row) => (
                <div key={row.code} className="flex justify-between">
                  <span>{row.name}</span>
                  <strong>{formatMoney(row.amountMinor)}</strong>
                </div>
              ))}
            </div>

            {sections.byProduct && data.byProduct.length > 0 && (
              <>
                <div className="my-2 border-t border-dashed border-slate-400" />
                <div className="font-bold uppercase text-[10px] tracking-wide mb-1">POR PRODUCTO</div>
                <div className="space-y-0.5">
                  {data.byProduct.map((row) => (
                    <div key={row.productId ?? row.name} className="flex justify-between">
                      <span className="truncate pr-2">{row.name} ×{row.quantity}</span>
                      <strong>{formatMoney(row.amountMinor)}</strong>
                    </div>
                  ))}
                </div>
              </>
            )}

            {sections.byCategory && data.byCategory.length > 0 && (
              <>
                <div className="my-2 border-t border-dashed border-slate-400" />
                <div className="font-bold uppercase text-[10px] tracking-wide mb-1">POR CATEGORÍA</div>
                <div className="space-y-0.5">
                  {data.byCategory.map((row) => (
                    <div key={row.name} className="flex justify-between">
                      <span className="truncate pr-2">{row.name} ×{row.quantity}</span>
                      <strong>{formatMoney(row.amountMinor)}</strong>
                    </div>
                  ))}
                </div>
              </>
            )}

            {sections.byTable && data.byTable.length > 0 && (
              <>
                <div className="my-2 border-t border-dashed border-slate-400" />
                <div className="font-bold uppercase text-[10px] tracking-wide mb-1">POR MESA</div>
                <div className="space-y-0.5">
                  {data.byTable.map((row) => (
                    <div key={row.tableId ?? row.name} className="flex justify-between">
                      <span>{row.name}</span>
                      <strong>{formatMoney(row.amountMinor)}</strong>
                    </div>
                  ))}
                </div>
              </>
            )}

            {sections.byWaiter && data.byWaiter.length > 0 && (
              <>
                <div className="my-2 border-t border-dashed border-slate-400" />
                <div className="font-bold uppercase text-[10px] tracking-wide mb-1">POR MOZO</div>
                <div className="space-y-2">
                  {data.byWaiter.map((w) => (
                    <div key={w.waiterUserId ?? w.name} className="border-b border-dotted border-slate-300 pb-1.5 last:border-b-0 last:pb-0">
                      <div className="font-bold text-slate-900">{w.name}</div>
                      {w.tables && w.tables.length > 0 ? (
                        <div className="pl-2 space-y-0.5 text-[10px] text-slate-700">
                          {w.tables.map((t, i) => (
                            <div key={i} className="flex justify-between">
                              <span>{t.name}</span>
                              <span>{formatMoney(t.amountMinor)}</span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      <div className="flex justify-between font-bold text-[10px] pt-0.5 mt-0.5 border-t border-dashed border-slate-200">
                        <span>Total {w.name}:</span>
                        <span>{formatMoney(w.amountMinor)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {sections.orderDetails && data.orders.length > 0 && (
              <>
                <div className="my-2 border-t border-dashed border-slate-400" />
                <div className="font-bold uppercase text-[10px] tracking-wide mb-1">DETALLE DE PEDIDOS</div>
                <div className="space-y-0.5 text-[10px]">
                  {data.orders.map((o) => (
                    <div key={o.id} className="flex justify-between">
                      <span className="truncate pr-2">#{o.number} · {o.items[0]?.productNameSnapshot ?? o.type}</span>
                      <strong>{formatMoney(o.totalMinor)}</strong>
                    </div>
                  ))}
                </div>
              </>
            )}

            <div className="my-2 border-t border-dashed border-slate-400" />
            <p className="text-center text-[9px] text-slate-500">
              Impreso: {new Date().toLocaleString("es-AR")}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-3 border-t border-slate-200 pt-4">
        <Button variant="secondary" onClick={onClose} disabled={isPrinting}>
          Cancelar
        </Button>
        <Button
          onClick={() => onPrint(sections)}
          disabled={isPrinting}
        >
          <Printer /> Imprimir ticket
        </Button>
      </div>
    </Modal>
  );
}
