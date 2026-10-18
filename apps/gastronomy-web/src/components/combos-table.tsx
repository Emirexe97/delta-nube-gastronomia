import type { ProductDto } from "@gastronomy/contracts";
import { Badge, Button, Card, Input } from "@gastronomy/ui";
import { MagnifyingGlass, Plus, Trash } from "@phosphor-icons/react";
import { formatMoney } from "../lib";

export function CombosTable({
  products,
  query,
  onQueryChange,
  canManage,
  onCreate,
  onEditOptions,
  onEditProduct,
  onDelete,
}: {
  products: ProductDto[];
  query: string;
  onQueryChange(value: string): void;
  canManage: boolean;
  onCreate(): void;
  onEditOptions(product: ProductDto): void;
  onEditProduct(product: ProductDto): void;
  onDelete(product: ProductDto): void;
}) {
  const combos = products.filter((product) => product.comboDefinition);
  const term = query.trim().toLocaleLowerCase();
  const filtered = combos.filter((product) =>
    `${product.name} ${product.code ?? ""} ${product.categoryName}`
      .toLocaleLowerCase()
      .includes(term),
  );
  return (
    <Card className="overflow-hidden">
      <div className="space-y-3 border-b border-slate-100 p-3">
        <p className="text-xs text-slate-600">
          Creá combos con precio propio y opciones de productos. El stock se
          descuenta de los componentes elegidos.
        </p>
        <div className="relative max-w-md">
          <MagnifyingGlass
            size={16}
            className="absolute left-3 top-3 text-slate-400"
          />
          <Input
            aria-label="Buscar combos"
            placeholder="Buscar nombre, código o categoría"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            className="pl-9"
          />
        </div>
      </div>
      {filtered.length ? (
        <div className="overflow-auto">
          <table className="dn-table min-w-[850px]">
            <thead>
              <tr>
                <th>Combo</th>
                <th>Categoría</th>
                <th>Opciones</th>
                <th className="text-right">Salón</th>
                <th className="text-right">Delivery / Para retirar</th>
                <th>Estado</th>
                <th className="text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((product) => (
                <tr key={product.id}>
                  <td className="font-bold text-slate-900">
                    {product.name}
                    {product.code && (
                      <div className="font-mono text-xs font-normal text-slate-500">
                        {product.code}
                      </div>
                    )}
                  </td>
                  <td>{product.categoryName}</td>
                  <td className="text-xs text-slate-600">
                    {product
                      .comboDefinition!.slots.map(
                        (slot) => `${slot.name} × ${slot.quantity}`,
                      )
                      .join(" · ")}
                  </td>
                  {["SALON", "TAKEAWAY"].map((code) => (
                    <td key={code} className="text-right font-semibold">
                      {formatMoney(
                        product.prices.find(
                          (price) => price.priceListCode === code,
                        )?.amountMinor ?? 0,
                      )}
                    </td>
                  ))}
                  <td>
                    <Badge tone={product.active ? "green" : "slate"}>
                      {product.active ? "Activo" : "Inactivo"}
                    </Badge>
                  </td>
                  <td>
                    <div className="flex justify-end gap-1.5">
                      {canManage && (
                        <>
                          <Button
                            variant="secondary"
                            className="h-8 px-2 text-xs"
                            aria-label={`Editar opciones de ${product.name}`}
                            onClick={() => onEditOptions(product)}
                          >
                            Editar opciones
                          </Button>
                          <Button
                            variant="secondary"
                            className="h-8 px-2 text-xs"
                            aria-label={`Editar datos de ${product.name}`}
                            onClick={() => onEditProduct(product)}
                          >
                            Datos y precios
                          </Button>
                          <Button
                            variant="danger"
                            className="h-8 px-2"
                            aria-label={`Eliminar combo ${product.name}`}
                            onClick={() => onDelete(product)}
                          >
                            <Trash size={14} />
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="space-y-3 p-10 text-center">
          <p className="text-sm text-slate-600">
            {combos.length
              ? "No hay combos que coincidan con la búsqueda."
              : "Todavía no hay combos. Creá el primero con los productos del catálogo."}
          </p>
          {canManage && !combos.length && (
            <Button onClick={onCreate}>
              <Plus size={17} /> Nuevo combo
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
