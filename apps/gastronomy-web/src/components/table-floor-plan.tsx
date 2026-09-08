import { useEffect, useMemo, useRef, useState } from "react";
import type {
  BootstrapDto,
  RestaurantTableDto,
  TableSectorDto,
} from "@gastronomy/contracts";
import {
  ArrowsOutCardinal,
  FloppyDisk,
  MapTrifold,
  PencilSimple,
  Plus,
  Trash,
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
import { formatElapsed, formatMoney, humanError } from "../lib";

type TableDraft = Pick<
  RestaurantTableDto,
  "number" | "name" | "sectorId" | "layoutWidth" | "layoutHeight" | "shape"
>;

type Position = { x: number; y: number };

const shapeLabels: Record<RestaurantTableDto["shape"], string> = {
  ROUND: "Redonda",
  SQUARE: "Cuadrada",
  RECTANGLE: "Rectangular",
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

function tableDraft(table: RestaurantTableDto): TableDraft {
  return {
    number: table.number,
    name: table.name,
    sectorId: table.sectorId,
    layoutWidth: table.layoutWidth,
    layoutHeight: table.layoutHeight,
    shape: table.shape,
  };
}

export function TableFloorPlan({
  data,
  tables,
  canManageTables,
  onActivateTable,
}: {
  data: BootstrapDto;
  tables: RestaurantTableDto[];
  canManageTables: boolean;
  onActivateTable(table: RestaurantTableDto): void;
}) {
  const sectors = useMemo(
    () => [...data.tableSectors].sort((a, b) => a.sortOrder - b.sortOrder),
    [data.tableSectors],
  );
  const [activeSectorId, setActiveSectorId] = useState(sectors[0]?.id ?? "");
  const [editing, setEditing] = useState(false);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TableDraft | null>(null);
  const [positions, setPositions] = useState<Record<string, Position>>({});
  const [drag, setDrag] = useState<{
    tableId: string;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [sectorDialog, setSectorDialog] = useState<
    { mode: "CREATE" } | { mode: "RENAME"; sector: TableSectorDto } | null
  >(null);
  const [sectorName, setSectorName] = useState("");
  const [deletingSector, setDeletingSector] = useState<TableSectorDto | null>(
    null,
  );
  const [addTableOpen, setAddTableOpen] = useState(false);
  const [newTableNumber, setNewTableNumber] = useState("");
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sectors.some((sector) => sector.id === activeSectorId))
      setActiveSectorId(sectors[0]?.id ?? "");
  }, [activeSectorId, sectors]);

  useEffect(() => {
    setPositions(
      Object.fromEntries(
        tables.map((table) => [
          table.id,
          { x: table.layoutX, y: table.layoutY },
        ]),
      ),
    );
  }, [tables]);

  const selectedTable = tables.find((table) => table.id === selectedTableId);
  useEffect(() => {
    setDraft(selectedTable ? tableDraft(selectedTable) : null);
  }, [selectedTable]);

  const sectorTables = tables.filter(
    (table) => table.sectorId === activeSectorId,
  );
  const activeSector = sectors.find((sector) => sector.id === activeSectorId);

  const updateTable = useApiMutation(
    (input: Parameters<typeof window.gastronomy.updateTable>[0]) =>
      window.gastronomy.updateTable(input),
    {
      onSuccess: () => setMessage("Plano guardado."),
      onError: (value) => setMessage(humanError(value)),
    },
  );
  const createSector = useApiMutation(
    (input: { name: string }) => window.gastronomy.createTableSector(input),
    {
      onSuccess: (sector) => {
        setActiveSectorId(sector.id);
        setSectorDialog(null);
        setSectorName("");
        setMessage(`Sector “${sector.name}” creado.`);
      },
      onError: (value) => setMessage(humanError(value)),
    },
  );
  const renameSector = useApiMutation(
    (input: { sectorId: string; name: string }) =>
      window.gastronomy.updateTableSector(input),
    {
      onSuccess: (sector) => {
        setSectorDialog(null);
        setSectorName("");
        setMessage(`Sector renombrado a “${sector.name}”.`);
      },
      onError: (value) => setMessage(humanError(value)),
    },
  );
  const deleteSector = useApiMutation(
    (input: { sectorId: string }) => window.gastronomy.deleteTableSector(input),
    {
      onSuccess: (result) => {
        setActiveSectorId(result.fallbackSectorId);
        setDeletingSector(null);
        setSelectedTableId(null);
        setMessage("Sector eliminado; sus mesas pasaron al sector principal.");
      },
      onError: (value) => setMessage(humanError(value)),
    },
  );
  const createTable = useApiMutation(
    async (input: { number: number; sectorId: string }) => {
      const existing = data.tables.find(
        (table) => table.number === input.number && table.active,
      );
      if (existing)
        throw new Error("Ya existe una mesa activa con ese número.");
      const table = await window.gastronomy.ensureTable({
        number: input.number,
      });
      return window.gastronomy.updateTable({
        tableId: table.id,
        number: table.number,
        name: table.name,
        active: true,
        sortOrder: table.sortOrder,
        sectorId: input.sectorId,
        layoutX: 5,
        layoutY: 7,
        layoutWidth: 14,
        layoutHeight: 17,
        shape: "SQUARE",
      });
    },
    {
      onSuccess: (table) => {
        setSelectedTableId(table.id);
        setAddTableOpen(false);
        setNewTableNumber("");
        setMessage(`Mesa ${table.number} agregada al plano.`);
      },
      onError: (value) => setMessage(humanError(value)),
    },
  );

  const persistPosition = (table: RestaurantTableDto, position: Position) => {
    updateTable.mutate({
      tableId: table.id,
      number: table.number,
      name: table.name,
      active: table.active,
      sortOrder: table.sortOrder,
      sectorId: table.sectorId,
      layoutX: position.x,
      layoutY: position.y,
      layoutWidth: table.layoutWidth,
      layoutHeight: table.layoutHeight,
      shape: table.shape,
    });
  };

  const positionFromPointer = (
    table: RestaurantTableDto,
    clientX: number,
    clientY: number,
    offsetX: number,
    offsetY: number,
  ) => {
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!bounds)
      return positions[table.id] ?? { x: table.layoutX, y: table.layoutY };
    return {
      x:
        Math.round(
          clamp(
            ((clientX - bounds.left) / bounds.width) * 100 - offsetX,
            0,
            100 - table.layoutWidth,
          ) * 10,
        ) / 10,
      y:
        Math.round(
          clamp(
            ((clientY - bounds.top) / bounds.height) * 100 - offsetY,
            0,
            100 - table.layoutHeight,
          ) * 10,
        ) / 10,
    };
  };

  const saveDraft = () => {
    if (!selectedTable || !draft) return;
    const currentPosition = positions[selectedTable.id] ?? {
      x: selectedTable.layoutX,
      y: selectedTable.layoutY,
    };
    const width = Number(draft.layoutWidth);
    const height = Number(draft.layoutHeight);
    updateTable.mutate({
      tableId: selectedTable.id,
      number: Number(draft.number),
      name: draft.name,
      active: selectedTable.active,
      sortOrder: selectedTable.sortOrder,
      sectorId: draft.sectorId,
      layoutX: clamp(currentPosition.x, 0, 100 - width),
      layoutY: clamp(currentPosition.y, 0, 100 - height),
      layoutWidth: width,
      layoutHeight: height,
      shape: draft.shape,
    });
    if (draft.sectorId !== activeSectorId) {
      setActiveSectorId(draft.sectorId);
      setSelectedTableId(null);
    }
  };

  return (
    <div className="space-y-3">
      <Card className="p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            className="flex min-w-0 items-center gap-2 overflow-x-auto"
            role="tablist"
            aria-label="Sectores del salón"
          >
            {sectors.map((sector) => {
              const count = tables.filter(
                (table) => table.sectorId === sector.id,
              ).length;
              return (
                <button
                  key={sector.id}
                  type="button"
                  role="tab"
                  aria-selected={sector.id === activeSectorId}
                  onClick={() => {
                    setActiveSectorId(sector.id);
                    setSelectedTableId(null);
                  }}
                  className={`whitespace-nowrap rounded-xl px-3 py-2 text-xs font-extrabold transition ${sector.id === activeSectorId ? "bg-brand-600 text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                >
                  {sector.name} · {count}
                </button>
              );
            })}
            {canManageTables ? (
              <button
                type="button"
                aria-label="Crear sector"
                onClick={() => {
                  setSectorName("");
                  setSectorDialog({ mode: "CREATE" });
                }}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-dashed border-brand-300 text-brand-600 transition hover:bg-brand-50"
              >
                <Plus size={16} weight="bold" />
              </button>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canManageTables && editing && activeSector ? (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setSectorName(activeSector.name);
                    setSectorDialog({ mode: "RENAME", sector: activeSector });
                  }}
                >
                  <PencilSimple size={15} /> Renombrar sector
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setAddTableOpen(true)}
                >
                  <Plus size={15} /> Nueva mesa
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={sectors.length <= 1}
                  onClick={() => setDeletingSector(activeSector)}
                >
                  <Trash size={15} /> Sector
                </Button>
              </>
            ) : null}
            {canManageTables ? (
              <Button
                type="button"
                variant={editing ? "primary" : "secondary"}
                onClick={() => {
                  setEditing((value) => !value);
                  setSelectedTableId(null);
                  setMessage(null);
                }}
              >
                {editing ? (
                  <FloppyDisk size={16} />
                ) : (
                  <PencilSimple size={16} />
                )}
                {editing ? "Terminar edición" : "Editar plano"}
              </Button>
            ) : null}
          </div>
        </div>
        <p className="mt-2 text-[11px] text-slate-400">
          {editing
            ? "Arrastrá las mesas para ubicarlas. Seleccioná una para cambiar nombre, sector, forma o tamaño."
            : "Elegí un sector y tocá una mesa para abrirla o continuar su pedido."}
        </p>
        {message ? (
          <p
            className={`mt-2 rounded-lg px-3 py-2 text-[11px] font-semibold ${updateTable.isError || createSector.isError || renameSector.isError || deleteSector.isError || createTable.isError ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}
            role="status"
          >
            {message}
          </p>
        ) : null}
      </Card>

      <div
        className={
          editing ? "grid gap-3 lg:grid-cols-[minmax(0,1fr)_290px]" : ""
        }
      >
        <Card className="overflow-hidden p-0">
          <div
            ref={canvasRef}
            className="relative min-h-[540px] overflow-hidden bg-slate-50"
            style={{
              backgroundImage:
                "linear-gradient(to right, rgb(226 232 240 / .75) 1px, transparent 1px), linear-gradient(to bottom, rgb(226 232 240 / .75) 1px, transparent 1px)",
              backgroundSize: "28px 28px",
            }}
          >
            <div className="pointer-events-none absolute left-4 top-4 flex items-center gap-2 rounded-xl bg-white/90 px-3 py-2 text-xs font-extrabold text-slate-600 shadow-sm backdrop-blur">
              <MapTrifold size={17} className="text-brand-600" />
              {activeSector?.name ?? "Sector"}
            </div>
            {!sectorTables.length ? (
              <div className="absolute inset-0 grid place-items-center p-8 text-center">
                <div>
                  <MapTrifold
                    className="mx-auto text-slate-300"
                    size={44}
                    weight="duotone"
                  />
                  <p className="mt-3 text-sm font-bold text-slate-500">
                    Este sector todavía no tiene mesas
                  </p>
                  {canManageTables ? (
                    <p className="mt-1 text-xs text-slate-400">
                      Activá “Editar plano” para agregar o mover una mesa.
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}
            {sectorTables.map((table) => {
              const occupied = Boolean(table.currentOrderId);
              const position = positions[table.id] ?? {
                x: table.layoutX,
                y: table.layoutY,
              };
              const selected = selectedTableId === table.id;
              return (
                <button
                  key={table.id}
                  type="button"
                  aria-label={`${editing ? "Editar" : occupied ? "Abrir pedido de" : "Abrir"} mesa ${table.number}`}
                  disabled={!editing && !occupied && !data.cashSession}
                  onClick={() =>
                    editing
                      ? setSelectedTableId(table.id)
                      : onActivateTable(table)
                  }
                  onPointerDown={(event) => {
                    if (!editing) return;
                    event.preventDefault();
                    const bounds = canvasRef.current?.getBoundingClientRect();
                    if (!bounds) return;
                    setSelectedTableId(table.id);
                    setDrag({
                      tableId: table.id,
                      offsetX:
                        ((event.clientX - bounds.left) / bounds.width) * 100 -
                        position.x,
                      offsetY:
                        ((event.clientY - bounds.top) / bounds.height) * 100 -
                        position.y,
                    });
                    event.currentTarget.setPointerCapture(event.pointerId);
                  }}
                  onPointerMove={(event) => {
                    if (!editing || drag?.tableId !== table.id) return;
                    const next = positionFromPointer(
                      table,
                      event.clientX,
                      event.clientY,
                      drag.offsetX,
                      drag.offsetY,
                    );
                    setPositions((current) => ({
                      ...current,
                      [table.id]: next,
                    }));
                  }}
                  onPointerUp={(event) => {
                    if (!editing || drag?.tableId !== table.id) return;
                    const next = positionFromPointer(
                      table,
                      event.clientX,
                      event.clientY,
                      drag.offsetX,
                      drag.offsetY,
                    );
                    setPositions((current) => ({
                      ...current,
                      [table.id]: next,
                    }));
                    setDrag(null);
                    persistPosition(table, next);
                  }}
                  onKeyDown={(event) => {
                    if (
                      !editing ||
                      ![
                        "ArrowLeft",
                        "ArrowRight",
                        "ArrowUp",
                        "ArrowDown",
                      ].includes(event.key)
                    )
                      return;
                    event.preventDefault();
                    const delta = event.shiftKey ? 5 : 1;
                    const next = {
                      x: clamp(
                        position.x +
                          (event.key === "ArrowLeft"
                            ? -delta
                            : event.key === "ArrowRight"
                              ? delta
                              : 0),
                        0,
                        100 - table.layoutWidth,
                      ),
                      y: clamp(
                        position.y +
                          (event.key === "ArrowUp"
                            ? -delta
                            : event.key === "ArrowDown"
                              ? delta
                              : 0),
                        0,
                        100 - table.layoutHeight,
                      ),
                    };
                    setPositions((current) => ({
                      ...current,
                      [table.id]: next,
                    }));
                    persistPosition(table, next);
                  }}
                  className={`absolute grid place-items-center border-2 px-2 text-center shadow-md transition focus:outline-none focus:ring-4 focus:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-60 ${table.shape === "ROUND" ? "rounded-full" : table.shape === "SQUARE" ? "rounded-2xl" : "rounded-xl"} ${occupied ? "border-brand-500 bg-brand-600 text-white" : "border-emerald-400 bg-white text-slate-700"} ${selected ? "ring-4 ring-amber-300" : ""} ${editing ? "cursor-grab select-none active:cursor-grabbing" : "hover:-translate-y-0.5 hover:shadow-lg"}`}
                  style={{
                    left: `${position.x}%`,
                    top: `${position.y}%`,
                    width: `${table.layoutWidth}%`,
                    height: `${table.layoutHeight}%`,
                    touchAction: "none",
                  }}
                >
                  <span className="min-w-0">
                    {editing ? (
                      <ArrowsOutCardinal
                        className="mx-auto mb-0.5 opacity-60"
                        size={13}
                      />
                    ) : null}
                    <strong className="block truncate text-sm">
                      Mesa {table.number}
                    </strong>
                    {table.name ? (
                      <span className="block truncate text-[9px] opacity-75">
                        {table.name}
                      </span>
                    ) : null}
                    <span className="block truncate text-[10px] font-bold">
                      {occupied
                        ? formatMoney(table.currentTotalMinor)
                        : "Libre"}
                    </span>
                    {occupied ? (
                      <span className="block truncate text-[8px] opacity-75">
                        {table.waiterName ?? "Sin mesero"} ·{" "}
                        {formatElapsed(table.openedAt)}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        </Card>

        {editing ? (
          <Card className="h-fit p-4">
            <h3 className="text-sm font-extrabold">Propiedades de la mesa</h3>
            {selectedTable && draft ? (
              <div className="mt-4 grid gap-3">
                <Field label="Número">
                  <Input
                    type="number"
                    min={1}
                    max={9999}
                    value={draft.number}
                    onChange={(event) =>
                      setDraft({ ...draft, number: Number(event.target.value) })
                    }
                  />
                </Field>
                <Field label="Nombre opcional">
                  <Input
                    value={draft.name ?? ""}
                    placeholder="Ej. Ventana"
                    onChange={(event) =>
                      setDraft({ ...draft, name: event.target.value })
                    }
                  />
                </Field>
                <Field label="Sector">
                  <Select
                    value={draft.sectorId}
                    onChange={(event) =>
                      setDraft({ ...draft, sectorId: event.target.value })
                    }
                  >
                    {sectors.map((sector) => (
                      <option key={sector.id} value={sector.id}>
                        {sector.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Forma">
                  <Select
                    value={draft.shape}
                    onChange={(event) => {
                      const shape = event.target
                        .value as RestaurantTableDto["shape"];
                      setDraft({
                        ...draft,
                        shape,
                        layoutWidth: shape === "RECTANGLE" ? 22 : 14,
                        layoutHeight: shape === "RECTANGLE" ? 14 : 17,
                      });
                    }}
                  >
                    {Object.entries(shapeLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Ancho %">
                    <Input
                      type="number"
                      min={6}
                      max={40}
                      value={draft.layoutWidth}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          layoutWidth: Number(event.target.value),
                        })
                      }
                    />
                  </Field>
                  <Field label="Alto %">
                    <Input
                      type="number"
                      min={8}
                      max={40}
                      value={draft.layoutHeight}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          layoutHeight: Number(event.target.value),
                        })
                      }
                    />
                  </Field>
                </div>
                <Button
                  type="button"
                  onClick={saveDraft}
                  disabled={updateTable.isPending}
                >
                  <FloppyDisk size={16} /> Guardar mesa
                </Button>
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-dashed border-slate-200 p-5 text-center text-xs text-slate-400">
                Seleccioná una mesa del plano para editarla.
              </div>
            )}
            <div className="mt-4 border-t border-slate-100 pt-3 text-[10px] text-slate-400">
              <Badge tone="green">Libre</Badge> se puede abrir ·{" "}
              <Badge tone="orange">Ocupada</Badge> conserva su pedido mientras
              la movés.
            </div>
          </Card>
        ) : null}
      </div>

      <Modal
        open={Boolean(sectorDialog)}
        onClose={() => setSectorDialog(null)}
        title={
          sectorDialog?.mode === "RENAME" ? "Renombrar sector" : "Crear sector"
        }
        description="Cada sector aparece como una subpestaña independiente dentro del plano."
      >
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (sectorDialog?.mode === "RENAME")
              renameSector.mutate({
                sectorId: sectorDialog.sector.id,
                name: sectorName,
              });
            else createSector.mutate({ name: sectorName });
          }}
        >
          <Field label="Nombre del sector">
            <Input
              autoFocus
              value={sectorName}
              onChange={(event) => setSectorName(event.target.value)}
              placeholder="Ej. Terraza"
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setSectorDialog(null)}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={
                sectorName.trim().length < 2 ||
                createSector.isPending ||
                renameSector.isPending
              }
            >
              Guardar
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={addTableOpen}
        onClose={() => setAddTableOpen(false)}
        title={`Agregar mesa a ${activeSector?.name ?? "sector"}`}
        description="La mesa quedará disponible también en la vista clásica y en carga rápida."
      >
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const number = Number(newTableNumber);
            if (Number.isInteger(number) && number > 0 && activeSectorId)
              createTable.mutate({ number, sectorId: activeSectorId });
          }}
        >
          <Field label="Número de mesa">
            <Input
              autoFocus
              type="number"
              min={1}
              max={9999}
              value={newTableNumber}
              onChange={(event) => setNewTableNumber(event.target.value)}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setAddTableOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={!newTableNumber || createTable.isPending}
            >
              Agregar mesa
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(deletingSector)}
        onClose={() => setDeletingSector(null)}
        title={`Eliminar sector ${deletingSector?.name ?? ""}`}
        description="Las mesas no se eliminan: pasarán automáticamente al primer sector disponible."
      >
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setDeletingSector(null)}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={() =>
              deletingSector &&
              deleteSector.mutate({ sectorId: deletingSector.id })
            }
            disabled={deleteSector.isPending}
          >
            Eliminar sector
          </Button>
        </div>
      </Modal>
    </div>
  );
}
