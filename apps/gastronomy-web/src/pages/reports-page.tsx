import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { BootstrapDto } from "@gastronomy/contracts";
import {
  ChartBar,
  DownloadSimple,
  Motorcycle,
  Receipt,
  Wallet,
} from "@phosphor-icons/react";
import { Button, Card, Field, Input } from "@gastronomy/ui";
import { formatMoney, localDateValue, typeLabels } from "../lib";
import { useApiMutation } from "../api";

export function ReportsPage({ data }: { data: BootstrapDto }) {
  const [dateFrom, setDateFrom] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 6);
    return localDateValue(date);
  });
  const [dateTo, setDateTo] = useState(() => localDateValue());
  const [message, setMessage] = useState<string | null>(null);
  const report = useQuery({
    queryKey: ["detailed-report", dateFrom, dateTo],
    queryFn: () => window.gastronomy.getDetailedReport({ dateFrom, dateTo }),
  });
  const exportMutation = useApiMutation(
    () => window.gastronomy.exportSalesCsv({ dateFrom, dateTo }),
    {
      onSuccess: (result) =>
        setMessage(
          result.path
            ? `Archivo guardado en ${result.path}`
            : "Exportación cancelada",
        ),
      onError: (error) => setMessage(error.message),
    },
  );
  const summary = report.data;
  const validPeriod = Boolean(dateFrom && dateTo && dateFrom <= dateTo);
  return (
    <div
      data-enter-navigation
      className="panel-enter mx-auto max-w-[1450px] space-y-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold">Informes operativos</h2>
          <p className="text-xs text-slate-600">
            Ventas, productos, caja, personal y envíos por día comercial
          </p>
        </div>
        <Button
          variant="secondary"
          disabled={exportMutation.isPending || !validPeriod}
          onClick={() => exportMutation.mutate()}
        >
          <DownloadSimple />
          {exportMutation.isPending ? "Exportando…" : "Exportar ventas CSV"}
        </Button>
      </div>
      <Card className="p-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[180px_180px_1fr]">
          <Field label="Día comercial desde">
            <Input
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
            />
          </Field>
          <Field label="Hasta">
            <Input
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
            />
          </Field>
          {!validPeriod ? (
            <p role="alert" className="self-end pb-2 text-xs text-rose-700">
              Ingresá un período válido: la fecha inicial no puede ser posterior
              a la final.
            </p>
          ) : null}
          <div className="self-end pb-1 text-xs leading-5 text-slate-600 sm:col-span-2 lg:col-span-1">
            Las ventas se muestran netas en su día original; las devoluciones de
            caja se muestran en el día en que se realizaron.
          </div>
        </div>
      </Card>
      {message ? (
        <div className="rounded-lg border border-sky-200 bg-sky-50 p-2 text-xs text-sky-800">
          {message}
        </div>
      ) : null}
      {!validPeriod ? null : report.isLoading ? (
        <Card className="grid h-64 place-items-center text-xs font-semibold text-slate-600">
          Calculando informe…
        </Card>
      ) : report.isError || !summary ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {report.error?.message ?? "No se pudo calcular el informe."}
        </div>
      ) : (
        <>
          <section className="grid gap-3 md:grid-cols-4">
            <Metric
              icon={<Wallet />}
              label="Venta total"
              value={formatMoney(summary.salesTotalMinor)}
              tone="text-emerald-600"
            />
            <Metric
              icon={<Receipt />}
              label="Pedidos"
              value={String(summary.orderCount)}
              detail={`Ticket ${formatMoney(summary.averageTicketMinor)}`}
              tone="text-brand-600"
            />
            <Metric
              icon={<ChartBar />}
              label="Diferencias acumuladas"
              value={formatMoney(summary.cash.differencesMinor)}
              detail={`${summary.cash.sessions.length} turno${summary.cash.sessions.length === 1 ? "" : "s"} en el rango`}
              tone="text-sky-600"
            />
            <Metric
              icon={<Motorcycle />}
              label="Importes de envío"
              value={formatMoney(summary.delivery.feesMinor)}
              detail={`${summary.delivery.orderCount} entregas`}
              tone="text-amber-600"
            />
          </section>
          <ReportTable
            title="Diferencias de caja por turno"
            headers={[
              "Turno",
              "Apertura",
              "Cierre",
              "Estado",
              "Esperado",
              "Contado",
              "Diferencia",
            ]}
            rows={summary.cash.sessions.map((session) => [
              `Caja #${session.number}`,
              formatReportDateTime(session.openedAt),
              session.closedAt ? formatReportDateTime(session.closedAt) : "—",
              session.status === "OPEN" ? "Abierta" : "Cerrada",
              formatMoney(session.expectedAmountMinor),
              session.countedAmountMinor == null
                ? "—"
                : formatMoney(session.countedAmountMinor),
              session.differenceMinor == null
                ? "Pendiente"
                : formatMoney(session.differenceMinor),
            ])}
          />
          <section className="grid gap-4 lg:grid-cols-2">
            <ReportTable
              title="Productos más vendidos"
              headers={["Producto", "Cantidad", "Facturación"]}
              rows={summary.byProduct
                .slice(0, 12)
                .map((row) => [
                  row.name,
                  String(row.quantity),
                  formatMoney(row.amountMinor),
                ])}
            />
            <ReportTable
              title="Categorías"
              headers={["Categoría", "Cantidad", "Facturación"]}
              rows={summary.byCategory.map((row) => [
                row.name,
                String(row.quantity),
                formatMoney(row.amountMinor),
              ])}
            />
            <ReportTable
              title="Canales"
              headers={["Canal", "Pedidos", "Facturación"]}
              rows={summary.byType.map((row) => [
                typeLabels[row.type],
                String(row.orderCount),
                formatMoney(row.amountMinor),
              ])}
            />
            <ReportTable
              title="Medios de pago"
              headers={["Medio", "", "Importe"]}
              rows={summary.byPaymentMethod.map((row) => [
                row.name,
                "",
                formatMoney(row.amountMinor),
              ])}
            />
            <ReportTable
              title="Ventas por hora"
              headers={["Hora", "Pedidos", "Facturación"]}
              rows={summary.byHour.map((row) => [
                `${String(row.hour).padStart(2, "0")}:00`,
                String(row.orderCount),
                formatMoney(row.amountMinor),
              ])}
            />
            <ReportTable
              title="Por mozo / operador"
              headers={["Usuario", "Pedidos", "Facturación"]}
              rows={summary.byWaiter.map((row) => [
                row.name,
                String(row.orderCount),
                formatMoney(row.amountMinor),
              ])}
            />
          </section>
          <section className="grid gap-3 md:grid-cols-2">
            <Card className="p-4">
              <h3 className="text-sm font-bold">Caja acumulada</h3>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
                <Stat
                  label="Cambio inicial"
                  value={formatMoney(summary.cash.openingMinor)}
                />
                <Stat
                  label="Ingresos"
                  value={formatMoney(summary.cash.incomeMinor)}
                />
                <Stat
                  label="Gastos"
                  value={formatMoney(summary.cash.expenseMinor)}
                />
                <Stat
                  label="Retiros"
                  value={formatMoney(summary.cash.withdrawalMinor)}
                />
                <Stat
                  label="Devoluciones"
                  value={formatMoney(summary.cash.refundMinor)}
                />
              </dl>
            </Card>
            <Card className="p-4">
              <h3 className="text-sm font-bold">Saldos de reparto</h3>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
                <Stat
                  label="Repartidores deben"
                  value={formatMoney(summary.delivery.pendingDriverOwesMinor)}
                />
                <Stat
                  label="Negocio debe"
                  value={formatMoney(summary.delivery.pendingBusinessOwesMinor)}
                />
              </dl>
            </Card>
          </section>
        </>
      )}
    </div>
  );
}

