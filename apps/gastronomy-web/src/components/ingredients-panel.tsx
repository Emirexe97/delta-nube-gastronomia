import { useEffect, useState } from "react";
import type {
  IngredientDto,
  IngredientUnit,
  SaveIngredientInput,
} from "@gastronomy/contracts";
import { calculateIngredientRecipeCost } from "@gastronomy/domain";
import { Button, Card, Field, Input, Modal, Select } from "@gastronomy/ui";
import { MagnifyingGlass, PencilSimple } from "@phosphor-icons/react";
import { useApiMutation } from "../api";
import {
  formatMoney,
  humanError,
  moneyInputValue,
  parseMoneyInput,
} from "../lib";
import {
  formatIngredientQuantity,
  ingredientQuantityInput,
  parseIngredientQuantity,
} from "../ingredient-quantities";

function equivalentCost(ingredient: IngredientDto) {
  try {
    return formatMoney(
      calculateIngredientRecipeCost(
        [{ ingredientId: ingredient.id, quantityMicros: 1_000_000 }],
        [ingredient],
      ),
    );
  } catch {
    return "Fuera de rango";
  }
}

export function IngredientsPanel({
  canManage,
  createOpen,
  onCloseCreate,
  onSaved,
}: {
  canManage: boolean;
  createOpen: boolean;
  onCloseCreate(): void;
  onSaved(): void;
}) {
  const [ingredients, setIngredients] = useState<IngredientDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<IngredientDto | null>(null);
  const [name, setName] = useState("");
  const [presentation, setPresentation] = useState("");
  const [baseUnit, setBaseUnit] = useState<IngredientUnit>("KG");
  const [quantity, setQuantity] = useState("");
  const [cost, setCost] = useState("");
  const [error, setError] = useState<string | null>(null);
  const open = createOpen || Boolean(editing);
  const close = () => {
    setEditing(null);
    onCloseCreate();
  };
  useEffect(() => {
    let current = true;
    setLoading(true);
    setLoadError(null);
    window.gastronomy
      .listIngredients()
      .then((items) => {
        if (current) setIngredients(items);
      })
      .catch((value) => {
        if (current) setLoadError(humanError(value));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [reload]);
  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? "");
    setPresentation(editing?.presentation ?? "");
    setBaseUnit(editing?.baseUnit ?? "KG");
    setQuantity(
      editing
        ? ingredientQuantityInput(
            editing.presentationQuantityMicros,
            editing.baseUnit,
          )
        : "",
    );
    setCost(editing ? moneyInputValue(editing.presentationCostMinor) : "");
    setError(null);
  }, [open, editing?.id]);
  const mutation = useApiMutation(
    (input: SaveIngredientInput) => window.gastronomy.saveIngredient(input),
    {
      onSuccess: (saved) => {
      setReload((value) => value + 1);
      setQuery("");
        setIngredients((current) =>
          [...current.filter((item) => item.id !== saved.id), saved].sort(
            (a, b) => a.name.localeCompare(b.name, "es"),
          ),
        );
        close();
        onSaved();
      },
      onError: (value) => setError(humanError(value)),
    },
  );
  const quantityMicros = parseIngredientQuantity(quantity, baseUnit);
  const costMinor = parseMoneyInput(cost);
  const valid = Boolean(
    name.trim() &&
    presentation.trim() &&
    quantityMicros != null &&
    costMinor != null,
  );
  const term = query.trim().toLocaleLowerCase();
  const filtered = ingredients.filter((item) =>
    `${item.name} ${item.presentation}`.toLocaleLowerCase().includes(term),
  );
  const unitLabel =
    baseUnit === "KG" ? "kg" : baseUnit === "L" ? "l" : "unidades";
  return (
    <>
      <Card className="overflow-hidden">
        <div className="space-y-3 border-b border-slate-100 p-3">
          <p className="text-xs text-slate-600">
            Cargá la presentación que comprás, su contenido y su costo. Las
            recetas toman el costo proporcional a la cantidad utilizada.
          </p>
          <div className="relative max-w-md">
            <MagnifyingGlass
              size={16}
              className="absolute left-3 top-3 text-slate-400"
            />
            <Input
              aria-label="Buscar ingredientes"
              className="pl-9"
              placeholder="Buscar ingrediente o presentación"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>
        {loading ? (
          <p className="p-6 text-sm text-slate-500">Cargando ingredientes…</p>
        ) : loadError ? (
          <div className="space-y-2 p-4">
            <p role="alert" className="text-sm text-rose-700">
              {loadError}
            </p>
            <Button
              variant="secondary"
              onClick={() => setReload((value) => value + 1)}
            >
              Reintentar
            </Button>
          </div>
        ) : filtered.length ? (
          <div className="overflow-auto">
            <table className="dn-table min-w-[750px]">
              <thead>
                <tr>
                  <th>Ingrediente</th>
                  <th>Presentación</th>
                  <th>Contenido</th>
                  <th className="text-right">Costo de presentación</th>
                  <th className="text-right">Costo equivalente</th>
                  <th className="text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((ingredient) => (
                  <tr key={ingredient.id}>
                    <td className="font-bold text-slate-900">
                      {ingredient.name}
                    </td>
                    <td>{ingredient.presentation}</td>
                    <td>
                      {formatIngredientQuantity(
                        ingredient.presentationQuantityMicros,
                        ingredient.baseUnit,
                      )}
                    </td>
                    <td className="text-right font-semibold">
                      {formatMoney(ingredient.presentationCostMinor)}
                    </td>
                    <td className="text-right text-xs text-slate-600">
                      {equivalentCost(ingredient)} /{" "}
                      {ingredient.baseUnit === "KG"
                        ? "kg"
                        : ingredient.baseUnit === "L"
                          ? "l"
                          : "u."}
                    </td>
                    <td className="text-right">
                      {canManage && (
                        <Button
                          variant="secondary"
                          className="h-8 px-2 text-xs"
                          aria-label={`Editar ingrediente ${ingredient.name}`}
                          onClick={() => setEditing(ingredient)}
                        >
                          <PencilSimple size={14} /> Editar
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="space-y-3 p-10 text-center">
            <p className="text-sm text-slate-600">
              {term
                ? "No hay ingredientes que coincidan con la búsqueda."
                : "Todavía no hay ingredientes. Cargá el primero para calcular tus recetas."}
            </p>
          </div>
        )}
      </Card>
      <Modal
        open={open}
        onClose={() => {
          if (!mutation.isPending) close();
        }}
        closeDisabled={mutation.isPending}
        title={
          editing ? `Editar ingrediente · ${editing.name}` : "Nuevo ingrediente"
        }
        description="Por ejemplo: papa, bolsa de 16 kg, con el costo total de esa bolsa."
        width="max-w-2xl"
      >
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (
              !valid ||
              mutation.isPending ||
              quantityMicros == null ||
              costMinor == null
            )
              return;
            mutation.mutate({
              ingredientId: editing?.id,
              name: name.trim(),
              presentation: presentation.trim(),
              baseUnit,
              presentationQuantityMicros: quantityMicros,
              presentationCostMinor: costMinor,
            });
          }}
        >
          <Field label="Ingrediente">
            <Input
              aria-label="Nombre del ingrediente"
              autoFocus
              required
              maxLength={120}
              disabled={mutation.isPending}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Papa"
            />
          </Field>
          <Field label="Presentación">
            <Input
              aria-label="Presentación del ingrediente"
              required
              maxLength={120}
              disabled={mutation.isPending}
              value={presentation}
              onChange={(event) => setPresentation(event.target.value)}
              placeholder="Bolsa, botella, caja, maple…"
            />
          </Field>
          <Field label="Se calcula por">
            <Select
              aria-label="Unidad del ingrediente"
              disabled={mutation.isPending}
              value={baseUnit}
              onChange={(event) => {
                setBaseUnit(event.target.value as IngredientUnit);
                setQuantity("");
              }}
            >
              <option value="KG">Peso (kg)</option>
              <option value="L">Volumen (litros)</option>
              <option value="UNIT">Unidades</option>
            </Select>
          </Field>
          <Field label={`Contenido de la presentación (${unitLabel})`}>
            <Input
              aria-label="Contenido de la presentación"
              required
              inputMode="decimal"
              disabled={mutation.isPending}
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              placeholder={
                baseUnit === "KG" ? "16" : baseUnit === "UNIT" ? "30" : "1,5"
              }
            />
          </Field>
          <Field label="Costo de la presentación">
            <Input
              aria-label="Costo de la presentación"
              required
              inputMode="decimal"
              disabled={mutation.isPending}
              value={cost}
              onChange={(event) => setCost(event.target.value)}
              placeholder="0,00"
            />
          </Field>
          <p className="self-center text-xs text-slate-500">
            El contenido puede ser aproximado, por ejemplo el peso habitual de
            la bolsa.
          </p>
          {(quantity.trim() && quantityMicros == null) ||
          (cost.trim() && costMinor == null) ? (
            <p role="alert" className="text-xs text-rose-700 sm:col-span-2">
              Ingresá un contenido mayor que cero y un costo válido. Usá coma o
              punto para los decimales.
            </p>
          ) : null}
          {error && (
            <p role="alert" className="text-xs text-rose-700 sm:col-span-2">
              {error}
            </p>
          )}
          <p className="text-xs text-slate-500 sm:col-span-2">
            Al cambiar el costo o el contenido se actualizan las recetas para
            ventas futuras.
          </p>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button
              type="button"
              variant="secondary"
              disabled={mutation.isPending}
              onClick={close}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={!valid || mutation.isPending}>
              {mutation.isPending ? "Guardando…" : "Guardar ingrediente"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
