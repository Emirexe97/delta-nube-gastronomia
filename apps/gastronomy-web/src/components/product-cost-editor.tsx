import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type {
  IngredientDto,
  ProductCostConfigurationDto,
  ProductDto,
} from "@gastronomy/contracts";
import { calculateIngredientRecipeCost } from "@gastronomy/domain";
import { Button, Card, Field, Input, Select } from "@gastronomy/ui";
import { useApiMutation } from "../api";
import {
  formatMoney,
  humanError,
  normalizeSearch,
  parseMoneyInput,
} from "../lib";
import {
  defaultRecipeUnit,
  ingredientQuantityInput,
  ingredientUnitOptions,
  parseIngredientQuantity,
  type IngredientDisplayUnit,
} from "../ingredient-quantities";

const INGREDIENT_OPTION_LIMIT = 100;

type DraftRow = {
  ingredientId: string;
  amount: string;
  unit: IngredientDisplayUnit;
};
const toMicros = parseIngredientQuantity;
const fromMicros = ingredientQuantityInput;

const RecipeIngredientRow = memo(function RecipeIngredientRow({
  index,
  row,
  ingredient,
  filteredIngredients,
  filteredIngredientIds,
  onChangeIngredient,
  onChangeAmount,
  onChangeUnit,
  onRemove,
}: {
  index: number;
  row: DraftRow;
  ingredient: IngredientDto | undefined;
  filteredIngredients: readonly IngredientDto[];
  filteredIngredientIds: ReadonlySet<string>;
  onChangeIngredient: (index: number, id: string) => void;
  onChangeAmount: (index: number, amount: string) => void;
  onChangeUnit: (index: number, unit: DraftRow["unit"]) => void;
  onRemove: (index: number) => void;
}) {
  const selectOptions = useMemo(() => {
    const list =
      ingredient && !filteredIngredientIds.has(ingredient.id)
        ? [ingredient, ...filteredIngredients]
        : filteredIngredients;
    return list.map((item) => (
      <option key={item.id} value={item.id}>
        {item.name} · {item.presentation}
      </option>
    ));
  }, [filteredIngredients, filteredIngredientIds, ingredient]);

  const qty = toMicros(row.amount, row.unit);
  const contribution =
    ingredient && qty
      ? (() => {
          try {
            return calculateIngredientRecipeCost(
              [{ ingredientId: ingredient.id, quantityMicros: qty }],
              [ingredient],
            );
          } catch {
            return null;
          }
        })()
      : null;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(5rem,.7fr)_5rem_auto] items-end gap-2">
      <Field label={`Ingrediente ${index + 1}`}>
        <Select
          aria-label={`Ingrediente ${index + 1}`}
          value={row.ingredientId}
          onChange={(e) => onChangeIngredient(index, e.target.value)}
        >
          <option value="">Elegir…</option>
          {selectOptions}
        </Select>
      </Field>
      <Field label={`Cantidad ${index + 1}`}>
        <Input
          aria-label={`Cantidad ${index + 1}`}
          inputMode="decimal"
          value={row.amount}
          onChange={(e) => onChangeAmount(index, e.target.value)}
        />
      </Field>
      <Field label={`Unidad ${index + 1}`}>
        <Select
          aria-label={`Unidad ${index + 1}`}
          value={row.unit}
          onChange={(e) =>
            onChangeUnit(index, e.target.value as DraftRow["unit"])
          }
        >
          {ingredientUnitOptions(ingredient?.baseUnit ?? "KG").map(
            ({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ),
          )}
        </Select>
      </Field>
      <Button
        type="button"
        variant="ghost"
        aria-label={`Quitar ingrediente ${index + 1}`}
        onClick={() => onRemove(index)}
      >
        Quitar
      </Button>
      {contribution !== null && (
        <span className="col-span-full text-right text-xs text-slate-500">
          Aporta {formatMoney(contribution)}
        </span>
      )}
    </div>
  );
});

