import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AuditEntryDto,
  BootstrapDto,
  CategoryDto,
  ProductDto,
} from "@gastronomy/contracts";
import {
  ClockCounterClockwise,
  MagnifyingGlass,
  Package,
  PencilSimple,
  Plus,
  Trash,
  SelectionAll,
  SlidersHorizontal,
  X,
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

const visiblePriceListCodes = ["SALON", "OFF_PREMISE"] as const;
type VisiblePriceListCode = (typeof visiblePriceListCodes)[number];
type VisibleProductPrices = Record<VisiblePriceListCode, string>;
const visiblePriceListLabels: Record<VisiblePriceListCode, string> = {
  SALON: "Salón",
  OFF_PREMISE: "Delivery / Para retirar",
};

function moneyInput(amountMinor: number) {
  return (amountMinor / 100).toLocaleString("es-AR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export function CatalogPage({ data }: { data: BootstrapDto }) {
  const [query, setQuery] = useState("");
  const [categoryQuery, setCategoryQuery] = useState("");
  const [tab, setTab] = useState<"PRODUCTS" | "CATEGORIES" | "MODIFIERS">(
    "PRODUCTS",
  );
  const [productOpen, setProductOpen] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<CategoryDto | null>(
    null,
  );
  const [deletingCategory, setDeletingCategory] = useState<CategoryDto | null>(
    null,
  );
  const [editingProduct, setEditingProduct] = useState<ProductDto | null>(null);
  const [newProductCategoryId, setNewProductCategoryId] = useState<
    string | null
  >(null);
  const [modifierOpen, setModifierOpen] = useState(false);
  const [stockProduct, setStockProduct] = useState<ProductDto | null>(null);
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(
    new Set(),
  );
  const [bulkOpen, setBulkOpen] = useState(false);
  const products = useMemo(
    () =>
      data.products.filter((product) =>
        `${product.code ?? ""} ${product.name} ${product.categoryName}`
          .toLocaleLowerCase()
          .includes(query.toLocaleLowerCase()),
      ),
    [data.products, query],
  );
  const selectedProducts = useMemo(
    () => data.products.filter((product) => selectedProductIds.has(product.id)),
    [data.products, selectedProductIds],
  );
  const closeProduct = () => {
    setProductOpen(false);
    setEditingProduct(null);
    setNewProductCategoryId(null);
  };
  const openNewProduct = (categoryId?: string) => {
    setEditingProduct(null);
    setNewProductCategoryId(categoryId ?? null);
    setProductOpen(true);
  };
  useEffect(() => {
    const available = new Set(data.products.map((product) => product.id));
    setSelectedProductIds(
      (current) => new Set([...current].filter((id) => available.has(id))),
    );
  }, [data.products]);
  const allVisibleSelected =
    products.length > 0 &&
    products.every((product) => selectedProductIds.has(product.id));

  return (
    <div className="panel-enter mx-auto max-w-[1500px] space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold">Catálogo, extras y stock</h2>
          <p className="text-xs text-slate-400">
            Precios por canal y existencias opcionales en milésimas
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {tab === "CATEGORIES" ? (
            <Button variant="secondary" onClick={() => setCategoryOpen(true)}>
              <Plus size={17} /> Nueva categoría
            </Button>
          ) : null}
          {tab !== "CATEGORIES" ? (
            <Button
              onClick={() =>
                tab === "PRODUCTS" ? openNewProduct() : setModifierOpen(true)
              }
            >
              <Plus size={17} />{" "}
              {tab === "PRODUCTS" ? "Nuevo producto" : "Nuevo extra"}
            </Button>
          ) : null}
        </div>
      </div>

      <div
        className="flex gap-1 rounded-xl border border-slate-200 bg-white p-1"
        role="tablist"
        aria-label="Secciones del catálogo"
      >
        {(
          [
            ["PRODUCTS", "Productos"],
            ["CATEGORIES", "Categorías"],
            ["MODIFIERS", "Modificadores"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={`h-9 flex-1 rounded-lg text-xs font-bold transition ${tab === value ? "bg-brand-600 text-white" : "text-slate-500 hover:bg-slate-50"}`}
          >
            {label}
            {value === "PRODUCTS" && selectedProductIds.size
              ? ` · ${selectedProductIds.size}`
              : ""}
          </button>
        ))}
      </div>

      {tab === "MODIFIERS" && selectedProducts.length ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-xs font-bold text-brand-800">
          <span>
            Hay {selectedProducts.length} producto
            {selectedProducts.length === 1 ? "" : "s"} seleccionado
            {selectedProducts.length === 1 ? "" : "s"} para una operación
            masiva.
          </span>
          <div className="flex gap-2">
            <Button
              className="h-8 px-3 text-[11px]"
              onClick={() => {
                setTab("PRODUCTS");
                setBulkOpen(true);
              }}
            >
              Continuar operación
            </Button>
            <Button
              variant="secondary"
              className="h-8 px-3 text-[11px]"
              onClick={() => setSelectedProductIds(new Set())}
            >
              Descartar selección
            </Button>
          </div>
        </div>
      ) : null}

      {tab === "PRODUCTS" ? (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
            <div className="relative min-w-64 flex-1">
              <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                aria-label="Buscar productos"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar nombre, código o categoría"
                className="pl-9"
              />
            </div>
            <Button
              variant="secondary"
              disabled={!selectedProductIds.size}
              onClick={() => setBulkOpen(true)}
            >
              <SelectionAll size={16} />
              Operación masiva
              {selectedProductIds.size ? ` · ${selectedProductIds.size}` : ""}
            </Button>
          </div>
          {selectedProducts.length ? (
            <section
              aria-label="Productos seleccionados"
              className="flex flex-wrap items-center gap-2 border-b border-brand-100 bg-brand-50/50 px-3 py-2.5"
            >
              <span className="text-[11px] font-extrabold text-brand-800">
                Seleccionados · {selectedProducts.length}
              </span>
              <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                {selectedProducts.slice(0, 12).map((product) => (
                  <button
                    key={product.id}
                    type="button"
                    aria-label={`Quitar ${product.name} de la selección`}
                    title="Quitar de la operación masiva"
                    onClick={() =>
                      setSelectedProductIds((current) => {
                        const next = new Set(current);
                        next.delete(product.id);
                        return next;
                      })
                    }
                    className="focus-ring inline-flex items-center gap-1 rounded-full border border-brand-200 bg-white px-2 py-1 text-[11px] font-bold text-brand-800 hover:bg-brand-100"
                  >
                    <span className="max-w-44 truncate">{product.name}</span>
                    <X size={12} aria-hidden="true" />
                  </button>
                ))}
                {selectedProducts.length > 12 ? (
                  <span className="inline-flex items-center rounded-full bg-brand-100 px-2 py-1 text-[11px] font-extrabold text-brand-800">
                    + {selectedProducts.length - 12} adicionales
                  </span>
                ) : null}
              </div>
              <Button
                variant="secondary"
                className="h-8 px-2.5 text-[11px]"
                onClick={() => setSelectedProductIds(new Set())}
              >
                Limpiar selección
              </Button>
            </section>
          ) : null}
          {products.length ? (
            <div className="max-h-[calc(100vh-260px)] overflow-auto">
              <table className="dn-table">
                <thead>
                  <tr>
                    <th className="w-10">
                      <input
                        type="checkbox"
                        aria-label="Seleccionar productos visibles"
                        checked={allVisibleSelected}
                        onChange={(event) => {
                          setSelectedProductIds((current) => {
                            const next = new Set(current);
                            for (const product of products) {
                              if (event.target.checked) next.add(product.id);
                              else next.delete(product.id);
                            }
                            return next;
                          });
                        }}
                        className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-300"
                      />
                    </th>
                    <th>Producto</th>
                    <th>Categoría</th>
                    <th>Código</th>
                    <th className="text-right">Salón</th>
                    <th className="text-right">Delivery / Para retirar</th>
                    <th>Stock</th>
                    <th>Estado</th>
                    <th className="text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((product) => (
                    <tr key={product.id}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Seleccionar ${product.name}`}
                          checked={selectedProductIds.has(product.id)}
                          onChange={(event) => {
                            setSelectedProductIds((current) => {
                              const next = new Set(current);
                              if (event.target.checked) next.add(product.id);
                              else next.delete(product.id);
                              return next;
                            });
                          }}
                          className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-300"
                        />
                      </td>
                      <td className="font-bold text-slate-900">
                        {product.name}
                      </td>
                      <td>{product.categoryName}</td>
                      <td className="font-mono text-[11px]">
                        {product.code || "—"}
                      </td>
                      {visiblePriceListCodes.map((code) => (
                        <td key={code} className="text-right font-semibold">
                          {formatMoney(
                            product.prices.find(
                              (price) =>
                                price.priceListCode ===
                                (code === "OFF_PREMISE" ? "TAKEAWAY" : code),
                            )?.amountMinor ?? 0,
                          )}
                        </td>
                      ))}
                      <td>
                        <button
                          type="button"
                          onClick={() => setStockProduct(product)}
                          className="font-bold text-brand-700 hover:underline"
                        >
                          {product.stockMinor == null
                            ? "Sin control"
                            : `${(product.stockMinor / 1000).toLocaleString("es-AR", { maximumFractionDigits: 3 })} u.`}
                        </button>
                      </td>
                      <td>
                        <Badge tone={product.active ? "green" : "slate"}>
                          {product.active ? "Activo" : "Inactivo"}
                        </Badge>
                      </td>
                      <td className="text-right">
                        <button
                          type="button"
                          aria-label={`Editar ${product.name}`}
                          title="Editar producto y precios"
                          onClick={() => setEditingProduct(product)}
                          className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 text-[11px] font-bold text-slate-600 transition hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700"
                        >
                          <PencilSimple size={14} />
                          Editar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyProducts onCreate={() => openNewProduct()} />
          )}
        </Card>
      ) : tab === "CATEGORIES" ? (
        <CategoryTable
          categories={data.categories}
          products={data.products}
          query={categoryQuery}
          setQuery={setCategoryQuery}
          onEdit={setEditingCategory}
          onDelete={setDeletingCategory}
          onCreate={() => setCategoryOpen(true)}
          onCreateProduct={(category) => openNewProduct(category.id)}
        />
      ) : (
        <Card className="overflow-hidden">
          {data.modifiers.length ? (
            <table className="dn-table">
              <thead>
                <tr>
                  <th>Grupo</th>
                  <th>Modificador</th>
                  <th className="text-right">Precio</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {data.modifiers.map((modifier) => (
                  <tr key={modifier.id}>
                    <td>
                      <Badge tone="orange">{modifier.groupName}</Badge>
                    </td>
                    <td className="font-bold text-slate-900">
                      {modifier.name}
                    </td>
                    <td className="text-right font-extrabold">
                      {formatMoney(modifier.priceMinor)}
                    </td>
                    <td>
                      <Badge tone={modifier.active ? "green" : "slate"}>
                        {modifier.active ? "Activo" : "Inactivo"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="grid h-64 place-items-center text-center">
              <div>
                <SlidersHorizontal
                  size={38}
                  className="mx-auto text-slate-300"
                />
                <p className="mt-2 text-sm font-semibold text-slate-500">
                  Creá extras como queso o salsa
                </p>
                <Button className="mt-3" onClick={() => setModifierOpen(true)}>
                  <Plus />
                  Nuevo extra
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      <ProductModal
        open={productOpen || Boolean(editingProduct)}
        product={editingProduct}
        categories={data.categories}
        initialCategoryId={newProductCategoryId}
        onClose={closeProduct}
      />
      <CategoryModal
        open={categoryOpen || Boolean(editingCategory)}
        category={editingCategory}
        onClose={() => {
          setCategoryOpen(false);
          setEditingCategory(null);
        }}
      />
      <DeleteCategoryModal
        category={deletingCategory}
        onClose={() => setDeletingCategory(null)}
      />
      <ModifierModal
        open={modifierOpen}
        onClose={() => setModifierOpen(false)}
      />
      <StockModal
        product={stockProduct}
        onClose={() => setStockProduct(null)}
      />
      <BulkProductsModal
        open={bulkOpen}
        products={selectedProducts}
        categories={data.categories}
        onRemoveProduct={(productId) =>
          setSelectedProductIds((current) => {
            const next = new Set(current);
            next.delete(productId);
            return next;
          })
        }
        onClose={() => setBulkOpen(false)}
        onApplied={() => {
          setBulkOpen(false);
          setSelectedProductIds(new Set());
        }}
      />
    </div>
  );
}

function CategoryModal({
  open,
  category,
  onClose,
}: {
  open: boolean;
  category: CategoryDto | null;
  onClose(): void;
}) {
  const [name, setName] = useState("");
  const [active, setActive] = useState(true);
  const [sortOrder, setSortOrder] = useState(0);
  const [reason, setReason] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setName(category?.name ?? "");
    setActive(category?.active ?? true);
    setSortOrder(category?.sortOrder ?? 0);
    setReason("");
    setPin("");
    setError(null);
  }, [category, open]);
  const mutation = useApiMutation(
    () =>
      category
        ? window.gastronomy.updateCategory({
            categoryId: category.id,
            name: name.trim(),
            active,
            sortOrder,
            reason: reason.trim(),
            authorizerPin: pin,
          })
        : window.gastronomy.createCategory({ name: name.trim() }),
    {
      onSuccess: onClose,
      onError: (value) => setError(humanError(value)),
    },
  );
  return (
    <Modal
      open={open}
      onClose={onClose}
      closeDisabled={mutation.isPending}
      title={category ? `Editar · ${category.name}` : "Nueva categoría"}
      description={
        category
          ? "Renombrá, ordená o desactivá la categoría con trazabilidad."
          : "Quedará disponible inmediatamente al crear o editar productos."
      }
    >
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <Field label="Nombre de la categoría">
          <Input
            autoFocus
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (error) setError(null);
            }}
            placeholder="Ej.: Postres"
            maxLength={80}
            required
          />
        </Field>
        {category ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Orden">
                <Input
                  type="number"
                  min={0}
                  value={sortOrder}
                  onChange={(event) => setSortOrder(Number(event.target.value))}
                />
              </Field>
              <label className="flex items-center gap-2 self-end rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(event) => setActive(event.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-300"
                />
                Categoría activa
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_150px]">
              <Field label="Motivo del cambio">
                <Input
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Ej.: reorganización del menú"
                  required
                />
              </Field>
              <Field label="PIN de autorización">
                <Input
                  type="password"
                  inputMode="numeric"
                  maxLength={8}
                  value={pin}
                  onChange={(event) =>
                    setPin(event.target.value.replace(/\D/g, ""))
                  }
                  required
                />
              </Field>
            </div>
            {!active ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                Para desactivarla, primero reasigná o desactivá todos sus
                productos activos.
              </p>
            ) : null}
          </>
        ) : null}
        {error ? (
          <p
            role="alert"
            className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700"
          >
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={mutation.isPending}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            disabled={
              !name.trim() ||
              (Boolean(category) &&
                (!Number.isInteger(sortOrder) ||
                  sortOrder < 0 ||
                  !reason.trim() ||
                  pin.length < 4)) ||
              mutation.isPending
            }
          >
            {mutation.isPending
              ? "Guardando…"
              : category
                ? "Guardar categoría"
                : "Crear categoría"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function BulkProductsModal({
  open,
  products,
  categories,
  onRemoveProduct,
  onClose,
  onApplied,
}: {
  open: boolean;
  products: ProductDto[];
  categories: CategoryDto[];
  onRemoveProduct(productId: string): void;
  onClose(): void;
  onApplied(): void;
}) {
  const [categoryId, setCategoryId] = useState("");
  const [active, setActive] = useState<"" | "ACTIVE" | "INACTIVE">("");
  const [adjustPrices, setAdjustPrices] = useState(false);
  const [mode, setMode] = useState<"PERCENTAGE" | "FIXED">("PERCENTAGE");
  const [value, setValue] = useState("");
  const [lists, setLists] = useState<Set<VisiblePriceListCode>>(
    new Set(visiblePriceListCodes),
  );
  const [reason, setReason] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setCategoryId("");
    setActive("");
    setAdjustPrices(false);
    setMode("PERCENTAGE");
    setValue("");
    setLists(new Set(visiblePriceListCodes));
    setReason("");
    setPin("");
    setError(null);
  }, [open]);
  const productIds = products.map((product) => product.id);
  const parsedValue = (() => {
    const normalized =
      mode === "PERCENTAGE"
        ? value.trim().replace(",", ".")
        : value.trim().replace(/\./g, "").replace(",", ".");
    const number = Number(normalized);
    if (!Number.isFinite(number)) return null;
    return mode === "PERCENTAGE" ? number : Math.round(number * 100);
  })();
  const adjustedPrice = (amountMinor: number, code: VisiblePriceListCode) => {
    if (!adjustPrices || !lists.has(code) || parsedValue == null)
      return amountMinor;
    return mode === "PERCENTAGE"
      ? Math.round(amountMinor * (1 + parsedValue / 100))
      : amountMinor + parsedValue;
  };
  const percentageOutOfRange =
    mode === "PERCENTAGE" &&
    parsedValue != null &&
    (parsedValue < -100 || parsedValue > 1000);
  const negativePrice = products.some((product) =>
    visiblePriceListCodes.some((code) => {
      const priceCode = code === "OFF_PREMISE" ? "TAKEAWAY" : code;
      const current =
        product.prices.find((price) => price.priceListCode === priceCode)
          ?.amountMinor ?? 0;
      return adjustedPrice(current, code) < 0;
    }),
  );
  const unsafePrice =
    (mode === "FIXED" &&
      parsedValue != null &&
      !Number.isSafeInteger(parsedValue)) ||
    products.some((product) =>
      visiblePriceListCodes.some((code) => {
        const priceCode = code === "OFF_PREMISE" ? "TAKEAWAY" : code;
        const current =
          product.prices.find((price) => price.priceListCode === priceCode)
            ?.amountMinor ?? 0;
        return !Number.isSafeInteger(adjustedPrice(current, code));
      }),
    );
  const invalidPriceAdjustment =
    adjustPrices &&
    (parsedValue == null ||
      !lists.size ||
      percentageOutOfRange ||
      negativePrice ||
      unsafePrice);
  const hasChange = Boolean(categoryId || active || adjustPrices);
  const mutation = useApiMutation(
    (input: Parameters<typeof window.gastronomy.bulkUpdateProducts>[0]) =>
      window.gastronomy.bulkUpdateProducts(input),
    {
      onSuccess: onApplied,
      onError: (value) => setError(humanError(value)),
    },
  );
  return (
    <Modal
      open={open}
      onClose={onClose}
      width="max-w-4xl"
      title={`Operación masiva · ${productIds.length} producto${productIds.length === 1 ? "" : "s"}`}
      description="Los cambios se aplican juntos o no se aplica ninguno; requieren autorización y quedan auditados."
    >
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (
            !productIds.length ||
            !hasChange ||
            invalidPriceAdjustment ||
            !reason.trim() ||
            pin.length < 4 ||
            mutation.isPending
          )
            return;
          mutation.mutate({
            productIds,
            categoryId: categoryId || null,
            active: active === "" ? null : active === "ACTIVE",
            priceAdjustment: adjustPrices
              ? {
                  mode,
                  value: parsedValue!,
                  priceListCodes: [
                    ...(lists.has("SALON") ? (["SALON"] as const) : []),
                    ...(lists.has("OFF_PREMISE")
                      ? (["TAKEAWAY", "DELIVERY"] as const)
                      : []),
                  ],
                }
              : null,
            reason,
            authorizerPin: pin,
          });
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Cambiar categoría">
            <Select
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
            >
              <option value="">No cambiar</option>
              {categories
                .filter((category) => category.active)
                .map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Cambiar estado">
            <Select
              value={active}
              onChange={(event) =>
                setActive(event.target.value as typeof active)
              }
            >
              <option value="">No cambiar</option>
              <option value="ACTIVE">Activar productos</option>
              <option value="INACTIVE">Desactivar productos</option>
            </Select>
          </Field>
        </div>

        <section className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
          <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
            <input
              type="checkbox"
              checked={adjustPrices}
              onChange={(event) => setAdjustPrices(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-300"
            />
            Ajustar precios
          </label>
          {adjustPrices ? (
            <div className="mt-3 grid gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Tipo de ajuste">
                  <Select
                    value={mode}
                    onChange={(event) =>
                      setMode(event.target.value as typeof mode)
                    }
                  >
                    <option value="PERCENTAGE">Porcentaje</option>
                    <option value="FIXED">Importe fijo por producto</option>
                  </Select>
                </Field>
                <Field
                  label={
                    mode === "PERCENTAGE" ? "Variación (%)" : "Variación ($)"
                  }
                  hint="Admite valores negativos para reducir."
                >
                  <Input
                    inputMode="decimal"
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                    placeholder={
                      mode === "PERCENTAGE" ? "Ej.: 10 o -5" : "Ej.: 500 o -100"
                    }
                  />
                </Field>
              </div>
              <div>
                <p className="mb-2 text-[11px] font-bold text-slate-600">
                  Listas a modificar
                </p>
                <div className="flex flex-wrap gap-3">
                  {visiblePriceListCodes.map((code) => (
                    <label
                      key={code}
                      className="flex items-center gap-2 text-xs font-semibold text-slate-600"
                    >
                      <input
                        type="checkbox"
                        checked={lists.has(code)}
                        onChange={(event) => {
                          setLists((current) => {
                            const next = new Set(current);
                            if (event.target.checked) next.add(code);
                            else next.delete(code);
                            return next;
                          });
                        }}
                        className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-300"
                      />
                      {visiblePriceListLabels[code]}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </section>

        <section className="overflow-hidden rounded-xl border border-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
            <div>
              <h3 className="text-xs font-extrabold text-slate-800">
                Vista previa antes de aplicar
              </h3>
              <p className="text-[10px] text-slate-500">
                Revisá cada fila; podés quitar productos sin cerrar esta
                ventana.
              </p>
            </div>
            <Badge tone="orange">{products.length} seleccionados</Badge>
          </div>
          {products.length ? (
            <div className="max-h-64 overflow-auto">
              <table className="dn-table">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Categoría</th>
                    <th>Estado</th>
                    <th className="text-right">Salón</th>
                    <th className="text-right">Delivery / Retirar</th>
                    <th className="w-20 text-right">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((product) => {
                    const nextCategory = categoryId
                      ? (categories.find(
                          (category) => category.id === categoryId,
                        )?.name ?? product.categoryName)
                      : product.categoryName;
                    const nextActive =
                      active === "" ? product.active : active === "ACTIVE";
                    return (
                      <tr key={product.id}>
                        <td className="font-bold text-slate-900">
                          {product.name}
                        </td>
                        <td>
                          <PreviewChange
                            before={product.categoryName}
                            after={nextCategory}
                          />
                        </td>
                        <td>
                          <PreviewChange
                            before={product.active ? "Activo" : "Inactivo"}
                            after={nextActive ? "Activo" : "Inactivo"}
                          />
                        </td>
                        {visiblePriceListCodes.map((code) => {
                          const priceCode =
                            code === "OFF_PREMISE" ? "TAKEAWAY" : code;
                          const current =
                            product.prices.find(
                              (price) => price.priceListCode === priceCode,
                            )?.amountMinor ?? 0;
                          const next = adjustedPrice(current, code);
                          return (
                            <td key={code} className="text-right">
                              <PreviewChange
                                before={formatMoney(current)}
                                after={formatMoney(next)}
                                invalid={next < 0}
                              />
                            </td>
                          );
                        })}
                        <td className="text-right">
                          <button
                            type="button"
                            aria-label={`Quitar ${product.name} del lote`}
                            title="Quitar del lote"
                            onClick={() => onRemoveProduct(product.id)}
                            className="focus-ring inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 px-2 text-[11px] font-bold text-slate-600 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700"
                          >
                            <X size={13} aria-hidden="true" />
                            Quitar
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p role="alert" className="px-3 py-4 text-xs text-rose-700">
              No quedan productos en este lote. Volvé y elegí al menos uno.
            </p>
          )}
        </section>

        {percentageOutOfRange ? (
          <p
            role="alert"
            className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700"
          >
            El porcentaje debe estar entre -100% y 1000%.
          </p>
        ) : negativePrice ? (
          <p
            role="alert"
            className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700"
          >
            El ajuste dejaría al menos un precio por debajo de cero. Revisá la
            vista previa.
          </p>
        ) : unsafePrice ? (
          <p
            role="alert"
            className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700"
          >
            El ajuste supera el importe máximo seguro. Ingresá un valor menor.
          </p>
        ) : null}

        <div className="grid gap-3 rounded-xl border border-brand-100 bg-brand-50/40 p-3 sm:grid-cols-[1fr_150px]">
          <Field label="Motivo">
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Ej.: actualización de lista de septiembre"
            />
          </Field>
          <Field label="PIN de autorización">
            <Input
              type="password"
              inputMode="numeric"
              maxLength={8}
              value={pin}
              onChange={(event) =>
                setPin(event.target.value.replace(/\D/g, ""))
              }
              placeholder="••••"
            />
          </Field>
        </div>
        {error ? (
          <p
            role="alert"
            className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700"
          >
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            disabled={
              !productIds.length ||
              !hasChange ||
              invalidPriceAdjustment ||
              !reason.trim() ||
              pin.length < 4 ||
              mutation.isPending
            }
          >
            {mutation.isPending ? "Aplicando…" : "Aplicar a seleccionados"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function PreviewChange({
  before,
  after,
  invalid = false,
}: {
  before: string;
  after: string;
  invalid?: boolean;
}) {
  if (before === after)
    return <span className="text-[11px] text-slate-500">{before}</span>;
  return (
    <span className="inline-flex flex-col text-[11px] leading-4">
      <span className="text-slate-400 line-through">{before}</span>
      <span
        className={
          invalid ? "font-bold text-rose-700" : "font-bold text-brand-700"
        }
      >
        → {after}
      </span>
    </span>
  );
}

function CategoryTable({
  categories,
  products,
  query,
  setQuery,
  onEdit,
  onDelete,
  onCreate,
  onCreateProduct,
}: {
  categories: CategoryDto[];
  products: ProductDto[];
  query: string;
  setQuery(value: string): void;
  onEdit(category: CategoryDto): void;
  onDelete(category: CategoryDto): void;
  onCreate(): void;
  onCreateProduct(category: CategoryDto): void;
}) {
  const rows = categories
    .filter((category) =>
      category.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
    )
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-slate-100 p-3">
        <div className="relative max-w-xl">
          <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            aria-label="Buscar categorías"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar categoría"
            className="pl-9"
          />
        </div>
      </div>
      {rows.length ? (
        <div className="max-h-[calc(100vh-260px)] overflow-auto">
          <table className="dn-table">
            <thead>
              <tr>
                <th>Orden</th>
                <th>Categoría</th>
                <th className="text-right">Productos activos</th>
                <th className="text-right">Productos totales</th>
                <th>Estado</th>
                <th className="text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((category) => {
                const list = products.filter(
                  (product) => product.categoryId === category.id,
                );
                return (
                  <tr key={category.id}>
                    <td>{category.sortOrder}</td>
                    <td className="font-bold text-slate-900">
                      {category.name}
                    </td>
                    <td className="text-right">
                      {list.filter((product) => product.active).length}
                    </td>
                    <td className="text-right">{list.length}</td>
                    <td>
                      <Badge tone={category.active ? "green" : "slate"}>
                        {category.active ? "Activo" : "Inactivo"}
                      </Badge>
                    </td>
                    <td className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="secondary"
                          className="h-8 px-2.5 text-[11px]"
                          disabled={!category.active}
                          onClick={() => onCreateProduct(category)}
                        >
                          <Plus size={14} /> Producto
                        </Button>
                        <Button
                          variant="secondary"
                          className="h-8 px-2.5 text-[11px]"
                          onClick={() => onEdit(category)}
                        >
                          <PencilSimple size={14} /> Editar
                        </Button>
                        <button
                          type="button"
                          aria-label={`Eliminar categoría ${category.name}`}
                          onClick={() => onDelete(category)}
                          className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-lg border border-rose-200 px-2.5 text-[11px] font-bold text-rose-700 hover:bg-rose-50"
                        >
                          <Trash size={14} /> Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid h-64 place-items-center text-center">
          <div>
            <Package size={38} className="mx-auto text-slate-300" />
            <p className="mt-2 text-sm font-semibold text-slate-500">
              {query
                ? "No encontramos categorías con esa búsqueda."
                : "Todavía no hay categorías."}
            </p>
            <Button className="mt-3" onClick={onCreate}>
              <Plus /> Crear categoría
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function DeleteCategoryModal({
  category,
  onClose,
}: {
  category: CategoryDto | null;
  onClose(): void;
}) {
  const [reason, setReason] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (category) {
      setReason("");
      setPin("");
      setError(null);
    }
  }, [category]);
  const mutation = useApiMutation(
    () =>
      window.gastronomy.deleteCategory({
        categoryId: category!.id,
        reason: reason.trim(),
        authorizerPin: pin,
      }),
    { onSuccess: onClose, onError: (value) => setError(humanError(value)) },
  );
  return (
    <Modal
      open={Boolean(category)}
      onClose={onClose}
      closeDisabled={mutation.isPending}
      title={`Eliminar categoría · ${category?.name ?? ""}`}
      description="Esta acción es irreversible y no elimina productos ni historial."
    >
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!category || !reason.trim() || pin.length < 4) return;
          mutation.mutate();
        }}
      >
        <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
          Sólo se puede eliminar una categoría sin productos ni referencias
          históricas. Si tiene relaciones, desactivala desde Editar.
        </p>
        <Field label="Motivo">
          <Input
            autoFocus
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
          />
        </Field>
        <Field label="PIN de autorización">
          <Input
            type="password"
            inputMode="numeric"
            maxLength={8}
            value={pin}
            onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
            required
          />
        </Field>
        {error ? (
          <p
            role="alert"
            className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700"
          >
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Volver
          </Button>
          <Button
            type="submit"
            disabled={!reason.trim() || pin.length < 4 || mutation.isPending}
          >
            Eliminar categoría
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function EmptyProducts({ onCreate }: { onCreate(): void }) {
  return (
    <div className="grid h-64 place-items-center text-center">
      <div>
        <Package size={38} className="mx-auto text-slate-300" />
        <p className="mt-2 text-sm font-semibold text-slate-500">
          Todavía no hay productos
        </p>
        <Button className="mt-3" onClick={onCreate}>
          <Plus />
          Crear el primero
        </Button>
      </div>
    </div>
  );
}

function ProductModal({
  open,
  product,
  categories,
  initialCategoryId,
  onClose,
}: {
  open: boolean;
  product: ProductDto | null;
  categories: CategoryDto[];
  initialCategoryId: string | null;
  onClose(): void;
}) {
  const editing = Boolean(product);
  const [categoryId, setCategoryId] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [stock, setStock] = useState("");
  const [active, setActive] = useState(true);
  const [prices, setPrices] = useState<VisibleProductPrices>({
    SALON: "",
    OFF_PREMISE: "",
  });
  const [reason, setReason] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<AuditEntryDto[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const initializedFormKeyRef = useRef("");

  useEffect(() => {
    if (!open) {
      initializedFormKeyRef.current = "";
      return;
    }
    const formKey = product
      ? `edit:${product.id}`
      : `new:${initialCategoryId ?? "default"}`;
    if (initializedFormKeyRef.current === formKey) return;
    initializedFormKeyRef.current = formKey;
    setCategoryId(
      product?.categoryId ??
        initialCategoryId ??
        categories.find((item) => item.active)?.id ??
        "",
    );
    setName(product?.name ?? "");
    setCode(product?.code ?? "");
    setStock(
      product?.stockMinor == null ? "" : String(product.stockMinor / 1000),
    );
    setActive(product?.active ?? true);
    setPrices(
      Object.fromEntries(
        visiblePriceListCodes.map((priceListCode) => [
          priceListCode,
          product
            ? moneyInput(
                product.prices.find(
                  (price) =>
                    price.priceListCode ===
                    (priceListCode === "OFF_PREMISE"
                      ? "TAKEAWAY"
                      : priceListCode),
                )?.amountMinor ?? 0,
              )
            : "",
        ]),
      ) as VisibleProductPrices,
    );
    setReason("");
    setPin("");
    setError(null);
  }, [categories, initialCategoryId, open, product]);

  useEffect(() => {
    if (!open || !product) {
      setHistory([]);
      setHistoryLoading(false);
      return;
    }
    let cancelled = false;
    setHistoryLoading(true);
    window.gastronomy
      .getAuditLog({ action: "PRODUCT_UPDATED", limit: 200 })
      .then((entries) => {
        if (!cancelled)
          setHistory(
            entries
              .filter((entry) => entry.entityId === product.id)
              .slice(0, 5),
          );
      })
      .catch(() => {
        if (!cancelled) setHistory([]);
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, product]);

  const parsedStockMinor = stock.trim() ? parseStockInput(stock) : null;
  const invalidPrices = visiblePriceListCodes.some(
    (codeValue) => parseMoneyInput(prices[codeValue]) == null,
  );
  const invalidInitialStock =
    !editing && Boolean(stock.trim()) && parsedStockMinor == null;

  const mutation = useApiMutation(
    async (parsedPrices: Record<VisiblePriceListCode, number>) => {
      const normalizedPrices = [
        { priceListCode: "SALON" as const, amountMinor: parsedPrices.SALON },
        {
          priceListCode: "TAKEAWAY" as const,
          amountMinor: parsedPrices.OFF_PREMISE,
        },
        {
          priceListCode: "DELIVERY" as const,
          amountMinor: parsedPrices.OFF_PREMISE,
        },
      ];
      if (product) {
        return window.gastronomy.updateProduct({
          productId: product.id,
          categoryId,
          name,
          code: code || null,
          active,
          prices: normalizedPrices,
          reason,
          authorizerPin: pin,
        });
      }
      return window.gastronomy.createProduct({
        categoryId,
        name,
        code: code || null,
        stockMinor: parsedStockMinor,
        prices: normalizedPrices,
      });
    },
    { onSuccess: onClose, onError: (value) => setError(humanError(value)) },
  );

  const submit = () => {
    const parsed = Object.fromEntries(
      visiblePriceListCodes.map((codeValue) => [
        codeValue,
        parseMoneyInput(prices[codeValue]),
      ]),
    ) as Record<VisiblePriceListCode, number | null>;
    if (Object.values(parsed).some((value) => value == null)) {
      setError("Completá precios válidos.");
      return;
    }
    if (invalidInitialStock) {
      setError(
        "El stock inicial debe ser mayor o igual a cero y tener hasta tres decimales.",
      );
      return;
    }
    if (editing && !reason.trim()) {
      setError("Indicá el motivo del cambio.");
      return;
    }
    mutation.mutate(parsed as Record<VisiblePriceListCode, number>);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      closeDisabled={mutation.isPending}
      width="max-w-3xl"
      title={
        editing ? `Editar · ${product?.name ?? "producto"}` : "Nuevo producto"
      }
      description={
        editing
          ? "Los cambios de datos y precios requieren autorización y quedan auditados."
          : "El precio se guarda como snapshot al agregarlo a un pedido."
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="grid gap-4"
      >
        <Field label="Categoría">
          <Select
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
          >
            {categories
              .filter((item) => item.active)
              .map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
          </Select>
        </Field>
        <div
          className={`grid gap-3 ${editing ? "sm:grid-cols-[1fr_150px]" : "sm:grid-cols-[1fr_120px_120px]"}`}
        >
          <Field label="Nombre">
            <Input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </Field>
          <Field label="Código">
            <Input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="MUZG"
            />
          </Field>
          {!editing ? (
            <Field
              label="Stock inicial"
              hint={
                invalidInitialStock
                  ? "Ingresá un número mayor o igual a cero con hasta tres decimales."
                  : "Opcional; admite hasta tres decimales."
              }
            >
              <Input
                inputMode="decimal"
                value={stock}
                aria-invalid={invalidInitialStock}
                onChange={(event) => {
                  setStock(event.target.value);
                  if (error) setError(null);
                }}
                placeholder="Opcional"
                className={invalidInitialStock ? "border-rose-300" : ""}
              />
            </Field>
          ) : null}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {visiblePriceListCodes.map((key) => (
            <Field key={key} label={visiblePriceListLabels[key]}>
              <Input
                inputMode="decimal"
                value={prices[key]}
                onChange={(event) =>
                  setPrices((current) => ({
                    ...current,
                    [key]: event.target.value,
                  }))
                }
                required
              />
            </Field>
          ))}
        </div>

        {editing ? (
          <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3 sm:grid-cols-[1fr_150px]">
            <Field label="Motivo del cambio">
              <Input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Ej.: actualización de lista"
                required
              />
            </Field>
            <Field label="PIN de autorización">
              <Input
                type="password"
                inputMode="numeric"
                maxLength={8}
                value={pin}
                onChange={(event) =>
                  setPin(event.target.value.replace(/\D/g, ""))
                }
                required
              />
            </Field>
            <label className="flex items-center gap-2 text-[12px] font-semibold text-slate-600 sm:col-span-2">
              <input
                type="checkbox"
                checked={active}
                onChange={(event) => setActive(event.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-300"
              />
              Producto activo y disponible para nuevos pedidos
            </label>
          </div>
        ) : null}

        {editing ? (
          <section
            aria-label="Historial reciente de cambios"
            className="rounded-xl border border-slate-200"
          >
            <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
              <ClockCounterClockwise size={15} />
              Historial reciente
            </div>
            {historyLoading ? (
              <p className="px-3 py-3 text-xs text-slate-400">
                Cargando cambios…
              </p>
            ) : history.length ? (
              <ul className="divide-y divide-slate-100">
                {history.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"
                  >
                    <span className="font-semibold text-slate-700">
                      {entry.reason || "Sin detalle"}
                    </span>
                    <span className="text-slate-400">
                      {new Date(entry.timestamp).toLocaleString("es-AR")} ·{" "}
                      {entry.authorizerName || "Sistema"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-3 py-3 text-xs text-slate-400">
                Todavía no hay cambios auditados.
              </p>
            )}
          </section>
        ) : null}

        {error ? (
          <p
            role="alert"
            className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700"
          >
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={mutation.isPending}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            disabled={
              !name.trim() ||
              !categoryId ||
              invalidPrices ||
              invalidInitialStock ||
              (editing && (pin.length < 4 || !reason.trim())) ||
              mutation.isPending
            }
          >
            {mutation.isPending
              ? "Guardando…"
              : editing
                ? "Guardar cambios"
                : "Guardar producto"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ModifierModal({ open, onClose }: { open: boolean; onClose(): void }) {
  const [groupName, setGroupName] = useState("Extras");
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mutation = useApiMutation(
    (input: Parameters<typeof window.gastronomy.createModifier>[0]) =>
      window.gastronomy.createModifier(input),
    {
      onSuccess: () => {
        setName("");
        setPrice("");
        onClose();
      },
      onError: (value) => setError(humanError(value)),
    },
  );
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nuevo modificador"
      description="Se podrá aplicar completo o a una mitad"
    >
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const priceMinor = parseMoneyInput(price);
          if (
            !groupName.trim() ||
            !name.trim() ||
            priceMinor == null ||
            mutation.isPending
          )
            return;
          mutation.mutate({ groupName, name, priceMinor });
        }}
      >
        <Field label="Grupo">
          <Input
            value={groupName}
            onChange={(event) => setGroupName(event.target.value)}
          />
        </Field>
        <Field label="Nombre">
          <Input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Extra queso"
          />
        </Field>
        <Field label="Precio">
          <Input
            inputMode="decimal"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            placeholder="0"
          />
        </Field>
        {error ? (
          <p
            role="alert"
            className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700"
          >
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            disabled={
              !groupName.trim() ||
              !name.trim() ||
              parseMoneyInput(price) == null ||
              mutation.isPending
            }
          >
            Crear extra
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function StockModal({
  product,
  onClose,
}: {
  product: ProductDto | null;
  onClose(): void;
}) {
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("Inventario manual");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!product) return;
    setQuantity("");
    setReason("Inventario manual");
    setPin("");
    setError(null);
  }, [product]);
  const parsedQuantity = quantity.trim() ? parseStockInput(quantity) : null;
  const invalidQuantity = Boolean(quantity.trim()) && parsedQuantity == null;
  const mutation = useApiMutation(
    (input: Parameters<typeof window.gastronomy.adjustStock>[0]) =>
      window.gastronomy.adjustStock(input),
    {
      onSuccess: () => {
        setQuantity("");
        setPin("");
        onClose();
      },
      onError: (value) => setError(humanError(value)),
    },
  );
  return (
    <Modal
      open={Boolean(product)}
      onClose={onClose}
      title={`Ajustar stock · ${product?.name ?? ""}`}
      description="Acepta decimales para medias porciones"
    >
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (
            !product ||
            !quantity.trim() ||
            parsedQuantity == null ||
            invalidQuantity ||
            !reason.trim() ||
            pin.length < 4 ||
            mutation.isPending
          )
            return;
          mutation.mutate({
            productId: product.id,
            newStockMinor: parsedQuantity,
            reason,
            authorizerPin: pin,
          });
        }}
      >
        <Field
          label="Nueva existencia"
          hint={
            invalidQuantity
              ? "Ingresá un número mayor o igual a cero con hasta tres decimales."
              : "Admite hasta tres decimales."
          }
        >
          <Input
            autoFocus
            inputMode="decimal"
            value={quantity}
            aria-invalid={invalidQuantity}
            onChange={(event) => {
              setQuantity(event.target.value);
              if (error) setError(null);
            }}
            className={invalidQuantity ? "border-rose-300" : ""}
            placeholder={
              product?.stockMinor == null
                ? "0"
                : String(product.stockMinor / 1000)
            }
          />
        </Field>
        <Field label="Motivo">
          <Input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        <Field label="PIN de autorización">
          <Input
            type="password"
            inputMode="numeric"
            maxLength={8}
            value={pin}
            onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
          />
        </Field>
        {error ? (
          <p
            role="alert"
            className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700"
          >
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Volver
          </Button>
          <Button
            type="submit"
            disabled={
              !product ||
              !quantity.trim() ||
              invalidQuantity ||
              parsedQuantity == null ||
              !reason.trim() ||
              pin.length < 4 ||
              mutation.isPending
            }
          >
            Guardar stock
          </Button>
        </div>
      </form>
    </Modal>
  );
}
