import { useEffect, useMemo, useState } from "react";
import type { BootstrapDto, FinanceExpenseDto, FinanceReportDto, FinanceExpenseKind } from "@gastronomy/contracts";
import { ArrowClockwise, ChartBar, Coins, DownloadSimple, Plus, WarningCircle } from "@phosphor-icons/react";
import { Badge, Button, Card, Field, Input, Select } from "@gastronomy/ui";
import { formatMoney, humanError, parseMoneyInput } from "../lib";

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const thisMonth = () => today().slice(0, 7);
const monthEnd = (month: string) => {
  const [year, value] = month.split("-").map(Number);
  return `${month}-${new Date(year!, value!, 0).getDate()}`;
};
const money = (value: string) => parseMoneyInput(value) ?? 0;

export function FinancePage({ data }: { data: BootstrapDto }) {
  const [month, setMonth] = useState(thisMonth);
  const [from, setFrom] = useState(`${thisMonth()}-01`);
  const [to, setTo] = useState(() => monthEnd(thisMonth()));
  const [report, setReport] = useState<FinanceReportDto | null>(null);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [kind, setKind] = useState<FinanceExpenseKind>("GENERAL");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [incurredOn, setIncurredOn] = useState(today);
  const [dueOn, setDueOn] = useState(today);
  const [employeeId, setEmployeeId] = useState("");
  const [note, setNote] = useState("");
  const [repeat, setRepeat] = useState(false);
  const [dayOfMonth, setDayOfMonth] = useState(String(new Date().getDate()));
  const [payingId, setPayingId] = useState<string | null>(null);
  const [payMethod, setPayMethod] = useState("CASH");
  const [fromCash, setFromCash] = useState(false);
  const [productId, setProductId] = useState("");
  const [unitCost, setUnitCost] = useState("");

  useEffect(() => {
    let current = true;
    setLoading(true);
    window.gastronomy.getFinanceReport({ from, to })
      .then((value) => { if (current) { setReport(value); setError(null); } })
      .catch((value) => { if (current) setError(humanError(value)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [from, to, reload]);

  const methods = data.paymentMethods.filter((item) => item.active && item.code !== "ACCOUNT");
  const employees = data.users.filter((user) => user.active);
  const expenseCategories = useMemo(() => {
    const grouped = new Map<string, number>();
    for (const item of report?.expenses ?? []) grouped.set(item.category, (grouped.get(item.category) ?? 0) + item.amountMinor);
    return [...grouped].sort((a,b) => b[1] - a[1]);
  }, [report]);
  const coverage = report && report.costedItems + report.unknownCostItems > 0
    ? Math.round(100 * report.costedItems / (report.costedItems + report.unknownCostItems)) : 0;

  async function run(action: () => Promise<unknown>, success: string) {
    if (busy) return false;
    setBusy(true); setError(null); setMessage(null);
    try { await action(); setMessage(success); setReload((value) => value + 1); return true; }
    catch (value) { setError(humanError(value)); return false; }
    finally { setBusy(false); }
  }

  function exportCsv() {
    if (!report) return;
    const quote = (value: string | number | null) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const rows = [
      ["Fecha", "Tipo", "Categoría", "Descripción", "Importe", "Estado", "Empleado", "Medio"],
      ...report.expenses.map((item) => [item.incurredOn, item.kind, item.category, item.title,
        (item.amountMinor / 100).toFixed(2), item.paidAt ? "Pagado" : "Pendiente", item.employeeName ?? "", item.paymentMethodCode ?? ""]),
    ];
    const csv = "\ufeff" + rows.map((row) => row.map(quote).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], {type: "text/csv;charset=utf-8"}));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `finanzas-${from}-${to}.csv`; anchor.click();
    URL.revokeObjectURL(url);
  }

  const card = (label: string, value: number, hint: string, emphasis = false) => (
    <Card className={`p-4 ${emphasis ? "bg-slate-950 text-white" : "bg-white"}`}>
      <p className={`text-[10px] font-bold uppercase tracking-widest ${emphasis ? "text-slate-400" : "text-slate-500"}`}>{label}</p>
      <p className="mt-2 text-2xl font-black tabular-nums">{formatMoney(value)}</p>
      <p className={`mt-1 text-[11px] ${emphasis ? "text-slate-300" : "text-slate-500"}`}>{hint}</p>
    </Card>
  );

  return <div className="space-y-5 pb-8">
    <header className="rounded-2xl bg-slate-950 px-5 py-5 text-white sm:px-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-300">Control de gestión</p>
          <h1 className="mt-1 text-2xl font-black">Finanzas</h1>
          <p className="mt-1 max-w-2xl text-xs text-slate-300">Ventas, costo estimado de lo vendido, sueldos y gastos devengados. Compras de stock separadas para no contarlas dos veces.</p>
        </div>
        <div className="flex gap-2"><Button type="button" variant="secondary" onClick={() => setReload((value) => value + 1)}><ArrowClockwise size={16}/> Actualizar</Button>
          <Button type="button" variant="secondary" disabled={!report} onClick={exportCsv}><DownloadSimple size={16}/> CSV</Button></div>
      </div>
    </header>

    <Card className="p-4"><div className="flex flex-wrap items-end gap-3">
      <Field label="Mes"><Input type="month" value={month} onChange={(event) => {const value = event.target.value; setMonth(value); if (value) {setFrom(`${value}-01`); setTo(monthEnd(value));}}} /></Field>
      <Field label="Desde"><Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></Field>
      <Field label="Hasta"><Input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></Field>
      <span className="pb-2 text-xs text-slate-500">Período personalizado de hasta 3 años</span>
    </div></Card>
    {error ? <p role="alert" className="rounded-xl bg-rose-50 p-3 text-xs font-semibold text-rose-700">{error}</p> : null}
    {message ? <p role="status" className="rounded-xl bg-emerald-50 p-3 text-xs font-semibold text-emerald-700">{message}</p> : null}
    {loading ? <p className="text-sm text-slate-500">Calculando período…</p> : null}
    {report ? <>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {card("Ventas netas", report.salesMinor, `Devoluciones descontadas: ${formatMoney(report.refundsMinor)}`)}
        {card("Costo vendido", report.cogsMinor, `${report.costedItems} líneas con costo · ${report.unknownCostItems} sin costo`)}
        {card("Margen bruto estimado", report.grossProfitMinor, `Cobertura de costos: ${coverage}%`)}
        {card("Gastos operativos", report.expensesMinor - report.payrollMinor, `Fijos: ${formatMoney(report.fixedMinor)}`)}
        {card("Sueldos", report.payrollMinor, "Importes cargados, no liquidación laboral")}
        {card("Resultado operativo estimado", report.estimatedOperatingProfitMinor, `Pendiente de pago: ${formatMoney(report.unpaidMinor)}`, true)}
      </section>
      {report.unknownCostItems > 0 ? <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><WarningCircle size={18}/>
        Hay {report.unknownCostItems} líneas vendidas sin costo registrado. El margen y el resultado son incompletos; cargá costos en esta página para ventas futuras. Las ventas históricas no se recalculan retroactivamente.</div> : null}
      <section className="grid gap-3 lg:grid-cols-2">
        <Card className="p-4"><h2 className="flex items-center gap-2 text-sm font-extrabold"><ChartBar size={17}/> Evolución mensual</h2>
          {report.monthly.length ? <div className="mt-4 space-y-3">{report.monthly.map((row) => {
            const scale = Math.max(1, ...report.monthly.map((item) => item.salesMinor));
            return <div key={row.month} className="grid grid-cols-[70px_1fr_100px] items-center gap-2 text-xs"><b>{row.month}</b>
              <div className="h-4 overflow-hidden rounded bg-slate-100"><div className="h-full rounded bg-emerald-500" style={{width: `${Math.max(0, 100 * row.salesMinor / scale)}%`}}/></div>
              <span className="text-right font-bold tabular-nums">{formatMoney(row.salesMinor)}</span></div>;
          })}</div> : <p className="mt-3 text-xs text-slate-500">Sin actividad en el período.</p>}
        </Card>
        <Card className="p-4"><h2 className="flex items-center gap-2 text-sm font-extrabold"><Coins size={17}/> Composición de gastos</h2>
          <div className="mt-3 space-y-2">{expenseCategories.length ? expenseCategories.map(([name, value]) =>
            <div key={name} className="flex items-center justify-between border-b border-slate-100 pb-2 text-xs"><span>{name}</span><b>{formatMoney(value)}</b></div>) : <p className="text-xs text-slate-500">Sin gastos cargados.</p>}</div>
          <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs"><b>Compras de inventario: {formatMoney(report.purchasesMinor)}</b><p className="mt-1 text-slate-500">Se muestran para control de abastecimiento. No se suman otra vez a los gastos del resultado.</p></div>
        </Card>
      </section>

      <section className="grid gap-3 xl:grid-cols-[1fr_1.4fr]">
        <Card className="p-4"><h2 className="text-sm font-extrabold">Registrar gasto o sueldo</h2><p className="mt-1 text-xs text-slate-500">Devenga en la fecha indicada; pagar desde caja es un paso separado.</p>
          <form className="mt-3 grid gap-3" onSubmit={async (event) => {event.preventDefault(); const amountMinor = money(amount); if (!amountMinor) {setError("Ingresá un importe válido."); return;}
            const saved = repeat
              ? await run(() => window.gastronomy.createFinanceRecurring({title,category,kind: kind === "PAYROLL" ? "PAYROLL" : "FIXED",amountMinor,dayOfMonth: Number(dayOfMonth),startMonth: incurredOn.slice(0,7),employeeId: employeeId || null,idempotencyKey: crypto.randomUUID()}),"Gasto fijo configurado.")
              : await run(() => window.gastronomy.createFinanceExpense({title,category,kind,amountMinor,incurredOn,dueOn,employeeId: employeeId || null,note: note || null,idempotencyKey: crypto.randomUUID()}),"Gasto registrado.");
            if (saved) {setTitle(""); setAmount("");} }}>
            <div className="grid gap-2 sm:grid-cols-2"><Field label="Tipo"><Select value={kind} onChange={(event) => setKind(event.target.value as FinanceExpenseKind)}><option value="GENERAL">General</option><option value="FIXED">Fijo</option><option value="PAYROLL">Sueldo</option></Select></Field>
              <Field label="Categoría"><Input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Alquiler, servicios, personal…" required /></Field></div>
            <div className="grid gap-2 sm:grid-cols-2"><Field label="Concepto"><Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Descripción" required /></Field>
              <Field label="Importe"><Input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0,00" required /></Field></div>
            {kind === "PAYROLL" ? <Field label="Empleado"><Select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)} required><option value="">Elegir empleado</option>{employees.map((user) => <option key={user.id} value={user.id}>{user.fullName}</option>)}</Select></Field> : null}
            <label className="flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={repeat} onChange={(event) => setRepeat(event.target.checked)}/> Repetir cada mes como gasto fijo</label>
            <div className="grid gap-2 sm:grid-cols-2"><Field label={repeat ? "Mes de inicio" : "Fecha del gasto"}><Input type={repeat ? "month" : "date"} value={repeat ? incurredOn.slice(0,7) : incurredOn} onChange={(event) => setIncurredOn(repeat ? `${event.target.value}-01` : event.target.value)} /></Field>
              {repeat ? <Field label="Día de vencimiento"><Input type="number" min="1" max="31" value={dayOfMonth} onChange={(event) => setDayOfMonth(event.target.value)} /></Field>
                : <Field label="Vencimiento"><Input type="date" value={dueOn} onChange={(event) => setDueOn(event.target.value)} /></Field>}</div>
            {!repeat ? <Field label="Nota"><Input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Opcional" /></Field> : null}
            <Button type="submit" disabled={busy}><Plus size={16}/> {repeat ? "Crear gasto mensual" : "Registrar gasto"}</Button>
          </form></Card>
        <Card className="p-4"><div className="flex items-center justify-between"><h2 className="text-sm font-extrabold">Gastos del período</h2><Badge tone="slate">{report.expenses.length} registros</Badge></div>
          <div className="mt-3 max-h-[550px] space-y-2 overflow-auto">{report.expenses.length ? report.expenses.map((item: FinanceExpenseDto) =>
            <article key={item.id} className="rounded-xl border border-slate-200 p-3 text-xs">
              <div className="flex flex-wrap items-start justify-between gap-2"><div><b className="text-slate-900">{item.title}</b><p className="text-slate-500">{item.category} · {item.incurredOn} · vence {item.dueOn}{item.employeeName ? ` · ${item.employeeName}` : ""}</p></div><b className="text-sm tabular-nums">{formatMoney(item.amountMinor)}</b></div>
              {item.paidAt ? <p className="mt-2 font-semibold text-emerald-700">Pagado · {item.paymentMethodCode ?? "Sin medio"}{item.recurringId ? " · Mensual" : ""}</p>
                : <div className="mt-2 flex flex-wrap items-center gap-2"><Badge tone="amber">Pendiente</Badge>
                  {payingId === item.id ? <><Select value={payMethod} onChange={(event) => setPayMethod(event.target.value)}>{methods.map((method) => <option key={method.code} value={method.code}>{method.name}</option>)}</Select>
                    <label className="flex items-center gap-1"><input type="checkbox" checked={fromCash} disabled={!data.cashSession} onChange={(event) => setFromCash(event.target.checked)}/> Desde caja</label>
                    <Button type="button" disabled={busy} onClick={() => void run(() => window.gastronomy.payFinanceExpense({expenseId: item.id,paymentMethodCode: payMethod,fromCash,idempotencyKey: crypto.randomUUID()}),"Pago registrado.").then((saved) => {if (saved) setPayingId(null);})}>Confirmar</Button>
                    <Button type="button" variant="secondary" onClick={() => setPayingId(null)}>Cancelar</Button></>
                    : <Button type="button" variant="secondary" onClick={() => {setPayingId(item.id);setFromCash(false);setPayMethod(methods[0]?.code ?? "CASH");}}>Marcar pagado</Button>}</div>}
            </article>) : <p className="text-xs text-slate-500">No hay gastos en este período.</p>}</div>
        </Card>
      </section>

      <section className="grid gap-3 xl:grid-cols-2">
        <Card className="p-4"><h2 className="text-sm font-extrabold">Gastos fijos activos</h2><p className="mt-1 text-xs text-slate-500">Se generan una vez por mes, sin duplicados.</p>
          <div className="mt-3 space-y-2">{report.recurring.filter((item) => item.active).length ? report.recurring.filter((item) => item.active).map((item) =>
            <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-2 text-xs"><span><b>{item.title}</b> · día {item.dayOfMonth} · desde {item.startMonth}</span><span className="flex items-center gap-2"><b>{formatMoney(item.amountMinor)}</b><Button type="button" variant="secondary" disabled={busy} onClick={() => void run(() => window.gastronomy.stopFinanceRecurring({recurringId: item.id}),"Gasto fijo detenido.")}>Detener</Button></span></div>) : <p className="text-xs text-slate-500">Sin reglas mensuales.</p>}</div>
        </Card>
        <Card className="p-4"><h2 className="text-sm font-extrabold">Costo unitario para ventas futuras</h2><p className="mt-1 text-xs text-slate-500">La última compra aporta el costo automáticamente. Un costo manual tiene prioridad; las ventas ya registradas mantienen su valor original.</p>
          <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(event) => {event.preventDefault(); void run(() => window.gastronomy.setFinanceProductCost({productId,unitCostMinor: money(unitCost)}),"Costo actualizado.");}}>
            <Field label="Producto"><Select value={productId} onChange={(event) => {const id = event.target.value;setProductId(id);const cost = report.productCosts.find((item) => item.productId === id)?.unitCostMinor;setUnitCost(cost == null ? "" : String(cost / 100));}} required><option value="">Elegir producto</option>{report.productCosts.map((item) => <option key={item.productId} value={item.productId}>{item.productName} · {item.unitCostMinor == null ? "sin costo" : formatMoney(item.unitCostMinor)} ({item.source})</option>)}</Select></Field>
            <Field label="Costo unitario"><Input inputMode="decimal" value={unitCost} onChange={(event) => setUnitCost(event.target.value)} placeholder="0,00" required /></Field>
            <Button type="submit" disabled={!productId || !unitCost.trim() || busy}>Guardar costo</Button>
            {report.productCosts.find((item) => item.productId === productId)?.source === "MANUAL" ? <Button type="button" variant="secondary" disabled={busy} onClick={() => void run(() => window.gastronomy.setFinanceProductCost({productId,unitCostMinor: null}),"Se vuelve a usar el costo de compras.")}>Usar costo de compras</Button> : null}
          </form>
        </Card>
      </section>
    </> : null}
  </div>;
}
