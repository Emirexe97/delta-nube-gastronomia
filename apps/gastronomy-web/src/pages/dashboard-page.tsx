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
      label: "Venta del día",
      value: formatMoney(summary.salesTotalMinor),
      detail: `${summary.orderCount} ventas cobradas`,
      icon: TrendUp,
      tone: "text-emerald-600 bg-emerald-50",
    },
    {
      label: "Pedidos abiertos",
      value: String(activeOrders.length),
      detail: activeOrders.length
        ? "requieren seguimiento"
        : "operación al día",
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
      label: "Caja esperada",
      value: data.cashSession
        ? formatMoney(data.cashSession.expectedAmountMinor)
        : "—",
      detail: data.cashSession
        ? `día ${data.cashSession.businessDate}`
        : "abrí caja para operar",
      icon: ClockCountdown,
      tone: "text-amber-600 bg-amber-50",
    },
  ];
  return (
    <div className="panel-enter mx-auto max-w-[1500px] space-y-4">
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {stats.map(({ label, value, detail, icon: Icon, tone }) => (
          <Card key={label} className="flex items-center gap-3 p-4">
            <div
              className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${tone}`}
            >
              <Icon size={20} weight="duotone" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[.1em] text-slate-400">
                {label}
              </p>
              <p className="truncate text-xl font-extrabold tracking-tight text-slate-950">
                {value}
              </p>
              <p className="truncate text-[10px] text-slate-400">{detail}</p>
            </div>
          </Card>
        ))}
      </section>
      <Card className="overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-bold">Últimas ventas cobradas</h2>
          <p className="text-[11px] text-slate-400">
            Ventas de la caja y día actual
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
                  <th className="text-right">Cobrado</th>
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
            Todavía no hay ventas cobradas en esta caja.
          </p>
        )}
      </Card>
      <section className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <div>
              <h2 className="text-sm font-bold">Pedidos en curso</h2>
              <p className="text-[11px] text-slate-400">
                Prioridad por hora de entrega y antigüedad
              </p>
            </div>
            <Link
              to="/pedidos"
              className="flex items-center gap-1 text-xs font-bold text-brand-600 hover:text-brand-700"
            >
              Ver todos <ArrowRight size={14} />
            </Link>
          </div>
          <div className="max-h-[420px] overflow-auto">
            {activeOrders.length ? (
              <table className="dn-table">
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
                      <td className="text-right font-bold">
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
                    No hay pedidos abiertos
                  </p>
                  <p className="text-xs text-slate-400">
                    F3 crea un pedido para retirar · F4 crea un envío
                  </p>
                </div>
              </div>
            )}
          </div>
        </Card>
        <Card className="p-4">
          <h2 className="text-sm font-bold">Venta por canal</h2>
          <p className="mt-1 text-[11px] text-slate-400">
            Día comercial actual
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
                  <p className="mt-1 text-right text-[10px] text-slate-400">
                    {percent}%
                  </p>
                </div>
              );
            })}
          </div>
          <div className="mt-6 border-t border-slate-100 pt-4">
            <h3 className="text-[10px] font-bold uppercase tracking-[.12em] text-slate-400">
              Atajos rápidos
            </h3>
            <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] font-semibold text-slate-500">
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
