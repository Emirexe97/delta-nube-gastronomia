import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  ProductDto,
  PriceBookDto,
  PriceBookRoundingIncrementMinor,
  PriceBooksDto,
  PriceChannel,
} from "@gastronomy/contracts";
import { Button, Field, Input, Select } from "@gastronomy/ui";
import { humanError, parsePriceInput } from "../lib";
import { PriceBookProductsEditor } from "./price-book-products-editor";

const channels: Array<[PriceChannel, string]> = [
  ["SALON", "Salón"],
  ["TAKEAWAY", "Retiro"],
  ["DELIVERY", "Delivery"],
];
const adjustmentBpsFromInput = (input: string): number | null => {
  const match = /^([+-]?)(\d+)(?:[.,](\d{1,2}))?$/.exec(input.trim());
  if (!match) return null;
  const [, sign, whole, fraction = ""] = match;
  const scaled = `${sign}${whole}${fraction.padEnd(2, "0")}`;
  const value = Number(scaled);
  return Number.isSafeInteger(value) ? value : null;
};
const percentErrorFor = (input: string): string | null => {
  if (!input.trim()) return "Ingresá un porcentaje.";
  const value = adjustmentBpsFromInput(input);
  if (value == null)
    return "Ingresá un porcentaje con hasta dos decimales, sin separadores de miles.";
  if (value < -10_000 || value > 100_000)
    return "El porcentaje debe estar entre -100% y 1000%.";
  return null;
};

