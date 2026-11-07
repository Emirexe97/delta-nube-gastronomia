import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  PriceBookDto,
  PriceBooksDto,
  PriceChannel,
} from "@gastronomy/contracts";
import { Button, Field, Input, Select } from "@gastronomy/ui";
import { humanError } from "../lib";

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
  onUpdated,
}: {
  permissions: string[];
  onUpdated?(books: PriceBooksDto): void;
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

  const beginEdit = (book: PriceBookDto) => {
    setEditingId(book.id);
    setName(book.name);
    setPercent(String(book.adjustmentBps / 100));
  };
  const reset = () => {
    setEditingId(null);
    setName("");
    setPercent("0");
    setPercentError(null);
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
    if (!name.trim() || !bookReason.trim() || bookPin.length < 4 || busy)
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
    <div className="grid gap-4 lg:grid-cols-2">
      <section
        className="rounded-xl border border-slate-200 bg-white p-4"
        aria-label="Listas disponibles"
      >
        <h3 className="font-bold text-slate-900">Listas y precios derivados</h3>
        <p className="mt-1 text-xs text-slate-600">
          Principal es la referencia. Las listas derivadas calculan su precio
          aplicando un porcentaje; los precios propios se administran en cada
          producto.
        </p>
        <ul className="mt-3 divide-y divide-slate-100">
          {data.books.map((book) => (
            <li
              key={book.id}
              className="flex items-center justify-between gap-3 py-2"
            >
              <span>
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
                  </span>
                )}
              </span>
              {canEdit && !book.isBase ? (
                <Button
                  variant="secondary"
                  className="h-8 px-3 text-xs"
                  onClick={() => beginEdit(book)}
                >
                  Editar
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        {canEdit ? (
          <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4">
            <h4 className="text-sm font-bold">
              {editingId ? "Editar lista" : "Nueva lista derivada"}
            </h4>
            <Field label="Nombre">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Por ejemplo, Delivery premium"
              />
            </Field>
            <Field
              label="Porcentaje sobre Principal"
              hint="Usá un valor negativo para aplicar descuento. Admite hasta dos decimales; no uses separadores de miles."
            >
              <Input
                className="min-w-0 w-full"
                inputMode="decimal"
                value={percent}
                onChange={(e) => {
                  const next = e.target.value;
                  setPercent(next);
                  setPercentError(percentErrorFor(next));
                }}
                aria-invalid={Boolean(percentError)}
              />
            </Field>
            {percentError ? (
              <p role="alert" className="text-xs text-rose-700">
                {percentError}
              </p>
            ) : null}
            <Field label="Motivo de la lista">
              <Input
                value={bookReason}
                onChange={(e) => setBookReason(e.target.value)}
                placeholder="Actualización de lista"
              />
            </Field>
            <Field label="PIN para guardar la lista">
              <Input
                type="password"
                inputMode="numeric"
                value={bookPin}
                onChange={(e) => setBookPin(e.target.value.replace(/\D/g, ""))}
              />
            </Field>
            <div className="flex gap-2">
              <Button
                disabled={
                  busy ||
                  !name.trim() ||
                  !bookReason.trim() ||
                  bookPin.length < 4 ||
                  percentErrorFor(percent) != null
                }
                onClick={() => void submitBook()}
              >
                {busy ? "Guardando…" : "Guardar lista"}
              </Button>
              {editingId ? (
                <Button variant="secondary" onClick={reset}>
                  Cancelar
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>
      <section
        className="rounded-xl border border-slate-200 bg-white p-4"
        aria-label="Listas por canal"
      >
        <h3 className="font-bold text-slate-900">Lista por canal</h3>
        <p className="mt-1 text-xs text-slate-600">
          Cada canal puede usar la misma lista o una diferente.
        </p>
        <div className="mt-3 grid gap-3">
          {channels.map(([channel, label]) => (
            <Field key={channel} label={label}>
              <Select
                aria-label={label}
                disabled={!canEdit}
                value={assignments[channel]}
                onChange={(e) =>
                  setAssignments((current) => ({
                    ...current,
                    [channel]: e.target.value,
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
        {canEdit ? (
          <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4">
            <Field label="Motivo de asignación">
              <Input
                value={assignmentReason}
                onChange={(e) => setAssignmentReason(e.target.value)}
                placeholder="Actualización de canales"
              />
            </Field>
            <Field label="PIN para guardar la asignación">
              <Input
                type="password"
                inputMode="numeric"
                value={assignmentPin}
                onChange={(e) =>
                  setAssignmentPin(e.target.value.replace(/\D/g, ""))
                }
              />
            </Field>
            <Button
              disabled={
                busy ||
                !hasAssignmentChanges ||
                !assignmentReason.trim() ||
                assignmentPin.length < 4
              }
              onClick={() => void saveAssignments()}
            >
              {busy
                ? "Guardando…"
                : hasAssignmentChanges
                  ? "Guardar asignación"
                  : "Sin cambios para guardar"}
            </Button>
          </div>
        ) : null}
      </section>
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
