import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  cashClosingTotals,
  cashOutflowGroups,
  cashReportBreakdown,
} from "@gastronomy/domain";
import type {
  CashSessionHistoryItemDto,
  CashSessionReportFilters,
  CashSessionReportDto,
  CashSessionReportPrintSections,
} from "@gastronomy/contracts";
import { Printer, Eye, Funnel, X, Check, Receipt } from "@phosphor-icons/react";
import { Badge, Button, Card, Field, Modal, Select } from "@gastronomy/ui";
import { formatMoney, statusLabels, typeLabels } from "../lib";
import { useApiMutation, useBootstrap } from "../api";

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
          <p className="text-xs text-slate-600">
            Consultá cierres anteriores y el detalle reciente del turno.
          </p>
        </div>
        <Button variant="secondary" onClick={() => history.refetch()}>
          Actualizar
        </Button>
      </div>
      {history.isLoading ? (
        <p className="p-6 text-center text-xs text-slate-600">
          Cargando historial…
        </p>
      ) : history.isError ? (
        <p className="p-4 text-xs text-rose-600">
          No se pudo cargar el historial.
        </p>
      ) : !history.data?.length ? (
        <p className="p-6 text-center text-xs text-slate-600">
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
                    {new Date(row.session.openedAt).toLocaleString("es-AR", {
                      timeZone: "America/Buenos_Aires",
                      hourCycle: "h23",
                    })}
                  </td>
                  <td>
                    {row.session.closedAt
                      ? new Date(row.session.closedAt).toLocaleString("es-AR", {
                          timeZone: "America/Buenos_Aires",
                          hourCycle: "h23",
                        })
                      : "—"}
                  </td>
                  <td className="whitespace-nowrap">
                    {formatMoney(row.session.salesTotalMinor ?? 0)}
                  </td>
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
  const [printModalOpen, setPrintModalOpen] = useState(false);
  useEffect(() => {
    setFilters(empty);
    setApplied(empty);
    setPrintMessage(null);
    setPrintModalOpen(false);
  }, [sessionId, open]);
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
    (sections?: CashSessionReportPrintSections) =>
      window.gastronomy.printCashSessionReport({
        filters: {
          cashSessionId: sessionId!,
          ...Object.fromEntries(Object.entries(applied).filter(([, v]) => v)),
        } as CashSessionReportFilters,
        sections,
      }),
    {
      onMutate: () => setPrintMessage(null),
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
  const closingTotals = data ? cashClosingTotals(data.session) : null;
  const closingReason = data?.detailAvailable
    ? data.session.movements
        ?.find((movement) => movement.type === "CLOSING")
        ?.reason?.trim()
    : undefined;
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
      closeDisabled={print.isPending}
    >
      <div className="flex max-h-[75vh] min-h-0 flex-col">
        <div className="grid min-h-0 flex-1 auto-rows-max gap-4 overflow-y-auto">
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
            <p className="p-5 text-center text-xs text-slate-600">
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
                    <p className="mt-1 text-xs text-slate-600">
                      {new Date(data.session.openedAt).toLocaleString("es-AR", {
                        timeZone: "America/Buenos_Aires",
                        hourCycle: "h23",
                      })}{" "}
                      →{" "}
                      {data.session.closedAt
                        ? new Date(data.session.closedAt).toLocaleString(
                            "es-AR",
                            {
                              timeZone: "America/Buenos_Aires",
                              hourCycle: "h23",
                            },
                          )
                        : "turno en curso"}
                    </p>
                    <p className="text-xs text-slate-600">
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
                    <p className="text-xs uppercase text-slate-600">{l}</p>
                    <strong>
                      {String(l) === "Pedidos" ? v : formatMoney(v as number)}
                    </strong>
                  </div>
                ))}
              </div>
              <Card className="p-3">
                <h3 className="text-sm font-bold">Resultado del cierre</h3>
                <p className="mt-1 text-xs text-slate-600">
                  El cambio final queda aparte del esperado y contado. Los pagos
                  a repartidores se descuentan como egresos. Las ventas por
                  medio de pago no representan el efectivo disponible.
                  {Object.values(applied).some(Boolean)
                    ? " El arqueo corresponde al turno completo, sin aplicar filtros de ventas."
                    : ""}
                </p>
                <div className="mt-3 space-y-1 text-xs">
                  <p className="font-bold uppercase tracking-wide">
                    Movimientos de efectivo
                  </p>
                  {cashReportBreakdown(
                    data.session,
                    closingTotals!.closingFloatAmountMinor,
                  ).map((row) => (
                    <div key={row.label} className="flex justify-between gap-3">
                      <span>{row.label}</span>
                      <strong>{formatMoney(row.amountMinor)}</strong>
                    </div>
                  ))}
                  <div className="flex justify-between gap-3 border-t border-slate-200 pt-2 font-bold">
                    <span>Esperado sin cambio</span>
                    <span>
                      {formatMoney(closingTotals!.expectedAmountMinor)}
                    </span>
                  </div>
                  {data.session.status === "CLOSED" ? (
                    <>
                      <div className="flex justify-between gap-3">
                        <span>Contado sin cambio</span>
                        <span>
                          {data.session.countedAmountMinor == null
                            ? "—"
                            : formatMoney(closingTotals!.countedAmountMinor!)}
                        </span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span>Cambio final</span>
                        <span>
                          {formatMoney(closingTotals!.closingFloatAmountMinor)}
                        </span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span>Diferencia</span>
                        <span>
                          {data.session.differenceMinor == null
                            ? "—"
                            : formatMoney(data.session.differenceMinor)}
                        </span>
                      </div>
                      {data.session.differenceMinor != null ? (
                        <p className="text-xs font-semibold">
                          {data.session.differenceMinor === 0
                            ? "Cuadra"
                            : data.session.differenceMinor < 0
                              ? "Faltante"
                              : "Sobrante"}
                        </p>
                      ) : null}
                      {closingReason ? (
                        <p className="text-xs">
                          <strong>Motivo del cierre:</strong> {closingReason}
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <p className="pt-1 text-xs text-slate-600">
                      Turno en curso: esperado sin cambio; los movimientos
                      reflejan el turno actual. El cambio inicial queda
                      excluido; contado, cambio final y diferencia estarán
                      disponibles al cerrar.
                    </p>
                  )}
                </div>
              </Card>
              {data.detailAvailable ? (
                <>
                  <Aggregates data={data} />
                  <div
                    role="region"
                    aria-label="Pedidos del turno"
                    tabIndex={0}
                    className="max-h-72 min-h-0 overflow-auto rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                  >
                    <table className="dn-table min-w-[640px]">
                      <thead>
                        <tr>
                          <th>Pedido</th>
                          <th>Mesa</th>
                          <th>Mozo</th>
                          <th>Tipo</th>
                          <th>Estado</th>
                          <th className="text-right whitespace-nowrap">
                            Importe
                          </th>
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
                  <div
                    role="region"
                    aria-label="Movimientos del turno"
                    tabIndex={0}
                    className="max-h-72 min-h-0 overflow-auto rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                  >
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
                                  : (m.paymentMethodCode ?? "—"))}
                            </td>
                            <td>
                              {new Date(m.createdAt).toLocaleString("es-AR", {
                                timeZone: "America/Buenos_Aires",
                                hourCycle: "h23",
                              })}
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
                  Este turno supera la retención de 2 meses: se muestra
                  únicamente el resumen.
                </p>
              )}
            </>
          ) : null}
        </div>
        {data && !report.isLoading && !report.isError ? (
          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-3">
            <Button
              disabled={print.isPending}
              onClick={() => print.mutate({ ...mandatoryOnlyPrintSections })}
            >
              <Printer />{" "}
              {print.isPending ? "Enviando a imprimir…" : "Imprimir informe"}
            </Button>
            <Button
              variant="secondary"
              disabled={print.isPending}
              onClick={() => setPrintModalOpen(true)}
            >
              <Receipt /> Personalizar ticket
            </Button>
          </div>
        ) : null}
        {printMessage ? (
          <p role="status" className="pt-2 text-right text-xs text-slate-600">
            {printMessage}
          </p>
        ) : null}
        {printModalOpen && data ? (
          <PrintCashSessionReportModal
            open={printModalOpen}
            onClose={() => {
              if (!print.isPending) setPrintModalOpen(false);
            }}
            data={data}
            appliedFilters={applied}
            isPrinting={print.isPending}
            onPrint={(sections) => print.mutate(sections)}
          />
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
    <div className="grid min-h-0 min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {standardGroups.map(([label, values]) => (
        <div
          key={label}
          className="min-h-0 min-w-0 rounded-lg border border-slate-100 p-3"
        >
          <p className="text-xs font-bold uppercase text-slate-600">{label}</p>
          {values.length ? (
            <div
              role="region"
              aria-label={`Resumen ${label}`}
              className="mt-1 max-h-48 min-h-0 overflow-auto break-words"
              tabIndex={0}
            >
              {values.map((v) => (
                <p key={v} className="mt-1 text-xs">
                  {v}
                </p>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-xs text-slate-600">Sin datos</p>
          )}
        </div>
      ))}
      <div className="min-h-0 min-w-0 rounded-lg border border-slate-100 p-3">
        <p className="text-xs font-bold uppercase text-slate-600">Por mozo</p>
        {data.byWaiter.length ? (
          <div
            role="region"
            aria-label="Resumen Por mozo"
            className="mt-1 max-h-48 min-h-0 space-y-2 overflow-auto break-words"
            tabIndex={0}
          >
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
                  <div className="mt-0.5 space-y-0.5 pl-2 text-xs text-slate-600">
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
          <p className="mt-1 text-xs text-slate-600">Sin datos</p>
        )}
      </div>
    </div>
  );
}