export function PriceBooksPanel({
  permissions,
  products,
  onUpdated,
  onDraftStateChange,
}: {
  permissions: string[];
  products: ProductDto[];
  onUpdated?(books: PriceBooksDto): void;
  onDraftStateChange?(state: "dirty" | "saving" | null): void;
}) {
  const canEdit =
    permissions.includes("prices.bulk_update") || permissions.includes("*");
  const queryClient = useQueryClient();
  const [data, setData] = useState<PriceBooksDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [percent, setPercent] = useState("0");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [viewOnly, setViewOnly] = useState(false);
  const [assignments, setAssignments] = useState<Record<PriceChannel, string>>({
    SALON: "",
    TAKEAWAY: "",
    DELIVERY: "",
  });
  const [bookReason, setBookReason] = useState("");
  const [bookPin, setBookPin] = useState("");
  const [assignmentReason, setAssignmentReason] = useState("");
  const [assignmentPin, setAssignmentPin] = useState("");
  const [success, setSuccess] = useState<string | null>(null);
  const [percentError, setPercentError] = useState<string | null>(null);
  const [roundingIncrementMinor, setRoundingIncrementMinor] =
    useState<PriceBookRoundingIncrementMinor>(1);
  const [productOverrides, setProductOverrides] = useState<
    Record<string, string | null>
  >({});

  const load = async () => {
    setLoading(true);
    try {
      const result = await window.gastronomy.getPriceBooks();
      setData(result);
      setAssignments(result.assignments);
      onUpdated?.(result);
      setError(null);
    } catch (value) {
      setError(humanError(value));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const beginEdit = (book: PriceBookDto, editable = true) => {
    if (editorOpen) return;
    if (hasAssignmentChanges) {
      setError(
        "Guardá o descartá primero los cambios de asignación para no perderlos.",
      );
      return;
    }
    setEditingId(book.id);
    setEditorOpen(true);
    setViewOnly(!editable);
    setName(book.name);
    setPercent(String(book.adjustmentBps / 100));
    setRoundingIncrementMinor(book.roundingIncrementMinor ?? 1);
    setProductOverrides({});
    setBookReason("");
    setBookPin("");
    setSuccess(null);
    setError(null);
  };
  const beginNew = () => {
    if (editorOpen || hasAssignmentChanges) return;
    setEditingId(null);
    setEditorOpen(true);
    setViewOnly(false);
    setName("");
    setPercent("0");
    setPercentError(null);
    setRoundingIncrementMinor(1);
    setProductOverrides({});
    setBookReason("");
    setBookPin("");
    setSuccess(null);
    setError(null);
  };
  const reset = () => {
    setEditingId(null);
    setEditorOpen(false);
    setViewOnly(false);
    setName("");
    setPercent("0");
    setPercentError(null);
    setProductOverrides({});
    setRoundingIncrementMinor(1);
    setBookReason("");
    setBookPin("");
    setError(null);
    setSuccess(null);
  };
  const submitBook = async () => {
    const validationError = percentErrorFor(percent);
    const parsedBps = adjustmentBpsFromInput(percent);
    if (validationError || parsedBps == null) {
      setPercentError(validationError ?? "Ingresá un porcentaje válido.");
      return;
    }
    if (hasAssignmentChanges) {
      setError(
        "Guardá o descartá primero los cambios de asignación para no perderlos.",
      );
      return;
    }
    if (
      !name.trim() ||
      !bookReason.trim() ||
      bookPin.length < 4 ||
      busy ||
      invalidOverrides
    )
      return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    setPercentError(null);
    try {
      const result = await window.gastronomy.savePriceBook({
        id: editingId ?? undefined,
        name: name.trim(),
        adjustmentBps: parsedBps,
        roundingIncrementMinor,
        productOverrides: parsedPatch,
        reason: bookReason.trim(),
        authorizerPin: bookPin,
      });
      setData(result);
      setAssignments(result.assignments);
      setBookReason("");
      setBookPin("");
      reset();
      onUpdated?.(result);
      await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
      setSuccess("Lista de precios guardada.");
    } catch (value) {
      setError(humanError(value));
    } finally {
      setBusy(false);
    }
  };
  const saveAssignments = async () => {
    if (
      busy ||
      !hasAssignmentChanges ||
      !assignmentReason.trim() ||
      assignmentPin.length < 4
    )
      return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await window.gastronomy.assignPriceBooks({
        assignments,
        reason: assignmentReason.trim(),
        authorizerPin: assignmentPin,
      });
      setData(result);
      setAssignments(result.assignments);
      setAssignmentReason("");
      setAssignmentPin("");
      onUpdated?.(result);
      await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
      setSuccess("Asignaciones de listas guardadas.");
    } catch (value) {
      setError(humanError(value));
    } finally {
      setBusy(false);
    }
  };
  const hasAssignmentChanges = Boolean(
    data &&
    channels.some(
      ([channel]) => assignments[channel] !== data.assignments[channel],
    ),
  );
  const editingBook = data?.books.find((book) => book.id === editingId);
  const effectiveBook: PriceBookDto = editingBook ?? {
    id: "__new__",
    name,
    adjustmentBps: adjustmentBpsFromInput(percent) ?? 0,
    isBase: false,
    roundingIncrementMinor,
  };
  const parsedPatch: Record<string, number | null> = {};
  let invalidOverrides = false;
  for (const [id, raw] of Object.entries(productOverrides)) {
    if (raw === null) parsedPatch[id] = null;
    else {
      const parsed = parsePriceInput(raw);
      if (parsed === null) invalidOverrides = true;
      else parsedPatch[id] = parsed;
    }
  }
  const validatedBps = adjustmentBpsFromInput(percent);
  const dirty =
    hasAssignmentChanges ||
    (editorOpen &&
      !viewOnly &&
      (name !== (editingBook?.name ?? "") ||
        validatedBps !== (editingBook?.adjustmentBps ?? 0) ||
        roundingIncrementMinor !== (editingBook?.roundingIncrementMinor ?? 1) ||
        Object.keys(productOverrides).length > 0 ||
        Boolean(bookReason || bookPin)));
  useEffect(() => {
    onDraftStateChange?.(busy ? "saving" : dirty ? "dirty" : null);
    return () => onDraftStateChange?.(null);
  }, [busy, dirty, onDraftStateChange]);

  if (loading)
    return (
      <div
        role="status"
        className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600"
      >
        Cargando listas de precios…
      </div>
    );
  if (!data)
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
        <p role="alert">
          No se pudieron cargar las listas de precios:{" "}
          {error ?? "Error desconocido"}
        </p>
        <Button
          className="mt-3"
          variant="secondary"
          onClick={() => void load()}
        >
          Reintentar
        </Button>
      </div>
    );

  return (
    <div className="grid gap-4" data-navigation-dirty={dirty || undefined}>
      {editorOpen ? (
        <section
          className="grid gap-5 rounded-xl border border-slate-200 bg-white p-5"
          aria-label="Editor de lista de precios"
        >
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                {editingId
                  ? `Lista: ${editingBook?.name ?? name}`
                  : "Nueva lista derivada"}
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                {viewOnly
                  ? "Consultá el importe que usa esta lista para cada producto."
                  : "Definí la regla general y revisá los precios antes de guardar."}
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                if (
                  !dirty ||
                  window.confirm("¿Descartar los cambios de esta lista?")
                )
                  reset();
              }}
            >
              Volver al resumen
            </Button>
          </div>
          {!viewOnly ? (
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Nombre">
                <Input
                  maxLength={80}
                  disabled={!canEdit || viewOnly || busy}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Por ejemplo, Delivery premium"
                />
              </Field>
              <Field
                label="Porcentaje sobre Principal"
                hint="Admite hasta dos decimales; podés usar negativo para descuento."
              >
                <Input
                  disabled={!canEdit || viewOnly || busy}
                  inputMode="decimal"
                  value={percent}
                  onChange={(event) => {
                    setPercent(event.target.value);
                    setPercentError(percentErrorFor(event.target.value));
                  }}
                  aria-invalid={Boolean(percentError)}
                />
              </Field>
              <Field
                label="Redondeo de precios calculados"
                hint="Al valor más cercano; los empates suben."
              >
                <Select
                  disabled={!canEdit || viewOnly || busy}
                  aria-label="Redondeo de precios calculados"
                  value={roundingIncrementMinor}
                  onChange={(event) =>
                    setRoundingIncrementMinor(
                      Number(
                        event.target.value,
                      ) as PriceBookRoundingIncrementMinor,
                    )
                  }
                >
                  <option value={1}>Sin redondeo</option>
                  <option value={1000}>A las decenas</option>
                  <option value={10000}>A las centenas</option>
                  <option value={100000}>A las unidades de mil</option>
                </Select>
              </Field>
            </div>
          ) : !effectiveBook.isBase ? (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
              Variación sobre Principal:{" "}
              <strong>
                {(effectiveBook.adjustmentBps / 100).toLocaleString("es-AR")} %
              </strong>
              {" · "}
              {roundingIncrementMinor === 1
                ? "Sin redondeo adicional"
                : `Redondeo a $${(roundingIncrementMinor / 100).toLocaleString("es-AR")}`}
            </p>
          ) : null}
          {percentError ? (
            <p
              role="alert"
              className="rounded-md bg-rose-50 p-2 text-sm text-rose-800"
            >
              {percentError}
            </p>
          ) : null}
          <PriceBookProductsEditor
            products={products}
            book={effectiveBook}
            adjustmentBps={
              validatedBps != null && percentErrorFor(percent) == null
                ? validatedBps
                : null
            }
            roundingIncrementMinor={roundingIncrementMinor}
            overrides={productOverrides}
            onOverridesChange={setProductOverrides}
            editable={canEdit && !viewOnly && !busy}
          />
          {canEdit && !viewOnly ? (
            <div className="grid gap-3 border-t border-slate-100 pt-4 md:grid-cols-2">
              <Field label="Motivo de la lista">
                <Input
                  disabled={busy}
                  value={bookReason}
                  onChange={(event) => setBookReason(event.target.value)}
                  placeholder="Actualización de lista"
                />
              </Field>
              <Field label="PIN para guardar la lista">
                <Input
                  disabled={busy}
                  type="password"
                  inputMode="numeric"
                  value={bookPin}
                  onChange={(event) =>
                    setBookPin(event.target.value.replace(/\D/g, ""))
                  }
                />
              </Field>
              <div className="flex gap-2 md:col-span-2">
                <Button
                  disabled={
                    busy ||
                    !name.trim() ||
                    !bookReason.trim() ||
                    bookPin.length < 4 ||
                    percentErrorFor(percent) != null ||
                    invalidOverrides
                  }
                  onClick={() => void submitBook()}
                >
                  {busy ? "Guardando…" : "Guardar lista"}
                </Button>
                <Button variant="secondary" disabled={busy} onClick={reset}>
                  Descartar cambios
                </Button>
              </div>
            </div>
          ) : null}
        </section>
      ) : (
        <>
          <section
            className="rounded-xl border border-slate-200 bg-white p-4"
            aria-label="Listas disponibles"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-bold text-slate-900">Listas de precios</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Principal es la referencia. Las derivadas aplican un
                  porcentaje y admiten importes propios.
                </p>
              </div>
              {canEdit ? (
                <Button
                  disabled={busy || hasAssignmentChanges}
                  onClick={beginNew}
                >
                  Nueva lista
                </Button>
              ) : null}
            </div>
            <ul className="mt-4 divide-y divide-slate-100">
              {data.books.map((book) => (
                <li
                  key={book.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div>
                    <strong>{book.name}</strong>
                    {book.isBase ? (
                      <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-600">
                        Principal
                      </span>
                    ) : (
                      <span className="ml-2 text-xs text-slate-600">
                        {book.adjustmentBps >= 0 ? "+" : ""}
                        {(book.adjustmentBps / 100).toLocaleString("es-AR", {
                          maximumFractionDigits: 2,
                        })}
                        %
                        {book.roundingIncrementMinor &&
                        book.roundingIncrementMinor > 1
                          ? ` · ${book.roundingIncrementMinor === 1000 ? "decenas" : book.roundingIncrementMinor === 10000 ? "centenas" : "unidades de mil"}`
                          : ""}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      className="h-8 px-3 text-xs"
                      disabled={busy || hasAssignmentChanges}
                      onClick={() => beginEdit(book, false)}
                    >
                      Ver precios
                    </Button>
                    {canEdit && !book.isBase ? (
                      <Button
                        type="button"
                        variant="secondary"
                        className="h-8 px-3 text-xs"
                        disabled={busy || hasAssignmentChanges}
                        onClick={() => beginEdit(book, true)}
                      >
                        Editar
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
          <section
            className="rounded-xl border border-slate-200 bg-white p-4"
            aria-label="Listas por canal"
          >
            <h2 className="font-bold text-slate-900">Lista por canal</h2>
            <p className="mt-1 text-sm text-slate-600">
              Cada canal puede usar la misma lista o una diferente.
            </p>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              {channels.map(([channel, label]) => (
                <Field key={channel} label={label}>
                  <Select
                    aria-label={label}
                    disabled={!canEdit || busy}
                    value={assignments[channel]}
                    onChange={(event) =>
                      setAssignments((current) => ({
                        ...current,
                        [channel]: event.target.value,
                      }))
                    }
                  >
                    {data.books.map((book) => (
                      <option key={book.id} value={book.id}>
                        {book.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              ))}
            </div>
            {hasAssignmentChanges && canEdit ? (
              <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 md:grid-cols-2">
                <Field label="Motivo de asignación">
                  <Input
                    disabled={busy}
                    value={assignmentReason}
                    onChange={(event) =>
                      setAssignmentReason(event.target.value)
                    }
                    placeholder="Actualización de canales"
                  />
                </Field>
                <Field label="PIN para guardar la asignación">
                  <Input
                    disabled={busy}
                    type="password"
                    inputMode="numeric"
                    value={assignmentPin}
                    onChange={(event) =>
                      setAssignmentPin(event.target.value.replace(/\D/g, ""))
                    }
                  />
                </Field>
                <div className="flex gap-2 md:col-span-2">
                  <Button
                    disabled={
                      busy ||
                      !assignmentReason.trim() ||
                      assignmentPin.length < 4
                    }
                    onClick={() => void saveAssignments()}
                  >
                    {busy ? "Guardando…" : "Guardar asignación"}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      setAssignments(data.assignments);
                      setAssignmentReason("");
                      setAssignmentPin("");
                    }}
                  >
                    Descartar cambios
                  </Button>
                </div>
              </div>
            ) : null}
          </section>
        </>
      )}
      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700 lg:col-span-2"
        >
          {error}
        </p>
      ) : null}
      {success ? (
        <p
          role="status"
          aria-live="polite"
          className="rounded-lg bg-emerald-50 p-3 text-sm font-medium text-emerald-800 lg:col-span-2"
        >
          {success}
        </p>
      ) : null}
    </div>
  );
}
