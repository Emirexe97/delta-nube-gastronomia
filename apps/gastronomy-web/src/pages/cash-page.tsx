import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  BootstrapDto,
  CashMovementInput,
  CashSessionDto,
  CloseCashSessionInput,
  DashboardSummaryDto,
} from "@gastronomy/contracts";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CashRegister,
  Lock,
  PlusCircle,
  Receipt,
  WarningCircle,
} from "@phosphor-icons/react";
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  Modal,
  Select,
  Textarea,
} from "@gastronomy/ui";
import { useApiMutation } from "../api";
import {
  CashSessionHistory,
  CashSessionReportModal,
} from "../components/cash-session-report";
import {
  formatMoney,
  humanError,
  paidOrdersForSession,
  paymentText,
  parseMoneyInput,
  salesByChannel,
  statusLabels,
  typeLabels,
} from "../lib";

export function CashPage({ data }: { data: BootstrapDto }) {
  const queryClient = useQueryClient();
  const [openModal, setOpenModal] = useState(false);
  const [movementOpen, setMovementOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [reportSessionId, setReportSessionId] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const session = data.cashSession;
  const paidOrders = paidOrdersForSession(data.orders, session);
  const channelTotals = salesByChannel(paidOrders);
  const paymentTotals = paidOrders
    .flatMap((o) => o.payments)
    .filter((p) => p.status !== "REFUNDED")
    .reduce<Map<string, { name: string; amountMinor: number }>>((map, p) => {
      const item = map.get(p.methodCode) ?? {
        name: p.methodName || p.methodCode,
        amountMinor: 0,
      };
      item.amountMinor += p.amountMinor - p.refundedMinor;
      map.set(p.methodCode, item);
      return map;
    }, new Map());
  const pendingDeliveryLedger = data.deliveryLedger.filter(
    (row) => row.status === "PENDING",
  );
  const pendingDriverOwesMinor = pendingDeliveryLedger
    .filter((row) => row.direction === "DRIVER_OWES_BUSINESS")
    .reduce((sum, row) => sum + row.amountDueMinor, 0);
  const pendingBusinessOwesMinor = pendingDeliveryLedger
    .filter((row) => row.direction === "BUSINESS_OWES_DRIVER")
    .reduce((sum, row) => sum + row.amountDueMinor, 0);
  return (
    <div className="panel-enter mx-auto max-w-[1200px] space-y-4">
      <div>
        <h2 className="text-lg font-extrabold">Caja y día comercial</h2>
        <p className="text-xs text-slate-400">
          Los pedidos después de medianoche conservan el día de apertura
        </p>
      </div>
      {session ? (
        <>
          <Card className="overflow-hidden">
            <div className="grid gap-px bg-slate-200 md:grid-cols-4">
              <CashHeader label="Caja">
                <p className="text-2xl font-extrabold">#{session.number}</p>
                <Badge tone="green">Abierta</Badge>
              </CashHeader>
              <CashHeader label="Día comercial">
                <p className="mt-1 text-lg font-extrabold">
                  {session.businessDate}
                </p>
                <p className="text-[10px] text-slate-400">
                  Apertura {new Date(session.openedAt).toLocaleString("es-AR")}
                </p>
              </CashHeader>
              <CashHeader label="Cambio inicial">
                <p className="mt-1 text-lg font-extrabold">
                  {formatMoney(session.openingAmountMinor)}
                </p>
              </CashHeader>
              <div className="bg-slate-950 p-4 text-white">
                <SmallLabel>Efectivo esperado</SmallLabel>
                <p className="mt-1 text-2xl font-extrabold">
                  {formatMoney(session.expectedAmountMinor)}
                </p>
              </div>
            </div>
          </Card>
          <section className="grid gap-3 md:grid-cols-3">
            <ActionCard
              icon={<PlusCircle size={21} />}
              title="Registrar movimiento"
              description="Ingreso, gasto, retiro o ajuste con motivo"
              onClick={() => setMovementOpen(true)}
            />
            <ActionCard
              icon={<Lock size={21} />}
              title="Conciliar y cerrar caja"
              description="Contar efectivo, definir cambio final y revisar diferencias"
              onClick={() => setCloseOpen(true)}
              danger
            />
            <Card className="p-4">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-emerald-600">
                <CashRegister size={21} />
              </div>
              <p className="mt-3 text-sm font-bold">Operación protegida</p>
              <p className="mt-1 text-[11px] text-slate-400">
                Cada venta y movimiento queda asociado a esta caja.
              </p>
            </Card>
          </section>
          <section className="grid gap-3 lg:grid-cols-2">
            <CashBreakdown session={session} />
            <div className="space-y-2">
              <PaymentMethodSummary
                paymentMethods={
                  session.salesByPaymentMethod ??
                  [...paymentTotals].map(([code, value]) => ({
                    code,
                    ...value,
                  }))
                }
              />
              <p className="rounded-xl border border-sky-100 bg-sky-50 p-3 text-[11px] text-sky-800">
                Las ventas con tarjeta o transferencia impactan el resumen, pero
                no aumentan el efectivo esperado de esta caja.
              </p>
            </div>
          </section>
          <Card className="overflow-hidden">
            <div className="border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-bold">Ventas cobradas del turno</h2>
              <p className="text-[11px] text-slate-400">
                Total cobrado: {formatMoney(session.salesTotalMinor ?? 0)}
              </p>
            </div>
            <div className="grid gap-2 border-b border-slate-100 p-4 sm:grid-cols-3">
              {(Object.keys(typeLabels) as Array<keyof typeof typeLabels>).map(
                (type) => (
                  <div key={type} className="rounded-lg bg-slate-50 p-3">
                    <SmallLabel>{typeLabels[type]}</SmallLabel>
                    <strong className="mt-1 block">
                      {formatMoney(
                        session.salesByType?.[type] ?? channelTotals[type],
                      )}
                    </strong>
                  </div>
                ),
              )}
            </div>
            {paidOrders.length ? (
              <div className="overflow-auto">
                <table className="dn-table">
                  <thead>
                    <tr>
                      <th>Pedido</th>
                      <th>Canal</th>
                      <th>Mesa / cliente</th>
                      <th>Medios</th>
                      <th>Estado</th>
                      <th className="text-right">Cobrado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paidOrders.slice(0, 20).map((order) => (
                      <tr key={order.id}>
                        <td className="font-bold">#{order.number}</td>
                        <td>{typeLabels[order.type]}</td>
                        <td>
                          {order.tableNumber
                            ? `Mesa ${order.tableNumber}`
                            : order.customerNameSnapshot || "Sin cliente"}
                        </td>
                        <td>{paymentText(order)}</td>
                        <td>
                          <Badge tone="green">
                            {order.type === "DINE_IN" &&
                            order.operationalStatus === "DELIVERED"
                              ? "Mesa cerrada"
                              : statusLabels[order.operationalStatus]}
                          </Badge>
                        </td>
                        <td className="text-right font-bold">
                          {formatMoney(order.paidMinor)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="p-8 text-center text-sm text-slate-500">
                No hay ventas cobradas en esta caja.
              </p>
            )}
          </Card>
          {pendingDeliveryLedger.length ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <div>
                <p className="font-bold">
                  Hay {pendingDeliveryLedger.length} rendición(es) sin conciliar
                </p>
                <p className="mt-0.5 text-[11px] text-amber-800">
                  Ingresan {formatMoney(pendingDriverOwesMinor)} · salen{" "}
                  {formatMoney(pendingBusinessOwesMinor)}. Liquidá o usá cierre
                  forzado con motivo y PIN.
                </p>
              </div>
              <Badge tone="amber">Bloquea cierre normal</Badge>
            </div>
          ) : null}
          <CashSessionHistory
            onReport={(id) => {
              setReportSessionId(id);
              setReportOpen(true);
            }}
          />
        </>
      ) : (
        <Card className="grid min-h-[380px] place-items-center p-8 text-center">
          <div className="max-w-md">
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-brand-50 text-brand-600">
              <CashRegister size={32} weight="duotone" />
            </div>
            <h3 className="mt-4 text-xl font-extrabold">
              La caja está cerrada
            </h3>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Abrila con el cambio inicial para habilitar mesas, pedidos y
              cobros. El día comercial quedará fijado.
            </p>
            <Button className="mt-5" onClick={() => setOpenModal(true)}>
              <PlusCircle size={18} /> Abrir caja
            </Button>
          </div>
        </Card>
      )}
      <OpenCashModal open={openModal} onClose={() => setOpenModal(false)} />
      <MovementModal
        open={movementOpen}
        onClose={() => setMovementOpen(false)}
      />
      {session ? (
        <CloseCashModal
          open={closeOpen}
          session={session}
          paymentMethods={data.dashboard.byPaymentMethod}
          pendingDeliveryCount={pendingDeliveryLedger.length}
          pendingDriverOwesMinor={pendingDriverOwesMinor}
          pendingBusinessOwesMinor={pendingBusinessOwesMinor}
          onClose={() => setCloseOpen(false)}
          onReport={() => {
            setReportSessionId(session.id);
            setReportOpen(true);
          }}
          onClosed={(closed) => {
            void queryClient.invalidateQueries({
              queryKey: ["cash-session-history"],
            });
            setCloseOpen(false);
            setReportSessionId(closed.id);
            setReportOpen(true);
          }}
        />
      ) : null}
      {!session ? (
        <CashSessionHistory
          onReport={(id) => {
            setReportSessionId(id);
            setReportOpen(true);
          }}
        />
      ) : null}
      <CashSessionReportModal
        open={reportOpen}
        sessionId={reportSessionId}
        onClose={() => setReportOpen(false)}
      />
    </div>
  );
}

function CashHeader({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="bg-white p-4">
      <SmallLabel>{label}</SmallLabel>
      {children}
    </div>
  );
}

function ActionCard({
  icon,
  title,
  description,
  onClick,
  danger,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  onClick(): void;
  danger?: boolean;
}) {
  return (
    <button onClick={onClick} className="text-left">
      <Card className="h-full p-4 transition hover:border-brand-300 hover:shadow-md">
        <div
          className={`grid h-10 w-10 place-items-center rounded-xl ${
            danger ? "bg-rose-50 text-rose-600" : "bg-brand-50 text-brand-600"
          }`}
        >
          {icon}
        </div>
        <p className="mt-3 text-sm font-bold">{title}</p>
        <p className="mt-1 text-[11px] text-slate-400">{description}</p>
      </Card>
    </button>
  );
}

function OpenCashModal({ open, onClose }: { open: boolean; onClose(): void }) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mutation = useApiMutation(
    (input: { openingAmountMinor: number; note?: string }) =>
      window.gastronomy.openCashSession(input),
    { onSuccess: onClose, onError: (value) => setError(humanError(value)) },
  );
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Abrir caja"
      description="El día comercial se toma de este momento"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const value = parseMoneyInput(amount);
          if (value == null) return setError("Ingresá un importe válido.");
          mutation.mutate({
            openingAmountMinor: value,
            note: note || undefined,
          });
        }}
        className="grid gap-4"
      >
        <Field label="Cambio / fondo inicial">
          <Input
            autoFocus
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            placeholder="50000"
            required
          />
        </Field>
        <Field label="Observación">
          <Textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Opcional"
          />
        </Field>
        {error ? <ErrorMessage>{error}</ErrorMessage> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            Abrir caja
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function MovementModal({ open, onClose }: { open: boolean; onClose(): void }) {
  const [type, setType] = useState<CashMovementInput["type"]>("EXPENSE");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mutation = useApiMutation(
    (input: CashMovementInput) => window.gastronomy.registerCashMovement(input),
    { onSuccess: onClose, onError: (value) => setError(humanError(value)) },
  );
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Movimiento de caja"
      description="Los movimientos sensibles nunca se eliminan"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const value = parseMoneyInput(amount);
          if (value == null) return setError("Importe inválido.");
          mutation.mutate({ type, amountMinor: value, reason });
        }}
        className="grid gap-4"
      >
        <Field label="Tipo">
          <Select
            value={type}
            onChange={(event) =>
              setType(event.target.value as CashMovementInput["type"])
            }
          >
            <option value="INCOME">Ingreso</option>
            <option value="EXPENSE">Gasto</option>
            <option value="WITHDRAWAL">Retiro</option>
            <option value="ADJUSTMENT">Ajuste</option>
          </Select>
        </Field>
        <Field label="Importe">
          <Input
            autoFocus
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </Field>
        <Field label="Motivo">
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
          />
        </Field>
        {error ? <ErrorMessage>{error}</ErrorMessage> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={!reason.trim() || mutation.isPending}>
            {type === "INCOME" ? <ArrowUp /> : <ArrowDown />} Registrar
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function CloseCashModal({
  open,
  session,
  paymentMethods,
  pendingDeliveryCount,
  pendingDriverOwesMinor,
  pendingBusinessOwesMinor,
  onClose,
  onReport,
  onClosed,
}: {
  open: boolean;
  session: CashSessionDto;
  paymentMethods: DashboardSummaryDto["byPaymentMethod"];
  pendingDeliveryCount: number;
  pendingDriverOwesMinor: number;
  pendingBusinessOwesMinor: number;
  onClose(): void;
  onReport(): void;
  onClosed(closed: CashSessionDto): void;
}) {
  const [counted, setCounted] = useState("");
  const [closingFloat, setClosingFloat] = useState("");
  const [force, setForce] = useState(false);
  const [reason, setReason] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  useEffect(() => {
    if (!open) return;
    setCounted("");
    setClosingFloat(String(session.openingAmountMinor / 100));
    setForce(false);
    setReason("");
    setPin("");
    setError(null);
    setReviewing(false);
  }, [open, session.id, session.openingAmountMinor]);

  const countedMinor = parseMoneyInput(counted);
  const closingFloatMinor = parseMoneyInput(closingFloat);
  const differenceMinor =
    countedMinor == null ? null : countedMinor - session.expectedAmountMinor;
  const cashRemovedMinor =
    countedMinor == null || closingFloatMinor == null
      ? null
      : countedMinor - closingFloatMinor;
  const floatDifferenceMinor =
    closingFloatMinor == null
      ? null
      : closingFloatMinor - session.openingAmountMinor;
  const needsReason = differenceMinor != null && differenceMinor !== 0;
  const invalidFloat =
    countedMinor != null &&
    closingFloatMinor != null &&
    closingFloatMinor > countedMinor;
  const valid =
    countedMinor != null &&
    countedMinor >= 0 &&
    closingFloatMinor != null &&
    closingFloatMinor >= 0 &&
    !invalidFloat &&
    (!needsReason || Boolean(reason.trim())) &&
    (!force || (Boolean(reason.trim()) && pin.length >= 4));
  const mutation = useApiMutation(
    (input: CloseCashSessionInput) => window.gastronomy.closeCashSession(input),
    {
      onSuccess: (closed) => onClosed(closed),
      onError: (value) => setError(humanError(value)),
    },
  );
  const submit = () => {
    if (countedMinor == null || closingFloatMinor == null) return;
    mutation.mutate({
      countedAmountMinor: countedMinor,
      closingFloatAmountMinor: closingFloatMinor,
      force,
      reason: reason.trim() || undefined,
      authorizerPin: force ? pin : undefined,
    });
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        reviewing ? "Confirmar cierre definitivo" : "Conciliar y cerrar caja"
      }
      description={
        reviewing
          ? "Revisá los importes: esta acción finaliza el día comercial"
          : "El arqueo y el cambio para la próxima apertura se registran por separado"
      }
    >
      {reviewing ? (
        <div className="grid gap-4">
          <div className="flex gap-3 rounded-xl border border-brand-200 bg-brand-50 p-4">
            <WarningCircle
              className="mt-0.5 shrink-0 text-brand-700"
              size={22}
            />
            <p className="text-xs leading-5 text-slate-600">
              La diferencia corresponde al arqueo. La variación de cambio solo
              indica cuánto fondo se dejará respecto de la apertura.
            </p>
          </div>
          <div className="grid gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 sm:grid-cols-2">
            <ReviewValue
              label="Efectivo esperado"
              value={session.expectedAmountMinor}
            />
            <ReviewValue label="Efectivo contado" value={countedMinor ?? 0} />
            <ReviewValue
              label="Diferencia de arqueo"
              value={differenceMinor ?? 0}
              danger={differenceMinor !== 0}
            />
            <ReviewValue label="Cambio final" value={closingFloatMinor ?? 0} />
            <ReviewValue
              label="Variación del cambio"
              value={floatDifferenceMinor ?? 0}
            />
            <ReviewValue
              label="Efectivo a retirar"
              value={cashRemovedMinor ?? 0}
              emphasized
            />
          </div>
          {reason.trim() ? (
            <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
              <strong>Observación: </strong>
              {reason.trim()}
            </p>
          ) : null}
          {error ? <ErrorMessage>{error}</ErrorMessage> : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setReviewing(false)}
            >
              <ArrowLeft /> Volver a revisar
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={mutation.isPending}
              onClick={submit}
            >
              <Lock /> Confirmar cierre definitivo
            </Button>
          </div>
        </div>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) setReviewing(true);
          }}
          className="grid gap-4"
        >
          <CashBreakdown session={session} />
          {pendingDeliveryCount ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <p className="font-bold">
                {pendingDeliveryCount} rendición(es) siguen pendientes
              </p>
              <p className="mt-1 text-[11px] leading-5">
                Repartidores deben {formatMoney(pendingDriverOwesMinor)} · el
                negocio debe {formatMoney(pendingBusinessOwesMinor)}. El cierre
                normal será rechazado hasta conciliarlas.
              </p>
            </div>
          ) : null}
          <div className="grid gap-3 rounded-xl border border-slate-200 p-4 sm:grid-cols-2">
            <Field label="Efectivo contado">
              <Input
                autoFocus
                value={counted}
                onChange={(event) => setCounted(event.target.value)}
                inputMode="decimal"
                placeholder="0,00"
                required
              />
            </Field>
            <Field label="Cambio final para la próxima caja">
              <Input
                value={closingFloat}
                onChange={(event) => setClosingFloat(event.target.value)}
                inputMode="decimal"
                placeholder="0,00"
                required
              />
            </Field>
            {differenceMinor != null ? (
              <Metric
                label="Diferencia de arqueo"
                value={differenceMinor}
                danger={differenceMinor !== 0}
              />
            ) : null}
            {cashRemovedMinor != null ? (
              <Metric
                label="Efectivo a retirar"
                value={cashRemovedMinor}
                dark
              />
            ) : null}
            {floatDifferenceMinor != null ? (
              <p className="text-xs text-slate-500 sm:col-span-2">
                Cambio: {formatMoney(session.openingAmountMinor)} →{" "}
                <strong>{formatMoney(closingFloatMinor ?? 0)}</strong>.
                Variación: <strong>{formatMoney(floatDifferenceMinor)}</strong>.
              </p>
            ) : null}
          </div>
          {invalidFloat ? (
            <ErrorMessage>
              El cambio final no puede superar el efectivo contado.
            </ErrorMessage>
          ) : null}
          {needsReason || force ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label={
                  needsReason
                    ? "Motivo de la diferencia"
                    : "Motivo del cierre forzado"
                }
              >
                <Textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Dejá una explicación para auditoría"
                  required
                />
              </Field>
              {force ? (
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
                    required
                  />
                </Field>
              ) : null}
            </div>
          ) : null}
          <PaymentMethodSummary paymentMethods={paymentMethods} />
          <label className="flex items-start gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={force}
              onChange={(event) => {
                setForce(event.target.checked);
                setError(null);
              }}
              className="mt-0.5 accent-brand-600"
            />
            Forzar cierre si existen pedidos pendientes (requiere motivo y
            autorización).
          </label>
          {error ? <ErrorMessage>{error}</ErrorMessage> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" variant="danger" disabled={!valid}>
              <Receipt /> Revisar cierre
            </Button>
          </div>
          <Button type="button" variant="secondary" onClick={onReport}>
            <Receipt /> Ver informe del turno antes de cerrar
          </Button>
        </form>
      )}
    </Modal>
  );
}

