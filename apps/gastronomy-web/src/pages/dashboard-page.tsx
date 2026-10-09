import type { BootstrapDto } from "@gastronomy/contracts";
import {
  ArrowRight,
  ClockCountdown,
  ForkKnife,
  Receipt,
  TrendUp,
} from "@phosphor-icons/react";
import { Badge, Card } from "@gastronomy/ui";
import { Link } from "react-router-dom";
import {
  formatMoney,
  formatTime,
  paidOrdersForSession,
  paymentText,
  statusLabels,
  typeLabels,
} from "../lib";

export function DashboardPage({ data }: { data: BootstrapDto }) {
  const activeOrders = data.orders.filter(
    (order) =>
      order.type !== "DINE_IN" &&
      !["DELIVERED", "CANCELLED"].includes(order.operationalStatus),
  );
  const pendingTableOrders = data.orders.filter(
    (order) =>
      order.type === "DINE_IN" &&
      order.paymentStatus !== "PAID" &&
      !["DELIVERED", "CANCELLED"].includes(order.operationalStatus),
  );
  const pendingTableTotal = pendingTableOrders.reduce(
    (total, order) => total + order.totalMinor - order.paidMinor,
    0,
  );
  const summary = data.dashboard;
  const recentSales = paidOrdersForSession(data.orders, data.cashSession);
  const stats = [
    {
      label: "Pagos registrados",
      value: formatMoney(summary.salesTotalMinor),
      detail: `${summary.orderCount} pedido${summary.orderCount === 1 ? "" : "s"} con pago · día comercial`,
      note: "Incluye pagos parciales y cuenta corriente",
      icon: TrendUp,
      tone: "text-emerald-600 bg-emerald-50",
    },
    {
      label: "Retiros y envíos abiertos",
      value: String(activeOrders.length),
      detail: activeOrders.length
        ? "requieren seguimiento"
        : "sin pendientes de entrega",
      icon: Receipt,
      tone: "text-brand-600 bg-brand-50",
    },
    {
      label: "Mesas por cobrar",
      value: formatMoney(pendingTableTotal),
      detail: `${pendingTableOrders.length} mesa${pendingTableOrders.length === 1 ? "" : "s"} abierta${pendingTableOrders.length === 1 ? "" : "s"}`,
      icon: ForkKnife,
      tone: "text-sky-600 bg-sky-50",
    },
    {
      label: "Efectivo esperado",
      value: data.cashSession
        ? formatMoney(data.cashSession.expectedAmountMinor)
        : "—",
      detail: data.cashSession
        ? `día ${data.cashSession.businessDate}`
        : "abrí caja para operar",
      note: data.cashSession ? "Incluye el cambio inicial" : undefined,
      icon: ClockCountdown,
      tone: "text-amber-600 bg-amber-50",
    },
  ];
  return (
    <div className="panel-enter mx-auto max-w-[1500px] space-y-4">
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {stats.map(({ label, value, detail, note, icon: Icon, tone }) => (
          <Card key={label} className="flex items-center gap-3 p-4">
            <div
              className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${tone}`}
            >
              <Icon size={20} weight="duotone" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-[.1em] text-slate-600">
                {label}
              </p>
              <p className="truncate text-xl font-extrabold tracking-tight text-slate-950">
                {value}
              </p>
              <p className="text-xs leading-4 text-slate-600">{detail}</p>
              {note ? (
                <p className="mt-1 text-xs leading-4 text-slate-600">
                  {note}
                </p>
              ) : null}
            </div>
          </Card>
        ))}
      </section>
      <Card className="overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-bold">Pedidos con pagos registrados</h2>
          <p className="text-xs text-slate-600">
            {data.cashSession ? "Caja actual · " : ""}Incluye pagos parciales y
            cuenta corriente
          </p>
        </div>
        {recentSales.length ? (
          <div className="overflow-auto">
            <table className="dn-table">
              <thead>
                <tr>
                  <th>Pedido</th>
                  <th>Canal</th>
                  <th>Mesa / cliente</th>
                  <th>Medios</th>
                  <th>Estado</th>
                  <th className="text-right">Pago registrado</th>
                </tr>
              </thead>
              <tbody>
                {recentSales.slice(0, 12).map((order) => (
                  <tr key={order.id}>
                    <td className="font-bold">#{order.number}</td>
                    <td>
                      <Badge
                        tone={
                          order.type === "DELIVERY"
                            ? "blue"
                            : order.type === "TAKEAWAY"
                              ? "orange"
                              : "green"
                        }
                      >
                        {typeLabels[order.type]}
                      </Badge>
                    </td>
                    <td>
                      {order.tableNumber
                        ? `Mesa ${order.tableNumber}`
                        : order.customerNameSnapshot || "Sin cliente"}
                    </td>
                    <td>{paymentText(order)}</td>
                    <td>
                      <Badge tone="green">
                        {order.type === "DINE_IN" &&
                        order.operationalStatus === "DELIVERED"
                          ? "Mesa cerrada"
                          : statusLabels[order.operationalStatus]}
                      </Badge>
                    </td>
                    <td className="text-right font-bold">
                      {formatMoney(order.paidMinor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="p-8 text-center text-sm text-slate-500">
            Todavía no hay pagos registrados en esta caja.
          </p>
        )}
      </Card>
      <section className="grid gap-4 xl:grid-cols-[2fr_1fr]">
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <div>
              <h2 className="text-sm font-bold">Retiros y envíos en curso</h2>
              <p className="text-xs text-slate-600">
                Prioridad por hora de entrega y antigüedad
              </p>
            </div>
            <Link
              to="/pedidos"
              className="flex items-center gap-1 text-xs font-bold text-brand-700 hover:text-brand-800"
            >
              Ver todos <ArrowRight size={14} />
            </Link>
          </div>
          <div className="max-h-[420px] overflow-auto">
            {activeOrders.length ? (
              <table className="dn-table [&>thead>tr>th]:px-2 [&>tbody>tr>td]:px-2">
                <thead>
                  <tr>
                    <th>Pedido</th>
                    <th>Tipo</th>
                    <th>Cliente / Mesa</th>
                    <th>Hora de entrega</th>
                    <th>Estado</th>
                    <th className="text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {activeOrders.slice(0, 12).map((order) => (
                    <tr key={order.id}>
                      <td className="font-bold text-slate-900">
                        #{order.number}
                      </td>
                      <td>
                        <Badge
                          tone={
                            order.type === "DELIVERY"
                              ? "blue"
                              : order.type === "TAKEAWAY"
                                ? "orange"
                                : "green"
                          }
                        >
                          {typeLabels[order.type]}
                        </Badge>
                      </td>
                      <td>
                        {order.tableNumber
                          ? `Mesa ${order.tableNumber}`
                          : order.customerNameSnapshot || "Sin cliente"}
                      </td>
                      <td className="font-semibold">
                        {formatTime(order.promisedAt)}
                      </td>
                      <td>
                        <Badge
                          tone={
                            order.operationalStatus === "READY"
                              ? "green"
                              : "amber"
                          }
                        >
                          {order.lifecycleStatus === "DRAFT"
                            ? "Borrador"
                            : statusLabels[order.operationalStatus]}
                        </Badge>
                      </td>
                      <td className="whitespace-nowrap text-right font-bold">
                        {formatMoney(order.totalMinor)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="grid h-52 place-items-center text-center">
                <div>
                  <ForkKnife className="mx-auto text-slate-300" size={34} />
                  <p className="mt-2 text-sm font-semibold text-slate-500">
                    No hay retiros ni envíos abiertos
                  </p>
                  <p className="text-xs text-slate-600">
                    F3 crea un pedido para retirar · F4 crea un envío
                  </p>
                </div>
              </div>
            )}
          </div>
        </Card>
        <Card className="p-4">
          <h2 className="text-sm font-bold">Pagos registrados por canal</h2>
          <p className="mt-1 text-xs text-slate-600">
            Día comercial · incluye cuenta corriente
          </p>
          <div className="mt-4 space-y-4">
            {Object.entries(summary.byType).map(([type, amount]) => {
              const percent = summary.salesTotalMinor
                ? Math.round((amount / summary.salesTotalMinor) * 100)
                : 0;
              return (
                <div key={type}>
                  <div className="mb-1.5 flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-600">
                      {typeLabels[type as keyof typeof typeLabels]}
                    </span>
                    <span className="font-bold">{formatMoney(amount)}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-brand-600 to-amber-400"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                  <p className="mt-1 text-right text-xs text-slate-600">
                    {percent}%
                  </p>
                </div>
              );
            })}
          </div>
          <div className="mt-6 border-t border-slate-100 pt-4">
            <h3 className="text-xs font-bold uppercase tracking-[.12em] text-slate-600">
              Atajos rápidos
            </h3>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs font-semibold text-slate-500">
              <span className="rounded-lg bg-slate-50 p-2">
                <b className="text-slate-900">F2</b> Salón
              </span>
              <span className="rounded-lg bg-slate-50 p-2">
                <b className="text-slate-900">F3</b> Para retirar
              </span>
              <span className="rounded-lg bg-slate-50 p-2">
                <b className="text-slate-900">F4</b> Envío
              </span>
              <span className="rounded-lg bg-slate-50 p-2">
                <b className="text-slate-900">F6</b> Buscar
              </span>
            </div>
          </div>
        </Card>
      </section>
    </div>
  );
}
