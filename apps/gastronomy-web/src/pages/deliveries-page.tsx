import { useEffect, useMemo, useState } from "react";
import type { BootstrapDto, DeliveryLedgerDto } from "@gastronomy/contracts";
import {
  ArrowLeft,
  CheckCircle,
  Clock,
  Motorcycle,
  Plus,
  Receipt,
  WarningCircle,
  Wallet,
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
import { formatMoney, humanError } from "../lib";

const formatDateTime = (value: string | null) =>
  value
    ? new Date(value).toLocaleString("es-AR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

export function DeliveriesPage({ data }: { data: BootstrapDto }) {
  const [driverOpen, setDriverOpen] = useState(false);
  const [settleOpen, setSettleOpen] = useState(false);
  const [driverFilter, setDriverFilter] = useState("ALL");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const drivers = data.users.filter(
    (user) => user.roleCode === "DELIVERY_DRIVER" && user.active,
  );
  const ledger =
    driverFilter === "ALL"
      ? data.deliveryLedger
      : data.deliveryLedger.filter((row) => row.driverUserId === driverFilter);
  const activity =
    driverFilter === "ALL"
      ? data.driverDeliveryActivity
      : data.driverDeliveryActivity.filter(
          (row) => row.driverUserId === driverFilter,
        );
  const pending = ledger.filter((row) => row.status === "PENDING");
  const selectedRows = ledger.filter(
    (row) => row.status === "PENDING" && selectedIds.includes(row.id),
  );

  useEffect(() => {
    setSelectedIds([]);
    setSettleOpen(false);
  }, [driverFilter]);

  useEffect(() => {
    const valid = new Set(
      data.deliveryLedger
        .filter(
          (row) =>
            row.status === "PENDING" &&
            (driverFilter === "ALL" || row.driverUserId === driverFilter),
        )
        .map((row) => row.id),
    );
    setSelectedIds((current) => current.filter((id) => valid.has(id)));
  }, [data.deliveryLedger, driverFilter]);

  const totals = useMemo(() => {
    const result = activity.reduce(
      (summary, row) => {
        summary.earnings += row.earningsMinor;
        summary.deliveries += row.deliveryCount;
        return summary;
      },
      { earnings: 0, deliveries: 0 },
    );
    return pending.reduce(
      (summary, row) => {
        summary[row.direction] += row.amountDueMinor;
        return summary;
      },
      {
        ...result,
        DRIVER_OWES_BUSINESS: 0,
        BUSINESS_OWES_DRIVER: 0,
      },
    );
  }, [activity, pending]);
  const driverRows = useMemo(
    () =>
      drivers.map((driver) => {
        const activityRow = data.driverDeliveryActivity.find(
          (row) => row.driverUserId === driver.id,
        );
        const rows = data.deliveryLedger.filter(
          (row) => row.driverUserId === driver.id,
        );
        const lastSettlement = rows
          .filter((row) => row.settledAt)
          .sort((left, right) =>
            right.settledAt!.localeCompare(left.settledAt!),
          )[0]?.settledAt;
        return {
          driver,
          deliveries: activityRow?.deliveryCount ?? 0,
          earnings: activityRow?.earningsMinor ?? 0,
          pendingCount: rows.filter((row) => row.status === "PENDING").length,
          pendingAmount: rows
            .filter((row) => row.status === "PENDING")
            .reduce((sum, row) => sum + row.amountDueMinor, 0),
          lastDelivery: activityRow?.lastDeliveryAt ?? null,
          lastSettlement: lastSettlement ?? null,
        };
      }),
    [data.deliveryLedger, data.driverDeliveryActivity, drivers],
  );

  const allVisibleSelected =
    pending.length > 0 && pending.every((row) => selectedIds.includes(row.id));
  const toggleAllVisible = () =>
    setSelectedIds(allVisibleSelected ? [] : pending.map((row) => row.id));

  return (
    <div className="panel-enter mx-auto max-w-[1450px] space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold">Repartidores y rendiciones</h2>
          <p className="text-xs text-slate-400">
            Actividad, ganancias y movimientos que caja debe conciliar
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setDriverOpen(true)}>
            <Plus size={17} /> Nuevo repartidor
          </Button>
          <Button
            onClick={() => setSettleOpen(true)}
            disabled={!data.cashSession || selectedRows.length === 0}
            title={
              !data.cashSession
                ? "Abrí caja para registrar la liquidación"
                : selectedRows.length === 0
                  ? "Seleccioná movimientos de un repartidor"
                  : undefined
            }
          >
            <Wallet size={17} /> Liquidar seleccionados ({selectedRows.length})
          </Button>
        </div>
      </div>

      {!data.cashSession ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800">
          Abrí caja antes de liquidar. Podés consultar todo el historial sin
          modificarlo.
        </div>
      ) : null}

      <Card className="p-3">
        <Field
          label="Repartidor"
          hint="Las liquidaciones se preparan de a un repartidor para evitar mezclas."
        >
          <Select
            value={driverFilter}
            onChange={(event) => setDriverFilter(event.target.value)}
          >
            <option value="ALL">Resumen de todos los repartidores</option>
            {drivers.map((driver) => (
              <option key={driver.id} value={driver.id}>
                {driver.fullName}
              </option>
            ))}
          </Select>
        </Field>
      </Card>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={<Motorcycle size={24} />}
          label="Envíos registrados"
          value={String(totals.deliveries)}
          tone="brand"
        />
        <MetricCard
          icon={<Receipt size={24} />}
          label="Ganancia de repartidores"
          value={formatMoney(totals.earnings)}
          tone="amber"
        />
        <MetricCard
          icon={<Wallet size={24} />}
          label="A rendir al negocio"
          value={formatMoney(totals.DRIVER_OWES_BUSINESS)}
          tone="green"
        />
        <MetricCard
          icon={<Wallet size={24} />}
          label="A pagar al repartidor"
          value={formatMoney(totals.BUSINESS_OWES_DRIVER)}
          tone="blue"
        />
      </section>

      <Card className="overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-3">
          <h3 className="text-sm font-bold">Resumen por repartidor</h3>
          <p className="text-[10px] text-slate-400">
            Elegí una fila para revisar y seleccionar sus movimientos
            pendientes.
          </p>
        </div>
        <div className="overflow-auto">
          <table className="dn-table min-w-[640px]">
            <thead>
              <tr>
                <th>Repartidor</th>
                <th className="text-right">Envíos</th>
                <th className="text-right">Ganancia</th>
                <th className="text-right">Pendientes</th>
                <th>Último envío</th>
                <th>Última rendición</th>
              </tr>
            </thead>
            <tbody>
              {driverRows.map((row) => (
                <tr
                  key={row.driver.id}
                  className="cursor-pointer"
                  tabIndex={0}
                  onClick={() => setDriverFilter(row.driver.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") setDriverFilter(row.driver.id);
                  }}
                >
                  <td className="font-bold text-slate-900">
                    {row.driver.fullName}
                  </td>
                  <td className="text-right font-extrabold">
                    {row.deliveries}
                  </td>
                  <td className="text-right font-extrabold text-brand-700">
                    {formatMoney(row.earnings)}
                  </td>
                  <td className="text-right">
                    <Badge tone={row.pendingCount ? "amber" : "green"}>
                      {row.pendingCount
                        ? `${row.pendingCount} · ${formatMoney(row.pendingAmount)}`
                        : "Al día"}
                    </Badge>
                  </td>
                  <td>{formatDateTime(row.lastDelivery)}</td>
                  <td>{formatDateTime(row.lastSettlement)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!driverRows.length ? (
            <div className="grid h-32 place-items-center text-xs text-slate-400">
              Todavía no hay repartidores cargados.
            </div>
          ) : null}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div>
            <h3 className="text-sm font-bold">
              Detalle de envíos y rendiciones
            </h3>
            <p className="text-[10px] text-slate-400">
              La ganancia es el costo de envío; el importe a rendir lo excluye.
            </p>
          </div>
          {driverFilter !== "ALL" && pending.length ? (
            <Button variant="secondary" onClick={toggleAllVisible}>
              {allVisibleSelected
                ? "Quitar selección"
                : `Seleccionar ${pending.length} pendiente(s)`}
            </Button>
          ) : driverFilter === "ALL" ? (
            <span className="rounded-lg bg-slate-100 px-3 py-2 text-[11px] font-semibold text-slate-500">
              Elegí un repartidor para preparar una liquidación
            </span>
          ) : null}
        </div>
        {ledger.length ? (
          <div className="max-h-[460px] overflow-auto">
            <table className="dn-table min-w-[640px]">
              <thead>
                <tr>
                  {driverFilter !== "ALL" ? <th>Elegir</th> : null}
                  <th>Pedido</th>
                  <th>Repartidor</th>
                  <th>Entrega registrada</th>
                  <th className="text-right">Ganancia</th>
                  <th>Movimiento de caja</th>
                  <th>Rendido</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((row) => (
                  <tr key={row.id}>
                    {driverFilter !== "ALL" ? (
                      <td>
                        {row.status === "PENDING" ? (
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-brand-600"
                            aria-label={`Seleccionar movimiento del pedido ${row.orderNumber}`}
                            checked={selectedIds.includes(row.id)}
                            onChange={() =>
                              setSelectedIds((current) =>
                                current.includes(row.id)
                                  ? current.filter((id) => id !== row.id)
                                  : [...current, row.id],
                              )
                            }
                          />
                        ) : null}
                      </td>
                    ) : null}
                    <td className="font-extrabold text-slate-900">
                      #{row.orderNumber}
                    </td>
                    <td className="font-semibold">{row.driverName}</td>
                    <td>
                      <span className="inline-flex items-center gap-1">
                        <Clock size={13} /> {formatDateTime(row.createdAt)}
                      </span>
                    </td>
                    <td className="text-right font-extrabold text-brand-700">
                      {formatMoney(row.deliveryFeeMinor)}
                    </td>
                    <td>
                      <span className="block">
                        {row.direction === "DRIVER_OWES_BUSINESS"
                          ? "Rinde al negocio"
                          : "Negocio paga envío"}
                      </span>
                      <strong className="text-xs">
                        {formatMoney(row.amountDueMinor)}
                      </strong>
                    </td>
                    <td>{formatDateTime(row.settledAt)}</td>
                    <td>
                      <Badge
                        tone={row.status === "SETTLED" ? "green" : "amber"}
                      >
                        {row.status === "SETTLED" ? "Liquidado" : "Pendiente"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="grid h-56 place-items-center text-center">
            <div>
              <CheckCircle className="mx-auto text-emerald-400" size={36} />
              <p className="mt-2 text-sm font-semibold text-slate-500">
                No hay envíos para esta selección
              </p>
            </div>
          </div>
        )}
      </Card>

      <DriverModal open={driverOpen} onClose={() => setDriverOpen(false)} />
      <SettlementModal
        open={settleOpen}
        rows={selectedRows}
        onClose={() => setSettleOpen(false)}
      />
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
    <Card className="p-4">
      <div
        className={`grid h-10 w-10 place-items-center rounded-xl ${tones[tone]}`}
      >
        {icon}
      </div>
      <p className="mt-3 text-[10px] font-bold uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p className="text-2xl font-extrabold">{value}</p>
    </Card>
  );
}

function DriverModal({ open, onClose }: { open: boolean; onClose(): void }) {
  const [name, setName] = useState("");
  const [authorizerPin, setAuthorizerPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mutation = useApiMutation(
    (input: Parameters<typeof window.gastronomy.createDriver>[0]) =>
      window.gastronomy.createDriver(input),
    {
      onSuccess: () => {
        setName("");
        setAuthorizerPin("");
        onClose();
      },
      onError: (value) => setError(humanError(value)),
    },
  );
  const close = () => {
    if (!mutation.isPending) onClose();
  };
  return (
    <Modal
      open={open}
      onClose={close}
      title="Nuevo repartidor"
      description="Se crea sólo para asignar envíos y calcular rendiciones; no tendrá usuario, pantalla ni PIN propios."
    >
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate({ fullName: name, authorizerPin });
        }}
      >
        <Field label="Nombre completo">
          <Input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Juan Pérez"
          />
        </Field>
        <Field label="PIN de autorización del responsable">
          <Input
            type="password"
            inputMode="numeric"
            maxLength={8}
            value={authorizerPin}
            onChange={(event) =>
              setAuthorizerPin(event.target.value.replace(/\D/g, ""))
            }
          />
        </Field>
        {error ? (
          <p className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={close}>
            Cancelar
          </Button>
          <Button
            type="submit"
            disabled={
              !name.trim() || authorizerPin.length < 4 || mutation.isPending
            }
          >
            Crear repartidor
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function SettlementModal({
  open,
  rows,
  onClose,
}: {
  open: boolean;
  rows: DeliveryLedgerDto[];
  onClose(): void;
}) {
  const [reason, setReason] = useState("Cierre de turno");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const driverOwes = rows
    .filter((row) => row.direction === "DRIVER_OWES_BUSINESS")
    .reduce((sum, row) => sum + row.amountDueMinor, 0);
  const businessOwes = rows
    .filter((row) => row.direction === "BUSINESS_OWES_DRIVER")
    .reduce((sum, row) => sum + row.amountDueMinor, 0);
  const net = driverOwes - businessOwes;
  const mutation = useApiMutation(
    (input: Parameters<typeof window.gastronomy.settleDelivery>[0]) =>
      window.gastronomy.settleDelivery(input),
    {
      onSuccess: () => {
        setPin("");
        setReviewing(false);
        onClose();
      },
      onError: (value) => {
        setReviewing(false);
        setError(humanError(value));
      },
    },
  );

  const rowKey = rows.map((row) => row.id).join("|");
  useEffect(() => {
    if (!open) return;
    setReason("Cierre de turno");
    setPin("");
    setError(null);
    setReviewing(false);
  }, [open, rowKey]);

  const close = () => {
    if (!mutation.isPending) onClose();
  };
  const confirm = () =>
    mutation.mutate({
      ledgerIds: rows.map((row) => row.id),
      reason: reason.trim(),
      authorizerPin: pin,
    });

  return (
    <Modal
      open={open}
      onClose={close}
      title={reviewing ? "Confirmar liquidación" : "Revisar rendición"}
      description={`${rows.length} movimiento(s) de ${rows[0]?.driverName ?? "un repartidor"}`}
    >
      {reviewing ? (
        <div className="grid gap-4">
          <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <WarningCircle size={22} className="shrink-0 text-amber-700" />
            <p className="text-xs leading-5 text-amber-900">
              Se crearán movimientos de caja y estas filas quedarán liquidadas.
              Verificá repartidor, importes y sentido antes de confirmar.
            </p>
          </div>
          <SettlementSummary
            driverOwes={driverOwes}
            businessOwes={businessOwes}
            net={net}
          />
          <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
            <strong>Motivo:</strong> {reason.trim()}
          </p>
          {error ? (
            <p className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setReviewing(false)}
            >
              <ArrowLeft /> Volver a revisar
            </Button>
            <Button disabled={mutation.isPending} onClick={confirm}>
              <CheckCircle />
              {mutation.isPending ? "Liquidando…" : "Confirmar liquidación"}
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (rows.length && reason.trim() && pin.length >= 4)
              setReviewing(true);
          }}
        >
          <SettlementSummary
            driverOwes={driverOwes}
            businessOwes={businessOwes}
            net={net}
          />
          <div className="max-h-52 overflow-auto rounded-xl border border-slate-200">
            <table className="dn-table min-w-[640px]">
              <thead>
                <tr>
                  <th>Pedido</th>
                  <th>Movimiento</th>
                  <th className="text-right">Importe</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="font-bold">#{row.orderNumber}</td>
                    <td>
                      {row.direction === "DRIVER_OWES_BUSINESS"
                        ? "Ingresa a caja"
                        : "Sale de caja"}
                    </td>
                    <td className="text-right font-bold">
                      {formatMoney(row.amountDueMinor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Field label="Motivo">
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <Field label="PIN de autorización">
            <Input
              autoFocus
              type="password"
              inputMode="numeric"
              maxLength={8}
              value={pin}
              onChange={(event) =>
                setPin(event.target.value.replace(/\D/g, ""))
              }
            />
          </Field>
          {error ? (
            <p className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={close}>
              Volver
            </Button>
            <Button
              type="submit"
              disabled={
                !rows.length ||
                !reason.trim() ||
                pin.length < 4 ||
                mutation.isPending
              }
            >
              Revisar liquidación
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function SettlementSummary({
  driverOwes,
  businessOwes,
  net,
}: {
  driverOwes: number;
  businessOwes: number;
  net: number;
}) {
  return (
    <div className="grid gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 sm:grid-cols-3">
      <div className="bg-white p-3">
        <p className="text-[10px] font-bold uppercase text-slate-400">
          Ingresa a caja
        </p>
        <p className="text-lg font-extrabold text-emerald-700">
          {formatMoney(driverOwes)}
        </p>
      </div>
      <div className="bg-white p-3">
        <p className="text-[10px] font-bold uppercase text-slate-400">
          Sale de caja
        </p>
        <p className="text-lg font-extrabold text-rose-700">
          {formatMoney(businessOwes)}
        </p>
      </div>
      <div className="bg-slate-950 p-3 text-white">
        <p className="text-[10px] font-bold uppercase text-slate-400">
          Efecto neto
        </p>
        <p className="text-lg font-extrabold">
          {net >= 0 ? "+" : "−"}
          {formatMoney(Math.abs(net))}
        </p>
      </div>
    </div>
  );
}
