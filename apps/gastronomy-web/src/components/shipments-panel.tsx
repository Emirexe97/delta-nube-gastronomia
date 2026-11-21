import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { BootstrapDto, DeliveryShipmentDto } from "@gastronomy/contracts";
import { Button, Card, Field, Input, Modal, Select } from "@gastronomy/ui";
import { useApiMutation } from "../api";
import type { DeliveryHistoryScope } from "../delivery-history";
import {
  formatMoney,
  humanError,
  moneyInputValue,
  parsePriceInput,
  statusLabels,
} from "../lib";

export function ShipmentsPanel({
  data,
  scope,
  date,
  driverFilter,
}: {
  data: BootstrapDto;
  scope: DeliveryHistoryScope;
  date: string;
  driverFilter: string;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<DeliveryShipmentDto | null>(null);
  const [driver, setDriver] = useState("");
  const [remuneration, setRemuneration] = useState("");
  const shipments = useQuery({
    queryKey: [
      "bootstrap",
      "delivery-shipments",
      scope,
      date,
      driverFilter,
      query,
      page,
      data.cashSession?.id,
    ],
    queryFn: () =>
      window.gastronomy.getDeliveryShipments({
        scope: scope === "CURRENT_SHIFT" ? "OPERATIONAL" : scope,
        businessDate: scope === "DATE" ? date : undefined,
        driverUserId: driverFilter,
        query,
        page,
        pageSize: 12,
      }),
    networkMode: "always",
  });
  const assign = useApiMutation(
    (input: Parameters<typeof window.gastronomy.assignDeliveryDriver>[0]) =>
      window.gastronomy.assignDeliveryDriver(input),
    { onSuccess: () => setEditing(null) },
  );
  const parsed = remuneration.trim() ? parsePriceInput(remuneration) : null;
  const drivers = data.users.filter(
    (u) => u.active && u.roleCode === "DELIVERY_DRIVER",
  );
  function edit(row: DeliveryShipmentDto) {
    assign.reset();
    setEditing(row);
    setDriver(row.driverUserId ?? "");
    setRemuneration(
      row.agreedRemunerationMinor == null
        ? ""
        : moneyInputValue(row.agreedRemunerationMinor),
    );
  }
  const result = shipments.data;
  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h3 className="text-sm font-bold">Pedidos con envío</h3>
        <Field label="Buscar envío">
          <Input
            value={query}
            placeholder="Nº de pedido, cliente o repartidor"
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
          />
        </Field>
      </div>
      {shipments.isError ? (
        <p role="alert">
          {humanError(shipments.error)}{" "}
          <Button variant="secondary" onClick={() => void shipments.refetch()}>
            Reintentar
          </Button>
        </p>
      ) : !result ? (
        <p role="status">Cargando envíos…</p>
      ) : !result.items.length ? (
        <p className="text-sm text-slate-600">
          No hay pedidos con envío para estos filtros.
        </p>
      ) : (
        <div className="max-h-80 overflow-auto rounded-lg border border-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-slate-100 text-xs text-slate-700">
              <tr>
                {[
                  "Pedido",
                  "Cliente y repartidor",
                  "Estado",
                  "Envío al cliente",
                  "Pago al repartidor",
                  "Rendición",
                  "",
                ].map((label) => (
                  <th key={label} className="p-2">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.items.map((row) => (
                <tr key={row.orderId} className="border-t border-slate-100">
                  <td className="p-2 font-bold">
                    #{row.orderNumber}
                    <small className="block font-normal text-slate-600">
                      {row.businessDate}
                    </small>
                  </td>
                  <td className="p-2">
                    {row.customerName ?? "Sin cliente"}
                    <small className="block text-slate-600">
                      {row.driverName ?? "Sin asignar"}
                    </small>
                  </td>
                  <td className="p-2">
                    {row.lifecycleStatus === "DRAFT"
                      ? "Borrador"
                      : statusLabels[row.operationalStatus]}
                  </td>
                  <td className="p-2 tabular-nums">
                    {formatMoney(row.customerChargeMinor)}
                  </td>
                  <td className="p-2 tabular-nums">
                    {formatMoney(row.driverRemunerationMinor ?? 0)}
                  </td>
                  <td className="p-2">
                    {row.status === "NO_SETTLEMENT"
                      ? "Sin rendición"
                      : row.status === "SETTLED"
                        ? "Liquidada"
                        : row.direction === "BUSINESS_OWES_DRIVER"
                          ? "A pagar"
                          : "A rendir"}
                    {row.status === "PENDING" && (
                      <strong className="block">
                        {formatMoney(
                          row.amountDueMinor - row.settledAmountMinor,
                        )}
                      </strong>
                    )}
                  </td>
                  <td className="p-2">
                    {data.cashSession &&
                      row.cashSessionId === data.cashSession.id &&
                      !["CANCELLED", "DELIVERED"].includes(
                        row.operationalStatus,
                      ) && (
                        <Button variant="secondary" onClick={() => edit(row)}>
                          Asignar
                        </Button>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {result && result.totalCount > 0 && (
        <div className="flex items-center justify-end gap-3 text-xs">
          <span>
            {result.totalCount} envíos · Página {result.page} de{" "}
            {Math.max(1, result.pageCount)}
          </span>
          <Button
            variant="secondary"
            disabled={result.page <= 1}
            onClick={() => setPage(result.page - 1)}
          >
            Anterior
          </Button>
          <Button
            variant="secondary"
            disabled={!result.hasNextPage}
            onClick={() => setPage(result.page + 1)}
          >
            Siguiente
          </Button>
        </div>
      )}
      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title="Asignar envío"
      >
        {editing && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (remuneration.trim() && parsed === null) return;
              assign.mutate({
                orderId: editing.orderId,
                driverUserId: driver || null,
                driverRemunerationMinor: parsed,
              });
            }}
          >
            <p>
              Pedido #{editing.orderNumber} ·{" "}
              {editing.customerName ?? "Sin cliente"}
            </p>
            <Field label="Repartidor">
              <Select
                value={driver}
                onChange={(e) => setDriver(e.target.value)}
              >
                <option value="">Sin asignar</option>
                {drivers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Pago acordado al repartidor ($)"
              hint="Dejá el importe vacío para aplicar la tarifa configurada. Podés ingresar 0."
            >
              <Input
                inputMode="decimal"
                value={remuneration}
                disabled={editing.paymentStatus !== "UNPAID"}
                placeholder="Tarifa configurada"
                onChange={(e) => setRemuneration(e.target.value)}
              />
            </Field>
            {assign.isError && (
              <p role="alert" className="text-sm text-rose-700">
                {humanError(assign.error)}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setEditing(null)}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={
                  assign.isPending ||
                  (Boolean(remuneration.trim()) && parsed === null)
                }
              >
                Guardar
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </Card>
  );
}