const mandatoryOnlyPrintSections: CashSessionReportPrintSections = {
  byProduct: false,
  byCategory: false,
  byTable: false,
  byWaiter: false,
  orderDetails: false,
};

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
  const bootstrap = useBootstrap();
  const closingTotals = cashClosingTotals(data.session);
  const cashMovements = data.session.movements ?? data.movements;
  const outflowGroups = data.detailAvailable
    ? cashOutflowGroups(cashMovements)
    : [];
  const hasSummarizedOutflows = Boolean(
    (data.session.cashExpenseMinor ?? 0) > 0 ||
    (data.session.cashWithdrawalMinor ?? 0) > 0 ||
    (data.session.cashRefundMinor ?? 0) > 0,
  );
  const closingReason = data.detailAvailable
    ? data.session.movements
        ?.find((movement) => movement.type === "CLOSING")
        ?.reason?.trim()
    : undefined;
  const businessName =
    bootstrap.data?.settings.businessName?.trim() || "Informe de caja";
  const terminalLabel = bootstrap.data?.settings.printing.terminalLabel?.trim();
  const [sections, setSections] = useState<CashSessionReportPrintSections>(
    () => ({ ...mandatoryOnlyPrintSections }),
  );
  useEffect(() => {
    if (open) setSections({ ...mandatoryOnlyPrintSections });
  }, [open]);

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
    setSections({ ...mandatoryOnlyPrintSections });
  };

  const appliedFilterCount =
    Object.values(appliedFilters).filter(Boolean).length;

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="max-w-4xl"
      title="Imprimir informe de caja"
      description="Seleccioná qué secciones incluir y revisá la vista previa del ticket antes de imprimir"
      closeDisabled={isPrinting}
    >
      <div className="grid gap-6 lg:grid-cols-12 max-h-[75vh] overflow-y-auto pr-1">
        {/* Columna Izquierda: Configuración de secciones */}
        <div className="space-y-4 lg:col-span-6">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 mb-2">
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
                  <Check
                    className="h-4 w-4 text-emerald-600 shrink-0"
                    weight="bold"
                  />
                  <span>{name}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-slate-200 pt-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
                Secciones opcionales
              </h3>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={selectAll}
                  disabled={!data.detailAvailable || isPrinting}
                  className="text-xs font-semibold text-brand-700 hover:text-brand-700 underline"
                >
                  Todas
                </button>
                <span className="text-slate-300">·</span>
                <button
                  type="button"
                  onClick={selectMandatoryOnly}
                  disabled={isPrinting}
                  className="text-xs font-semibold text-slate-600 hover:text-slate-700 underline"
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
                    disabled={!data.detailAvailable || isPrinting}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-300"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-800">
                        {label}
                      </span>
                      <span className="text-xs font-medium text-slate-600">
                        {count} {count === 1 ? "ítem" : "ítems"}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 mt-0.5">{desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Columna Derecha: Vista previa en vivo del ticket */}
        <div className="lg:col-span-6 flex flex-col items-center">
          <div className="w-full flex items-center justify-between mb-2 px-1">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
              <Receipt className="h-4 w-4 text-slate-600" />
              Vista previa del ticket
            </span>
            <span className="text-xs text-slate-600">
              {appliedFilterCount > 0
                ? `${appliedFilterCount} filtro(s) activo(s)`
                : "Sin filtros"}
            </span>
          </div>

          <div
            role="region"
            aria-label="Vista previa del ticket"
            tabIndex={0}
            className="w-full max-w-[340px] rounded-lg border border-slate-300 bg-white p-4 shadow-sm text-black font-mono text-xs leading-tight overflow-y-auto max-h-[50vh]"
          >
            <div className="text-center font-bold">
              <p className="text-xs uppercase tracking-wider">{businessName}</p>
              <p className="text-sm font-black">
                INFORME DE CAJA #{data.session.number}
              </p>
              <p className="text-xs font-normal text-slate-600">
                {terminalLabel ||
                  (data.session.status === "OPEN"
                    ? "TURNO EN CURSO"
                    : "CIERRE DE CAJA")}
              </p>
            </div>
            <div className="my-2 border-t border-dashed border-slate-400" />
            <div className="space-y-0.5 text-xs">
              <div>
                <strong>Día comercial:</strong> {data.session.businessDate}
              </div>
              <div>
                <strong>Apertura:</strong>{" "}
                {new Date(data.session.openedAt).toLocaleString("es-AR", {
                  timeZone: "America/Buenos_Aires",
                  hourCycle: "h23",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
              <div>
                <strong>Cierre:</strong>{" "}
                {data.session.closedAt
                  ? new Date(data.session.closedAt).toLocaleString("es-AR", {
                      timeZone: "America/Buenos_Aires",
                      hourCycle: "h23",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "En curso"}
              </div>
              <div>
                <strong>Responsable:</strong> {data.session.openedByName}
              </div>
            </div>

            {appliedFilterCount > 0 ? (
              <p className="my-2 border border-black p-2 text-xs">
                <strong>Ventas filtradas.</strong> El arqueo corresponde al
                turno completo, sin filtros.
              </p>
            ) : null}

            <div className="my-2 border-t border-dashed border-slate-400" />
            <div className="font-bold uppercase text-xs tracking-wide mb-1">
              RESUMEN DE VENTAS
            </div>
            <div className="space-y-0.5">
              <div className="flex justify-between font-black text-xs border-y border-black py-0.5">
                <span>
                  {appliedFilterCount > 0
                    ? "Ventas filtradas"
                    : "Ventas totales"}
                </span>
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
            <div className="font-bold uppercase text-xs tracking-wide mb-1">
              POR MEDIO DE PAGO
            </div>
            <div className="space-y-0.5">
              {data.byPaymentMethod.map((row) => (
                <div key={row.code} className="flex justify-between gap-2">
                  <span>{row.name}</span>
                  <strong className="whitespace-nowrap">
                    {formatMoney(row.amountMinor)}
                  </strong>
                </div>
              ))}
            </div>

            <div className="my-2 border-t border-dashed border-slate-400" />
            <div className="font-bold uppercase text-xs tracking-wide mb-1">
              POR TIPO
            </div>
            <div className="space-y-0.5">
              {data.byType.map((row) => (
                <div key={row.type} className="flex justify-between gap-2">
                  <span className="break-words">
                    {typeLabels[row.type] ?? row.type}
                  </span>
                  <strong className="whitespace-nowrap">
                    {formatMoney(row.amountMinor)}
                  </strong>
                </div>
              ))}
            </div>

            <div className="my-2 border-t border-dashed border-slate-400" />
            <div className="font-bold uppercase text-xs tracking-wide mb-1">
              RESULTADO DEL CIERRE
            </div>
            {data.session.status === "CLOSED" ? (
              <>
                <div className="space-y-0.5">
                  <div className="flex justify-between gap-2 font-bold">
                    <span>Esperado sin cambio</span>
                    <span className="whitespace-nowrap">
                      {formatMoney(closingTotals.expectedAmountMinor)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span>Contado sin cambio</span>
                    <span className="whitespace-nowrap">
                      {closingTotals.countedAmountMinor != null
                        ? formatMoney(closingTotals.countedAmountMinor)
                        : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span>Cambio final</span>
                    <span className="whitespace-nowrap">
                      {formatMoney(closingTotals.closingFloatAmountMinor)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2 font-bold">
                    <span>Diferencia</span>
                    <span className="whitespace-nowrap">
                      {data.session.differenceMinor != null
                        ? formatMoney(data.session.differenceMinor)
                        : "—"}
                    </span>
                  </div>
                </div>
                {data.session.differenceMinor != null ? (
                  <p className="text-xs font-bold">
                    {data.session.differenceMinor === 0
                      ? "Cuadra"
                      : data.session.differenceMinor < 0
                        ? "Faltante"
                        : "Sobrante"}
                  </p>
                ) : null}
                {closingReason ? (
                  <p className="text-xs">
                    <strong>Motivo del cierre:</strong> {closingReason}
                  </p>
                ) : null}
                <p className="mt-1 text-xs">
                  Esperado y contado excluyen el cambio final que queda en caja.
                </p>
              </>
            ) : (
              <>
                <div className="flex justify-between gap-2 font-bold">
                  <span>Esperado sin cambio</span>
                  <span className="whitespace-nowrap">
                    {formatMoney(closingTotals.expectedAmountMinor)}
                  </span>
                </div>
                <p className="text-xs text-slate-600">
                  Turno en curso: esperado sin cambio; los movimientos reflejan
                  el turno actual. El cambio inicial queda excluido; contado,
                  cambio final y diferencia estarán disponibles al cerrar.
                </p>
              </>
            )}

            <>
              <div className="my-2 border-t border-dashed border-slate-400" />
              <div className="font-bold uppercase text-xs tracking-wide mb-1">
                MOVIMIENTOS DE EFECTIVO
              </div>
              <div className="space-y-0.5">
                {cashReportBreakdown(
                  data.session,
                  closingTotals.closingFloatAmountMinor,
                ).map((row) => (
                  <div key={row.label} className="flex justify-between gap-2">
                    <span className="break-words">{row.label}</span>
                    <span className="whitespace-nowrap">
                      {formatMoney(row.amountMinor)}
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-1 text-xs text-slate-600">
                Los pagos a repartidores ya están incluidos en los egresos.
              </p>
            </>

            <>
              <div className="my-2 border-t border-dashed border-slate-400" />
              <div className="font-bold uppercase text-xs tracking-wide mb-1">
                DETALLE DE EGRESOS EN EFECTIVO
              </div>
              {!data.detailAvailable ? (
                <p className="border border-dashed border-black p-2 text-xs">
                  Detalle de egresos no disponible.
                </p>
              ) : outflowGroups.length ? (
                <>
                  {outflowGroups.map((group) => {
                    const annulled = group.items.filter(
                      (item) => item.reversedById,
                    ).length;
                    const reversals = group.items.filter(
                      (item) => item.referenceId,
                    ).length;
                    return (
                      <div key={group.key} className="mb-2">
                        <h4 className="mb-0.5 font-bold">{group.title}</h4>
                        {group.key === "delivery" ? (
                          <>
                            <div className="flex justify-between gap-2 font-bold">
                              <span>
                                Total envíos y rendiciones ({group.items.length}
                                )
                              </span>
                              <span className="whitespace-nowrap">
                                {formatMoney(group.totalMinor)}
                              </span>
                            </div>
                            {annulled || reversals ? (
                              <p className="text-xs text-slate-600">
                                {annulled} anulados · {reversals} anulaciones.
                                Importe bruto; las compensaciones están
                                incluidas en el arqueo.
                              </p>
                            ) : null}
                          </>
                        ) : (
                          <div className="space-y-1">
                            {group.items.map((movement) => (
                              <div
                                key={movement.id}
                                className="border-b border-dotted border-slate-400 pb-1"
                              >
                                <div className="flex justify-between items-start gap-2">
                                  <span className="min-w-0 break-words">
                                    {movement.reason?.trim() ||
                                      "Sin concepto registrado"}
                                  </span>
                                  <strong className="shrink-0 whitespace-nowrap">
                                    {formatMoney(movement.outflowMinor)}
                                  </strong>
                                </div>
                                <p className="text-xs text-slate-600">
                                  {new Date(movement.createdAt).toLocaleString(
                                    "es-AR",
                                    {
                                      timeZone: "America/Buenos_Aires",
                                      hourCycle: "h23",
                                      day: "2-digit",
                                      month: "2-digit",
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    },
                                  )}
                                  {movement.reversedById
                                    ? " · Anulado · Compensado en el arqueo"
                                    : ""}
                                  {movement.referenceId ? " · Anulación" : ""}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <p className="mt-1 text-xs text-slate-600">
                    Detalle informativo; estos importes ya están incluidos en el
                    arqueo.
                  </p>
                </>
              ) : hasSummarizedOutflows ? (
                <p className="border border-dashed border-black p-2 text-xs">
                  Detalle de egresos no disponible.
                </p>
              ) : (
                <p className="text-xs">Sin egresos en efectivo registrados.</p>
              )}
            </>

            {data.detailAvailable &&
              sections.byProduct &&
              data.byProduct.length > 0 && (
                <>
                  <div className="my-2 border-t border-dashed border-slate-400" />
                  <div className="font-bold uppercase text-xs tracking-wide mb-1">
                    POR PRODUCTO
                  </div>
                  <div className="space-y-0.5">
                    {data.byProduct.map((row) => (
                      <div
                        key={row.productId ?? row.name}
                        className="flex justify-between"
                      >
                        <span className="break-words pr-2">
                          {row.name} ×{row.quantity}
                        </span>
                        <strong className="whitespace-nowrap">
                          {formatMoney(row.amountMinor)}
                        </strong>
                      </div>
                    ))}
                  </div>
                </>
              )}

            {data.detailAvailable &&
              sections.byCategory &&
              data.byCategory.length > 0 && (
                <>
                  <div className="my-2 border-t border-dashed border-slate-400" />
                  <div className="font-bold uppercase text-xs tracking-wide mb-1">
                    POR CATEGORÍA
                  </div>
                  <div className="space-y-0.5">
                    {data.byCategory.map((row) => (
                      <div key={row.name} className="flex justify-between">
                        <span className="break-words pr-2">
                          {row.name} ×{row.quantity}
                        </span>
                        <strong className="whitespace-nowrap">
                          {formatMoney(row.amountMinor)}
                        </strong>
                      </div>
                    ))}
                  </div>
                </>
              )}

            {data.detailAvailable &&
              sections.byTable &&
              data.byTable.length > 0 && (
                <>
                  <div className="my-2 border-t border-dashed border-slate-400" />
                  <div className="font-bold uppercase text-xs tracking-wide mb-1">
                    POR MESA
                  </div>
                  <div className="space-y-0.5">
                    {data.byTable.map((row) => (
                      <div
                        key={row.tableId ?? row.name}
                        className="flex justify-between gap-2"
                      >
                        <span className="break-words">{row.name}</span>
                        <strong className="whitespace-nowrap">
                          {formatMoney(row.amountMinor)}
                        </strong>
                      </div>
                    ))}
                  </div>
                </>
              )}

            {data.detailAvailable &&
              sections.byWaiter &&
              data.byWaiter.length > 0 && (
                <>
                  <div className="my-2 border-t border-dashed border-slate-400" />
                  <div className="font-bold uppercase text-xs tracking-wide mb-1">
                    POR MOZO
                  </div>
                  <div className="space-y-2">
                    {data.byWaiter.map((w) => (
                      <div
                        key={w.waiterUserId ?? w.name}
                        className="border-b border-dotted border-slate-300 pb-1.5 last:border-b-0 last:pb-0"
                      >
                        <div className="font-bold text-slate-900">{w.name}</div>
                        {w.tables && w.tables.length > 0 ? (
                          <div className="pl-2 space-y-0.5 text-xs text-slate-700">
                            {w.tables.map((t, i) => (
                              <div
                                key={i}
                                className="flex justify-between gap-2"
                              >
                                <span className="break-words">{t.name}</span>
                                <span className="whitespace-nowrap">
                                  {formatMoney(t.amountMinor)}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : null}
                        <div className="flex justify-between gap-2 font-bold text-xs pt-0.5 mt-0.5 border-t border-dashed border-slate-200">
                          <span className="break-words">Total {w.name}:</span>
                          <span className="whitespace-nowrap">
                            {formatMoney(w.amountMinor)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

            {data.detailAvailable &&
              sections.orderDetails &&
              data.orders.length > 0 && (
                <>
                  <div className="my-2 border-t border-dashed border-slate-400" />
                  <div className="font-bold uppercase text-xs tracking-wide mb-1">
                    DETALLE DE PEDIDOS
                  </div>
                  <div className="space-y-0.5 text-xs">
                    {data.orders.map((o) => (
                      <div key={o.id} className="flex justify-between gap-2">
                        <span className="break-words pr-2">
                          #{o.number} ·{" "}
                          {o.items[0]?.productNameSnapshot ?? o.type}
                        </span>
                        <strong className="whitespace-nowrap">
                          {formatMoney(o.totalMinor)}
                        </strong>
                      </div>
                    ))}
                  </div>
                </>
              )}

            <div className="my-2 border-t border-dashed border-slate-400" />
            <p className="text-center text-xs text-slate-500">
              Impreso:{" "}
              {new Date().toLocaleString("es-AR", {
                timeZone: "America/Buenos_Aires",
                hourCycle: "h23",
              })}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-3 border-t border-slate-200 pt-4">
        <Button variant="secondary" onClick={onClose} disabled={isPrinting}>
          Cancelar
        </Button>
        <Button onClick={() => onPrint(sections)} disabled={isPrinting}>
          <Printer /> Imprimir ticket
        </Button>
      </div>
    </Modal>
  );
}
