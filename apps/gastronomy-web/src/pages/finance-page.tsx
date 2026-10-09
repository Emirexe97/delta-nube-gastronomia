import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { bootstrapKey } from "../api";
import type {
  BootstrapDto,
  FinanceExpenseDto,
  FinanceReportDto,
  FinanceExpenseKind,
} from "@gastronomy/contracts";
import {
  ArrowClockwise,
  ChartBar,
  Coins,
  DownloadSimple,
  Plus,
} from "@phosphor-icons/react";
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  Select,
  Modal,
} from "@gastronomy/ui";
import { csvCell } from "@gastronomy/domain";
import {
  formatMoney,
  humanError,
  moneyInputValue,
  parseMoneyInput,
} from "../lib";
import { fullMonthForRange } from "./finance-period";

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const thisMonth = () => today().slice(0, 7);
const monthEnd = (month: string) => {
  const [year, value] = month.split("-").map(Number);
  return `${month}-${new Date(year!, value!, 0).getDate()}`;
};

export function FinancePage({ data }: { data: BootstrapDto }) {
  const queryClient = useQueryClient();
  const [, setMonth] = useState(thisMonth);
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
  const [payingRevision, setPayingRevision] = useState<number | null>(null);
  const [payMethod, setPayMethod] = useState("CASH");
  const [fromCash, setFromCash] = useState(false);
  const [productId, setProductId] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [recovery, setRecovery] = useState<{
    mode: "correct" | "cancel" | "unmark" | "cash-payment" | "closed-payment" | "monthly-correct" | "monthly-cancel";
    item: FinanceExpenseDto;
    revision: number;
    key: string;
  } | null>(null);
  const [correction, setCorrection] = useState({
    kind: "GENERAL" as FinanceExpenseKind,
    title: "",
    category: "",
    amount: "",
    incurredOn: "",
    dueOn: "",
    employeeId: "",
    note: "",
    reason: "",
  });
  const [cancelReason, setCancelReason] = useState("");
  const [cashCorrectionReason, setCashCorrectionReason] = useState("");
  const [cashCorrectionPin, setCashCorrectionPin] = useState("");
  const [closedConfirmed, setClosedConfirmed] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [receiving, setReceiving] = useState<{
    item: FinanceExpenseDto;
    revision: number;
    key: string;
    date: string;
  } | null>(null);
  const [returnDestination, setReturnDestination] = useState<
    "CASH_SESSION" | "EXTERNAL"
  >("EXTERNAL");
  const [returnMethod, setReturnMethod] = useState("");
  const [returnReason, setReturnReason] = useState("");
  const [returnPin, setReturnPin] = useState("");
  const [returnError, setReturnError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setLoading(true);
    window.gastronomy
      .getFinanceReport({ from, to })
      .then((value) => {
        if (current) {
          setReport(value);
          setError(null);
        }
      })
      .catch((value) => {
        if (current) setError(humanError(value));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [from, to, reload]);

  const methods = data.paymentMethods.filter(
    (item) => item.active && item.code !== "ACCOUNT",
  );
  const employees = data.users.filter((user) => user.active);
  const activeExpenses = useMemo(
    () => (report?.expenses ?? []).filter((item) => !item.cancelledAt),
    [report],
  );
  const expenseCategories = useMemo(() => {
    const grouped = new Map<string, number>();
    for (const item of activeExpenses)
      grouped.set(
        item.category,
        (grouped.get(item.category) ?? 0) + item.amountMinor,
      );
    for (const item of report?.expenseReturns ?? [])
      grouped.set(
        item.expenseCategory,
        (grouped.get(item.expenseCategory) ?? 0) - item.amountMinor,
      );
    return [...grouped].sort((a, b) => b[1] - a[1]);
  }, [activeExpenses, report?.expenseReturns]);
  const unitCostMinor = parseMoneyInput(unitCost);
  const costInvalid = Boolean(unitCost.trim()) && unitCostMinor == null;

  const coverage =
    report && report.costedItems + report.unknownCostItems > 0
      ? Math.round(
          (100 * report.costedItems) /
            (report.costedItems + report.unknownCostItems),
        )
      : 0;

  async function run(action: () => Promise<unknown>, success: string) {
    if (busy) return false;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
      setMessage(success);
      setReload((value) => value + 1);
      return true;
    } catch (value) {
      setError(humanError(value));
      return false;
    } finally {
      setBusy(false);
    }
  }

  function exportCsv() {
    if (!report || loading || report.from !== from || report.to !== to) return;
    const rows = [
      [
        "Fecha",
        "Tipo",
        "Categoría",
        "Descripción",
        "Importe (pesos)",
        "Estado",
        "Empleado",
        "Medio",
      ],
      ...activeExpenses.map((item) => [
        item.incurredOn,
        item.kind,
        item.category,
        item.title,
        moneyInputValue(item.amountMinor, true).replace(",", "."),
        item.returnInfo ? "Devuelto" : item.paidAt ? "Pagado" : "Pendiente",
        item.employeeName ?? "",
        item.paymentMethodCode ?? "",
      ]),
      ...(report.expenseReturns ?? []).map((item) => [
        item.receivedOn,
        "DEVOLUCIÓN",
        item.expenseCategory,
        item.expenseTitle,
        moneyInputValue(-item.amountMinor, true).replace(",", "."),
        "Recibida",
        "",
        item.paymentMethodCode,
      ]),
    ];
    const csv =
      "\ufeff" +
      rows
        .map((row) =>
          row
            .map((value, index) => {
              // Only the server-calculated return amount may be a signed numeric cell.
              // Keep formula-injection protection for every user-controlled text cell.
              if (
                row[1] === "DEVOLUCIÓN" &&
                index === 4 &&
                /^-\d+\.\d{2}$/.test(value)
              )
                return `"${value}"`;
              return csvCell(value);
            })
            .join(";"),
        )
        .join("\r\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `finanzas-${from}-${to}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const canManageFinance =
    data.currentUser.permissions.includes("finance.manage") ||
    data.currentUser.permissions.includes("*");
  const hasOpenCash = data.cashSession?.status === "OPEN";
  const receivedMethod = methods.find((item) => item.code === returnMethod);
  function beginReturn(item: FinanceExpenseDto) {
    setReceiving({
      item,
      revision: item.revision ?? 0,
      key: crypto.randomUUID(),
      date: today(),
    });
    setReturnDestination("EXTERNAL");
    setReturnMethod("");
    setReturnReason("");
    setReturnPin("");
    setReturnError(null);
  }
  async function submitReturn(event: FormEvent) {
    event.preventDefault();
    if (!receiving || busy) return;
    if (
      !returnReason.trim() ||
      returnReason.trim().length > 500 ||
      !receivedMethod ||
      (returnDestination === "CASH_SESSION" &&
        (!hasOpenCash || !/^\d{4,8}$/.test(returnPin)))
    ) {
      setReturnError(
        "Completá el medio recibido, el motivo y la autorización correspondiente.",
      );
      return;
    }
    setBusy(true);
    setReturnError(null);
    try {
      await window.gastronomy.receiveFinanceExpenseReturn({
        expenseId: receiving.item.id,
        expectedRevision: receiving.revision,
        idempotencyKey: receiving.key,
        destination: returnDestination,
        paymentMethodCode: returnMethod,
        reason: returnReason.trim(),
        authorizerPin:
          returnDestination === "CASH_SESSION" ? returnPin : undefined,
      });
      setReceiving(null);
      setMessage(
        "Devolución recibida registrada. El gasto no vuelve a pendiente.",
      );
      setReload((value) => value + 1);
      await queryClient.invalidateQueries({ queryKey: bootstrapKey });
    } catch (value) {
      setReturnError(humanError(value));
      await queryClient.invalidateQueries({ queryKey: bootstrapKey });
    } finally {
      setBusy(false);
    }
  }
  function canRecover(item: FinanceExpenseDto) {
    return (
      canManageFinance &&
      !item.cancelledAt &&
      !item.paidAt &&
      !item.recurringId &&
      !item.id.startsWith("cash-")
    );
  }
  function canCorrectCashPayment(item: FinanceExpenseDto) {
    const correction = item.cashPaymentCorrection;
    return Boolean(
      canManageFinance &&
      !item.cancelledAt &&
      item.paidAt &&
      !item.returnInfo &&
      correction &&
      data.cashSession &&
      data.cashSession.closedAt === null &&
      data.cashSession.id === correction.cashSessionId,
    );
  }
  function canRecoverMonthly(item: FinanceExpenseDto) {
    return canManageFinance && item.canRecoverMonthlyExpense === true && !item.paidAt && !item.cancelledAt;
  }
  function canCorrectClosedCashPayment(item: FinanceExpenseDto) {
    return Boolean(canManageFinance && item.paidAt && !item.cancelledAt && !item.returnInfo && item.closedCashPaymentCorrection);
  }
  function beginRecovery(
    mode: "correct" | "cancel" | "unmark" | "cash-payment" | "closed-payment" | "monthly-correct" | "monthly-cancel",
    item: FinanceExpenseDto,
  ) {
    setRecovery({
      mode,
      item,
      revision: item.revision ?? 0,
      key: crypto.randomUUID(),
    });
    setRecoveryError(null);
    setCancelReason("");
    setCashCorrectionReason("");
    setCashCorrectionPin("");
    setClosedConfirmed(false);
    setCorrection({
      kind: item.kind,
      title: item.title,
      category: item.category,
      amount: moneyInputValue(item.amountMinor),
      incurredOn: item.incurredOn,
      dueOn: item.dueOn,
      employeeId: item.employeeId ?? "",
      note: item.note ?? "",
      reason: "",
    });
  }
  function closeRecovery() {
    if (!busy) {
      setRecovery(null);
      setRecoveryError(null);
    }
  }
  async function submitRecovery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!recovery || busy) return;
    const reason = (
      recovery.mode === "correct" || recovery.mode === "monthly-correct"
        ? correction.reason
        : recovery.mode === "cash-payment" || recovery.mode === "closed-payment"
          ? cashCorrectionReason
          : cancelReason
    ).trim();
    if (!reason || reason.length > 500) {
      setRecoveryError("Ingresá un motivo de hasta 500 caracteres.");
      return;
    }
    setBusy(true);
    setRecoveryError(null);
    try {
      if (recovery.mode === "monthly-correct") {
        const amountMinor = parseMoneyInput(correction.amount);
        if (amountMinor == null || amountMinor <= 0) {
          setRecoveryError("Ingresá un importe válido."); return;
        }
        await window.gastronomy.correctFinanceMonthlyExpense({
          expenseId: recovery.item.id, expectedRevision: recovery.revision, idempotencyKey: recovery.key,
          title: correction.title.trim(), category: correction.category.trim(), amountMinor,
          dueOn: correction.dueOn, note: correction.note.trim() || null, reason,
        });
        setMessage("El gasto de este mes fue corregido. La repetición se conserva.");
      } else if (recovery.mode === "monthly-cancel") {
        await window.gastronomy.cancelFinanceMonthlyExpense({
          expenseId: recovery.item.id, expectedRevision: recovery.revision, idempotencyKey: recovery.key, reason,
        });
        setMessage("El gasto de este mes fue anulado. Los próximos meses se conservan.");
      } else if (recovery.mode === "closed-payment") {
        if (!closedConfirmed || !/^\d{4,8}$/.test(cashCorrectionPin)) {
          setRecoveryError("Confirmá que el dinero nunca salió y el gasto sigue adeudado; ingresá un PIN válido.");
          return;
        }
        await window.gastronomy.correctFinanceExpenseClosedCashPayment({
          expenseId: recovery.item.id, expectedRevision: recovery.revision,
          reason, authorizerPin: cashCorrectionPin, confirmedUnpaid: closedConfirmed,
          idempotencyKey: recovery.key,
        });
        setMessage("El pago registrado fue corregido. El gasto está pendiente y el cierre anterior se conserva.");
      } else if (recovery.mode === "cash-payment") {
        if (!/^\d{4,8}$/.test(cashCorrectionPin)) {
          setRecoveryError("Ingresá un PIN de autorización válido.");
          return;
        }
        await window.gastronomy.correctFinanceExpenseCashPayment({
          expenseId: recovery.item.id,
          expectedRevision: recovery.revision,
          reason,
          authorizerPin: cashCorrectionPin,
          idempotencyKey: recovery.key,
        });
        setMessage(
          "El pago registrado fue corregido. El gasto está pendiente.",
        );
      } else if (recovery.mode === "correct") {
        const amountMinor = parseMoneyInput(correction.amount);
        if (amountMinor == null || amountMinor <= 0) {
          setRecoveryError("Ingresá un importe válido.");
          return;
        }
        await window.gastronomy.correctFinanceExpense({
          expenseId: recovery.item.id,
          expectedRevision: recovery.revision,
          reason,
          idempotencyKey: recovery.key,
          title: correction.title.trim(),
          category: correction.category.trim(),
          kind: correction.kind,
          amountMinor,
          incurredOn: correction.incurredOn,
          dueOn: correction.dueOn,
          employeeId:
            correction.kind === "PAYROLL"
              ? correction.employeeId || null
              : null,
          note: correction.note || null,
        });
        setMessage("Gasto corregido.");
      } else if (recovery.mode === "cancel") {
        await window.gastronomy.cancelFinanceExpense({
          expenseId: recovery.item.id,
          expectedRevision: recovery.revision,
          reason,
          idempotencyKey: recovery.key,
        });
        setMessage("Gasto anulado.");
      } else {
        await window.gastronomy.unmarkFinanceExpensePayment({
          expenseId: recovery.item.id,
          expectedRevision: recovery.revision,
          reason,
          idempotencyKey: recovery.key,
        });
        setMessage("La marca de pago se deshizo. El gasto está pendiente.");
      }
      setRecovery(null);
      setReload((value) => value + 1);
    } catch (value) {
      setRecoveryError(humanError(value).replace(/^Error:\s*/, ""));
    } finally {
      setBusy(false);
    }
  }

  const card = (
    label: string,
    value: number,
    hint: string,
    emphasis = false,
    missingCosts = false,
  ) => (
    <Card
      className={`p-4 ${emphasis ? "!bg-slate-950 text-white" : "bg-white"}`}
    >
      <p
        className={`text-xs font-bold uppercase tracking-widest ${emphasis ? "text-slate-400" : "text-slate-500"}`}
      >
        {label}
      </p>
      <p className="mt-2 text-2xl font-black tabular-nums">
        {formatMoney(value)}
      </p>
      <p
        className={`mt-1 text-xs ${emphasis ? "text-slate-300" : "text-slate-500"}`}
      >
        {hint}
      </p>
      {missingCosts ? (
        <div className="mt-3 space-y-2">
          <p
            className={`text-xs leading-5 ${emphasis ? "text-amber-200" : "text-amber-800"}`}
          >
            Hay ventas de productos sin costo cargado (
            {report?.unknownCostItems}{" "}
            {report?.unknownCostItems === 1 ? "línea" : "líneas"}). Este
            resultado no descuenta esos costos.
          </p>
          {emphasis ? (
            <Link
              to="/catalogo?costo=sin"
              className="inline-flex rounded-lg bg-white px-3 py-2 text-xs font-bold text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              Ver productos sin costo
            </Link>
          ) : null}
        </div>
      ) : null}
    </Card>
  );

  return (
    <div className="space-y-5 pb-8">
      <header className="rounded-2xl bg-slate-950 px-5 py-5 text-white sm:px-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-300">
              Control de gestión
            </p>
            <h1 className="mt-1 text-2xl font-black">Finanzas</h1>
            <p className="mt-1 max-w-2xl text-xs text-slate-300">
              Ventas, costo estimado de lo vendido, sueldos y gastos del
              período. Las compras de stock se muestran aparte.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setReload((value) => value + 1)}
            >
              <ArrowClockwise size={16} /> Actualizar
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={
                !report || loading || report.from !== from || report.to !== to
              }
              onClick={exportCsv}
            >
              <DownloadSimple size={16} /> Exportar gastos (CSV)
            </Button>
          </div>
        </div>
      </header>

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Mes">
            <Input
              type="month"
              value={fullMonthForRange(from, to)}
              onChange={(event) => {
                const value = event.target.value;
                setMonth(value);
                if (value) {
                  setFrom(`${value}-01`);
                  setTo(monthEnd(value));
                }
              }}
            />
          </Field>
          <Field label="Desde">
            <Input
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </Field>
          <Field label="Hasta">
            <Input
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </Field>
          <span className="pb-2 text-xs text-slate-500">
            {fullMonthForRange(from, to)
              ? "Mes completo · hasta 3 años"
              : "Período personalizado de hasta 3 años"}
          </span>
        </div>
      </Card>
      {error ? (
        <p
          role="alert"
          className="rounded-xl bg-rose-50 p-3 text-xs font-semibold text-rose-700"
        >
          {error}
        </p>
      ) : null}
      {message ? (
        <p
          role="status"
          className="rounded-xl bg-emerald-50 p-3 text-xs font-semibold text-emerald-700"
        >
          {message}
        </p>
      ) : null}
      {loading ? (
        <p className="text-sm text-slate-500">Calculando período…</p>
      ) : null}
      {report && !loading && report.from === from && report.to === to ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {card(
              "Ventas confirmadas",
              report.salesMinor,
              `Incluye pendientes de cobro · Devoluciones descontadas: ${formatMoney(report.refundsMinor)}`,
            )}
            {card(
              report.unknownCostItems > 0 ? "Costo conocido" : "Costo vendido",
              report.cogsMinor + report.deliveryCostsMinor,
              `Comida: ${formatMoney(report.cogsMinor)} · Reparto: ${formatMoney(report.deliveryCostsMinor)} · ${report.costedItems} líneas con costo · ${report.unknownCostItems} sin costo${report.unknownCostItems > 0 ? " · Costo parcial" : ""}`,
            )}
            {card(
              "Margen bruto estimado",
              report.grossProfitMinor,
              `Cobertura de costos: ${coverage}%`,
              false,
              report.unknownCostItems > 0,
            )}
            {card(
              "Gastos operativos",
              (report.netExpensesMinor ?? report.expensesMinor) -
                report.payrollMinor,
              (report.expenseReturnsMinor ?? 0) > 0
                ? `Gastos: ${formatMoney(report.expensesMinor - report.payrollMinor)} · Reintegros: ${formatMoney(report.expenseReturnsMinor ?? 0)}`
                : `Fijos: ${formatMoney(report.fixedMinor)}`,
            )}
            {card(
              "Sueldos",
              report.payrollMinor,
              "Importes cargados, no liquidación laboral",
            )}
            {card(
              "Resultado operativo estimado",
              report.estimatedOperatingProfitMinor,
              `Pendiente de pago: ${formatMoney(report.unpaidMinor)}`,
              true,
              report.unknownCostItems > 0,
            )}
          </section>
          <section className="grid gap-3 lg:grid-cols-2">
            <Card className="p-4">
              <h2 className="flex items-center gap-2 text-sm font-extrabold">
                <ChartBar size={17} /> Evolución mensual
              </h2>
              {report.monthly.length ? (
                <div className="mt-4 space-y-3">
                  {report.monthly.map((row) => {
                    const scale = Math.max(
                      1,
                      ...report.monthly.map((item) => item.salesMinor),
                    );
                    return (
                      <div
                        key={row.month}
                        className="grid grid-cols-[70px_1fr_100px] items-center gap-2 text-xs"
                      >
                        <b>{row.month}</b>
                        <div className="h-4 overflow-hidden rounded bg-slate-100">
                          <div
                            className="h-full rounded bg-emerald-500"
                            style={{
                              width: `${Math.max(0, (100 * row.salesMinor) / scale)}%`,
                            }}
                          />
                        </div>
                        <span className="text-right font-bold tabular-nums">
                          {formatMoney(row.salesMinor)}
                        </span>
                        {(row.expenseReturnsMinor ?? 0) > 0 ? (
                          <p className="col-span-3 text-slate-600">
                            Reintegros:{" "}
                            {formatMoney(row.expenseReturnsMinor ?? 0)} ·
                            Resultado:{" "}
                            {formatMoney(
                              row.salesMinor -
                                row.cogsMinor -
                                row.deliveryCostsMinor -
                                row.expensesMinor +
                                (row.expenseReturnsMinor ?? 0),
                            )}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="mt-3 text-xs text-slate-500">
                  Sin actividad en el período.
                </p>
              )}
            </Card>
            <Card className="p-4">
              <h2 className="flex items-center gap-2 text-sm font-extrabold">
                <Coins size={17} /> Composición de gastos
              </h2>
              <div className="mt-3 space-y-2">
                {expenseCategories.length ? (
                  expenseCategories.map(([name, value]) => (
                    <div
                      key={name}
                      className="flex items-center justify-between border-b border-slate-100 pb-2 text-xs"
                    >
                      <span>{name}</span>
                      <b>
                        {value < 0
                          ? `Reintegro ${formatMoney(-value)}`
                          : formatMoney(value)}
                      </b>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-slate-500">Sin gastos cargados.</p>
                )}
              </div>
              <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs">
                <b>
                  Compras de inventario: {formatMoney(report.purchasesMinor)}
                </b>
                <p className="mt-1 text-slate-500">
                  Se muestran para control de abastecimiento. No se suman otra
                  vez a los gastos del resultado.
                </p>
              </div>
            </Card>
          </section>

          {(report.expenseReturns?.length ?? 0) > 0 ? (
            <Card className="p-4">
              <h2 className="text-sm font-extrabold">
                Devoluciones recibidas del período
              </h2>
              <div className="mt-3 space-y-2">
                {report.expenseReturns!.map((item) => (
                  <article
                    key={item.id}
                    className="rounded-xl border border-slate-200 p-3 text-xs"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <b className="break-words">{item.expenseTitle}</b>
                      <b className="tabular-nums">
                        {formatMoney(item.amountMinor)}
                      </b>
                    </div>
                    <p className="mt-1 text-slate-600">
                      {item.receivedOn} · {item.paymentMethodName} ·{" "}
                      {item.destination === "CASH_SESSION"
                        ? `Caja #${item.cashSessionNumber}`
                        : "Fuera de caja"}
                    </p>
                    <p className="mt-1 break-words text-slate-600">
                      {item.reason}
                    </p>
                  </article>
                ))}
              </div>
            </Card>
          ) : null}
          <section className="grid gap-3 xl:grid-cols-[1fr_1.4fr]">
            <Card className="p-4">
              <h2 className="text-sm font-extrabold">
                Registrar gasto o sueldo
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Se registra en la fecha indicada; el pago desde caja se carga
                aparte.
              </p>
              <form
                className="mt-3 grid gap-3"
                onSubmit={async (event) => {
                  event.preventDefault();
                  const amountMinor = parseMoneyInput(amount);
                  if (amountMinor == null || amountMinor <= 0) {
                    setError("Ingresá un importe válido.");
                    return;
                  }
                  const saved = repeat
                    ? await run(
                        () =>
                          window.gastronomy.createFinanceRecurring({
                            title,
                            category,
                            kind: kind === "PAYROLL" ? "PAYROLL" : "FIXED",
                            amountMinor,
                            dayOfMonth: Number(dayOfMonth),
                            startMonth: incurredOn.slice(0, 7),
                            employeeId: employeeId || null,
                            idempotencyKey: crypto.randomUUID(),
                          }),
                        "Gasto fijo configurado.",
                      )
                    : await run(
                        () =>
                          window.gastronomy.createFinanceExpense({
                            title,
                            category,
                            kind,
                            amountMinor,
                            incurredOn,
                            dueOn,
                            employeeId: employeeId || null,
                            note: note || null,
                            idempotencyKey: crypto.randomUUID(),
                          }),
                        "Gasto registrado.",
                      );
                  if (saved) {
                    setTitle("");
                    setAmount("");
                  }
                }}
              >
                <div className="grid gap-2 sm:grid-cols-2">
                  <Field label="Tipo">
                    <Select
                      value={kind}
                      onChange={(event) =>
                        setKind(event.target.value as FinanceExpenseKind)
                      }
                    >
                      <option value="GENERAL">General</option>
                      <option value="FIXED">Fijo</option>
                      <option value="PAYROLL">Sueldo</option>
                    </Select>
                  </Field>
                  <Field label="Categoría">
                    <Input
                      value={category}
                      onChange={(event) => setCategory(event.target.value)}
                      placeholder="Alquiler, servicios, personal…"
                      required
                    />
                  </Field>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Field label="Concepto">
                    <Input
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      placeholder="Descripción"
                      required
                    />
                  </Field>
                  <Field label="Importe">
                    <Input
                      inputMode="decimal"
                      value={amount}
                      onChange={(event) => setAmount(event.target.value)}
                      placeholder="0,00"
                      required
                    />
                  </Field>
                </div>
                {kind === "PAYROLL" ? (
                  <Field label="Empleado">
                    <Select
                      value={employeeId}
                      onChange={(event) => setEmployeeId(event.target.value)}
                      required
                    >
                      <option value="">Elegir empleado</option>
                      {employees.map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.fullName}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : null}
                <label className="flex items-center gap-2 text-xs font-semibold">
                  <input
                    type="checkbox"
                    checked={repeat}
                    onChange={(event) => setRepeat(event.target.checked)}
                  />{" "}
                  Repetir cada mes como gasto fijo
                </label>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Field label={repeat ? "Mes de inicio" : "Fecha del gasto"}>
                    <Input
                      type={repeat ? "month" : "date"}
                      value={repeat ? incurredOn.slice(0, 7) : incurredOn}
                      onChange={(event) =>
                        setIncurredOn(
                          repeat
                            ? `${event.target.value}-01`
                            : event.target.value,
                        )
                      }
                    />
                  </Field>
                  {repeat ? (
                    <Field label="Día de vencimiento">
                      <Input
                        type="number"
                        min="1"
                        max="31"
                        value={dayOfMonth}
                        onChange={(event) => setDayOfMonth(event.target.value)}
                      />
                    </Field>
                  ) : (
                    <Field label="Vencimiento">
                      <Input
                        type="date"
                        value={dueOn}
                        onChange={(event) => setDueOn(event.target.value)}
                      />
                    </Field>
                  )}
                </div>
                {!repeat ? (
                  <Field label="Nota">
                    <Input
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="Opcional"
                    />
                  </Field>
                ) : null}
                <Button type="submit" disabled={busy}>
                  <Plus size={16} />{" "}
                  {repeat ? "Crear gasto mensual" : "Registrar gasto"}
                </Button>
              </form>
            </Card>
            <Card className="p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-extrabold">Gastos del período</h2>
                <Badge tone="slate">{report.expenses.length} registros</Badge>
              </div>
              <div className="mt-3 max-h-[550px] space-y-2 overflow-auto">
                {report.expenses.length ? (
                  report.expenses.map((item: FinanceExpenseDto) => (
                    <article
                      key={item.id}
                      className="rounded-xl border border-slate-200 p-3 text-xs"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <b className="text-slate-900">{item.title}</b>
                          <p className="text-slate-500">
                            {item.category} · {item.incurredOn} · vence{" "}
                            {item.dueOn}
                            {item.employeeName ? ` · ${item.employeeName}` : ""}
                          </p>
                        </div>
                        <b className="text-sm tabular-nums">
                          {formatMoney(item.amountMinor)}
                        </b>
                      </div>
                      {item.cancelledAt ? (
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-slate-600">
                          <Badge tone="slate">Anulado</Badge>
                          <span className="min-w-0 break-words">
                            {item.cancellationReason}
                          </span>
                        </div>
                      ) : item.returnInfo ? (
                        <div className="mt-2 space-y-1 text-emerald-700">
                          <Badge tone="green">Devuelto</Badge>
                          <p>
                            {item.returnInfo.receivedOn} ·{" "}
                            {item.returnInfo.paymentMethodName} ·{" "}
                            {item.returnInfo.destination === "CASH_SESSION"
                              ? `Caja #${item.returnInfo.cashSessionNumber}`
                              : "Fuera de caja"}
                          </p>
                        </div>
                      ) : item.paidAt ? (
                        <p className="mt-2 font-semibold text-emerald-700">
                          Pagado · {item.paymentMethodCode ?? "Sin medio"}
                          {item.recurringId ? " · Mensual" : ""}
                        </p>
                      ) : (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <Badge tone="amber">Pendiente</Badge>
                          {payingId === item.id ? (
                            <>
                              <Select
                                value={payMethod}
                                onChange={(event) =>
                                  setPayMethod(event.target.value)
                                }
                              >
                                {methods.map((method) => (
                                  <option key={method.code} value={method.code}>
                                    {method.name}
                                  </option>
                                ))}
                              </Select>
                              <label className="flex items-center gap-1">
                                <input
                                  type="checkbox"
                                  checked={fromCash}
                                  disabled={!data.cashSession}
                                  onChange={(event) =>
                                    setFromCash(event.target.checked)
                                  }
                                />{" "}
                                Desde caja
                              </label>
                              <Button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void run(
                                    () =>
                                      window.gastronomy.payFinanceExpense({
                                        expenseId: item.id,
                                        paymentMethodCode: payMethod,
                                        fromCash,
                                        expectedRevision:
                                          payingRevision ?? item.revision ?? 0,
                                        idempotencyKey: crypto.randomUUID(),
                                      }),
                                    "Pago registrado.",
                                  ).then((saved) => {
                                    if (saved) {
                                      setPayingId(null);
                                      setPayingRevision(null);
                                    }
                                  })
                                }
                              >
                                Confirmar
                              </Button>
                              <Button
                                type="button"
                                variant="secondary"
                                onClick={() => {
                                  setPayingId(null);
                                  setPayingRevision(null);
                                }}
                              >
                                Cancelar
                              </Button>
                            </>
                          ) : (
                            <Button
                              type="button"
                              variant="secondary"
                              onClick={() => {
                                setPayingId(item.id);
                                setPayingRevision(item.revision ?? 0);
                                setFromCash(false);
                                setPayMethod(methods[0]?.code ?? "CASH");
                              }}
                            >
                              Marcar pagado
                            </Button>
                          )}
                          {canRecover(item) ? (
                            <>
                              <Button
                                type="button"
                                variant="secondary"
                                disabled={busy}
                                onClick={() => beginRecovery("correct", item)}
                              >
                                Corregir
                              </Button>
                              <Button
                                type="button"
                                variant="secondary"
                                disabled={busy}
                                onClick={() => beginRecovery("cancel", item)}
                              >
                                Anular
                              </Button>
                            </>
                          ) : null}
                        </div>
                      )}
                      {!item.cancelledAt &&
                      !item.returnInfo &&
                      item.paidAt &&
                      item.canUnmarkPayment === true &&
                      canManageFinance ? (
                        <div className="mt-2">
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={busy}
                            onClick={() => beginRecovery("unmark", item)}
                          >
                            Deshacer marca de pago
                          </Button>
                        </div>
                      ) : null}
                      {canRecoverMonthly(item) ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button type="button" variant="secondary" disabled={busy} onClick={() => beginRecovery("monthly-correct", item)}>Corregir este mes</Button>
                          <Button type="button" variant="secondary" disabled={busy} onClick={() => beginRecovery("monthly-cancel", item)}>Anular este mes</Button>
                        </div>
                      ) : null}
                      {canCorrectCashPayment(item) ? (
                        <div className="mt-2">
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={busy}
                            onClick={() => beginRecovery("cash-payment", item)}
                          >
                            Corregir pago registrado
                          </Button>
                        </div>
                      ) : null}
                      {canCorrectClosedCashPayment(item) ? (
                        <div className="mt-2">
                          <Button type="button" variant="secondary" disabled={busy}
                            onClick={() => beginRecovery("closed-payment", item)}>
                            Corregir pago de caja cerrada
                          </Button>
                        </div>
                      ) : null}
                      {canManageFinance &&
                      item.canReceiveReturn === true &&
                      !item.returnInfo ? (
                        <div className="mt-2">
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={busy}
                            onClick={() => beginReturn(item)}
                          >
                            Registrar devolución recibida
                          </Button>
                        </div>
                      ) : null}
                    </article>
                  ))
                ) : (
                  <p className="text-xs text-slate-500">
                    No hay gastos en este período.
                  </p>
                )}
              </div>
            </Card>
          </section>

          <section className="grid gap-3 xl:grid-cols-2">
            <Card className="p-4">
              <h2 className="text-sm font-extrabold">Gastos fijos activos</h2>
              <div className="mt-3 space-y-2">
                {report.recurring.filter((item) => item.active).length ? (
                  report.recurring
                    .filter((item) => item.active)
                    .map((item) => (
                      <div
                        key={item.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-2 text-xs"
                      >
                        <span>
                          <b>{item.title}</b> · día {item.dayOfMonth} · desde{" "}
                          {item.startMonth}
                        </span>
                        <span className="flex items-center gap-2">
                          <b>{formatMoney(item.amountMinor)}</b>
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={busy}
                            onClick={() =>
                              void run(
                                () =>
                                  window.gastronomy.stopFinanceRecurring({
                                    recurringId: item.id,
                                  }),
                                "Gasto fijo detenido.",
                              )
                            }
                          >
                            Detener
                          </Button>
                        </span>
                      </div>
                    ))
                ) : (
                  <p className="text-xs text-slate-500">Sin gastos fijos.</p>
                )}
              </div>
            </Card>
            <Card className="p-4">
              <h2 className="text-sm font-extrabold">
                Costo unitario para ventas futuras
              </h2>
              {report.productCosts.some(
                (item) => item.unitCostMinor == null,
              ) ? (
                <Link
                  to="/catalogo?costo=sin"
                  className="mt-2 inline-flex rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-700"
                >
                  Ver productos sin costo
                </Link>
              ) : null}
              <form
                className="mt-3 flex flex-wrap items-end gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!productId || !unitCost.trim() || unitCostMinor == null) {
                    setError("Ingresá un costo válido, mayor o igual a cero.");
                    return;
                  }
                  void run(
                    () =>
                      window.gastronomy.setFinanceProductCost({
                        productId,
                        unitCostMinor,
                      }),
                    "Costo actualizado.",
                  );
                }}
              >
                <Field label="Producto">
                  <Select
                    value={productId}
                    onChange={(event) => {
                      const id = event.target.value;
                      setProductId(id);
                      const cost = report.productCosts.find(
                        (item) => item.productId === id,
                      )?.unitCostMinor;
                      setUnitCost(cost == null ? "" : moneyInputValue(cost));
                    }}
                    required
                  >
                    <option value="">Elegir producto</option>
                    {report.productCosts.map((item) => (
                      <option key={item.productId} value={item.productId}>
                        {item.productName} ·{" "}
                        {item.unitCostMinor == null
                          ? "sin costo"
                          : formatMoney(item.unitCostMinor)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Costo unitario">
                  <Input
                    inputMode="decimal"
                    value={unitCost}
                    onChange={(event) => setUnitCost(event.target.value)}
                    placeholder="0,00"
                    required
                  />
                </Field>
                {costInvalid ? (
                  <p
                    role="alert"
                    className="text-xs font-semibold text-rose-700"
                  >
                    Ingresá un costo válido, mayor o igual a cero.
                  </p>
                ) : null}
                <Button
                  type="submit"
                  disabled={
                    !productId || !unitCost.trim() || costInvalid || busy
                  }
                >
                  Guardar costo
                </Button>
                {report.productCosts.find(
                  (item) => item.productId === productId,
                )?.source === "MANUAL" ? (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () =>
                          window.gastronomy.setFinanceProductCost({
                            productId,
                            unitCostMinor: null,
                          }),
                        "Se vuelve a usar el costo de compras.",
                      )
                    }
                  >
                    Usar costo de compras
                  </Button>
                ) : null}
              </form>
            </Card>
          </section>
        </>
      ) : null}
      {receiving ? (
        <Modal
          open
          title="Registrar devolución recibida"
          width="max-w-xl"
          closeDisabled={busy}
          onClose={() => {
            if (!busy) setReceiving(null);
          }}
        >
          <p className="mt-2 text-sm text-slate-600">
            {receiving.item.title} · {formatMoney(receiving.item.amountMinor)} ·
            Fecha de recepción: {receiving.date}
          </p>
          <p className="mt-2 text-xs text-slate-600">
            Usá esta opción sólo si recibiste la devolución total de un gasto
            General que ya no corresponde pagar. No volverá a pendiente. El pago
            original y los cierres anteriores se conservarán.
          </p>
          <form className="mt-4 grid gap-3" onSubmit={submitReturn}>
            <fieldset disabled={busy} className="contents">
              <Field label="Destino">
                <Select
                  aria-label="Destino"
                  value={returnDestination}
                  onChange={(e) =>
                    setReturnDestination(
                      e.target.value as "CASH_SESSION" | "EXTERNAL",
                    )
                  }
                >
                  <option value="EXTERNAL">Fuera de caja</option>
                  <option value="CASH_SESSION" disabled={!hasOpenCash}>
                    En caja
                  </option>
                </Select>
              </Field>
              <Field label="Medio recibido">
                <Select
                  aria-label="Medio recibido"
                  value={returnMethod}
                  onChange={(e) => setReturnMethod(e.target.value)}
                  required
                >
                  <option value="">Elegir medio recibido</option>
                  {methods.map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <p className="text-xs text-slate-600">
                {returnDestination === "CASH_SESSION" &&
                receivedMethod?.affectsCash
                  ? `El efectivo esperado de la caja actual aumentará ${formatMoney(receiving.item.amountMinor)}.`
                  : "No cambia el efectivo esperado de la caja."}
              </p>
              <Field label="Motivo">
                <Input
                  value={returnReason}
                  maxLength={500}
                  onChange={(e) => setReturnReason(e.target.value)}
                  required
                />
              </Field>
              {returnDestination === "CASH_SESSION" ? (
                <Field label="PIN de autorización">
                  <Input
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    value={returnPin}
                    onChange={(e) => setReturnPin(e.target.value)}
                    required
                  />
                </Field>
              ) : null}
              {returnError ? (
                <div role="alert" className="text-xs text-rose-700">
                  {returnError}
                </div>
              ) : null}
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setReceiving(null)}
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={
                    busy ||
                    !returnReason.trim() ||
                    !receivedMethod ||
                    (returnDestination === "CASH_SESSION" &&
                      (!hasOpenCash || !/^\d{4,8}$/.test(returnPin)))
                  }
                >
                  {busy ? "Guardando…" : "Registrar devolución recibida"}
                </Button>
              </div>
            </fieldset>
          </form>
        </Modal>
      ) : null}
      {recovery ? (
        <Modal
          open
          onClose={closeRecovery}
          closeDisabled={busy}
          width="max-w-xl"
          title={
            recovery.mode === "monthly-correct"
              ? "Corregir este mes"
              : recovery.mode === "monthly-cancel"
                ? "Anular este mes"
                : recovery.mode === "correct"
              ? "Corregir gasto"
              : recovery.mode === "cash-payment" || recovery.mode === "closed-payment"
                ? "Corregir pago registrado"
                : recovery.mode === "unmark"
                  ? "Deshacer marca de pago"
                  : "Anular gasto"
          }
        >
          {recovery.mode === "monthly-correct" || recovery.mode === "monthly-cancel" ? (
            <>
              <p className="mt-2 text-sm text-slate-600">{recovery.item.title} · {formatMoney(recovery.item.amountMinor)} · Mes {recovery.item.incurredOn.slice(0, 7)}</p>
              <p className="mt-2 text-xs text-slate-600">Fecha del gasto: {recovery.item.incurredOn} · {recovery.item.kind === "PAYROLL" ? `Sueldo · ${recovery.item.employeeName ?? "Empleado registrado"}` : "Gasto fijo"}</p>
              <p className="mt-2 text-xs text-slate-600">Sólo cambia este gasto. Los próximos meses no se modifican.</p>
            </>
          ) : recovery.mode === "cash-payment" &&
          recovery.item.cashPaymentCorrection ? (
            <>
              <p className="mt-2 text-sm text-slate-600">
                {recovery.item.title} ·{" "}
                {formatMoney(recovery.item.cashPaymentCorrection.amountMinor)} ·{" "}
                {recovery.item.cashPaymentCorrection.paymentMethodName} · Caja #
                {recovery.item.cashPaymentCorrection.cashSessionNumber}
              </p>
              <p className="mt-2 text-xs text-slate-600">
                Usá esta opción sólo si el pago se registró por error y el
                dinero no salió. El gasto volverá a pendiente. No registra una
                devolución real.
              </p>
              <p className="mt-2 text-xs text-slate-600">
                {recovery.item.cashPaymentCorrection.affectsCash
                  ? `El saldo esperado de esta caja aumentará ${formatMoney(recovery.item.cashPaymentCorrection.amountMinor)}.`
                  : "No cambia el efectivo esperado de esta caja."}
              </p>
            </>
          ) : recovery.mode === "closed-payment" && recovery.item.closedCashPaymentCorrection ? (
            <>
              <p className="mt-2 text-sm text-slate-600">
                {recovery.item.title} · {formatMoney(recovery.item.amountMinor)} · {recovery.item.closedCashPaymentCorrection.paymentMethodName} · Caja #{recovery.item.closedCashPaymentCorrection.cashSessionNumber} cerrada
              </p>
              <p className="mt-2 text-xs text-slate-600">
                El gasto volverá a pendiente. No se registrará un ingreso ni se cambiará el cierre anterior.
              </p>
            </>
          ) : recovery.mode !== "correct" ? (
            <p className="mt-2 text-sm text-slate-600">
              {recovery.item.title} · {formatMoney(recovery.item.amountMinor)} ·{" "}
              {recovery.item.paymentMethodCode ?? "Sin medio"}
            </p>
          ) : null}
          {recovery.mode === "unmark" ? (
            <p className="mt-2 text-xs text-slate-600">
              El gasto volverá a pendiente. Esta acción no registra una
              devolución de dinero.
            </p>
          ) : null}
          {recoveryError ? (
            <p
              role="alert"
              className="mt-3 rounded-lg bg-rose-50 p-2 text-xs font-semibold text-rose-700"
            >
              {recoveryError}
            </p>
          ) : null}
          <form className="mt-4 grid gap-3" onSubmit={submitRecovery}>
            <fieldset disabled={busy} className="contents">
              {recovery.mode === "monthly-correct" ? (
                <>
                  <Field label="Concepto"><Input value={correction.title} maxLength={160} onChange={(event) => setCorrection({ ...correction, title: event.target.value })} required /></Field>
                  <Field label="Categoría"><Input value={correction.category} maxLength={160} onChange={(event) => setCorrection({ ...correction, category: event.target.value })} required /></Field>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Field label="Importe"><Input inputMode="decimal" value={correction.amount} onChange={(event) => setCorrection({ ...correction, amount: event.target.value })} required /></Field>
                    <Field label="Vencimiento"><Input type="date" value={correction.dueOn} onChange={(event) => setCorrection({ ...correction, dueOn: event.target.value })} required /></Field>
                  </div>
                  <Field label="Nota"><Input value={correction.note} maxLength={1000} onChange={(event) => setCorrection({ ...correction, note: event.target.value })} /></Field>
                  <Field label="Motivo"><Input value={correction.reason} maxLength={500} onChange={(event) => setCorrection({ ...correction, reason: event.target.value })} required /></Field>
                </>
              ) : recovery.mode === "cash-payment" || recovery.mode === "closed-payment" ? (
                <>
                  {recovery.mode === "closed-payment" ? (
                    <label className="flex items-start gap-2 text-sm text-slate-700">
                      <input type="checkbox" checked={closedConfirmed} onChange={(event) => setClosedConfirmed(event.target.checked)} required className="mt-1" />
                      Confirmo que el dinero nunca salió y el gasto todavía se debe pagar.
                    </label>
                  ) : null}
                  <Field label="Motivo">
                    <Input
                      value={cashCorrectionReason}
                      maxLength={500}
                      onChange={(event) =>
                        setCashCorrectionReason(event.target.value)
                      }
                      required
                    />
                  </Field>
                  <Field label="PIN de autorización">
                    <Input
                      type="password"
                      inputMode="numeric"
                      autoComplete="off"
                      value={cashCorrectionPin}
                      onChange={(event) =>
                        setCashCorrectionPin(event.target.value)
                      }
                      required
                    />
                  </Field>
                </>
              ) : recovery.mode === "correct" ? (
                <>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Field label="Tipo">
                      <Select
                        value={correction.kind}
                        onChange={(event) =>
                          setCorrection({
                            ...correction,
                            kind: event.target.value as FinanceExpenseKind,
                          })
                        }
                      >
                        <option value="GENERAL">General</option>
                        <option value="FIXED">Fijo</option>
                        <option value="PAYROLL">Sueldo</option>
                      </Select>
                    </Field>
                    <Field label="Categoría">
                      <Input
                        value={correction.category}
                        onChange={(event) =>
                          setCorrection({
                            ...correction,
                            category: event.target.value,
                          })
                        }
                        required
                      />
                    </Field>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Field label="Concepto">
                      <Input
                        value={correction.title}
                        onChange={(event) =>
                          setCorrection({
                            ...correction,
                            title: event.target.value,
                          })
                        }
                        required
                      />
                    </Field>
                    <Field label="Importe">
                      <Input
                        inputMode="decimal"
                        value={correction.amount}
                        onChange={(event) =>
                          setCorrection({
                            ...correction,
                            amount: event.target.value,
                          })
                        }
                        required
                      />
                    </Field>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Field label="Fecha del gasto">
                      <Input
                        type="date"
                        value={correction.incurredOn}
                        onChange={(event) =>
                          setCorrection({
                            ...correction,
                            incurredOn: event.target.value,
                          })
                        }
                        required
                      />
                    </Field>
                    <Field label="Vencimiento">
                      <Input
                        type="date"
                        value={correction.dueOn}
                        onChange={(event) =>
                          setCorrection({
                            ...correction,
                            dueOn: event.target.value,
                          })
                        }
                        required
                      />
                    </Field>
                  </div>
                  {correction.kind === "PAYROLL" ? (
                    <Field label="Empleado">
                      <Select
                        value={correction.employeeId}
                        onChange={(event) =>
                          setCorrection({
                            ...correction,
                            employeeId: event.target.value,
                          })
                        }
                        required
                      >
                        <option value="">Elegir empleado</option>
                        {data.users
                          .filter(
                            (user) =>
                              user.active || user.id === correction.employeeId,
                          )
                          .map((user) => (
                            <option key={user.id} value={user.id}>
                              {user.fullName}
                            </option>
                          ))}
                      </Select>
                    </Field>
                  ) : null}
                  <Field label="Nota">
                    <Input
                      value={correction.note}
                      onChange={(event) =>
                        setCorrection({
                          ...correction,
                          note: event.target.value,
                        })
                      }
                    />
                  </Field>
                  <Field label="Motivo de la corrección">
                    <Input
                      value={correction.reason}
                      maxLength={500}
                      onChange={(event) =>
                        setCorrection({
                          ...correction,
                          reason: event.target.value,
                        })
                      }
                      required
                    />
                  </Field>
                  {parseMoneyInput(correction.amount) !==
                    recovery.item.amountMinor ||
                  correction.incurredOn !== recovery.item.incurredOn ? (
                    <p className="text-xs text-amber-800">
                      Importe: {formatMoney(recovery.item.amountMinor)} →{" "}
                      {formatMoney(parseMoneyInput(correction.amount) ?? 0)}.
                      Fecha: {recovery.item.incurredOn} →{" "}
                      {correction.incurredOn}.
                    </p>
                  ) : null}
                </>
              ) : (
                <Field
                  label={
                    recovery.mode === "unmark"
                      ? "Motivo"
                      : "Motivo de anulación"
                  }
                >
                  <Input
                    value={cancelReason}
                    maxLength={500}
                    onChange={(event) => setCancelReason(event.target.value)}
                    required
                  />
                </Field>
              )}
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={closeRecovery}
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={
                    busy ||
                    !(recovery.mode === "correct" || recovery.mode === "monthly-correct"
                      ? correction.reason.trim()
                      : recovery.mode === "cash-payment" || recovery.mode === "closed-payment"
                        ? (recovery.mode !== "closed-payment" || closedConfirmed) && cashCorrectionReason.trim() &&
                          /^\d{4,8}$/.test(cashCorrectionPin)
                        : cancelReason.trim())
                  }
                >
                  {busy
                    ? "Guardando…"
                    : recovery.mode === "correct" || recovery.mode === "monthly-correct"
                      ? "Guardar corrección"
                      : recovery.mode === "cash-payment" || recovery.mode === "closed-payment"
                        ? "Corregir pago registrado"
                        : recovery.mode === "unmark"
                          ? "Deshacer marca de pago"
                          : "Confirmar anulación"}
                </Button>
              </div>
            </fieldset>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
