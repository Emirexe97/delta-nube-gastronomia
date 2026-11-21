import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
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
import { ShipmentsPanel } from "../components/shipments-panel";
import { useApiMutation } from "../api";
import {
  filterDeliveryLedger,
  filterDriverDeliveryActivity,
  localDateKey,
  visibleDeliveryRange,
  type DeliveryHistoryScope,
} from "../delivery-history";
import { formatMoney, humanError } from "../lib";

const formatDateTime = (value: string | null) =>
  value
    ? movementDateFormatter.format(new Date(value))
    : "—";

const movementDateFormatter = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
});

export function DeliveriesPage({ data }: { data: BootstrapDto }) {
  const [params] = useSearchParams();
  const dateParam = params.get("fecha") ?? "";
  const linkedDate = /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : null;
  const [driverOpen, setDriverOpen] = useState(false);
  const [settleOpen, setSettleOpen] = useState(false);
  const [reversingRow, setReversingRow] = useState<DeliveryLedgerDto | null>(
    null,
  );
  const [driverFilter, setDriverFilter] = useState(params.get("repartidor") || "ALL");
  const [historyScope, setHistoryScope] =
    useState<DeliveryHistoryScope>(linkedDate ? "DATE" : "CURRENT_SHIFT");
  const [selectedDate, setSelectedDate] = useState(() =>
    linkedDate ?? localDateKey(new Date()),
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const historyQuery = useQuery({
    queryKey: ["bootstrap", "delivery-history", historyScope, ...(historyScope === "DATE" ? [selectedDate] : [])],
    queryFn: () => window.gastronomy.getDeliveryHistory({
      scope: historyScope as "ALL" | "DATE",
      ...(historyScope === "DATE" ? { date: selectedDate } : {}),
    }),
    enabled: historyScope !== "CURRENT_SHIFT",
    networkMode: "always",
  });
  const sourceLedger = historyScope === "CURRENT_SHIFT"
    ? data.deliveryLedger
    : historyQuery.data?.deliveryLedger ?? [];
  const sourceActivity = historyScope === "CURRENT_SHIFT"
    ? data.driverDeliveryActivity
    : historyQuery.data?.driverDeliveryActivity ?? [];
  const drivers = useMemo(
    () => data.users.filter(
      (user) => user.roleCode === "DELIVERY_DRIVER" && user.active,
    ),
    [data.users],
  );
  const scopedLedger = useMemo(
    () =>
      filterDeliveryLedger(
        sourceLedger,
        data.cashSession,
        historyScope,
        selectedDate,
      ),
    [sourceLedger, data.cashSession, historyScope, selectedDate],
  );
  const scopedActivity = useMemo(
    () =>
      filterDriverDeliveryActivity(
        sourceActivity,
        data.cashSession,
        historyScope,
        selectedDate,
      ),
    [sourceActivity, data.cashSession, historyScope, selectedDate],
  );
  const ledger = useMemo(() =>
    driverFilter === "ALL"
      ? scopedLedger
      : scopedLedger.filter((row) => row.driverUserId === driverFilter), [driverFilter, scopedLedger]);
  const activity = useMemo(() =>
    driverFilter === "ALL"
      ? scopedActivity
      : scopedActivity.filter((row) => row.driverUserId === driverFilter), [driverFilter, scopedActivity]);
  const pending = useMemo(() => ledger.filter((row) => row.status === "PENDING"), [ledger]);
  const settled = useMemo(() => ledger.filter((row) => row.status === "SETTLED"), [ledger]);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedRows = useMemo(() => pending.filter(row => selectedIdSet.has(row.id)), [pending, selectedIdSet]);

  useEffect(() => {
    setSelectedIds([]);
    setSettleOpen(false);
    if (ledgerScroll.current) ledgerScroll.current.scrollTop = 0;
    setLedgerScrollTop(0);
  }, [driverFilter, historyScope, selectedDate]);

  useEffect(() => {
    const valid = new Set(
      scopedLedger
        .filter(
          (row) =>
            row.status === "PENDING" &&
            (driverFilter === "ALL" || row.driverUserId === driverFilter),
        )
        .map((row) => row.id),
    );
    setSelectedIds((current) => {
      const next = current.filter((id) => valid.has(id));
      return next.length === current.length ? current : next;
    });
  }, [scopedLedger, driverFilter]);

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
  const driverRows = useMemo(() => {
    const byDriver = new Map<string, {
      deliveries: number; earnings: number; pendingCount: number;
      pendingAmount: number; lastDelivery: string | null; lastSettlement: string | null;
    }>();
    for (const driver of drivers) byDriver.set(driver.id, {
      deliveries: 0, earnings: 0, pendingCount: 0, pendingAmount: 0,
      lastDelivery: null, lastSettlement: null,
    });
    for (const row of scopedActivity) {
      const summary = byDriver.get(row.driverUserId);
      if (!summary) continue;
      summary.deliveries += row.deliveryCount;
      summary.earnings += row.earningsMinor;
      if (!summary.lastDelivery || row.lastDeliveryAt > summary.lastDelivery)
        summary.lastDelivery = row.lastDeliveryAt;
    }
    for (const row of scopedLedger) {
      const summary = byDriver.get(row.driverUserId);
      if (!summary) continue;
      if (row.status === "PENDING") {
        summary.pendingCount += 1;
        summary.pendingAmount += row.amountDueMinor;
      }
      if (row.settledAt && (!summary.lastSettlement || row.settledAt > summary.lastSettlement))
        summary.lastSettlement = row.settledAt;
    }
    return drivers.map((driver) => ({ driver, ...byDriver.get(driver.id)! }));
  }, [scopedActivity, scopedLedger, drivers]);

  const allVisibleSelected =
    pending.length > 0 && selectedRows.length === pending.length;
  const toggleAllVisible = () =>
    setSelectedIds(allVisibleSelected ? [] : pending.map((row) => row.id));
  const selectedDirections = useMemo(() => new Set(selectedRows.map((row) => row.direction)), [selectedRows]);
  const settlementActionLabel =
    selectedDirections.size === 1 &&
    selectedDirections.has("BUSINESS_OWES_DRIVER")
      ? "Pagar envío(s) al repartidor"
      : selectedDirections.size === 1 &&
          selectedDirections.has("DRIVER_OWES_BUSINESS")
        ? "Registrar rendición del repartidor"
        : "Liquidar movimientos seleccionados";
  const alreadySettled = useMemo(() => settled.reduce(
    (sum, row) => sum + row.amountDueMinor,
    0,
  ), [settled]);
  const ledgerScroll = useRef<HTMLDivElement>(null);
  const [ledgerScrollTop, setLedgerScrollTop] = useState(0);
  const ledgerRange = visibleDeliveryRange(ledger.length, ledgerScrollTop, 460);
  const visibleLedger = ledger.slice(ledgerRange.start, ledgerRange.end);
  const orderById = useMemo(() => new Map(data.orders.map((order) => [order.id, order])), [data.orders]);
  return (
    <div className="panel-enter mx-auto max-w-[1450px] space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold">Repartidores y rendiciones</h2>
          <p className="text-xs text-slate-600">
            Consultá las ganancias y los saldos pendientes de cada repartidor.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
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
                  ? "Seleccioná movimientos para liquidar"
                  : undefined
            }
          >
            <Wallet size={17} /> {settlementActionLabel} ({selectedRows.length})
          </Button>
        </div>
      </div>

      {!data.cashSession ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800">
          Abrí caja antes de liquidar. Podés consultar todo el historial sin
          modificarlo.
        </div>
      ) : null}

      {historyScope !== "CURRENT_SHIFT" && historyQuery.isPending ? (
        <div role="status" className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">Cargando historial de repartidores…</div>
      ) : null}
      {historyScope !== "CURRENT_SHIFT" && historyQuery.isError ? (
        <div role="alert" className="flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          No se pudo cargar el historial.
          <Button variant="secondary" onClick={() => void historyQuery.refetch()}>Reintentar</Button>
        </div>
      ) : null}

      <Card className="grid gap-3 p-3 md:grid-cols-3">
        <Field label="Período" hint="Por defecto se limita a la caja abierta.">
          <Select
            value={historyScope}
            onChange={(event) =>
              setHistoryScope(event.target.value as DeliveryHistoryScope)
            }
          >
            <option value="CURRENT_SHIFT">Turno actual</option>
            <option value="DATE">Otro día</option>
            <option value="ALL">Historial completo</option>
          </Select>
        </Field>
        {historyScope === "DATE" ? (
          <Field label="Día">
            <Input
              type="date"
              value={selectedDate}
              onChange={(event) => setSelectedDate(event.target.value)}
            />
          </Field>
        ) : (
          <div className="hidden md:block" />
        )}
        <Field
          label="Repartidor"
          hint="Filtrá por repartidor o liquidá movimientos de todos."
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

      {historyScope === "CURRENT_SHIFT" && data.cashSession && sourceLedger.some(row => row.cashSessionId !== data.cashSession?.id && row.status === "PENDING") && (
        <Button variant="secondary" onClick={() => setHistoryScope("ALL")}>Ver rendiciones pendientes de turnos anteriores</Button>
      )}
      <ShipmentsPanel key={JSON.stringify([historyScope,selectedDate,driverFilter])} data={data} scope={historyScope} date={selectedDate} driverFilter={driverFilter} />

      {historyScope === "CURRENT_SHIFT" || historyQuery.data ? <>
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
          label="Pendiente: repartidor rinde al negocio"
          value={formatMoney(totals.DRIVER_OWES_BUSINESS)}
          tone="green"
        />
        <MetricCard
          icon={<Wallet size={24} />}
          label="Pendiente: negocio paga al repartidor"
          value={formatMoney(totals.BUSINESS_OWES_DRIVER)}
          tone="blue"
        />
        <MetricCard
          icon={<CheckCircle size={24} />}
          label="Ya liquidado en el período"
          value={formatMoney(alreadySettled)}
          tone="green"
        />
      </section>
      <p className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs leading-5 text-sky-950">
        <strong>Ganancia y saldo pendiente son conceptos distintos.</strong> La
        ganancia suma los envíos registrados; el pendiente indica cuánto debe
        rendir el repartidor al negocio o cuánto debe pagarle el negocio. Si el
        repartidor cobró el pedido al cliente, puede retener el importe del
        envío y rendir solo el resto. Lo que rinde al negocio no es
        necesariamente su ganancia ni coincide con el total liquidado.
      </p>

      <Card className="overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-3">
          <h3 className="text-sm font-bold">Resumen por repartidor</h3>
          <p className="text-xs text-slate-600">
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
            <div className="grid h-32 place-items-center text-xs text-slate-600">
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
            <p className="text-xs text-slate-600">
              La ganancia incluye el envío cuando corresponde al repartidor; si
              el negocio lo retiene, el repartidor rinde el cobro completo.
            </p>
          </div>
          {pending.length ? (
            <Button variant="secondary" onClick={toggleAllVisible}>
              {allVisibleSelected
                ? "Quitar selección"
                : `Seleccionar ${pending.length} pendiente(s)`}
            </Button>
          ) : null}
        </div>
        {ledger.length ? (
          <div ref={ledgerScroll} className="max-h-[460px] overflow-auto" onScroll={(event) => setLedgerScrollTop(event.currentTarget.scrollTop)}>
            <table className="dn-table min-w-[760px]" aria-rowcount={ledger.length + 1}>
              <thead>
                <tr>
                  <th>Elegir</th>
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
                {ledgerRange.top > 0 ? <tr aria-hidden="true"><td colSpan={8} style={{ height: ledgerRange.top, padding: 0, border: 0 }} /></tr> : null}
                {visibleLedger.map((row, visibleIndex) => (
                  <tr
                    key={row.id}
                    data-ledger-id={row.id}
                    style={{ height: 56 }}
                    aria-rowindex={ledgerRange.start + visibleIndex + 2}
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
                      event.preventDefault();
                      const index = ledgerRange.start + visibleIndex + (event.key === "ArrowDown" ? 1 : -1);
                      if (index < 0 || index >= ledger.length) return;
                      const target = ledger[index];
                      if (!target) return;
                      if (ledgerScroll.current) ledgerScroll.current.scrollTop = Math.max(0, index * 56 - 140);
                      requestAnimationFrame(() => ledgerScroll.current?.querySelector<HTMLElement>(`[data-ledger-id="${CSS.escape(target.id)}"]`)?.focus());
                    }}
                  >
                    <td>
                      {row.status === "PENDING" ? (
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-brand-600"
                          aria-label={`Seleccionar movimiento del pedido ${row.orderNumber}`}
                          checked={selectedIdSet.has(row.id)}
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
                      {formatMoney(
                        (row.deliveryFeeBelongsToDriver ?? orderById.get(row.orderId)?.deliveryFeeBelongsToDriver) === false
                          ? 0
                          : row.deliveryFeeMinor,
                      )}
                    </td>
                    <td>
                      <span className="block">
                        {row.direction === "DRIVER_OWES_BUSINESS"
                          ? "Repartidor rinde al negocio"
                          : "Negocio paga al repartidor"}
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
                      {row.status === "SETTLED" ? (
                        <Button
                          type="button"
                          variant="secondary"
                          className="mt-1"
                          disabled={!data.cashSession}
                          onClick={() => setReversingRow(row)}
                          aria-label={`Revertir liquidación del pedido ${row.orderNumber}`}
                        >
                          Revertir liquidación
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
                {ledgerRange.bottom > 0 ? <tr aria-hidden="true"><td colSpan={8} style={{ height: ledgerRange.bottom, padding: 0, border: 0 }} /></tr> : null}
              </tbody>
            </table>
          </div>
        ) : historyScope !== "CURRENT_SHIFT" && (historyQuery.isPending || historyQuery.isError) ? null : (
          <div className="grid h-56 place-items-center text-center">
            <div>
              <CheckCircle className="mx-auto text-emerald-400" size={36} />
              <p className="mt-2 text-sm font-semibold text-slate-600">
                No hay envíos para esta selección
              </p>
            </div>
          </div>
        )}
      </Card>

      </> : null}
      <DriverModal open={driverOpen} onClose={() => setDriverOpen(false)} />
      <ReverseSettlementModal
        row={reversingRow}
        onClose={() => setReversingRow(null)}
      />
      <SettlementModal
        open={settleOpen}
        rows={selectedRows}
        paymentMethods={data.paymentMethods}
        onClose={() => setSettleOpen(false)}
      />
    </div>
  );
}

function ReverseSettlementModal({
  row,
  onClose,
}: {
  row: DeliveryLedgerDto | null;
  onClose(): void;
}) {
  const [reason, setReason] = useState("");
  const [pin, setPin] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mutation = useApiMutation(
    (
      input: Parameters<typeof window.gastronomy.reverseDeliverySettlement>[0],
    ) => window.gastronomy.reverseDeliverySettlement(input),
    { onSuccess: onClose, onError: (value) => setError(humanError(value)) },
  );
  useEffect(() => {
    setReason("");
    setPin("");
    setConfirmed(false);
    setError(null);
  }, [row?.id]);
  const canSubmit = Boolean(
    row &&
    reason.trim() &&
    /^\d{4,8}$/.test(pin) &&
    confirmed &&
    !mutation.isPending,
  );
  return (
    <Modal
      open={Boolean(row)}
      onClose={onClose}
      closeDisabled={mutation.isPending}
      title="Revertir liquidación del repartidor"
      description="Registra el movimiento inverso en caja y deja la liquidación pendiente para corregirla."
    >
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit && row)
            mutation.mutate({
              ledgerId: row.id,
              reason: reason.trim(),
              authorizerPin: pin,
            });
        }}
      >
        {row ? (
          <p className="rounded-lg bg-amber-50 p-3 text-sm">
            Pedido #{row.orderNumber} · {row.driverName}.{" "}
            {row.direction === "BUSINESS_OWES_DRIVER"
              ? "El repartidor debe devolver al negocio"
              : "El negocio debe devolver al repartidor"}{" "}
            {formatMoney(row.settledAmountMinor)}.
          </p>
        ) : null}
        <Field label="Motivo de la reversión">
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
        <label className="flex gap-2 text-sm">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          Confirmo que el dinero fue devuelto según el movimiento indicado
        </label>
        {error ? (
          <p role="alert" className="text-sm text-rose-700">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={mutation.isPending}
            onClick={onClose}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            Confirmar reversión
          </Button>
        </div>
      </form>
    </Modal>
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
      <p className="mt-3 text-xs font-bold uppercase tracking-wide text-slate-600">
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
      description="Se crea para asignar envíos y calcular rendiciones. También estará visible y gestionable en la sección de Usuarios."
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
  paymentMethods,
  onClose,
}: {
  open: boolean;
  rows: DeliveryLedgerDto[];
  paymentMethods: BootstrapDto["paymentMethods"];
  onClose(): void;
}) {
  const allowedMethods = paymentMethods.filter(
    (method) => method.active && method.code !== "ACCOUNT",
  );
  const defaultMethodCode =
    allowedMethods.find((method) => method.code === "CASH")?.code ??
    allowedMethods[0]?.code ??
    "";
  const [reason, setReason] = useState("Cierre de turno");
  const [pin, setPin] = useState("");
  const [paymentMethodCode, setPaymentMethodCode] = useState(defaultMethodCode);
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
    setPaymentMethodCode(defaultMethodCode);
    setError(null);
    setReviewing(false);
  }, [open, rowKey, defaultMethodCode]);

  const selectedPaymentMethod = allowedMethods.find(
    (method) => method.code === paymentMethodCode,
  );

  const close = () => {
    if (!mutation.isPending) onClose();
  };
  const confirm = () =>
    mutation.mutate({
      ledgerIds: rows.map((row) => row.id),
      reason: reason.trim(),
      authorizerPin: pin,
      paymentMethodCode,
    });

  const distinctDrivers = Array.from(
    new Set(rows.map((r) => r.driverName || "Repartidor")),
  );
  const driverDescription =
    distinctDrivers.length === 1
      ? distinctDrivers[0]
      : `${distinctDrivers.length} repartidores`;

  return (
    <Modal
      open={open}
      onClose={close}
      title={
        reviewing ? "Confirmar movimiento de caja" : "Revisar pago o rendición"
      }
      description={`${rows.length} movimiento(s) de ${driverDescription}; diferenciá los pagos al repartidor de las rendiciones que recibe el negocio.`}
    >
      {reviewing ? (
        <div className="grid gap-4">
          <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <WarningCircle size={22} className="shrink-0 text-amber-700" />
            <p className="text-xs leading-5 text-amber-900">
              Se registrarán los movimientos seleccionados con el medio indicado
              y quedarán liquidados. Verificá repartidor, importes y sentido
              antes de confirmar.
            </p>
          </div>
          <SettlementSummary
            driverOwes={driverOwes}
            businessOwes={businessOwes}
            net={net}
            paymentMethodName={selectedPaymentMethod?.name}
            affectsCash={selectedPaymentMethod?.affectsCash ?? false}
          />
          <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
            <strong>Motivo:</strong> {reason.trim()}
          </p>
          <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
            <strong>Medio:</strong>{" "}
            {selectedPaymentMethod?.name ?? "No disponible"}.{" "}
            {selectedPaymentMethod?.affectsCash
              ? net === 0
                ? "Sin variación neta de efectivo."
                : `Impacto neto en efectivo: ${net > 0 ? "ingresa" : "sale"} ${formatMoney(Math.abs(net))}.`
              : "Este medio no modifica el efectivo de caja."}
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
            <Button
              disabled={mutation.isPending || !selectedPaymentMethod}
              onClick={confirm}
            >
              <CheckCircle />
              {mutation.isPending ? "Registrando…" : "Confirmar movimiento"}
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (
              rows.length &&
              selectedPaymentMethod &&
              reason.trim() &&
              pin.length >= 4
            )
              setReviewing(true);
          }}
        >
          <SettlementSummary
            driverOwes={driverOwes}
            businessOwes={businessOwes}
            net={net}
            paymentMethodName={selectedPaymentMethod?.name}
            affectsCash={selectedPaymentMethod?.affectsCash ?? false}
          />
          <div className="max-h-52 overflow-auto rounded-xl border border-slate-200">
            <table className="dn-table min-w-[640px]">
              <thead>
                <tr>
                  <th>Pedido</th>
                  <th>Repartidor</th>
                  <th>Movimiento</th>
                  <th className="text-right">Importe</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="font-bold">#{row.orderNumber}</td>
                    <td className="font-semibold">
                      {row.driverName || "Repartidor"}
                    </td>
                    <td>
                      {row.direction === "DRIVER_OWES_BUSINESS"
                        ? "Recibe el negocio"
                        : "Paga el negocio"}
                    </td>
                    <td className="text-right font-bold">
                      {formatMoney(row.amountDueMinor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Field
            label="Medio de pago de la liquidación"
            hint="Se aplicará a todos los movimientos seleccionados."
            hintMode="inline"
          >
            <Select
              value={paymentMethodCode}
              onChange={(event) => setPaymentMethodCode(event.target.value)}
              disabled={!allowedMethods.length || mutation.isPending}
            >
              {!allowedMethods.length ? (
                <option value="">Sin medios permitidos</option>
              ) : null}
              {allowedMethods.map((method) => (
                <option key={method.code} value={method.code}>
                  {method.name}
                </option>
              ))}
            </Select>
          </Field>
          {!allowedMethods.length ? (
            <p
              role="alert"
              className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900"
            >
              No hay medios de pago activos permitidos para registrar la
              liquidación. Activá un medio distinto de cuenta corriente.
            </p>
          ) : null}
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
                !selectedPaymentMethod ||
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
  paymentMethodName,
  affectsCash,
}: {
  driverOwes: number;
  businessOwes: number;
  net: number;
  paymentMethodName?: string;
  affectsCash: boolean;
}) {
  return (
    <div>
      <div className="grid gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 sm:grid-cols-3">
        <div className="bg-white p-3">
          <p className="text-xs font-bold uppercase text-slate-600">
            Repartidor rinde al negocio
          </p>
          <p className="text-lg font-extrabold text-emerald-700">
            {formatMoney(driverOwes)}
          </p>
        </div>
        <div className="bg-white p-3">
          <p className="text-xs font-bold uppercase text-slate-600">
            Negocio paga al repartidor
          </p>
          <p className="text-lg font-extrabold text-rose-700">
            {formatMoney(businessOwes)}
          </p>
        </div>
        <div className="bg-slate-950 p-3 text-white">
          <p className="text-xs font-bold uppercase text-slate-400">
            {net === 0
              ? "Saldo neto equilibrado"
              : net > 0
                ? "Saldo neto a favor del negocio"
                : "Saldo neto a favor del repartidor"}
          </p>
          <p className="text-lg font-extrabold">
            {net >= 0 ? "+" : "−"}
            {formatMoney(Math.abs(net))}
          </p>
        </div>
      </div>
      <p className="mt-2 text-xs text-slate-600">
        {paymentMethodName
          ? `Medio elegido: ${paymentMethodName}. ${affectsCash ? (net === 0 ? "Sin variación neta de efectivo." : `Impacto neto en efectivo: ${net > 0 ? "ingresa" : "sale"} ${formatMoney(Math.abs(net))}.`) : "No modifica el efectivo de caja."}`
          : "Seleccioná un medio para ver el impacto en efectivo."}
      </p>
    </div>
  );
}
