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
import { formatMoney, typeLabels } from "../lib";
import { useApiMutation } from "../api";

const dateValue = (offset = 0) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

export function ReportsPage({ data }: { data: BootstrapDto }) {
  const [dateFrom, setDateFrom] = useState(dateValue(-6));
  const [dateTo, setDateTo] = useState(dateValue());
  const [message, setMessage] = useState<string | null>(null);
  const report = useQuery({
    queryKey: ["detailed-report", dateFrom, dateTo],
    queryFn: () => window.gastronomy.getDetailedReport({ dateFrom, dateTo }),
  });
  const exportMutation = useApiMutation(
    () => window.gastronomy.exportSalesCsv(),
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
  return (
    <div
      data-enter-navigation
      className="panel-enter mx-auto max-w-[1450px] space-y-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold">Informes operativos</h2>
          <p className="text-xs text-slate-400">
            Ventas, productos, caja, personal y delivery por día comercial
          </p>
        </div>
        <Button
          variant="secondary"
          disabled={exportMutation.isPending}
          onClick={() => exportMutation.mutate()}
        >
          <DownloadSimple />
          {exportMutation.isPending ? "Exportando…" : "Exportar ventas CSV"}
        </Button>
      </div>
      <Card className="p-3">
        <div className="grid gap-3 sm:grid-cols-[minmax(170px,180px)_minmax(170px,180px)_1fr]">
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
          <div className="self-end pb-1 text-xs leading-5 text-slate-400">
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
      {report.isLoading ? (
        <Card className="grid h-64 place-items-center text-xs font-semibold text-slate-400">
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
              label="Diferencias de caja"
              value={formatMoney(summary.cash.differencesMinor)}
              detail={`Gastos ${formatMoney(summary.cash.expenseMinor)}`}
              tone="text-sky-600"
            />
            <Metric
              icon={<Motorcycle />}
              label="Delivery fees"
              value={formatMoney(summary.delivery.feesMinor)}
              detail={`${summary.delivery.orderCount} entregas`}
              tone="text-amber-600"
            />
          </section>
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
              <h3 className="text-sm font-bold">Saldos de delivery</h3>
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
      <p className="mt-3 text-[10px] font-bold uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p className="text-2xl font-extrabold">{value}</p>
      {detail ? <p className="text-[10px] text-slate-400">{detail}</p> : null}
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
          <table className="dn-table">
            <thead>
              <tr>
                {headers.map((header, index) => (
                  <th key={header} className={index ? "text-right" : ""}>
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
                        cellIndex ? "text-right font-semibold" : "font-semibold"
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
        <div className="grid h-32 place-items-center text-xs text-slate-400">
          Sin datos para el rango
        </div>
      )}
    </Card>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <dt className="text-[10px] font-bold uppercase text-slate-400">
        {label}
      </dt>
      <dd className="mt-1 font-extrabold">{value}</dd>
    </div>
  );
}
