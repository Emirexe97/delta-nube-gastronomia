import { useEffect, useState, type FormEvent } from "react";
import type { BootstrapDto, PurchaseDto } from "@gastronomy/contracts";
import {
  Package,
  Plus,
  Receipt,
  Trash,
  Wallet,
} from "@phosphor-icons/react";
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  Modal,
  Select,
} from "@gastronomy/ui";
import { useApiMutation } from "../api";
import {
  formatMoney,
  humanError,
  parseMoneyInput,
  parseStockInput,
} from "../lib";

export function PurchasesPage({ data }: { data: BootstrapDto }) {
  const [open, setOpen] = useState(false);
  const [supplier, setSupplier] = useState("");
  const [invoice, setInvoice] = useState("");
  const [notes, setNotes] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState([
    { productId: "", quantity: "", cost: "" },
  ]);
  const [history, setHistory] = useState<PurchaseDto[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingHistory(true);
    window.gastronomy
      .listPurchases()
      .then((purchases) => {
        if (!cancelled) setHistory(purchases);
      })
      .catch((value) => {
        if (!cancelled) setHistoryError(humanError(value));
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const mutation = useApiMutation(
    (input: Parameters<typeof window.gastronomy.createPurchase>[0]) =>
      window.gastronomy.createPurchase(input),
    {
      onSuccess: (purchase) => {
        setOpen(false);
        setSupplier("");
        setInvoice("");
        setNotes("");
        setLines([{ productId: "", quantity: "", cost: "" }]);
        setPin("");
        setHistory((current) => [
          purchase,
          ...current.filter((item) => item.id !== purchase.id),
        ]);
      },
      onError: (value) => setError(humanError(value)),
    },
  );

  const total = lines.reduce(
    (sum, l) =>
      sum +
      Math.round(
        ((parseStockInput(l.quantity) || 0) * (parseMoneyInput(l.cost) || 0)) /
          1000,
      ),
    0,
  );

  const update = (i: number, k: string, v: string) =>
    setLines((ls) => ls.map((l, n) => (n === i ? { ...l, [k]: v } : l)));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (
      !supplier.trim() ||
      !pin.trim() ||
      lines.some(
        (l) =>
          !l.productId ||
          (parseStockInput(l.quantity) ?? 0) <= 0 ||
          parseMoneyInput(l.cost) == null,
      )
    ) {
      setError("Completá proveedor, PIN y todas las líneas.");
      return;
    }
    mutation.mutate({
      supplierName: supplier.trim(),
      invoiceNumber: invoice.trim() || null,
      notes: notes.trim() || null,
      authorizerPin: pin,
      items: lines.map((l) => ({
        productId: l.productId,
        quantityMinor: parseStockInput(l.quantity)!,
        unitCostMinor: parseMoneyInput(l.cost)!,
      })),
    });
  };

  const monthTotal = history.reduce((s, p) => s + p.totalMinor, 0);

  return (
    <div className="panel-enter mx-auto max-w-[1500px] space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-brand-600">
            Inventario
          </p>
          <h2 className="text-xl font-extrabold tracking-tight text-slate-900">
            Compras e ingresos
          </h2>
          <p className="text-xs text-slate-500 sm:text-sm">
            Registrá mercadería y actualizá existencias en stock.
          </p>
        </div>
        <Button onClick={() => setOpen(true)} className="gap-2 self-start sm:self-auto">
          <Plus size={16} weight="bold" /> Registrar ingreso
        </Button>
      </div>

      <section className="grid gap-3 sm:grid-cols-3">
        <MetricCard
          icon={<Receipt size={22} weight="duotone" />}
          label="Ingresos registrados"
          value={String(history.length)}
          tone="brand"
        />
        <MetricCard
          icon={<Wallet size={22} weight="duotone" />}
          label="Costo acumulado"
          value={formatMoney(monthTotal)}
          tone="green"
        />
        <MetricCard
          icon={<Package size={22} weight="duotone" />}
          label="Productos en catálogo"
          value={String(data.products.length)}
          tone="blue"
        />
      </section>

      <Card className="overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-3 sm:px-5 sm:py-3.5">
          <h3 className="text-sm font-bold text-slate-900">Historial de ingresos</h3>
          <p className="text-[11px] text-slate-400">
            Comprobantes y compras de mercadería registrados
          </p>
        </div>
        {loadingHistory ? (
          <p className="p-8 text-center text-sm font-medium text-slate-400">
            Cargando ingresos…
          </p>
        ) : historyError ? (
          <p role="alert" className="p-8 text-center text-sm font-semibold text-rose-600">
            {historyError}
          </p>
        ) : history.length === 0 ? (
          <div className="grid place-items-center gap-2 p-12 text-center">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-400">
              <Package size={28} />
            </div>
            <p className="text-sm font-semibold text-slate-600">
              Todavía no hay ingresos registrados.
            </p>
            <p className="text-xs text-slate-400">
              Los comprobantes de compra confirmados aparecerán listados aquí.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {history.map((p) => (
              <div
                key={p.id}
                className="flex flex-col gap-3 p-4 transition-colors hover:bg-slate-50/70 sm:flex-row sm:items-center sm:justify-between sm:px-5 sm:py-4"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-slate-900">{p.supplierName}</span>
                    {p.invoiceNumber ? (
                      <span className="rounded-md border border-slate-200 bg-slate-100/70 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">
                        {p.invoiceNumber}
                      </span>
                    ) : (
                      <span className="text-[11px] italic text-slate-400">
                        Sin comprobante
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">
                    {new Intl.DateTimeFormat("es-AR", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    }).format(new Date(p.createdAt))} · Registrado por{" "}
                    <span className="font-medium text-slate-700">
                      {p.createdByUserName}
                    </span>
                  </p>
                  {p.items && p.items.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                      {p.items.map((item, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600"
                        >
                          <span className="font-semibold text-slate-800">
                            {(item.quantityMinor / 1000).toLocaleString("es-AR", {
                              maximumFractionDigits: 3,
                            })}
                          </span>
                          <span>{item.productName}</span>
                        </span>
                      ))}
                    </div>
                  )}
                  {p.notes ? (
                    <p className="text-xs italic text-slate-500">Nota: {p.notes}</p>
                  ) : null}
                </div>
                <div className="flex items-center justify-between sm:flex-col sm:items-end sm:justify-center">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 sm:hidden">
                    Total
                  </span>
                  <Badge tone="green">{formatMoney(p.totalMinor)}</Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        closeDisabled={mutation.isPending}
        width="max-w-3xl"
        title="Registrar ingreso"
        description="El stock y costo de los artículos se actualizarán al confirmar el ingreso."
      >
        <form
          className="grid gap-4"
          onSubmit={submit}
          aria-busy={mutation.isPending}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Proveedor">
              <Input
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
                autoFocus
                placeholder="Nombre o razón social"
              />
            </Field>
            <Field label="Comprobante">
              <Input
                value={invoice}
                onChange={(e) => setInvoice(e.target.value)}
                placeholder="Ej. Factura A-0001-00001234"
              />
            </Field>
          </div>
          <Field label="Notas">
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Observaciones o detalle adicional (opcional)"
            />
          </Field>

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-700">
              Líneas del comprobante
            </label>
            <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/50 p-3">
              {lines.map((l, i) => (
                <div
                  key={i}
                  className="grid items-end gap-2 sm:grid-cols-[minmax(180px,1fr)_120px_130px_40px]"
                >
                  <Field label={i === 0 ? "Producto" : ""}>
                    <Select
                      value={l.productId}
                      onChange={(e) => update(i, "productId", e.target.value)}
                    >
                      <option value="">Seleccionar…</option>
                      {data.products
                        .filter((p) => p.active)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                    </Select>
                  </Field>
                  <Field label={i === 0 ? "Cantidad" : ""}>
                    <Input
                      inputMode="decimal"
                      value={l.quantity}
                      onChange={(e) => update(i, "quantity", e.target.value)}
                      placeholder="0"
                    />
                  </Field>
                  <Field label={i === 0 ? "Costo unit." : ""}>
                    <Input
                      inputMode="decimal"
                      value={l.cost}
                      onChange={(e) => update(i, "cost", e.target.value)}
                      placeholder="$0"
                    />
                  </Field>
                  <button
                    type="button"
                    className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400 transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
                    onClick={() =>
                      setLines((ls) =>
                        ls.length > 1 ? ls.filter((_, n) => n !== i) : ls,
                      )
                    }
                    disabled={lines.length === 1}
                    aria-label="Quitar línea"
                  >
                    <Trash size={16} />
                  </button>
                </div>
              ))}
              <div className="pt-1">
                <Button
                  type="button"
                  variant="secondary"
                  className="gap-1.5"
                  onClick={() =>
                    setLines((ls) => [
                      ...ls,
                      { productId: "", quantity: "", cost: "" },
                    ])
                  }
                >
                  <Plus size={15} weight="bold" /> Agregar línea
                </Button>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div>
              <span className="text-xs font-bold text-slate-600">
                Total del ingreso
              </span>
              <p className="text-[11px] text-slate-400">
                Suma calculada según cantidades y costos
              </p>
            </div>
            <span className="text-xl font-extrabold tracking-tight text-slate-900">
              {formatMoney(total)}
            </span>
          </div>

          <Field
            label="PIN autorizador"
            hint="Código numérico de usuario autorizado para registrar compras."
          >
            <Input
              type="password"
              inputMode="numeric"
              maxLength={8}
              placeholder="••••"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            />
          </Field>

          {error && (
            <p role="alert" className="text-xs font-semibold text-rose-600">
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(false)}
              disabled={mutation.isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Guardando…" : "Confirmar ingreso"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: "brand" | "amber" | "green" | "blue";
}) {
  const tones = {
    brand: "text-brand-600 bg-brand-50",
    amber: "text-amber-600 bg-amber-50",
    green: "text-emerald-600 bg-emerald-50",
    blue: "text-sky-600 bg-sky-50",
  };
  return (
    <Card className="p-4 sm:p-5">
      <div
        className={`grid h-10 w-10 place-items-center rounded-xl ${tones[tone]}`}
      >
        {icon}
      </div>
      <p className="mt-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">
        {label}
      </p>
      <p className="mt-0.5 text-2xl font-extrabold tracking-tight text-slate-900">
        {value}
      </p>
    </Card>
  );
}
