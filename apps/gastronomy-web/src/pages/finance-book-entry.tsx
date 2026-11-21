import { useRef, useState, type FormEvent, type ReactNode } from "react";
import type {
  FinanceBooksDto,
  FinanceEntryInput,
  FinanceAccountKind,
  FinanceReportDto,
} from "@gastronomy/contracts";
import { Button, Field, Input, Modal, Select } from "@gastronomy/ui";
import {
  formatMoney,
  humanError,
  localDateValue,
  moneyInputValue,
  parsePriceInput,
  parseStockInput,
} from "../lib";

type EntryKind = FinanceEntryInput["kind"];
export interface BookAction {
  kind: EntryKind;
  id?: string;
}
export const bookActionLabels: Record<EntryKind, string> = {
  account_open: "Crear cuenta de fondos",
  transfer: "Transferir entre cuentas",
  obligation: "Vincular compra a proveedor",
  obligation_payment: "Registrar pago a proveedor",
  settlement_expected: "Crear lote de acreditación",
  settlement_credit: "Registrar acreditación",
  settlement_reconcile: "Conciliar acreditación",
  inventory_count: "Registrar conteo físico",
  month_close: "Cerrar mes",
  adjustment: "Registrar ajuste",
  reverse: "Revertir movimiento",
  cash_category: "Clasificar gasto de caja",
  recurring_rate: "Cambiar importe mensual",
};

const value = (form: FormData, name: string) =>
  String(form.get(name) ?? "").trim();
function money(form: FormData, key: string) {
  const parsed = parsePriceInput(value(form, key));
  if (parsed == null) throw new Error("Ingresá un importe válido en pesos.");
  return parsed;
}
function quantity(form: FormData, field: string) {
  const parsed = parseStockInput(value(form, field));
  if (parsed == null)
    throw new Error("Ingresá una cantidad válida con hasta tres decimales.");
  return parsed / 1000;
}
function Amount({
  label,
  name,
  initial,
}: {
  label: string;
  name: string;
  initial?: string;
}) {
  return (
    <Field label={label}>
      <Input
        name={name}
        required
        inputMode="decimal"
        placeholder="0,00"
        defaultValue={initial}
      />
    </Field>
  );
}
function Choice({
  label,
  name,
  children,
  initial,
}: {
  label: string;
  name: string;
  children: ReactNode;
  initial?: string;
}) {
  return (
    <Field label={label}>
      <Select name={name} required defaultValue={initial ?? ""}>
        <option value="">Elegir…</option>
        {children}
      </Select>
    </Field>
  );
}

