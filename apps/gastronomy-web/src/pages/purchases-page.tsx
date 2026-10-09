import { useEffect, useRef, useState, type FormEvent } from "react";
import type { BootstrapDto, PurchaseDto } from "@gastronomy/contracts";
import { Package, Plus, Receipt, Trash, Wallet } from "@phosphor-icons/react";
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
  const canCorrectPurchases =
    data.currentUser.permissions.includes("purchases.manage") ||
    data.currentUser.permissions.includes("*");
  const [open, setOpen] = useState(false);
  const [costing, setCosting] = useState<PurchaseDto | null>(null);
  const [costItemId, setCostItemId] = useState("");
  const [costValue, setCostValue] = useState("");
  const [costReason, setCostReason] = useState("");
  const [costPin, setCostPin] = useState("");
  const [costError, setCostError] = useState<string | null>(null);
  const [costSource, setCostSource] = useState<string | null>(null);
  const costReceipt = useRef<{ fingerprint: string; key: string } | null>(null);
  const [quantityCorrection, setQuantityCorrection] =
    useState<PurchaseDto | null>(null);
  const [quantityItemId, setQuantityItemId] = useState("");
  const [quantityValue, setQuantityValue] = useState("");
  const [quantityReason, setQuantityReason] = useState("");
  const [quantityPin, setQuantityPin] = useState("");
  const [quantityError, setQuantityError] = useState<string | null>(null);
  const quantityReceipt = useRef<{ fingerprint: string; key: string } | null>(
    null,
  );
  const [correcting, setCorrecting] = useState<PurchaseDto | null>(null);
  const [correctionSupplier, setCorrectionSupplier] = useState("");
  const [correctionInvoice, setCorrectionInvoice] = useState("");
  const [correctionNotes, setCorrectionNotes] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [correctionPin, setCorrectionPin] = useState("");
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const correctionReceipt = useRef<{ fingerprint: string; key: string } | null>(
    null,
  );
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

  const correction = useApiMutation(
    (input: Parameters<typeof window.gastronomy.correctPurchaseMetadata>[0]) =>
      window.gastronomy.correctPurchaseMetadata(input),
    {
      onSuccess: async (purchase) => {
        try {
          setHistory(await window.gastronomy.listPurchases());
          setHistoryError(null);
        } catch (value) {
          setHistory((current) =>
            current.map((item) =>
              item.id === purchase.id &&
              (item.revision ?? 0) <= (purchase.revision ?? 0)
                ? purchase
                : item,
            ),
          );
          setHistoryError(humanError(value));
        }
        setCorrecting(null);
        setCorrectionPin("");
        correctionReceipt.current = null;
      },
      onError: async (value) => {
        setCorrectionError(humanError(value));
        try {
          setHistory(await window.gastronomy.listPurchases());
        } catch {
          /* Keep entered fields and the original error. */
        }
      },
    },
  );
  const beginCorrection = (purchase: PurchaseDto) => {
    setCorrecting(purchase);
    setCorrectionSupplier(purchase.supplierName);
    setCorrectionInvoice(purchase.invoiceNumber ?? "");
    setCorrectionNotes(purchase.notes ?? "");
    setCorrectionReason("");
    setCorrectionPin("");
    setCorrectionError(null);
    correctionReceipt.current = null;
  };
  const submitCorrection = (event: FormEvent) => {
    event.preventDefault();
    if (!correcting || correction.isPending) return;
    setCorrectionError(null);
    if (
      !correctionSupplier.trim() ||
      !correctionReason.trim() ||
      !correctionPin.trim()
    ) {
      setCorrectionError("Completá proveedor, motivo y PIN autorizador.");
      return;
    }
    const input = {
      purchaseId: correcting.id,
      expectedRevision: correcting.revision ?? 0,
      supplierName: correctionSupplier.trim(),
      invoiceNumber: correctionInvoice.trim() || null,
      notes: correctionNotes.trim() || null,
      reason: correctionReason.trim(),
      authorizerPin: correctionPin,
    };
    const fingerprint = JSON.stringify(input);
    if (correctionReceipt.current?.fingerprint !== fingerprint)
      correctionReceipt.current = { fingerprint, key: crypto.randomUUID() };
    correction.mutate({
      ...input,
      idempotencyKey: correctionReceipt.current.key,
    });
  };

  const costItem = costing?.items.find((item) => item.id === costItemId);
  useEffect(() => {
    setCostSource(null);
    if (!costItem) return;
    let cancelled = false;
    window.gastronomy
      .getFinanceProductCosts()
      .then((rows) => {
        if (!cancelled)
          setCostSource(
            rows.find((row) => row.productId === costItem.productId)?.source ??
              null,
          );
      })
      .catch(() => {
        /* Reference context is optional; purchase permission alone can correct. */
      });
    return () => {
      cancelled = true;
    };
  }, [costItem?.productId, costing?.id]);
  const costMutation = useApiMutation(
    (input: Parameters<typeof window.gastronomy.correctPurchaseItemCost>[0]) =>
      window.gastronomy.correctPurchaseItemCost(input),
    {
      onSuccess: async () => {
        try {
          setHistory(await window.gastronomy.listPurchases());
          setHistoryError(null);
        } catch (value) {
          setHistoryError(humanError(value));
        }
        setCosting(null);
        setCostPin("");
        costReceipt.current = null;
      },
      onError: async (value) => {
        setCostError(humanError(value));
        try {
          setHistory(await window.gastronomy.listPurchases());
        } catch {
          /* Keep fields and original error. */
        }
      },
    },
  );
  const chooseCostItem = (purchase: PurchaseDto, id: string) => {
    setCostItemId(id);
    const item = purchase.items.find((row) => row.id === id);
    setCostValue(
      item
        ? String((item.effectiveUnitCostMinor ?? item.unitCostMinor) / 100)
        : "",
    );
    setCostError(null);
  };
  const beginCostCorrection = (purchase: PurchaseDto) => {
    setCosting(purchase);
    chooseCostItem(purchase, purchase.items[0]?.id ?? "");
    setCostReason("");
    setCostPin("");
    setCostError(null);
    costReceipt.current = null;
  };
  const parsedCost = parseMoneyInput(costValue);
  let proposedLine: number | null = null,
    proposedTotal: number | null = null;
  if (
    costItem &&
    costing &&
    parsedCost != null &&
    Number.isSafeInteger(parsedCost) &&
    parsedCost >= 0 &&
    Number.isSafeInteger(costItem.effectiveQuantityMinor ?? costItem.quantityMinor) &&
    (costItem.effectiveQuantityMinor ?? costItem.quantityMinor) > 0
  ) {
    const quantity = costItem.effectiveQuantityMinor ?? costItem.quantityMinor;
    const line = (BigInt(quantity) * BigInt(parsedCost) + 500n) / 1000n;
    const sum =
      BigInt(costing.effectiveTotalMinor ?? costing.totalMinor) -
      BigInt(costItem.effectiveLineTotalMinor ?? costItem.lineTotalMinor) +
      line;
    if (
      line <= BigInt(Number.MAX_SAFE_INTEGER) &&
      sum <= BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      proposedLine = Number(line);
      proposedTotal = Number(sum);
    }
  }
  const submitCost = (event: FormEvent) => {
    event.preventDefault();
    if (!costing || !costItem || costMutation.isPending) return;
    setCostError(null);
    if (
      parsedCost == null ||
      proposedLine == null ||
      proposedTotal == null ||
      !costReason.trim() ||
      !costPin.trim()
    ) {
      setCostError("Completá un costo válido, motivo y PIN autorizador.");
      return;
    }
    if (
      parsedCost === (costItem.effectiveUnitCostMinor ?? costItem.unitCostMinor)
    ) {
      setCostError("El costo ya tiene ese valor.");
      return;
    }
    const input = {
      purchaseId: costing.id,
      purchaseItemId: costItem.id,
      expectedRevision: costing.revision ?? 0,
      unitCostMinor: parsedCost,
      reason: costReason.trim(),
      authorizerPin: costPin,
    };
    const fingerprint = JSON.stringify(input);
    if (costReceipt.current?.fingerprint !== fingerprint)
      costReceipt.current = { fingerprint, key: crypto.randomUUID() };
    costMutation.mutate({ ...input, idempotencyKey: costReceipt.current.key });
  };
  const newerPurchase =
    costItem &&
    costing &&
    history.some(
      (p) =>
        p.id !== costing.id &&
        p.createdAt > costing.createdAt &&
        p.items.some((i) => i.productId === costItem.productId),
    );
  const historyTotal = history.reduce(
    (s, p) => s + (p.effectiveTotalMinor ?? p.totalMinor),
    0,
  );

  const quantityItem = quantityCorrection?.items.find(
    (item) => item.id === quantityItemId,
  );
  const chooseQuantityItem = (purchase: PurchaseDto, id: string) => {
    const item = purchase.items.find((row) => row.id === id);
    setQuantityItemId(id);
    setQuantityValue(
      item
        ? String((item.effectiveQuantityMinor ?? item.quantityMinor) / 1000)
        : "",
    );
    setQuantityError(null);
  };
  const beginQuantityCorrection = (purchase: PurchaseDto) => {
    setQuantityCorrection(purchase);
    chooseQuantityItem(purchase, purchase.items[0]?.id ?? "");
    setQuantityReason("");
    setQuantityPin("");
    setQuantityError(null);
    quantityReceipt.current = null;
  };
  const parsedQuantity = parseStockInput(quantityValue);
  let proposedQuantityLine: number | null = null,
    proposedQuantityTotal: number | null = null;
  if (
    quantityItem &&
    quantityCorrection &&
    parsedQuantity != null &&
    Number.isSafeInteger(parsedQuantity) &&
    parsedQuantity > 0 &&
    Number.isSafeInteger(
      quantityItem.effectiveUnitCostMinor ?? quantityItem.unitCostMinor,
    )
  ) {
    const line =
      (BigInt(parsedQuantity) *
        BigInt(
          quantityItem.effectiveUnitCostMinor ?? quantityItem.unitCostMinor,
        ) +
        500n) /
      1000n;
    const sum =
      BigInt(quantityCorrection.effectiveTotalMinor ?? quantityCorrection.totalMinor) -
      BigInt(
        quantityItem.effectiveLineTotalMinor ?? quantityItem.lineTotalMinor,
      ) +
      line;
    if (
      line <= BigInt(Number.MAX_SAFE_INTEGER) &&
      sum >= 0n &&
      sum <= BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      proposedQuantityLine = Number(line);
      proposedQuantityTotal = Number(sum);
    }
  }
  const quantityMutation = useApiMutation(
    (input: Parameters<typeof window.gastronomy.correctPurchaseItemQuantity>[0]) =>
      window.gastronomy.correctPurchaseItemQuantity(input),
    {
      onSuccess: async (purchase) => {
        try {
          setHistory(await window.gastronomy.listPurchases());
          setHistoryError(null);
        } catch (value) {
          setHistory((current) =>
            current.map((item) => (item.id === purchase.id && (item.revision ?? 0) <= (purchase.revision ?? 0) ? purchase : item)),
          );
          setHistoryError(humanError(value));
        }
        setQuantityCorrection(null);
        setQuantityPin("");
        quantityReceipt.current = null;
      },
      onError: async (value) => {
        setQuantityError(humanError(value));
        try {
          setHistory(await window.gastronomy.listPurchases());
        } catch {
          /* Keep fields and the original error. */
        }
      },
    },
  );
  const submitQuantityCorrection = (event: FormEvent) => {
    event.preventDefault();
    if (!quantityCorrection || !quantityItem || quantityMutation.isPending) return;
    setQuantityError(null);
    if (
      parsedQuantity == null ||
      parsedQuantity <= 0 ||
      proposedQuantityLine == null ||
      proposedQuantityTotal == null ||
      !quantityReason.trim() ||
      !quantityPin.trim()
    ) {
      setQuantityError("Completá una cantidad positiva válida, motivo y PIN autorizador.");
      return;
    }
    if (
      parsedQuantity ===
      (quantityItem.effectiveQuantityMinor ?? quantityItem.quantityMinor)
    ) {
      setQuantityError("La cantidad ya tiene ese valor.");
      return;
    }
    const input = {
      purchaseId: quantityCorrection.id,
      purchaseItemId: quantityItem.id,
      expectedRevision: quantityCorrection.revision ?? 0,
      quantityMinor: parsedQuantity,
      reason: quantityReason.trim(),
      authorizerPin: quantityPin,
    };
    const fingerprint = JSON.stringify(input);
    if (quantityReceipt.current?.fingerprint !== fingerprint)
      quantityReceipt.current = { fingerprint, key: crypto.randomUUID() };
    quantityMutation.mutate({
      ...input,
      idempotencyKey: quantityReceipt.current.key,
    });
  };

  return (
    <div className="panel-enter mx-auto max-w-[1500px] space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-brand-700">
            Inventario
          </p>
          <h2 className="text-xl font-extrabold tracking-tight text-slate-900">
            Compras e ingresos
          </h2>
          <p className="text-xs text-slate-500 sm:text-sm">
            Registrá mercadería y actualizá existencias en stock.
          </p>
        </div>
        <Button
          onClick={() => setOpen(true)}
          className="gap-2 self-start sm:self-auto"
        >
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
          label="Costo histórico de compras"
          value={formatMoney(historyTotal)}
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
          <h3 className="text-sm font-bold text-slate-900">
            Historial de ingresos
          </h3>
          <p className="text-xs text-slate-600">
            Comprobantes y compras de mercadería registrados
          </p>
        </div>
        {loadingHistory ? (
          <p className="p-8 text-center text-sm font-medium text-slate-600">
            Cargando ingresos…
          </p>
        ) : historyError ? (
          <p
            role="alert"
            className="p-8 text-center text-sm font-semibold text-rose-600"
          >
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
            <p className="text-xs text-slate-600">
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
                    <span className="font-bold text-slate-900">
                      {p.supplierName}
                    </span>
                    {p.invoiceNumber ? (
                      <span className="rounded-md border border-slate-200 bg-slate-100/70 px-1.5 py-0.5 text-xs font-semibold text-slate-600">
                        {p.invoiceNumber}
                      </span>
                    ) : (
                      <span className="text-xs italic text-slate-600">
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
                    }).format(new Date(p.createdAt))}{" "}
                    · Registrado por{" "}
                    <span className="font-medium text-slate-700">
                      {p.createdByUserName}
                    </span>
                  </p>
                  {p.items && p.items.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                      {p.items.map((item, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600"
                        >
                          <span className="font-semibold text-slate-800">
                            {((item.effectiveQuantityMinor ?? item.quantityMinor) / 1000).toLocaleString(
                              "es-AR",
                              {
                                maximumFractionDigits: 3,
                              },
                            )}
                          </span>
                          {item.effectiveQuantityMinor !== undefined && (
                            <span className="font-normal">
                              (original: {(item.quantityMinor / 1000).toLocaleString(
                                "es-AR",
                                { maximumFractionDigits: 3 },
                              )})
                            </span>
                          )}
                          <span>{item.productName}</span>
                          {item.effectiveUnitCostMinor !== undefined && (
                            <span className="font-normal">
                              · Costo corregido:{" "}
                              {formatMoney(item.effectiveUnitCostMinor)}{" "}
                              (original: {formatMoney(item.unitCostMinor)})
                            </span>
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                  {p.notes ? (
                    <p className="text-xs italic text-slate-500">
                      Nota: {p.notes}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center justify-between sm:flex-col sm:items-end sm:justify-center">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-600 sm:hidden">
                    Total
                  </span>
                  <Badge tone="green">
                    {formatMoney(p.effectiveTotalMinor ?? p.totalMinor)}
                  </Badge>
                  {p.effectiveTotalMinor !== undefined && (
                    <span className="mt-1 text-xs text-slate-600">
                      Original: {formatMoney(p.totalMinor)}
                    </span>
                  )}
                  {canCorrectPurchases && (
                    <Button
                      type="button"
                      variant="secondary"
                      className="mt-2"
                      onClick={() => beginCorrection(p)}
                    >
                      Corregir datos
                    </Button>
                  )}
                  {canCorrectPurchases && (
                    <Button
                      type="button"
                      variant="secondary"
                      className="mt-2"
                      onClick={() => beginCostCorrection(p)}
                    >
                      Corregir costo
                    </Button>
                  )}
                  {canCorrectPurchases && (
                    <Button
                      type="button"
                      variant="secondary"
                      className="mt-2"
                      onClick={() => beginQuantityCorrection(p)}
                    >
                      Corregir cantidad
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal
        open={costing !== null}
        onClose={() => setCosting(null)}
        closeDisabled={costMutation.isPending}
        title="Corregir costo de compra"
        description="Los costos ya registrados en ventas se mantienen."
        width="max-w-xl"
      >
        <form
          className="grid gap-4"
          onSubmit={submitCost}
          aria-busy={costMutation.isPending}
        >
          {costing && (
            <p className="text-sm text-slate-700">
              {costing.supplierName} · Ingreso original:{" "}
              {new Intl.DateTimeFormat("es-AR").format(
                new Date(costing.createdAt),
              )}{" "}
              · Registrado por {costing.createdByUserName}
            </p>
          )}
          <Field label="Producto de la compra">
            <Select
              value={costItemId}
              disabled={costMutation.isPending}
              onChange={(e) =>
                costing && chooseCostItem(costing, e.target.value)
              }
            >
              {costing?.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.productName}
                </option>
              ))}
            </Select>
          </Field>
          {costItem && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              <p>
                Cantidad registrada:{" "}
                {((costItem.effectiveQuantityMinor ?? costItem.quantityMinor) / 1000).toLocaleString("es-AR", {
                  maximumFractionDigits: 3,
                })}
                {costItem.effectiveQuantityMinor !== undefined && (
                  <> (original: {(costItem.quantityMinor / 1000).toLocaleString("es-AR", { maximumFractionDigits: 3 })})</>
                )}
              </p>
              <p>Costo original: {formatMoney(costItem.unitCostMinor)}</p>
              <p>
                Costo vigente de esta línea:{" "}
                {formatMoney(
                  costItem.effectiveUnitCostMinor ?? costItem.unitCostMinor,
                )}
              </p>
              <p className="mt-1">Las cantidades y el stock no se modifican.</p>
            </div>
          )}
          <Field label="Costo unitario correcto">
            <Input
              inputMode="decimal"
              disabled={costMutation.isPending}
              value={costValue}
              onChange={(e) => setCostValue(e.target.value)}
            />
          </Field>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            <p>
              Importe de la línea:{" "}
              {proposedLine == null ? "—" : formatMoney(proposedLine)}
            </p>
            <p className="font-semibold">
              Importe corregido del ingreso:{" "}
              {proposedTotal == null ? "—" : formatMoney(proposedTotal)}
            </p>
          </div>
          <p className="text-sm text-slate-600">
            {costSource === "MANUAL"
              ? "El producto tiene un costo manual; no se cambiará."
              : newerPurchase
                ? "Hay una compra más nueva: el costo vigente del producto se conserva."
                : "El costo vigente respeta las compras más recientes y cualquier costo manual."}
          </p>
          <Field label="Motivo">
            <Input
              maxLength={500}
              disabled={costMutation.isPending}
              value={costReason}
              onChange={(e) => setCostReason(e.target.value)}
            />
          </Field>
          <Field
            label="PIN autorizador"
            hint="Código de usuario autorizado para gestionar compras."
          >
            <Input
              aria-label="PIN autorizador"
              type="password"
              inputMode="numeric"
              maxLength={8}
              disabled={costMutation.isPending}
              value={costPin}
              onChange={(e) => setCostPin(e.target.value.replace(/\D/g, ""))}
            />
          </Field>
          {costError && (
            <p role="alert" className="text-sm font-semibold text-rose-700">
              {costError}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3">
            <Button
              type="button"
              variant="secondary"
              disabled={costMutation.isPending}
              onClick={() => setCosting(null)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={costMutation.isPending}>
              {costMutation.isPending ? "Guardando…" : "Guardar costo"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={quantityCorrection !== null}
        onClose={() => setQuantityCorrection(null)}
        closeDisabled={quantityMutation.isPending}
        title="Corregir cantidad de compra"
        description="Corrige la compra registrada. Las existencias actuales no se modifican."
        width="max-w-xl"
      >
        <form
          className="grid gap-4"
          onSubmit={submitQuantityCorrection}
          aria-busy={quantityMutation.isPending}
        >
          {quantityCorrection && (
            <p className="text-sm text-slate-700">
              {quantityCorrection.supplierName} · Ingreso original:{" "}
              {new Intl.DateTimeFormat("es-AR").format(
                new Date(quantityCorrection.createdAt),
              )}{" "}
              · Registrado por {quantityCorrection.createdByUserName}
            </p>
          )}
          <Field label="Producto de la compra">
            <Select
              aria-label="Producto de la compra"
              value={quantityItemId}
              disabled={quantityMutation.isPending}
              onChange={(event) =>
                quantityCorrection &&
                chooseQuantityItem(quantityCorrection, event.target.value)
              }
            >
              {quantityCorrection?.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.productName}
                </option>
              ))}
            </Select>
          </Field>
          {quantityItem && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              <p>
                Cantidad original: {(quantityItem.quantityMinor / 1000).toLocaleString("es-AR", {
                  maximumFractionDigits: 3,
                })}
              </p>
              <p className="font-semibold">
                Cantidad efectiva actual: {(
                  (quantityItem.effectiveQuantityMinor ?? quantityItem.quantityMinor) /
                  1000
                ).toLocaleString("es-AR", { maximumFractionDigits: 3 })}
              </p>
              <p>Costo unitario efectivo: {formatMoney(quantityItem.effectiveUnitCostMinor ?? quantityItem.unitCostMinor)}</p>
            </div>
          )}
          <Field label="Cantidad correcta">
            <Input
              inputMode="decimal"
              disabled={quantityMutation.isPending}
              value={quantityValue}
              onChange={(event) => setQuantityValue(event.target.value)}
            />
          </Field>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            <p>
              Importe efectivo de la línea: {" "}
              {proposedQuantityLine == null ? "—" : formatMoney(proposedQuantityLine)}
            </p>
            <p className="font-semibold">
              Importe efectivo del ingreso: {" "}
              {proposedQuantityTotal == null ? "—" : formatMoney(proposedQuantityTotal)}
            </p>
            <p className="mt-1">
              Corrige la compra registrada. Las existencias actuales no se modifican.
            </p>
          </div>
          <Field label="Motivo">
            <Input
              maxLength={500}
              disabled={quantityMutation.isPending}
              value={quantityReason}
              onChange={(event) => setQuantityReason(event.target.value)}
            />
          </Field>
          <Field
            label="PIN autorizador"
            hint="Código de usuario autorizado para gestionar compras."
          >
            <Input
              aria-label="PIN autorizador"
              type="password"
              inputMode="numeric"
              maxLength={8}
              disabled={quantityMutation.isPending}
              value={quantityPin}
              onChange={(event) => setQuantityPin(event.target.value.replace(/\D/g, ""))}
            />
          </Field>
          {quantityError && (
            <p role="alert" className="text-sm font-semibold text-rose-700">
              {quantityError}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3">
            <Button
              type="button"
              variant="secondary"
              disabled={quantityMutation.isPending}
              onClick={() => setQuantityCorrection(null)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={quantityMutation.isPending}>
              {quantityMutation.isPending ? "Guardando…" : "Guardar cantidad"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={correcting !== null}
        onClose={() => setCorrecting(null)}
        closeDisabled={correction.isPending}
        title="Corregir datos de compra"
        description="No cambia cantidades, costos ni stock."
        width="max-w-xl"
      >
        <form
          className="grid gap-4"
          onSubmit={submitCorrection}
          aria-busy={correction.isPending}
        >
          {correcting && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              <p>
                Ingreso original:{" "}
                {new Intl.DateTimeFormat("es-AR").format(
                  new Date(correcting.createdAt),
                )}{" "}
                · Registrado por {correcting.createdByUserName}
              </p>
              <p className="mt-1 font-semibold">
                Total: {formatMoney(correcting.totalMinor)}
              </p>
              {correcting.items.map((item) => (
                <p key={item.id}>
                  {(item.quantityMinor / 1000).toLocaleString("es-AR", {
                    maximumFractionDigits: 3,
                  })}{" "}
                  × {item.productName} · {formatMoney(item.unitCostMinor)} por
                  unidad
                </p>
              ))}
            </div>
          )}
          <Field label="Proveedor">
            <Input
              disabled={correction.isPending}
              maxLength={160}
              value={correctionSupplier}
              onChange={(e) => setCorrectionSupplier(e.target.value)}
            />
          </Field>
          <Field label="Comprobante">
            <Input
              disabled={correction.isPending}
              maxLength={160}
              value={correctionInvoice}
              onChange={(e) => setCorrectionInvoice(e.target.value)}
            />
          </Field>
          <Field label="Notas">
            <Input
              disabled={correction.isPending}
              maxLength={1000}
              value={correctionNotes}
              onChange={(e) => setCorrectionNotes(e.target.value)}
            />
          </Field>
          <Field label="Motivo">
            <Input
              disabled={correction.isPending}
              maxLength={500}
              value={correctionReason}
              onChange={(e) => setCorrectionReason(e.target.value)}
            />
          </Field>
          <Field
            label="PIN autorizador"
            hint="Código de usuario autorizado para gestionar compras."
          >
            <Input
              type="password"
              inputMode="numeric"
              maxLength={8}
              disabled={correction.isPending}
              aria-label="PIN autorizador"
              value={correctionPin}
              onChange={(e) =>
                setCorrectionPin(e.target.value.replace(/\D/g, ""))
              }
            />
          </Field>
          {correctionError && (
            <p role="alert" className="text-sm font-semibold text-rose-700">
              {correctionError}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-3">
            <Button
              type="button"
              variant="secondary"
              disabled={correction.isPending}
              onClick={() => setCorrecting(null)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={correction.isPending}>
              {correction.isPending ? "Guardando…" : "Guardar cambios"}
            </Button>
          </div>
        </form>
      </Modal>

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
              <p className="text-xs text-slate-600">
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
      <p className="mt-3 text-xs font-bold uppercase tracking-wider text-slate-600">
        {label}
      </p>
      <p className="mt-0.5 text-2xl font-extrabold tracking-tight text-slate-900">
        {value}
      </p>
    </Card>
  );
}
