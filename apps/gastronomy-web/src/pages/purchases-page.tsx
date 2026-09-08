import { useEffect, useState, type FormEvent } from "react";
import type { BootstrapDto, PurchaseDto } from "@gastronomy/contracts";
import { Plus, Trash, Package } from "@phosphor-icons/react";
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
    <div className="grid gap-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-brand-600">
            Inventario
          </p>
          <h2 className="text-lg font-extrabold">Compras e ingresos</h2>
          <p className="text-sm text-slate-500">
            Registrá mercadería y actualizá existencias.
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus size={16} /> Registrar ingreso
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <p className="text-xs text-slate-500">Ingresos registrados</p>
          <p className="mt-1 text-2xl font-extrabold">{history.length}</p>
        </Card>
        <Card>
          <p className="text-xs text-slate-500">Costo acumulado</p>
          <p className="mt-1 text-2xl font-extrabold">
            {formatMoney(monthTotal)}
          </p>
        </Card>
        <Card>
          <p className="text-xs text-slate-500">Productos en catálogo</p>
          <p className="mt-1 text-2xl font-extrabold">{data.products.length}</p>
        </Card>
      </div>
      <Card className="overflow-hidden">
        <div className="border-b border-slate-100 p-4">
          <h3 className="font-bold">Historial de ingresos</h3>
        </div>
        {loadingHistory ? (
          <p className="p-8 text-center text-sm text-slate-400">
            Cargando ingresos…
          </p>
        ) : historyError ? (
          <p role="alert" className="p-8 text-center text-sm text-rose-600">
            {historyError}
          </p>
        ) : history.length === 0 ? (
          <div className="grid place-items-center gap-2 p-12 text-center">
            <Package size={32} className="text-slate-300" />
            <p className="font-semibold text-slate-500">
              Todavía no hay ingresos registrados.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {history.map((p) => (
              <div
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-3 p-4"
              >
                <div>
                  <p className="font-bold">{p.supplierName}</p>
                  <p className="text-xs text-slate-500">
                    {p.invoiceNumber || "Sin comprobante"} ·{" "}
                    {new Date(p.createdAt).toLocaleString("es-AR")} ·{" "}
                    {p.createdByUserName}
                  </p>
                </div>
                <Badge tone="green">{formatMoney(p.totalMinor)}</Badge>
              </div>
            ))}
          </div>
        )}
      </Card>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        closeDisabled={mutation.isPending}
        width="max-w-4xl"
        title="Registrar ingreso"
        description="El stock se actualiza al confirmar."
      >
        <form
          className="grid gap-3"
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
                placeholder="Factura / remito"
              />
            </Field>
          </div>
          <Field label="Notas">
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Opcional"
            />
          </Field>
          <div className="grid gap-2">
            {lines.map((l, i) => (
              <div
                key={i}
                className="grid items-end gap-2 sm:grid-cols-[minmax(180px,1fr)_110px_120px_32px]"
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
                  className="mb-1 text-slate-400"
                  onClick={() =>
                    setLines((ls) =>
                      ls.length > 1 ? ls.filter((_, n) => n !== i) : ls,
                    )
                  }
                  aria-label="Quitar línea"
                >
                  <Trash size={17} />
                </button>
              </div>
            ))}
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                setLines((ls) => [
                  ...ls,
                  { productId: "", quantity: "", cost: "" },
                ])
              }
            >
              <Plus size={15} /> Agregar línea
            </Button>
          </div>
          <div className="flex justify-end border-t pt-3 font-extrabold">
            Total: {formatMoney(total)}
          </div>
          <Field label="PIN autorizador">
            <Input
              type="password"
              inputMode="numeric"
              maxLength={8}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            />
          </Field>
          {error && (
            <p role="alert" className="text-xs font-semibold text-rose-600">
              {error}
            </p>
          )}
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "Guardando…" : "Confirmar ingreso"}
          </Button>
        </form>
      </Modal>
    </div>
  );
}