export function FinanceBookEntry({
  action,
  books,
  report,
  month,
  onClose,
  onSaved,
}: {
  action: BookAction;
  books: FinanceBooksDto;
  report: FinanceReportDto;
  month: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [selectedPayments, setSelectedPayments] = useState<string[]>([]);
  const [selectedProduct, setSelectedProduct] = useState(
    books.sources.theoreticalInventory[0]?.itemId ?? "",
  );
  const [search, setSearch] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID());
  const inFlight = useRef(false);
  const accounts = books.accounts.filter((a) => a.active);
  const accountOptions = accounts.map((a) => (
    <option key={a.id} value={a.id}>
      {a.name} · {formatMoney(a.balanceMinor)}
    </option>
  ));
  const obligation = books.obligations.find((o) => o.id === action.id);
  const settlement = books.settlements.find((s) => s.id === action.id);
  const paymentIdsInUse = new Set(
    books.settlements.flatMap((s) => s.paymentIds),
  );
  const available = books.sources.posPayments.filter(
    (p) =>
      p.status === "captured" &&
      !p.alreadySettled &&
      !paymentIdsInUse.has(p.id),
  );
  const selected = available.filter((p) => selectedPayments.includes(p.id));
  const gross = selected.reduce((total, p) => total + p.amountMinor, 0);
  const purchases = books.sources.purchases.filter(
    (p) => p.status === "confirmed" && !p.alreadyLinked,
  );
  const product = books.sources.theoreticalInventory.find(
    (p) => p.itemId === selectedProduct,
  );
  const [entityId] = useState(() => crypto.randomUUID());

  function entry(form: FormData): FinanceEntryInput {
    const common = {
      idempotencyKey: key,
      authorizerPin: value(form, "pin"),
      date: value(form, "date"),
      reason: value(form, "reason"),
    };
    const accountId = value(form, "account");
    switch (action.kind) {
      case "account_open":
        return {
          ...common,
          kind: action.kind,
          account: {
            id: entityId,
            name: value(form, "name"),
            kind: value(form, "kind") as FinanceAccountKind,
            openingBalanceMinor: money(form, "amount"),
            active: true,
          },
        };
      case "transfer":
        return {
          ...common,
          kind: action.kind,
          fromAccountId: accountId,
          toAccountId: value(form, "dest"),
          amountMinor: money(form, "amount"),
        };
      case "obligation": {
        const p = purchases.find((p) => p.id === value(form, "purchase"));
        if (!p) throw new Error("Elegí una compra disponible.");
        return {
          ...common,
          kind: action.kind,
          obligation: {
            id: entityId,
            supplierId: p.supplierId,
            supplierName: p.supplierName,
            description: common.reason,
            documentNumber: p.documentNumber,
            purchaseRef: { type: "purchase", id: p.id },
            incurredAt: p.occurredAt,
            dueAt: value(form, "due"),
            amountMinor: p.totalMinor,
          },
        };
      }
      case "obligation_payment":
        if (!obligation)
          throw new Error("Actualizá la obligación del proveedor.");
        return {
          ...common,
          kind: action.kind,
          obligationId: obligation.id,
          accountId,
          amountMinor: money(form, "amount"),
        };
      case "settlement_expected": {
        if (!selected.length)
          throw new Error("Seleccioná los cobros del lote.");
        const commissionMinor = money(form, "deductions");
        const withheldMinor = money(form, "withheld");
        const deductionsMinor = commissionMinor + withheldMinor;
        return {
          ...common,
          kind: action.kind,
          settlement: {
            id: entityId,
            sourceRef: { type: "settlement_batch", id: entityId },
            paymentIds: selected.map((p) => p.id),
            accountId,
            occurredAt: common.date,
            grossMinor: gross,
            commissionMinor,
            withheldMinor,
            deductionsMinor,
            expectedNetMinor: gross - deductionsMinor,
          },
        };
      }
      case "settlement_credit":
        if (!settlement) throw new Error("Actualizá el lote.");
        return {
          ...common,
          kind: action.kind,
          settlementId: settlement.id,
          accountId: settlement.accountId,
          actualNetMinor: money(form, "amount"),
        };
      case "settlement_reconcile":
        return { ...common, kind: action.kind, settlementId: action.id! };
      case "inventory_count":
        if (!product)
          throw new Error("Elegí un producto con control de stock.");
        return {
          ...common,
          kind: action.kind,
          count: {
            id: entityId,
            occurredAt: common.date,
            items: [
              {
                itemId: product.itemId,
                unit: product.unit,
                theoreticalQuantity: product.quantity,
                actualQuantity: quantity(form, "actual"),
                wasteQuantity: quantity(form, "waste"),
              },
            ],
          },
        };
      case "month_close":
        return { ...common, kind: action.kind, month: value(form, "month") };
      case "adjustment": {
        const id = value(form, "target");
        const payment = books.sources.posPayments.find(
          (p) => "payment-" + p.id === id,
        );
        const purchase = books.sources.purchases.find(
          (p) => "purchase-" + p.id === id,
        );
        const expense = report.expenses.find((e) => "expense-" + e.id === id);
        if (!payment && !purchase && !expense)
          throw new Error("Elegí el comprobante que origina el ajuste.");
        return {
          ...common,
          kind: action.kind,
          accountId: accountId || undefined,
          amountMinor:
            money(form, "amount") * (value(form, "sign") === "minus" ? -1 : 1),
          targetRef: expense
            ? { type: "expense", id: expense.id }
            : payment
              ? { type: "pos_payment", id: payment.id }
              : { type: "purchase", id: purchase!.id },
        };
      }
      case "reverse":
        return { ...common, kind: action.kind, targetEventId: action.id! };
      case "cash_category": {
        const expense = report.expenses.find(
          (e) => e.id === value(form, "movement"),
        );
        if (!expense) throw new Error("Elegí el egreso original.");
        return {
          ...common,
          kind: action.kind,
          movementId: expense.id.slice(5),
          expectedCategory: expense.category,
          category: value(form, "category"),
        };
      }
      case "recurring_rate": {
        const rule = report.recurring.find(
          (r) => r.id === value(form, "rule") && r.active,
        );
        if (!rule) throw new Error("Elegí una regla activa.");
        return {
          ...common,
          kind: action.kind,
          recurringId: rule.id,
          startMonth: value(form, "startMonth"),
          amountMinor: money(form, "amount"),
          expectedAmountMinor: rule.amountMinor,
        };
      }
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (inFlight.current) return;
    const form = new FormData(e.currentTarget);
    inFlight.current = true;
    setSaving(true);
    setError("");
    try {
      await window.gastronomy.postFinanceEntry(entry(form));
      onSaved();
    } catch (cause) {
      setError(humanError(cause));
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }
  return (
    <Modal
      open
      title={bookActionLabels[action.kind]}
      onClose={onClose}
      closeDisabled={saving}
      width="max-w-xl"
    >
      <form
        className="grid gap-3"
        onSubmit={submit}
        onChange={() => setKey(crypto.randomUUID())}
      >
        <fieldset disabled={saving} className="grid gap-3">
          {action.kind === "account_open" && (
            <>
              <Field label="Nombre de la cuenta">
                <Input
                  name="name"
                  required
                  maxLength={100}
                  placeholder="Banco, billetera o caja mayor"
                />
              </Field>
              <Choice label="Tipo de cuenta" name="kind" initial="bank">
                <option value="bank">Banco</option>
                <option value="wallet">Billetera</option>
                <option value="cash">Caja mayor</option>
              </Choice>
              <Amount label="Saldo inicial" name="amount" initial="0" />
            </>
          )}
          {action.kind === "transfer" && (
            <>
              <Choice label="Cuenta de origen" name="account">
                {accountOptions}
              </Choice>
              <Choice label="Cuenta de destino" name="dest">
                {accountOptions}
              </Choice>
              <Amount label="Importe a transferir" name="amount" />
            </>
          )}
          {action.kind === "obligation" && (
            <>
              <Choice
                label="Compra recibida"
                name="purchase"
                initial={action.id}
              >
                {purchases.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.supplierName} ·{" "}
                    {p.documentNumber || p.occurredAt.slice(0, 10)} ·{" "}
                    {formatMoney(p.totalMinor)}
                  </option>
                ))}
              </Choice>
              <Field label="Vencimiento del proveedor">
                <Input
                  name="due"
                  type="date"
                  required
                  defaultValue={localDateValue()}
                />
              </Field>
            </>
          )}
          {action.kind === "obligation_payment" && obligation && (
            <>
              <p>
                {obligation.supplierName} · Saldo{" "}
                {formatMoney(obligation.outstandingMinor)}
              </p>
              <Choice label="Cuenta de origen" name="account">
                {accountOptions}
              </Choice>
              <Amount
                label="Importe a pagar"
                name="amount"
                initial={moneyInputValue(obligation.outstandingMinor)}
              />
            </>
          )}
          {action.kind === "settlement_expected" && (
            <>
              <Choice label="Cuenta de acreditación" name="account">
                {accountOptions}
              </Choice>
              <Field label="Buscar cobros digitales">
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Medio, pedido o fecha"
                />
              </Field>
              <div className="max-h-44 space-y-1 overflow-auto rounded border p-2">
                {available
                  .filter((p) =>
                    [p.method, p.orderNumber, p.occurredAt]
                      .join(" ")
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  )
                  .map((p) => (
                    <label
                      key={p.id}
                      className="flex items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={selectedPayments.includes(p.id)}
                        onChange={(e) =>
                          setSelectedPayments((s) =>
                            e.target.checked
                              ? [...s, p.id]
                              : s.filter((id) => id !== p.id),
                          )
                        }
                      />
                      {p.method} · Pedido #{p.orderNumber ?? p.orderId} ·{" "}
                      {p.occurredAt.slice(0, 10)} · {formatMoney(p.amountMinor)}
                    </label>
                  ))}
                {!available.length && (
                  <p>Sin cobros digitales disponibles para armar un lote.</p>
                )}
              </div>
              <p>
                Bruto seleccionado <b>{formatMoney(gross)}</b>
              </p>
              <Amount
                label="Comisiones del lote"
                name="deductions"
                initial="0"
              />
              <Amount
                label="Retenciones recuperables"
                name="withheld"
                initial="0"
              />
            </>
          )}
          {action.kind === "settlement_credit" && settlement && (
            <>
              <p>
                Neto esperado <b>{formatMoney(settlement.expectedNetMinor)}</b>
              </p>
              <Amount
                label="Importe acreditado según extracto"
                name="amount"
                initial={moneyInputValue(settlement.expectedNetMinor)}
              />
            </>
          )}
          {action.kind === "settlement_reconcile" && settlement && (
            <p>
              Extracto {formatMoney(settlement.actualNetMinor ?? 0)} ·
              Diferencia {formatMoney(settlement.differenceMinor ?? 0)}
            </p>
          )}
          {action.kind === "inventory_count" && (
            <>
              <Field label="Producto contado">
                <Select
                  value={selectedProduct}
                  onChange={(e) => setSelectedProduct(e.target.value)}
                  required
                >
                  {books.sources.theoreticalInventory.map((p) => (
                    <option key={p.itemId} value={p.itemId}>
                      {p.name ?? p.itemId}
                    </option>
                  ))}
                </Select>
              </Field>
              <p>
                Stock teórico actual{" "}
                <b>
                  {product?.quantity ?? 0} {product?.unit}
                </b>
              </p>
              <Amount label="Cantidad física contada" name="actual" />
              <Amount
                label="Merma identificada (unidades)"
                name="waste"
                initial="0"
              />
            </>
          )}
          {action.kind === "month_close" && (
            <Field label="Mes contable">
              <Input name="month" type="month" required defaultValue={month} />
            </Field>
          )}
          {action.kind === "cash_category" && (
            <>
              <Choice name="movement" label="Egreso de caja">
                {report.expenses
                  .filter((e) => e.id.startsWith("cash-"))
                  .map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.incurredOn} · {e.title} · {formatMoney(e.amountMinor)}{" "}
                      · {e.category}
                    </option>
                  ))}
              </Choice>
              <Field label="Categoría del egreso">
                <Input
                  name="category"
                  required
                  list="finance-cash-categories"
                  maxLength={100}
                />
                <datalist id="finance-cash-categories">
                  {[...new Set(report.expenses.map((e) => e.category))]
                    .filter((s) => s !== "Caja sin clasificar")
                    .map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                </datalist>
              </Field>
            </>
          )}
          {action.kind === "recurring_rate" && (
            <>
              <Choice name="rule" label="Gasto recurrente">
                {report.recurring
                  .filter((r) => r.active)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.title} · {formatMoney(r.amountMinor)}
                    </option>
                  ))}
              </Choice>
              <Field label="Aplicar desde el mes">
                <Input type="month" name="startMonth" required />
              </Field>
              <Amount label="Nuevo importe mensual" name="amount" />
            </>
          )}
          {action.kind === "adjustment" && (
            <>
              <Choice label="Comprobante del ajuste" name="target">
                {report.expenses
                  .filter((e) => !e.cancelledAt && !e.id.startsWith("cash-"))
                  .map((e) => (
                    <option key={e.id} value={"expense-" + e.id}>
                      Gasto · {e.title} · {e.incurredOn} ·{" "}
                      {formatMoney(e.amountMinor)}
                    </option>
                  ))}
                {books.sources.purchases.map((p) => (
                  <option key={p.id} value={"purchase-" + p.id}>
                    {p.supplierName} ·{" "}
                    {p.documentNumber ?? p.occurredAt.slice(0, 10)}
                  </option>
                ))}
                {books.sources.posPayments.map((p) => (
                  <option key={p.id} value={"payment-" + p.id}>
                    Pedido #{p.orderNumber} · {p.method} ·{" "}
                    {formatMoney(p.amountMinor)} · {p.occurredAt.slice(0, 10)}
                  </option>
                ))}
              </Choice>
              <Choice label="Sentido del ajuste" name="sign" initial="plus">
                <option value="plus">Aumento</option>
                <option value="minus">Disminución</option>
              </Choice>
              <Amount label="Importe del ajuste" name="amount" />
              <Field label="Cuenta afectada (opcional)">
                <Select name="account">
                  <option value="">Solo registrar ajuste</option>
                  {accountOptions}
                </Select>
              </Field>
            </>
          )}
          <Field
            label={
              action.kind === "settlement_expected"
                ? "Fecha prevista de acreditación"
                : action.kind === "inventory_count"
                  ? "Fecha del conteo físico de hoy"
                  : "Fecha del movimiento"
            }
          >
            <Input
              name="date"
              type="date"
              required
              defaultValue={localDateValue()}
              readOnly={action.kind === "inventory_count"}
            />
          </Field>
          <Field label="Concepto o motivo">
            <Input name="reason" required maxLength={250} />
          </Field>
          <Field label="PIN de autorización financiera">
            <Input
              name="pin"
              type="password"
              required
              pattern="[0-9]{4,8}"
              inputMode="numeric"
              maxLength={8}
              autoComplete="off"
            />
          </Field>
        </fieldset>
        {error && (
          <p role="alert" className="text-sm text-rose-700">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={saving}
            onClick={onClose}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Guardando…" : "Confirmar registro"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
