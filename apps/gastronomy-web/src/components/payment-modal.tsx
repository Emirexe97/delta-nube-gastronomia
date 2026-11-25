import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { BootstrapDto, CustomerDto, OrderDto } from "@gastronomy/contracts";
import { CreditCard, Receipt } from "@phosphor-icons/react";
import { Button, Field, Input, Modal, Select, cn } from "@gastronomy/ui";
import { useOrderDispatchMutation } from "../api";
import { formatMoney, moneyInputValue, humanError, parseMoneyInput } from "../lib";
export function PaymentModal({
  open,
  order,
  data,
  onClose,
  onError,
  completeOnPay,
  onOpenDeposit,
}: {
  open: boolean;
  order: OrderDto;
  data: BootstrapDto;
  onClose(): void;
  onError(value: string): void;
  completeOnPay: boolean;
  onOpenDeposit?(): void;
}) {
  const remaining = Math.max(0, order.totalMinor - order.paidMinor);
  const [values, setValues] = useState<Record<string, string>>({});
  const [references, setReferences] = useState<Record<string, string>>({});
  const [customerId, setCustomerId] = useState<string | null>(order.customerId);
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerResults, setCustomerResults] = useState<CustomerDto[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const activeDeliveryDrivers = data.users.filter(
    (user) => user.roleCode === "DELIVERY_DRIVER" && user.active,
  );
  const currentDriverIsActive = activeDeliveryDrivers.some(
    (driver) => driver.id === order.driverUserId,
  );
  const initialDriverUserId =
    order.driverUserId && (currentDriverIsActive || order.paidMinor > 0)
      ? order.driverUserId
      : "";
  const initialCollectedByDriver =
    order.paidMinor > 0 && order.collectedByDriver;
  const [driverUserId, setDriverUserId] = useState(initialDriverUserId);
  const [collectedByDriver, setCollectedByDriver] = useState(
    initialCollectedByDriver,
  );
  const defaultCashUntouched = useRef(true);
  const [localError, setLocalError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const activePaymentMethods = data.paymentMethods.filter((method) => method.active);
  const defaultChangeMethod = useMemo(
    () =>
      data.paymentMethods.find((m) => m.code === "CASH" && m.active)?.code ??
      data.paymentMethods.find((m) => m.active)?.code ??
      "CASH",
    [data.paymentMethods],
  );
  const [changeMethodCode, setChangeMethodCode] =
    useState<string>(defaultChangeMethod);
  const initialPaymentMethodCode = activePaymentMethods.find((m) => m.code === "CASH")?.code ?? activePaymentMethods[0]?.code ?? "";
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState(initialPaymentMethodCode);
  const [mixedPaymentExpanded, setMixedPaymentExpanded] = useState(false);
  const submitLock = useRef(false);
  const deliveryFeeBelongsToDriver =
    order.deliveryFeeBelongsToDriver ??
    data.settings.deliveryFeeBelongsToDriver ??
    true;
  const driverRemunerationMinor =
    order.driverRemunerationMinor ??
    (deliveryFeeBelongsToDriver ? order.deliveryFeeMinor : 0);
  const completionDriverUserId =
    completeOnPay && order.type === "DELIVERY"
      ? driverUserId
      : order.driverUserId;
  const initialCanSettleDriverFee =
    order.type === "DELIVERY" &&
    Boolean(initialDriverUserId) &&
    data.settings.deliverySettlementEnabled &&
    driverRemunerationMinor > 0;
  const [payDriverNow, setPayDriverNow] = useState(
    initialCanSettleDriverFee &&
      data.settings.deliveryDriverPaymentMode === "ON_ORDER_PAYMENT",
  );
  const firstPaymentInputRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    if (!open) {
      setInitialized(false);
      return;
    }
    const exact = moneyInputValue(remaining);
    setValues(initialPaymentMethodCode ? { [initialPaymentMethodCode]: exact } : {});
    setSelectedPaymentMethod(initialPaymentMethodCode);
    setMixedPaymentExpanded(false);
    defaultCashUntouched.current = true;
    setCustomerId(order.customerId);
    setCustomerQuery(
      order.customerNameSnapshot ?? order.customerPhoneSnapshot ?? "",
    );
    setCustomerResults([]);
    setCustomerName(order.customerNameSnapshot ?? "");
    setCustomerPhone(order.customerPhoneSnapshot ?? "");
    setDriverUserId(initialDriverUserId);
    setCollectedByDriver(initialCollectedByDriver);
    setReferences({});
    setChangeMethodCode(defaultChangeMethod);
    setPayDriverNow(
      initialCanSettleDriverFee &&
        data.settings.deliveryDriverPaymentMode === "ON_ORDER_PAYMENT",
    );
    setLocalError(null);
    setInitialized(true);
    const focusFrame = window.requestAnimationFrame(() =>
      firstPaymentInputRef.current?.focus(),
    );
    return () => window.cancelAnimationFrame(focusFrame);
  }, [
    open,
    remaining,
    defaultChangeMethod,
    initialPaymentMethodCode,
    order.id,
    initialDriverUserId,
    initialCollectedByDriver,
    initialCanSettleDriverFee,
    deliveryFeeBelongsToDriver,
    driverRemunerationMinor,
    data.settings.deliverySettlementEnabled,
    data.settings.deliveryDriverPaymentMode,
  ]);

  const mutation = useOrderDispatchMutation(
    (input: Parameters<typeof window.gastronomy.payOrder>[0]) => {
      return completeOnPay
        ? window.gastronomy.completeOrder({
            ...input,
            finalStatus: "DELIVERED",
            ...(order.type === "DELIVERY"
              ? { driverUserId, collectedByDriver }
              : {}),
          })
        : window.gastronomy.payOrder(input);
    },
    order.type === "TAKEAWAY"
      ? (completeOnPay ? "complete" : "payment")
      : order.type === "DELIVERY" && completeOnPay
        ? "complete"
        : order.type === "DINE_IN" && !completeOnPay
          ? "payment"
          : null,
    {
      onSuccess: () => onClose(),
      onError: (value) => {
        const message = humanError(value);
        setLocalError(message);
        onError(message);
      },
      onSettled: () => { submitLock.current = false; },
    },
  );

  const payments = data.paymentMethods
    .map((method) => {
      const amountMinor = parseMoneyInput(values[method.code] ?? "") ?? 0;
      return {
        methodCode: method.code,
        amountMinor,
        ...(method.code !== "CASH"
          ? { reference: references[method.code]?.trim() || null }
          : {}),
      };
    })
    .filter((item) => item.amountMinor > 0);

  const allocated = payments.reduce((sum, item) => sum + item.amountMinor, 0);
  const hasInvalidAmount = data.paymentMethods.some((method) => {
    const raw = values[method.code] ?? "";
    return raw.trim() !== "" && parseMoneyInput(raw) === null;
  });
  const hasInactiveAllocation = Object.entries(values).some(([code, raw]) =>
    (parseMoneyInput(raw) ?? 0) > 0 && !activePaymentMethods.some((method) => method.code === code),
  );
  const accountAmount =
    payments.find((item) => item.methodCode === "ACCOUNT")?.amountMinor ?? 0;
  const changeDue = Math.max(0, allocated - remaining);

  const selectedChangeMethod = data.paymentMethods.find(
    (m) => m.code === changeMethodCode,
  );
  const incomingCashMinor =
    payments.find((item) => item.methodCode === "CASH")?.amountMinor ?? 0;
  const isDeliveryWithDriver =
    order.type === "DELIVERY" &&
    Boolean(completionDriverUserId) &&
    data.settings.deliverySettlementEnabled &&
    driverRemunerationMinor > 0;

  const deliveryCashTotal = payments
    .filter((payment) => payment.methodCode === "CASH")
    .reduce((sum, payment) => sum + payment.amountMinor, 0);
  const deliveryPrepaidTotal = payments
    .filter(
      (payment) =>
        payment.methodCode !== "CASH" && payment.methodCode !== "ACCOUNT",
    )
    .reduce((sum, payment) => sum + payment.amountMinor, 0);
  const atDoorCash =
    order.type === "DELIVERY" &&
    collectedByDriver &&
    deliveryCashTotal > 0 &&
    accountAmount === 0 &&
    deliveryPrepaidTotal === 0 &&
    payments.every((payment) => payment.methodCode === "CASH");
  const invalidDriverCollection = collectedByDriver && !atDoorCash;
  const drawerCashAvailable =
    (data.cashSession?.expectedAmountMinor ?? 0) +
    (collectedByDriver ? 0 : incomingCashMinor);
  const isCashChangeInsufficient =
    changeDue > 0 &&
    Boolean(selectedChangeMethod?.affectsCash) &&
    !collectedByDriver &&
    changeDue > drawerCashAvailable;
  const collectionDriver = data.users.find(
    (user) => user.id === completionDriverUserId,
  )?.fullName;
  const invalidDriverChange =
    atDoorCash && changeDue > 0 && changeMethodCode !== "CASH";
  const driverRequired =
    completeOnPay && order.type === "DELIVERY" && !driverUserId;
  const hasNonCashPayment = payments.some(
    (payment) => payment.methodCode !== "CASH",
  );
  const driverSelectionLocked =
    order.paidMinor > 0 && Boolean(order.driverUserId);
  const collectorLocked = order.paidMinor > 0;
  const assignedDriver = data.users.find((user) => user.id === driverUserId);

  const canSubmit =
    !invalidDriverCollection &&
    !invalidDriverChange &&
    !driverRequired &&
    initialized &&
    activePaymentMethods.length > 0 &&
    !hasInvalidAmount &&
    !hasInactiveAllocation &&
    allocated >= remaining &&
    (!accountAmount || (Boolean(customerId) && allocated === remaining)) &&
    !isCashChangeInsufficient &&
    !mutation.isPending;

  const loadToAccount = () => {
    defaultCashUntouched.current = false;
    if (!collectorLocked) setCollectedByDriver(false);
    setValues({ ACCOUNT: moneyInputValue(remaining) });
    setSelectedPaymentMethod("ACCOUNT");
    setMixedPaymentExpanded(false);
    setLocalError(null);
  };

  const submitPayment = () => {
    if (!canSubmit || submitLock.current) return;
    submitLock.current = true;
    mutation.mutate({
      orderId: order.id,
      customerId: accountAmount ? customerId : undefined,
      ...(order.type === "DELIVERY" ? { collectedByDriver } : {}),
      payments,
      change:
        changeDue > 0
          ? { methodCode: changeMethodCode, amountMinor: changeDue }
          : null,
      payDriverNow:
        isDeliveryWithDriver && !collectedByDriver ? payDriverNow : false,
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      closeDisabled={mutation.isPending}
      title={
        completeOnPay
          ? order.type === "DINE_IN"
            ? "Cobrar y cerrar mesa"
            : "Cobrar y entregar"
          : "Cobrar pedido"
      }
      description={
        completeOnPay
          ? "El cobro y el cierre se guardan como una única operación"
          : "Podés sobrepagar y entregar el vuelto en el medio que desees"
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submitPayment();
        }}
      >
        <fieldset disabled={mutation.isPending} className="m-0 min-w-0 border-0 p-0">
        <div className="rounded-xl bg-slate-950 p-4 text-white">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
              Saldo a cobrar
            </p>
            {onOpenDeposit ? (
              <button
                type="button"
                onClick={onOpenDeposit}
                className="text-xs font-semibold text-indigo-300 hover:text-indigo-100 underline inline-flex items-center gap-1"
              >
                <Receipt size={13} />
                {order.depositMinor > 0
                  ? `Seña: −${formatMoney(order.depositMinor)} (Editar)`
                  : "Restar seña"}
              </button>
            ) : null}
          </div>
          <p className="text-3xl font-extrabold">{formatMoney(remaining)}</p>
          {order.depositMinor > 0 ? (
            <p className="mt-1 text-xs text-indigo-200">
              Total {formatMoney(order.totalMinor + order.depositMinor)} − Seña{" "}
              {formatMoney(order.depositMinor)}
            </p>
          ) : null}
        </div>
        {!mixedPaymentExpanded ? <div className="mt-4 flex flex-wrap gap-2" aria-label="Medio de pago">
          {activePaymentMethods.map((method) => (
            <button key={method.code} type="button" aria-label={`Usar ${method.name}`} aria-pressed={selectedPaymentMethod === method.code} disabled={mutation.isPending} onClick={() => {
              setSelectedPaymentMethod(method.code);
              setValues({ [method.code]: moneyInputValue(remaining) });
              setReferences({});
              defaultCashUntouched.current = false;
              if (method.code !== "CASH" && !collectorLocked) setCollectedByDriver(false);
              setLocalError(null);
              window.requestAnimationFrame(() => { firstPaymentInputRef.current?.focus(); firstPaymentInputRef.current?.select(); });
            }} className={cn("rounded-full border px-3 py-1.5 text-sm font-semibold", selectedPaymentMethod === method.code ? "border-brand-600 bg-brand-50 text-brand-800" : "border-slate-300 bg-white text-slate-700")}>
              {method.name}
            </button>
          ))}
        </div> : null}
        {!mixedPaymentExpanded && selectedPaymentMethod ? <div className="mt-3 max-w-sm space-y-2">
          {(() => { const method = activePaymentMethods.find((item) => item.code === selectedPaymentMethod); if (!method) return null; return <>
            <Field label={method.name}>
              <Input ref={firstPaymentInputRef} inputMode="decimal" value={values[method.code] ?? ""} disabled={mutation.isPending} onChange={(event) => {
                const next = event.target.value; setLocalError(null);
                if (method.code === "CASH") defaultCashUntouched.current = false;
                else if (!collectorLocked && (parseMoneyInput(next) ?? 0) > 0) setCollectedByDriver(false);
                if (method.code === "ACCOUNT" && defaultCashUntouched.current && (parseMoneyInput(next) ?? 0) > 0) defaultCashUntouched.current = false;
                setValues((current) => ({ ...current, [method.code]: next }));
              }} placeholder="0" />
            </Field>
            {method.code === "TRANSFER" ? <Field label="Referencia / comprobante"><Input value={references.TRANSFER ?? ""} disabled={mutation.isPending} onChange={(event) => setReferences((current) => ({ ...current, TRANSFER: event.target.value }))} placeholder="Opcional" /></Field> : null}
          </>; })()}
        </div> : null}
        <button type="button" aria-expanded={mixedPaymentExpanded} disabled={mutation.isPending} onClick={() => setMixedPaymentExpanded(true)} className="mt-3 text-sm font-semibold text-indigo-700 underline">Pago mixto</button>
        {mixedPaymentExpanded ? <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {data.paymentMethods
            .filter((method) => method.active)
            .map((method, index) => (
              <div key={method.code} className="space-y-2">
                <Field label={method.name}>
                  <Input
                    ref={index === 0 ? firstPaymentInputRef : undefined}
                    inputMode="decimal"
                    value={values[method.code] ?? ""}
                    disabled={mutation.isPending}
                    onChange={(event) => {
                      setLocalError(null);
                      if (method.code === "CASH")
                        defaultCashUntouched.current = false;
                      else if (
                        !collectorLocked &&
                        (parseMoneyInput(event.target.value) ?? 0) > 0
                      )
                        setCollectedByDriver(false);
                      if (
                        method.code === "ACCOUNT" &&
                        defaultCashUntouched.current &&
                        (parseMoneyInput(event.target.value) ?? 0) > 0
                      ) {
                        defaultCashUntouched.current = false;
                        setValues((current) => ({
                          ...current,
                          CASH: "0",
                          [method.code]: event.target.value,
                        }));
                        return;
                      }
                      setValues((current) => ({
                        ...current,
                        [method.code]: event.target.value,
                      }));
                    }}
                    placeholder="0"
                  />
                </Field>
                {method.code === "TRANSFER" ? (
                  <Field label="Referencia / comprobante">
                    <Input
                      value={references[method.code] ?? ""}
                      disabled={mutation.isPending}
                      onChange={(event) =>
                        setReferences((current) => ({
                          ...current,
                          [method.code]: event.target.value,
                        }))
                      }
                      placeholder="Opcional"
                    />
                  </Field>
                ) : null}
              </div>
            ))}
        </div> : null}

        {completeOnPay && order.type === "DELIVERY" ? (
          <div className="mt-3 grid gap-3">
            <Field
              label="Repartidor"
              hintMode={driverSelectionLocked ? "inline" : "help"}
              hint={
                driverSelectionLocked
                  ? "Se mantiene el repartidor asignado porque el pedido ya tiene un pago parcial."
                  : "Elegí quién realizará la entrega; no se asignará automáticamente."
              }
            >
              <Select
                value={driverUserId}
                onChange={(event) => {
                  setDriverUserId(event.target.value);
                  setLocalError(null);
                }}
                disabled={driverSelectionLocked || mutation.isPending}
              >
                <option value="">Elegir repartidor…</option>
                {activeDeliveryDrivers.map((driver) => (
                  <option key={driver.id} value={driver.id}>
                    {driver.fullName}
                  </option>
                ))}
                {driverSelectionLocked &&
                driverUserId &&
                !activeDeliveryDrivers.some(
                  (driver) => driver.id === driverUserId,
                ) ? (
                  <option value={driverUserId}>
                    {assignedDriver?.fullName ?? "Repartidor asignado"}{" "}
                    (inactivo)
                  </option>
                ) : null}
              </Select>
            </Field>
            {driverRequired ? (
              <p role="alert" className="text-xs font-semibold text-rose-700">
                Elegí un repartidor para entregar el pedido.
              </p>
            ) : null}
            {!activeDeliveryDrivers.length && !driverSelectionLocked ? (
              <p role="alert" className="text-xs font-semibold text-rose-700">
                No hay repartidores activos. Activá o creá uno antes de
                entregar.
              </p>
            ) : null}
            <label className="flex cursor-pointer select-none items-start gap-3 rounded-xl border border-slate-200 p-3 text-xs">
              <input
                type="checkbox"
                aria-label="Cobró el repartidor"
                checked={collectedByDriver}
                onChange={(event) => setCollectedByDriver(event.target.checked)}
                disabled={
                  collectorLocked ||
                  !driverUserId ||
                  hasNonCashPayment ||
                  mutation.isPending
                }
                className="mt-0.5 h-4 w-4 rounded accent-brand-600"
              />
              <span>
                <strong>Cobró el repartidor</strong>
                <span className="mt-0.5 block text-slate-600">
                  {collectorLocked
                    ? "Se conserva el responsable de los pagos ya registrados."
                    : hasNonCashPayment
                      ? "Sólo se permite para cobro exclusivamente en efectivo. Al volver a efectivo, no se marcará automáticamente."
                      : "Marcá sólo si el repartidor recibe el efectivo del cliente contra entrega."}
                </span>
              </span>
            </label>
            {allocated > 0 ? (
              <div
                className="space-y-1 text-xs text-slate-600"
                aria-label="Quién recibe el cobro"
              >
                {atDoorCash ? (
                  <>
                    <p>
                      El efectivo lo recibe el repartidor
                      {collectionDriver ? `: ${collectionDriver}` : " elegido"};
                      no ingresa efectivo a esta caja.
                    </p>
                    {isDeliveryWithDriver ? (
                      <p>
                        El repartidor retiene el importe de su envío; el resto
                        queda pendiente de rendición. No se paga el envío desde
                        caja.
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p>
                    {accountAmount > 0
                      ? "El importe en cuenta corriente queda como deuda del cliente al negocio; no es efectivo ni una deuda del repartidor."
                      : incomingCashMinor > 0
                        ? "El cobro lo recibe el negocio. La parte en efectivo ingresa a esta caja; elegir efectivo no crea por sí solo una deuda del repartidor. Los otros medios no aumentan el efectivo."
                        : "El cobro lo recibe el negocio mediante medios no efectivos; no aumenta el efectivo de caja."}
                  </p>
                )}
              </div>
            ) : null}
          </div>
        ) : null}

        {data.paymentMethods.some(
          (method) => method.code === "ACCOUNT" && method.active,
        ) && remaining > 0 ? (
          <Button
            type="button"
            variant="secondary"
            className="mt-3"
            onClick={loadToAccount}
          >
            Cargar saldo completo a cuenta corriente
          </Button>
        ) : null}

        {accountAmount > 0 ? (
          <section className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50 p-3 space-y-2">
            <p className="text-xs font-bold text-indigo-900">
              Cuenta corriente · cliente obligatorio
            </p>
            <p className="text-xs text-indigo-700">
              {completeOnPay
                ? "Se registrará el cobro y el pedido se entregará/cerrará."
                : "Se registrará el cobro y el pedido quedará pagado, sin entregarse ni cerrarse."}{" "}
              El importe {formatMoney(accountAmount)} se cargará como deuda, sin
              ingreso de efectivo.
            </p>
            {order.type === "DELIVERY" &&
            payments.some((payment) => payment.methodCode === "CASH") ? (
              <p className="text-xs font-semibold text-indigo-700">
                El efectivo de este cobro mixto se registra como recibido en la
                caja del negocio, no por el repartidor.
              </p>
            ) : null}
            {!customerId ? (
              <p role="alert" className="text-xs font-semibold text-rose-700">
                Seleccioná una ficha de cliente activa para habilitar el cobro
                en cuenta corriente. Los datos escritos en el pedido son sólo
                una referencia y no vinculan una ficha.
              </p>
            ) : null}
            {customerId ? (
              <div className="flex items-center gap-2 text-xs">
                <span className="font-bold">
                  {customerResults.find(
                    (customer) => customer.id === customerId,
                  )?.name ??
                    order.customerNameSnapshot ??
                    customerName ??
                    "Cliente seleccionado"}
                </span>
                {!order.customerId ? (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setCustomerId(null)}
                  >
                    Cambiar
                  </Button>
                ) : null}
              </div>
            ) : (
              <>
                <div className="flex gap-2">
                  <Input
                    aria-label="Buscar cliente para cuenta corriente"
                    value={customerQuery}
                    onChange={(event) => setCustomerQuery(event.target.value)}
                    placeholder="Nombre o teléfono"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={async () => {
                      try {
                        setCustomerResults(
                          (
                            await window.gastronomy.searchCustomers(
                              customerQuery,
                            )
                          ).filter((customer) => customer.active),
                        );
                        setLocalError(null);
                      } catch (error) {
                        setLocalError(humanError(error));
                      }
                    }}
                  >
                    Buscar
                  </Button>
                </div>
                {customerResults.map((customer) => (
                  <button
                    type="button"
                    key={customer.id}
                    className="block w-full rounded-lg bg-white p-2 text-left text-xs hover:bg-indigo-100"
                    onClick={() => setCustomerId(customer.id)}
                  >
                    {customer.name} · {customer.phone}
                  </button>
                ))}
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input
                    aria-label="Nombre del cliente nuevo"
                    value={customerName}
                    onChange={(event) => setCustomerName(event.target.value)}
                    placeholder="Nuevo cliente · nombre"
                  />
                  <Input
                    aria-label="Teléfono del cliente nuevo"
                    value={customerPhone}
                    onChange={(event) => setCustomerPhone(event.target.value)}
                    placeholder="Teléfono"
                  />
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!customerName.trim() || !customerPhone.trim()}
                  onClick={async () => {
                    try {
                      const customer = await window.gastronomy.createCustomer({
                        name: customerName.trim(),
                        phone: customerPhone.trim(),
                      });
                      setCustomerId(customer.id);
                      setCustomerResults([customer]);
                      setLocalError(null);
                    } catch (error) {
                      setLocalError(humanError(error));
                    }
                  }}
                >
                  Crear y seleccionar cliente
                </Button>
              </>
            )}
          </section>
        ) : null}

        {changeDue > 0 && !accountAmount ? (
          <div className="mt-3 rounded-xl border border-emerald-300 bg-emerald-50/80 p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-800">
                  Vuelto a entregar
                </span>
                <p className="text-xs text-emerald-700">
                  Sobrepago recibido: {formatMoney(changeDue)}
                </p>
              </div>
              <span className="text-2xl font-black text-emerald-700">
                {formatMoney(changeDue)}
              </span>
            </div>
            <Field label="Entregar vuelto en:">
              <Select
                value={changeMethodCode}
                onChange={(event) => {
                  setChangeMethodCode(event.target.value);
                  setLocalError(null);
                }}
              >
                {data.paymentMethods
                  .filter(
                    (method) => method.active && method.code !== "ACCOUNT",
                  )
                  .map((method) => (
                    <option key={method.code} value={method.code}>
                      {method.name}{" "}
                      {method.affectsCash
                        ? "(Efectivo de caja)"
                        : "(Electrónico / No caja)"}
                    </option>
                  ))}
              </Select>
            </Field>
            {invalidDriverChange ? (
              <p role="alert" className="text-xs font-semibold text-rose-700">
                Cuando cobra el repartidor, el vuelto debe ser en efectivo.
                Elegí Efectivo para el vuelto.
              </p>
            ) : null}
            {isCashChangeInsufficient ? (
              <p
                role="alert"
                className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs font-semibold text-rose-700"
              >
                La caja no cuenta con efectivo suficiente (
                {formatMoney(drawerCashAvailable)}) para entregar este vuelto (
                {formatMoney(changeDue)}).
              </p>
            ) : null}
          </div>
        ) : null}

        {isDeliveryWithDriver && !atDoorCash ? (
          <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50/70 p-3">
            <label className="flex items-start gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={payDriverNow}
                onChange={(event) => setPayDriverNow(event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded accent-brand-600"
              />
              <div className="text-xs">
                <span className="font-bold text-slate-800">
                  Pagar envío al repartidor ahora (
                  {formatMoney(driverRemunerationMinor)})
                </span>
                <p className="text-slate-600 mt-0.5">
                  {payDriverNow
                    ? `Se registrará el egreso de caja (${formatMoney(driverRemunerationMinor)}) y el reparto quedará liquidado.`
                    : "El envío se acumulará en la cuenta corriente del repartidor para liquidarse luego en la sección Repartidores."}
                </p>
              </div>
            </label>
          </div>
        ) : null}

        <div
          className={cn(
            "mt-4 flex items-center justify-between rounded-lg p-3 text-xs font-bold",
            allocated === remaining
              ? "bg-emerald-50 text-emerald-700"
              : allocated > remaining
                ? "bg-blue-50 text-blue-800"
                : "bg-amber-50 text-amber-700",
          )}
        >
          <span>
            {allocated > remaining
              ? accountAmount > 0
                ? "Exceso asignado"
                : "Total abonado (con sobrepago)"
              : allocated === remaining
                ? "Asignado"
                : "Falta abonar"}
          </span>
          <span>
            {allocated > remaining
              ? accountAmount > 0
                ? `${formatMoney(allocated)} / ${formatMoney(remaining)}`
                : `${formatMoney(allocated)} · Vuelto: ${formatMoney(changeDue)}`
              : `${formatMoney(allocated)} / ${formatMoney(remaining)}`}
          </span>
        </div>

        {accountAmount > 0 && allocated > remaining ? (
          <p role="alert" className="mt-2 text-xs font-semibold text-rose-700">
            La cuenta corriente no admite vuelto: hay{" "}
            {formatMoney(allocated - remaining)} de más. Ajustá los importes
            para que el total coincida exactamente con el saldo.
          </p>
        ) : null}

        {!activePaymentMethods.length || hasInvalidAmount || hasInactiveAllocation ? (
          <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-2 text-xs text-rose-700">
            {!activePaymentMethods.length ? "No hay medios de pago activos. Revisá la configuración antes de cobrar." : hasInactiveAllocation ? "Un medio asignado ya no está activo. Volvé a abrir el cobro y elegí un medio disponible." : "Ingresá importes válidos y no negativos en todos los medios utilizados."}
          </p>
        ) : null}
        {localError ? (
          <p
            role="alert"
            className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700"
          >
            {localError}
          </p>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={mutation.isPending}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            <CreditCard size={16} />
            {completeOnPay
              ? order.type === "DINE_IN"
                ? "Cobrar y cerrar"
                : "Cobrar y entregar"
              : "Confirmar cobro"}
          </Button>
        </div>
        </fieldset>
      </form>
    </Modal>
  );
}