export function ProductCostEditor({
  product,
  onSaved,
}: {
  product: ProductDto;
  onSaved(): void;
}) {
  const [ingredients, setIngredients] = useState<IngredientDto[]>([]);
  const [ingredientFilter, setIngredientFilter] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [manual, setManual] = useState("");
  const lastValidManual = useRef("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const requestId = useRef(0);
  const mutation = useApiMutation(
    (input: ProductCostConfigurationDto) =>
      window.gastronomy.setProductCostConfiguration(input),
    { onSuccess: () => onSaved() },
  );

  const load = async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    setLoadError("");
    try {
      const [available, config] = await Promise.all([
        window.gastronomy.listIngredients(),
        window.gastronomy.getProductCostConfiguration({
          productId: product.id,
        }),
      ]);
      if (currentRequest !== requestId.current) return;
      setIngredients(available);
      setIngredientFilter("");
      setEnabled(config.recipeEnabled);
      const manualValue =
        config.manualUnitCostMinor == null
          ? ""
          : (config.manualUnitCostMinor / 100).toFixed(2).replace(".", ",");
      setManual(manualValue);
      lastValidManual.current = manualValue;
      setRows(
        config.recipeItems.map((item) => {
          const ing = available.find(
            (candidate) => candidate.id === item.ingredientId,
          );
          const unit = ing ? defaultRecipeUnit(ing.baseUnit) : "KG";
          return {
            ingredientId: item.ingredientId,
            amount: fromMicros(item.quantityMicros, unit),
            unit,
          };
        }),
      );
    } catch (error) {
      if (currentRequest === requestId.current) setLoadError(humanError(error));
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    return () => {
      requestId.current += 1;
    }; /* product identity owns this draft lifecycle */
  }, [product.id]);

  const indexedIngredients = useMemo(
    () =>
      ingredients.map((ingredient) => ({
        ingredient,
        searchText: normalizeSearch(
          `${ingredient.name} ${ingredient.presentation}`,
        ),
      })),
    [ingredients],
  );
  const ingredientsById = useMemo(
    () => new Map(ingredients.map((item) => [item.id, item])),
    [ingredients],
  );
  const needsIngredientFilter = ingredients.length > INGREDIENT_OPTION_LIMIT;
  const filteredIngredients = useMemo(() => {
    if (!needsIngredientFilter) return ingredients;
    const query = normalizeSearch(ingredientFilter);
    const matching = query
      ? indexedIngredients
          .filter((entry) => entry.searchText.includes(query))
          .map((entry) => entry.ingredient)
      : ingredients;
    return matching.slice(0, INGREDIENT_OPTION_LIMIT);
  }, [ingredients, indexedIngredients, needsIngredientFilter, ingredientFilter]);
  const filteredIngredientIds = useMemo(
    () => new Set(filteredIngredients.map((item) => item.id)),
    [filteredIngredients],
  );

  const recipeItems = useMemo(
    () =>
      rows.map((row) => ({
        ingredientId: row.ingredientId,
        quantityMicros: toMicros(row.amount, row.unit) ?? 0,
      })),
    [rows],
  );
  let preview: number | null = null;
  let previewError = "";
  if (enabled) {
    try {
      if (
        rows.some((row) => !row.ingredientId || !toMicros(row.amount, row.unit))
      )
        throw new Error("Completá ingrediente y cantidad en cada fila.");
      preview = calculateIngredientRecipeCost(recipeItems, ingredients);
    } catch (error) {
      previewError = humanError(error);
    }
  }
  const manualCost = manual.trim() ? parseMoneyInput(manual) : null;
  const invalid =
    (manual.trim() !== "" && manualCost === null) ||
    (enabled && preview === null);
  const changeIngredient = useCallback(
    (index: number, id: string) =>
      setRows((old) =>
        old.map((row, i) => {
          if (i !== index) return row;
          const ing = ingredientsById.get(id);
          const unit = ing ? defaultRecipeUnit(ing.baseUnit) : row.unit;
          const previous = ingredientsById.get(row.ingredientId);
          return {
            ingredientId: id,
            amount:
              previous?.baseUnit === ing?.baseUnit && row.amount
                ? fromMicros(toMicros(row.amount, row.unit) ?? 0, unit)
                : "",
            unit,
          };
        }),
      ),
    [ingredientsById],
  );
  const changeAmount = useCallback(
    (index: number, amount: string) =>
      setRows((old) =>
        old.map((r, i) => (i === index ? { ...r, amount } : r)),
      ),
    [],
  );
  const changeUnit = useCallback(
    (index: number, unit: DraftRow["unit"]) =>
      setRows((old) =>
        old.map((r, i) => {
          if (i !== index) return r;
          const micros = toMicros(r.amount, r.unit);
          return {
            ...r,
            unit,
            amount: micros ? fromMicros(micros, unit) : r.amount,
          };
        }),
      ),
    [],
  );
  const removeRow = useCallback(
    (index: number) => setRows((old) => old.filter((_, i) => i !== index)),
    [],
  );
  const save = () => {
    if (loading || invalid || mutation.isPending) return;
    mutation.mutate({
      productId: product.id,
      recipeEnabled: enabled,
      recipeItems: rows
        .filter((row) => row.ingredientId && toMicros(row.amount, row.unit))
        .map((row) => ({
          ingredientId: row.ingredientId,
          quantityMicros: toMicros(row.amount, row.unit)!,
        })),
      manualUnitCostMinor: manual.trim() ? manualCost : null,
    });
  };

  return (
    <Card className="grid gap-4 p-4">
      <div>
        <h3 className="text-sm font-bold text-slate-800">Costo del producto</h3>
        <p className="mt-1 text-xs text-slate-500">
          Los cambios se aplican a ventas futuras.
        </p>
      </div>
      {product.comboDefinition ? (
        <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
          Las ventas de este combo usan el costo de sus componentes.
        </p>
      ) : loading ? (
        <p className="text-sm text-slate-500">Cargando ingredientes y costo…</p>
      ) : loadError ? (
        <div role="alert" className="grid gap-2 text-sm text-rose-700">
          <p>{loadError}</p>
          <Button type="button" variant="secondary" onClick={() => void load()}>
            Reintentar
          </Button>
        </div>
      ) : (
        <>
          <fieldset
            disabled={mutation.isPending}
            className="grid gap-4 disabled:opacity-70"
          >
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => {
                  const checked = event.target.checked;
                  if (
                    checked &&
                    manual.trim() &&
                    parseMoneyInput(manual) === null
                  )
                    setManual(lastValidManual.current);
                  setEnabled(checked);
                  if (checked && rows.length === 0 && ingredients.length > 0)
                    setRows([{ ingredientId: "", amount: "", unit: "KG" }]);
                }}
              />
              Calcular costo por ingredientes
            </label>
            {enabled ? (
              <div className="grid gap-3">
                {ingredients.length === 0 && (
                  <p className="text-sm text-slate-600">
                    Cargá ingredientes en{" "}
                    <Link
                      className="font-semibold text-brand-700 underline"
                      to="/catalogo?tab=ingredients"
                    >
                      Productos &gt; Ingredientes
                    </Link>{" "}
                    para armar la receta.
                  </p>
                )}
                {needsIngredientFilter && (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Input
                      aria-label="Buscar ingrediente"
                      placeholder="Buscar ingrediente por nombre o presentación…"
                      value={ingredientFilter}
                      onChange={(e) => setIngredientFilter(e.target.value)}
                      className="h-9 max-w-sm"
                    />
                    <span className="text-xs text-slate-500">
                      Mostrando hasta {INGREDIENT_OPTION_LIMIT} de{" "}
                      {ingredients.length} ingredientes
                    </span>
                  </div>
                )}
                {rows.map((row, index) => (
                  <RecipeIngredientRow
                    key={index}
                    index={index}
                    row={row}
                    ingredient={ingredientsById.get(row.ingredientId)}
                    filteredIngredients={filteredIngredients}
                    filteredIngredientIds={filteredIngredientIds}
                    onChangeIngredient={changeIngredient}
                    onChangeAmount={changeAmount}
                    onChangeUnit={changeUnit}
                    onRemove={removeRow}
                  />
                ))}
                <Button
                  type="button"
                  variant="secondary"
                  className="justify-self-start"
                  disabled={ingredients.length === 0 || rows.length >= 100}
                  onClick={() =>
                    setRows((old) =>
                      old.length >= 100
                        ? old
                        : [
                            ...old,
                            { ingredientId: "", amount: "", unit: "KG" },
                          ],
                    )
                  }
                >
                  Agregar ingrediente
                </Button>
                {previewError ? (
                  <p role="alert" className="text-sm text-rose-700">
                    {previewError}
                  </p>
                ) : (
                  <p className="text-sm font-bold text-slate-800">
                    Costo por unidad: {formatMoney(preview ?? 0)}
                  </p>
                )}
              </div>
            ) : (
              <Field
                label="Costo manual por unidad"
                hint="Dejalo vacío para usar las últimas compras."
              >
                <Input
                  aria-label="Costo manual por unidad"
                  inputMode="decimal"
                  placeholder="Opcional"
                  value={manual}
                  onChange={(e) => {
                    const value = e.target.value;
                    setManual(value);
                    if (!value.trim() || parseMoneyInput(value) !== null)
                      lastValidManual.current = value;
                  }}
                />
              </Field>
            )}
            {!enabled && manual.trim() && manualCost === null && (
              <p role="alert" className="text-sm text-rose-700">
                Ingresá un costo válido, mayor o igual a cero.
              </p>
            )}
            {mutation.isError && (
              <p role="alert" className="text-sm text-rose-700">
                {humanError(mutation.error)}
              </p>
            )}
            <Button
              type="button"
              className="justify-self-start"
              disabled={mutation.isPending || invalid || loading}
              onClick={save}
            >
              {mutation.isPending ? "Guardando…" : "Guardar costo"}
            </Button>
          </fieldset>
        </>
      )}
    </Card>
  );
}
