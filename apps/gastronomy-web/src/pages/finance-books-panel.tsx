import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { FinanceForecast } from "./finance-forecast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Field, Input } from "@gastronomy/ui";
import { csvCell } from "@gastronomy/domain";
import type {
  BootstrapDto,
  FinanceBookEvent,
  FinanceBooksDto,
  FinanceMonthlyClosureDto,
  FinanceReportDto,
} from "@gastronomy/contracts";
import {
  formatMoney,
  humanError,
  localDateValue,
  moneyInputValue,
} from "../lib";
import {
  FinanceBookEntry,
  bookActionLabels,
  type BookAction,
} from "./finance-book-entry";

type Section = "overview" | "expenses" | "treasury" | "results";
interface PanelProps {
  section: Section;
  data: BootstrapDto;
  from: string;
  to: string;
  report: FinanceReportDto;
  onChange: () => void;
}
function Panel({
  title,
  tools,
  children,
}: {
  title: string;
  tools?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold">{title}</h2>
        {tools}
      </div>
      {children}
    </Card>
  );
}
function LedgerTable({
  headers,
  rows,
  empty,
}: {
  headers: string[];
  rows: { id: string; cells: ReactNode[] }[];
  empty: string;
}) {
  return rows.length ? (
    <div className="max-h-96 overflow-auto">
      <table className="w-full text-left text-xs">
        <thead className="sticky top-0 bg-slate-100">
          <tr>
            {headers.map((h) => (
              <th key={h} scope="col" className="px-3 py-2">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t">
              {row.cells.map((cell, i) => (
                <td key={headers[i]} className="px-3 py-2 tabular-nums">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <p className="text-sm text-slate-600">{empty}</p>
  );
}
function reference(event: FinanceBookEvent, books: FinanceBooksDto) {
  const e = event.input;
  const account = (id: string) =>
    books.accounts.find((a) => a.id === id)?.name ?? id;
  switch (e.kind) {
    case "account_open":
      return (
        e.account.name + " · " + formatMoney(e.account.openingBalanceMinor)
      );
    case "transfer":
      return (
        account(e.fromAccountId) +
        " → " +
        account(e.toAccountId) +
        " · " +
        formatMoney(e.amountMinor)
      );
    case "obligation":
      return (
        e.obligation.supplierName +
        " · " +
        formatMoney(e.obligation.amountMinor)
      );
    case "obligation_payment":
      return account(e.accountId) + " · " + formatMoney(e.amountMinor);
    case "settlement_expected":
      return (
        account(e.settlement.accountId) +
        " · " +
        formatMoney(e.settlement.expectedNetMinor)
      );
    case "settlement_credit":
      return account(e.accountId) + " · " + formatMoney(e.actualNetMinor);
    case "month_close":
      return e.month;
    case "adjustment":
      return formatMoney(e.amountMinor);
    default:
      return e.reason;
  }
}

function exportClosure(
  closure: FinanceMonthlyClosureDto,
  books: FinanceBooksDto,
) {
  const rows = [["Mes", "Fecha de cierre", "Motivo", "Concepto", "Importe"]];
  function add(label: string, amount: number) {
    rows.push([
      closure.month,
      closure.closedAt,
      closure.reason,
      label,
      moneyInputValue(amount, true).replace(",", "."),
    ]);
  }
  const pnl = closure.pnlSnapshot;
  add("Ventas", pnl.salesMinor);
  add("Mercadería y reparto", pnl.costOfGoodsMinor);
  add("Personal", pnl.payrollMinor);
  add("Gastos operativos netos", pnl.operatingExpensesMinor);
  add("Resultado al cierre", pnl.netMinor);
  for (const [id, balance] of Object.entries(closure.accountBalances)) {
    add(
      "Saldo al cierre · " +
        (books.accounts.find((a) => a.id === id)?.name ?? id),
      balance,
    );
  }
  for (const adjustment of books.adjustments.filter((a) =>
    closure.adjustmentIds.includes(a.id),
  )) {
    add(
      "Ajuste registrado · " +
        adjustment.occurredAt.slice(0, 10) +
        " · " +
        adjustment.reason,
      adjustment.amountMinor,
    );
  }
  const csv =
    "\uFEFF" +
    rows
      .map((r) => r.map((v, n) => csvCell(v, n === 4)).join(";"))
      .join("\r\n");
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "cierre-" + closure.month + ".csv";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function FinanceBooksPanel({
  section,
  data,
  from,
  to,
  report,
  onChange,
}: PanelProps) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["finance-books", from, to],
    queryFn: () => window.gastronomy.getFinanceBooks({ from, to }),
  });
  const [action, setAction] = useState<BookAction | null>(null);
  const [notice, setNotice] = useState("");
  const [supplierSearch, setSupplierSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const books = query.data;
  const canManage = data.currentUser.permissions.some(
    (p) => p === "finance.manage" || p === "*",
  );
  if (!books)
    return (
      <Card className="p-3 text-sm" role={query.isError ? "alert" : "status"}>
        {query.isError ? (
          <>
            {humanError(query.error)}{" "}
            <Button variant="secondary" onClick={() => void query.refetch()}>
              Reintentar
            </Button>
          </>
        ) : (
          "Consultando tesorería y proveedores…"
        )}
      </Card>
    );
  const act = (
    kind: BookAction["kind"],
    id?: string,
    label?: string,
    disabled = false,
  ) =>
    canManage && (
      <Button
        type="button"
        variant="secondary"
        disabled={disabled}
        onClick={() => {
          setNotice("");
          setAction({ kind, id });
        }}
      >
        {label ?? bookActionLabels[kind]}
      </Button>
    );
  const availablePurchases = books.sources.purchases.filter(
    (p) => p.status === "confirmed" && !p.alreadyLinked,
  );
  const account = (id: string) =>
    books.accounts.find((a) => a.id === id)?.name ?? "Cuenta registrada";
  const outstanding = books.obligations.filter((o) => o.outstandingMinor > 0);
  const pending = books.settlements.filter((s) => s.status === "expected");
  const recvs = books.sources.customerBalances ?? [];
  const driverDebt = data.deliveryLedger.filter((l) => l.status === "PENDING");
  const canSeePurchases = data.currentUser.permissions.some(
    (p) => p === "purchases.manage" || p === "*",
  );
  const today = localDateValue();
  const suppliers = new Map<string, { name: string; amount: number }>();
  for (const o of outstanding) {
    const s = suppliers.get(o.supplierId) ?? {
      name: o.supplierName,
      amount: 0,
    };
    s.amount += o.outstandingMinor;
    suppliers.set(o.supplierId, s);
  }
  const reversed = new Set(books.reversedEventIds);
  return (
    <div className="space-y-3">
      {notice && (
        <p className="text-sm text-emerald-700" role="status">
          {notice}
        </p>
      )}
      {section === "overview" && (
        <Panel title="Proveedores y acreditaciones">
          <div className="grid gap-2 sm:grid-cols-3">
            {[
              [
                "Saldo actual con proveedores",
                outstanding.reduce((a, o) => a + o.outstandingMinor, 0),
              ],
              [
                "De proveedores vencido o para hoy",
                outstanding
                  .filter((o) => o.dueAt && o.dueAt.slice(0, 10) <= today)
                  .reduce((a, o) => a + o.outstandingMinor, 0),
              ],
              [
                "Acreditaciones esperadas",
                pending.reduce((a, s) => a + s.expectedNetMinor, 0),
              ],
            ].map(([name, amount]) => (
              <div key={name} className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs text-slate-600">{name}</p>
                <b className="text-xl">{formatMoney(Number(amount))}</b>
              </div>
            ))}
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer font-semibold">
              Ver obligaciones y lotes pendientes
            </summary>
            <ul className="mt-2 space-y-1">
              {outstanding.map((o) => (
                <li key={o.id}>
                  {o.supplierName} · {o.documentNumber || o.description} ·{" "}
                  {o.dueAt?.slice(0, 10)} · {formatMoney(o.outstandingMinor)}
                </li>
              ))}
              {pending.map((s) => (
                <li key={s.id}>
                  {account(s.accountId)} · {s.occurredAt.slice(0, 10)} ·{" "}
                  {formatMoney(s.expectedNetMinor)}
                </li>
              ))}
            </ul>
            {!outstanding.length && !pending.length && (
              <p>Sin pendientes registrados.</p>
            )}
          </details>
        </Panel>
      )}
      {section === "expenses" && (
        <Panel
          title="Cuenta de proveedores"
          tools={act(
            "obligation",
            undefined,
            undefined,
            !availablePurchases.length,
          )}
        >
          {suppliers.size > 0 && (
            <p className="text-sm">
              {[...suppliers.values()]
                .map((s) => s.name + " · " + formatMoney(s.amount))
                .join(" / ")}
            </p>
          )}
          <Field label="Buscar proveedor o comprobante">
            <Input
              value={supplierSearch}
              onChange={(e) => setSupplierSearch(e.target.value)}
            />
          </Field>
          <LedgerTable
            headers={[
              "Proveedor / comprobante",
              "Vencimiento",
              "Importe",
              "Pagado",
              "Saldo",
              "Movimientos",
            ]}
            empty={
              supplierSearch
                ? "Sin coincidencias para esta búsqueda."
                : "Vinculá una compra recibida para registrar su vencimiento y sus pagos."
            }
            rows={books.obligations
              .filter((o) =>
                (
                  o.supplierName +
                  " " +
                  (o.documentNumber ?? "") +
                  " " +
                  o.description
                )
                  .toLowerCase()
                  .includes(supplierSearch.toLowerCase()),
              )
              .map((o) => ({
                id: o.id,
                cells: [
                  <>
                    {o.supplierName}
                    <br />
                    {canSeePurchases ? (
                      <Link
                        className="underline"
                        to={
                          "/compras?ver=" + encodeURIComponent(o.purchaseRef.id)
                        }
                      >
                        {o.documentNumber || o.description}
                      </Link>
                    ) : (
                      o.documentNumber || o.description
                    )}
                    {Boolean(o.purchaseVarianceMinor) && (
                      <p className="text-amber-800">
                        Diferencia con compra actual{" "}
                        {formatMoney(o.purchaseVarianceMinor!)}
                      </p>
                    )}
                  </>,
                  o.dueAt?.slice(0, 10) ?? "Sin fecha",
                  formatMoney(o.currentPurchaseAmountMinor ?? o.amountMinor),
                  formatMoney(o.paidMinor),
                  o.creditBalanceMinor
                    ? "A favor " + formatMoney(o.creditBalanceMinor)
                    : formatMoney(o.outstandingMinor),
                  <div className="space-y-1">
                    {act(
                      "obligation_payment",
                      o.id,
                      "Pagar",
                      !books.accounts.length || o.outstandingMinor <= 0,
                    )}
                    {o.payments.length > 0 && (
                      <details>
                        <summary>Ver pagos</summary>
                        {o.payments.map((p) => (
                          <p key={p.id}>
                            {p.occurredAt.slice(0, 10)} · {account(p.accountId)}{" "}
                            · {formatMoney(p.amountMinor)}
                          </p>
                        ))}
                      </details>
                    )}
                  </div>,
                ],
              }))}
          />
          {canSeePurchases && (
            <Link className="text-sm font-semibold underline" to="/compras">
              Abrir compras
            </Link>
          )}
        </Panel>
      )}
      {section === "expenses" &&
        canManage &&
        (report.expenses.some((e) => e.id.startsWith("cash-")) ||
          report.recurring.some((r) => r.active)) && (
          <div className="flex flex-wrap gap-2">
            {report.expenses.some((e) => e.id.startsWith("cash-")) &&
              act("cash_category")}
            {report.recurring.some((r) => r.active) && act("recurring_rate")}
          </div>
        )}
      {section === "treasury" && (
        <>
          <Panel
            title="Cuentas de fondos"
            tools={
              <div className="flex gap-2">
                {act("account_open")}
                {act(
                  "transfer",
                  undefined,
                  undefined,
                  books.accounts.length < 2,
                )}
              </div>
            }
          >
            <LedgerTable
              headers={[
                "Cuenta",
                "Tipo",
                "Saldo inicial",
                "Saldo actual del libro",
              ]}
              empty="Creá una cuenta con el saldo inicial de tu banco, billetera o caja mayor."
              rows={books.accounts.map((a) => ({
                id: a.id,
                cells: [
                  a.name,
                  { cash: "Caja mayor", bank: "Banco", wallet: "Billetera" }[
                    a.kind
                  ],
                  formatMoney(a.openingBalanceMinor),
                  formatMoney(a.balanceMinor),
                ],
              }))}
            />
            <p className="text-sm">
              Efectivo esperado del turno abierto{" "}
              <b>
                {data.cashSession
                  ? formatMoney(data.cashSession.expectedAmountMinor)
                  : "Sin turno abierto"}
              </b>{" "}
              ·{" "}
              <Link to="/caja" className="underline">
                Ver Caja
              </Link>
            </p>
          </Panel>
          <Panel
            title="Acreditaciones de cobros digitales"
            tools={act(
              "settlement_expected",
              undefined,
              undefined,
              !books.accounts.length,
            )}
          >
            <LedgerTable
              headers={[
                "Fecha prevista",
                "Destino / cobros",
                "Bruto",
                "Comisiones",
                "Retenciones",
                "Neto esperado",
                "Acreditado",
                "Diferencia",
                "Estado",
              ]}
              empty="Los cobros digitales del POS se pueden agrupar en un lote para controlar su acreditación."
              rows={books.settlements.map((s) => ({
                id: s.id,
                cells: [
                  s.occurredAt.slice(0, 10),
                  <>
                    {account(s.accountId)}
                    <details>
                      <summary>{s.paymentIds.length} cobros</summary>
                      {s.paymentIds.map((id) => {
                        const p = books.sources.posPayments.find(
                          (pay) => pay.id === id,
                        );
                        return (
                          <p key={id}>
                            {p ? (
                              <Link
                                className="underline"
                                to={
                                  "/pedidos?ver=" +
                                  encodeURIComponent(p.orderId)
                                }
                              >
                                Pedido #{p.orderNumber}
                              </Link>
                            ) : (
                              "Cobro registrado"
                            )}{" "}
                            · {p?.method}
                          </p>
                        );
                      })}
                    </details>
                  </>,
                  formatMoney(s.grossMinor),
                  formatMoney(s.commissionMinor ?? s.deductionsMinor),
                  formatMoney(s.withheldMinor ?? 0),
                  formatMoney(s.expectedNetMinor),
                  s.actualNetMinor == null ? (
                    "—"
                  ) : (
                    <>
                      {formatMoney(s.actualNetMinor)}
                      <small className="block">
                        {s.creditedAt?.slice(0, 10)}
                      </small>
                    </>
                  ),
                  s.differenceMinor == null
                    ? "—"
                    : formatMoney(s.differenceMinor),
                  <>
                    {
                      {
                        expected: "Previsto",
                        credited: "Acreditado",
                        reconciled: "Conciliado",
                      }[s.status]
                    }{" "}
                    {s.reconciledAt && (
                      <small className="block">
                        {s.reconciledAt.slice(0, 10)}
                      </small>
                    )}
                    {s.status === "expected"
                      ? act("settlement_credit", s.id, "Acreditar")
                      : s.status === "credited"
                        ? act("settlement_reconcile", s.id, "Conciliar")
                        : null}
                  </>,
                ],
              }))}
            />
          </Panel>
          <Panel title="Flujo de fondos previsto">
            <FinanceForecast books={books} expenses={report.dueAgenda} />
          </Panel>
          <Panel title="Cobranzas y rendiciones pendientes">
            <LedgerTable
              headers={["Origen", "Detalle", "Saldo pendiente"]}
              empty="Sin deudas de clientes ni rendiciones pendientes."
              rows={[
                ...recvs.map((c) => ({
                  id: "c" + c.id,
                  cells: [
                    <Link
                      to={"/clientes?ver=" + encodeURIComponent(c.id)}
                      className="underline"
                    >
                      Cuenta de cliente
                    </Link>,
                    c.name,
                    formatMoney(c.outstandingMinor),
                  ],
                })),
                ...driverDebt.map((r) => ({
                  id: "d" + r.id,
                  cells: [
                    data.settings.modules?.delivery !== false ? (
                      <Link
                        to={
                          "/repartidores?" +
                          new URLSearchParams({
                            repartidor: r.driverUserId,
                            fecha: r.businessDate,
                          })
                        }
                        className="underline"
                      >
                        {r.direction === "DRIVER_OWES_BUSINESS"
                          ? "Por rendir al local"
                          : "Por pagar al repartidor"}
                      </Link>
                    ) : r.direction === "DRIVER_OWES_BUSINESS" ? (
                      "Por rendir al local"
                    ) : (
                      "Por pagar al repartidor"
                    ),
                    r.driverName + " · Pedido #" + r.orderNumber,
                    formatMoney(r.amountDueMinor - r.settledAmountMinor),
                  ],
                })),
              ]}
            />
          </Panel>
          <Panel title="Movimientos del período">
            <LedgerTable
              headers={["Fecha", "Operación", "Concepto", "Autorizó", "Acción"]}
              empty="Sin movimientos de tesorería en el período."
              rows={[...books.entries].reverse().map((e) => ({
                id: e.id,
                cells: [
                  e.input.date,
                  bookActionLabels[e.input.kind],
                  <>
                    {reference(e, books)}
                    <small className="block">{e.input.reason}</small>
                  </>,
                  e.actorName,
                  reversed.has(e.id)
                    ? "Revertido"
                    : [
                          "transfer",
                          "obligation",
                          "obligation_payment",
                          "settlement_expected",
                          "settlement_credit",
                          "adjustment",
                        ].includes(e.input.kind)
                      ? act("reverse", e.id, "Revertir")
                      : "—",
                ],
              }))}
            />
          </Panel>
        </>
      )}
      {section === "results" && (
        <>
          <Panel
            title="Conteos y mermas"
            tools={act(
              "inventory_count",
              undefined,
              undefined,
              !books.sources.theoreticalInventory.length,
            )}
          >
            <LedgerTable
              headers={[
                "Fecha",
                "Producto",
                "Stock teórico",
                "Conteo físico",
                "Consumo teórico",
                "Consumo real",
                "Merma declarada",
                "Desvío sin explicar",
              ]}
              empty="Registrá dos conteos físicos de un producto para comparar su consumo durante el intervalo."
              rows={books.inventoryCounts.flatMap((c) =>
                c.items.map((i) => ({
                  id: c.id + i.itemId,
                  cells: [
                    c.occurredAt.slice(0, 10),
                    books.sources.theoreticalInventory.find(
                      (p) => p.itemId === i.itemId,
                    )?.name ??
                      data.products.find((p) => p.id === i.itemId)?.name ??
                      i.itemId,
                    i.theoreticalQuantity,
                    i.actualQuantity,
                    i.theoreticalUsage ?? "—",
                    i.actualUsage ?? "—",
                    i.wasteQuantity,
                    i.unexplainedUsage ?? "—",
                  ],
                })),
              )}
            />
          </Panel>
          <Panel
            title="Cierres mensuales de gestión"
            tools={
              <div className="flex gap-2">
                {act("month_close")}
                {act("adjustment")}
              </div>
            }
          >
            <LedgerTable
              headers={[
                "Mes",
                "Cerrado el",
                "Resultado al cierre",
                "Ajustes",
                "Detalle",
              ]}
              empty="Sin cierres de gestión registrados."
              rows={books.monthlyClosures.map((c) => ({
                id: c.id,
                cells: [
                  c.month,
                  c.closedAt.slice(0, 10),
                  formatMoney(c.pnlSnapshot.netMinor),
                  String(c.adjustmentIds.length),
                  <button
                    type="button"
                    className="underline"
                    onClick={() => setExpanded(expanded === c.id ? null : c.id)}
                  >
                    Ver cierre
                  </button>,
                ],
              }))}
            />
            {books.monthlyClosures
              .filter((c) => c.id === expanded)
              .map((c) => (
                <div key={c.id} className="rounded border p-3 text-sm">
                  <b>{c.month}</b>
                  <p>
                    {c.reason} ·{" "}
                    {books.entries.find((e) => e.id === c.id)?.actorName ||
                      c.actorId}
                  </p>
                  <p>
                    Ventas {formatMoney(c.pnlSnapshot.salesMinor)} · Mercadería
                    y reparto {formatMoney(c.pnlSnapshot.costOfGoodsMinor)} ·
                    Personal {formatMoney(c.pnlSnapshot.payrollMinor)} · Gastos{" "}
                    {formatMoney(c.pnlSnapshot.operatingExpensesMinor)}
                  </p>
                  {Object.entries(c.accountBalances).map(([id, balance]) => (
                    <p key={id}>
                      {account(id)} al cierre · {formatMoney(balance)}
                    </p>
                  ))}
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => exportClosure(c, books)}
                  >
                    Exportar cierre (CSV)
                  </Button>
                  {books.adjustments
                    .filter((a) => c.adjustmentIds.includes(a.id))
                    .map((a) => (
                      <p key={a.id}>
                        {a.occurredAt.slice(0, 10)} · {a.reason} ·{" "}
                        {formatMoney(a.amountMinor)}
                      </p>
                    ))}
                  {report.from.slice(0, 7) === c.month &&
                    report.from.endsWith("-01") &&
                    report.to ===
                      new Date(
                        Date.UTC(
                          Number(c.month.slice(0, 4)),
                          Number(c.month.slice(5)),
                          0,
                        ),
                      )
                        .toISOString()
                        .slice(0, 10) && (
                      <p>
                        Resultado actualizado{" "}
                        {formatMoney(report.estimatedOperatingProfitMinor)} ·
                        Variación desde el cierre{" "}
                        {formatMoney(
                          report.estimatedOperatingProfitMinor -
                            c.pnlSnapshot.netMinor,
                        )}
                      </p>
                    )}
                </div>
              ))}
          </Panel>
        </>
      )}
      {action && (
        <FinanceBookEntry
          key={action.kind + (action.id ?? "")}
          action={action}
          books={books}
          report={report}
          month={from.slice(0, 7)}
          onClose={() => setAction(null)}
          onSaved={() => {
            setAction(null);
            setNotice("Movimiento registrado.");
            void client.invalidateQueries({ queryKey: ["finance-books"] });
            onChange();
          }}
        />
      )}
    </div>
  );
}