function CashBreakdown({ session }: { session: CashSessionDto }) {
  const rows = [
    ["Cambio inicial", session.openingAmountMinor],
    ["Ventas en efectivo", session.cashSalesMinor ?? 0],
    ["Ingresos manuales", session.cashIncomeMinor ?? 0],
    ["Gastos", -(session.cashExpenseMinor ?? 0)],
    ["Retiros", -(session.cashWithdrawalMinor ?? 0)],
    ["Devoluciones", -(session.cashRefundMinor ?? 0)],
  ] as const;
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <p className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-extrabold">
        Composición del efectivo esperado
      </p>
      <div className="divide-y divide-slate-100 px-4">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between py-2 text-xs">
            <span className="text-slate-500">{label}</span>
            <strong>{formatMoney(value)}</strong>
          </div>
        ))}
        <div className="flex items-center justify-between py-3">
          <strong>Efectivo esperado</strong>
          <strong className="text-xl">
            {formatMoney(session.expectedAmountMinor)}
          </strong>
        </div>
      </div>
    </div>
  );
}

function PaymentMethodSummary({
  paymentMethods,
}: {
  paymentMethods: DashboardSummaryDto["byPaymentMethod"];
}) {
  const methods = paymentMethods.filter((method) => method.amountMinor !== 0);
  if (!methods.length) return null;
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <SmallLabel>Medios cobrados · informativo</SmallLabel>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {methods.map((method) => (
          <div
            key={method.code}
            className="flex justify-between rounded-lg bg-white px-3 py-2 text-xs"
          >
            <span className="text-slate-500">{method.name}</span>
            <strong>{formatMoney(method.amountMinor)}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  danger,
  dark,
}: {
  label: string;
  value: number;
  danger?: boolean;
  dark?: boolean;
}) {
  return (
    <div
      className={
        dark
          ? "rounded-lg bg-slate-950 p-3 text-white"
          : "rounded-lg bg-slate-50 p-3"
      }
    >
      <SmallLabel>{label}</SmallLabel>
      <p
        className={`mt-1 text-lg font-extrabold ${danger ? "text-rose-600" : ""}`}
      >
        {value < 0 && dark ? "—" : formatMoney(value)}
      </p>
    </div>
  );
}

function ReviewValue({
  label,
  value,
  danger,
  emphasized,
}: {
  label: string;
  value: number;
  danger?: boolean;
  emphasized?: boolean;
}) {
  return (
    <div
      className={emphasized ? "bg-slate-950 p-4 text-white" : "bg-white p-4"}
    >
      <SmallLabel>{label}</SmallLabel>
      <p
        className={`mt-1 text-lg font-extrabold ${danger ? "text-rose-600" : ""}`}
      >
        {formatMoney(value)}
      </p>
    </div>
  );
}

function SmallLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
      {children}
    </p>
  );
}

function ErrorMessage({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-lg bg-rose-50 p-3 text-xs text-rose-700">
      <WarningCircle className="mt-px shrink-0" size={16} /> {children}
    </p>
  );
}