function formatReportDateTime(value: string) {
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function Metric({
  icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail?: string;
  tone: string;
}) {
  return (
    <Card className="p-4">
      <div className={tone}>{icon}</div>
      <p className="mt-3 text-xs font-bold uppercase tracking-wide text-slate-600">
        {label}
      </p>
      <p className="text-2xl font-extrabold">{value}</p>
      {detail ? <p className="text-xs text-slate-600">{detail}</p> : null}
    </Card>
  );
}
function ReportTable({
  title,
  headers,
  rows,
}: {
  title: string;
  headers: string[];
  rows: string[][];
}) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-bold">{title}</h3>
      </div>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table
            className={headers.length > 3 ? "dn-table min-w-[640px]" : "dn-table"}
          >
            <thead>
              <tr>
                {headers.map((header, index) => (
                  <th
                    key={header}
                    className={
                      index
                        ? "text-right whitespace-nowrap"
                        : "whitespace-nowrap"
                    }
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${row[0]}-${index}`}>
                  {row.map((cell, cellIndex) => (
                    <td
                      key={cellIndex}
                      className={
                        cellIndex
                          ? "whitespace-nowrap text-right font-semibold"
                          : headers.length > 3
                            ? "font-semibold"
                            : "font-semibold [overflow-wrap:anywhere]"
                      }
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid h-32 place-items-center text-xs text-slate-600">
          Sin datos para el rango
        </div>
      )}
    </Card>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <dt className="text-xs font-bold uppercase text-slate-600">
        {label}
      </dt>
      <dd className="mt-1 font-extrabold">{value}</dd>
    </div>
  );
}
