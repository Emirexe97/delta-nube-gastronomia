import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  BookOpen,
  CashRegister,
  CheckCircle,
  Compass,
  Package,
  Receipt,
  ShieldCheck,
} from "@phosphor-icons/react";
import { Button, Card, Modal, cn } from "@gastronomy/ui";
import type {
  BootstrapDto,
  SaveTutorialProgressInput,
  TutorialProgressDto,
} from "@gastronomy/contracts";
import {
  TUTORIAL_STEPS,
  tutorialCapabilities,
  tutorialStepIndex,
} from "./tutorial-content";

type TutorialControls = {
  progress?: TutorialProgressDto;
  loading: boolean;
  busy: boolean;
  error: string | null;
  retry(): void;
  start(resume?: boolean): void;
};
const TutorialContext = createContext<TutorialControls | null>(null);

/** Mounted only after bootstrap and the initial PIN gate. No business mutations. */
export function TutorialProvider({
  children,
  data,
  accountKey,
  ready,
}: {
  children: ReactNode;
  data: BootstrapDto;
  accountKey: string;
  ready: boolean;
}) {
  const client = useQueryClient();
  const scope = JSON.stringify([data.currentUser.id, accountKey]);
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const queryKey = ["tutorial-progress", data.currentUser.id, accountKey];
  const progress = useQuery({
    queryKey,
    queryFn: () => window.gastronomy.getTutorialProgress(),
    enabled: ready,
    retry: false,
  });
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [practiceKey, setPracticeKey] = useState(0);
  const saving = useRef(false);
  const offered = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  // Reset only the guide, never remount the shell (which may contain drafts).
  useEffect(() => {
    offered.current = false;
    saving.current = false;
    setOpen(false);
    setBusy(false);
    setError(null);
    setStep(0);
  }, [scope]);
  useEffect(() => {
    if (!ready || !progress.data || offered.current) return;
    offered.current = true;
    if (
      progress.data.status === "NOT_STARTED" ||
      progress.data.status === "IN_PROGRESS"
    ) {
      trigger.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setStep(tutorialStepIndex(progress.data.stepId));
      setOpen(true);
    }
  }, [progress.data, scope, ready]);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      // The shared Modal owns the scroll container. Each lesson starts at its top,
      // even when Siguiente was reached by scrolling on a small screen.
      content.current?.parentElement?.scrollTo({ top: 0 });
      heading.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [open, step]);

  const persist = async (
    status: SaveTutorialProgressInput["status"],
    index: number,
    after: () => void,
  ) => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      const saved = await window.gastronomy.saveTutorialProgress({
        version: 1,
        status,
        stepId: TUTORIAL_STEPS[index]!.id,
      });
      client.setQueryData(queryKey, saved);
      if (activeScope.current === scope) after();
    } catch {
      if (activeScope.current === scope)
        setError(
          "No pudimos guardar tu avance. Volvé a intentar. Si salís sin guardar, el tutorial puede aparecer nuevamente.",
        );
    } finally {
      if (activeScope.current === scope) {
        saving.current = false;
        setBusy(false);
      }
    }
  };
  const closeTutorial = () => {
    setOpen(false);
    requestAnimationFrame(() => {
      if (
        trigger.current?.isConnected &&
        !trigger.current.closest("[hidden], [inert]")
      )
        trigger.current.focus({ preventScroll: true });
    });
  };
  const start = (resume = false) => {
    trigger.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const index =
      resume && progress.data ? tutorialStepIndex(progress.data.stepId) : 0;
    offered.current = true;
    void persist("IN_PROGRESS", index, () => {
      setStep(index);
      setPracticeKey((key) => key + 1);
      setOpen(true);
    });
  };
  const dismiss = () => void persist("SKIPPED", step, closeTutorial);
  const current = TUTORIAL_STEPS[step]!;
  const controls: TutorialControls = {
    progress: progress.data,
    loading: !ready || progress.isLoading,
    busy,
    error:
      error ??
      (progress.isError
        ? "No pudimos cargar el tutorial. Podés seguir usando el programa y reintentar desde acá."
        : null),
    retry: () => {
      setError(null);
      void progress.refetch();
    },
    start,
  };
  return (
    <TutorialContext.Provider value={controls}>
      <div
        className="contents"
        ref={(node) => node?.toggleAttribute("inert", open)}
      >
        {children}
      </div>
      <Modal
        open={open}
        onClose={dismiss}
        closeDisabled={busy}
        title="Primeros pasos en Delta Nube"
        description="Un recorrido de 3 minutos · Podés salir y retomarlo desde Configuración → Tutorial."
        width="max-w-4xl"
      >
        <div ref={content} className="space-y-5" data-testid="user-tutorial">
          <div>
            <div className="flex items-center justify-between gap-3 text-xs font-semibold text-slate-500">
              <span className="flex items-center gap-1.5 text-brand-700">
                <ShieldCheck size={16} /> Práctica segura · datos de ejemplo
              </span>
              <span aria-live="polite">
                Paso {step + 1} de {TUTORIAL_STEPS.length}
              </span>
            </div>
            <div
              role="progressbar"
              aria-label="Avance del tutorial"
              aria-valuemin={0}
              aria-valuemax={5}
              aria-valuenow={step + 1}
              className="mt-3 flex gap-1.5"
            >
              {TUTORIAL_STEPS.map((item, index) => (
                <span
                  key={item.id}
                  className={cn(
                    "h-1.5 flex-1 rounded-full",
                    index <= step ? "bg-brand-600" : "bg-slate-100",
                  )}
                />
              ))}
            </div>
            <ol className="mt-2 hidden grid-cols-5 gap-2 text-[11px] sm:grid">
              {TUTORIAL_STEPS.map((item, index) => (
                <li
                  key={item.id}
                  aria-current={index === step ? "step" : undefined}
                  className={cn(
                    index === step
                      ? "font-bold text-brand-800"
                      : "text-slate-500",
                  )}
                >
                  {index + 1}. {item.label}
                </li>
              ))}
            </ol>
          </div>
          <div>
            <h3
              ref={heading}
              tabIndex={-1}
              className="text-2xl font-semibold tracking-tight text-slate-950 outline-none"
            >
              {current.title}
            </h3>
            <TutorialLesson
              key={`${practiceKey}-${current.id}`}
              step={current.id}
              data={data}
            />
          </div>
          {error ? (
            <div
              role="alert"
              className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"
            >
              {error}{" "}
              <button
                type="button"
                className="focus-ring min-h-10 underline"
                onClick={closeTutorial}
              >
                Salir sin guardar
              </button>
            </div>
          ) : null}
          <footer className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-white py-3">
            <button
              type="button"
              disabled={busy}
              onClick={dismiss}
              className="focus-ring min-h-11 rounded-lg px-3 text-sm font-semibold text-slate-500 hover:bg-slate-50 disabled:opacity-50"
            >
              Omitir por ahora
            </button>
            <div className="flex gap-2">
              {step > 0 ? (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    void persist("IN_PROGRESS", step - 1, () =>
                      setStep(step - 1),
                    )
                  }
                >
                  Anterior
                </Button>
              ) : null}
              <Button
                disabled={busy}
                onClick={() =>
                  void persist(
                    step === 4 ? "COMPLETED" : "IN_PROGRESS",
                    Math.min(step + 1, 4),
                    () => (step === 4 ? closeTutorial() : setStep(step + 1)),
                  )
                }
              >
                {busy
                  ? "Guardando…"
                  : step === 4
                    ? "Finalizar tutorial"
                    : step === 0
                      ? "Empezar recorrido"
                      : "Siguiente"}{" "}
                {!busy && step < 4 ? <ArrowRight size={16} /> : null}
              </Button>
            </div>
          </footer>
        </div>
      </Modal>
    </TutorialContext.Provider>
  );
}

export function TutorialSettingsPanel() {
  const tutorial = useContext(TutorialContext);
  const status = tutorial?.progress?.status;
  const canResume = status === "IN_PROGRESS" || status === "SKIPPED";
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <div className="rounded-2xl bg-brand-50 p-3 text-brand-700">
          <BookOpen size={28} weight="duotone" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-wider text-brand-700">
            Aprendé a tu ritmo
          </p>
          <h3 className="mt-1 text-xl font-semibold">Tutorial de uso</h3>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">
            Conocé el programa y practicá cómo preparar la caja, tomar un pedido
            y cobrar. Son 5 pasos con ejemplos que no modifican tus datos.
          </p>
          <p
            className="mt-3 text-xs font-semibold text-slate-500"
            role="status"
          >
            {status === "COMPLETED"
              ? "Tutorial completado. Podés repetirlo cuando quieras."
              : canResume
                ? `Guardado en el paso ${tutorialStepIndex(tutorial?.progress?.stepId ?? "welcome") + 1} de 5.`
                : "Duración aproximada: 3 minutos."}
          </p>
          {tutorial?.error ? (
            <div role="alert" className="mt-3 text-sm text-rose-700">
              {tutorial.error}{" "}
              <button
                type="button"
                className="min-h-10 underline"
                onClick={tutorial.retry}
              >
                Reintentar
              </button>
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            {canResume ? (
              <Button
                disabled={tutorial?.busy || tutorial?.loading}
                onClick={() => tutorial?.start(true)}
              >
                Continuar tutorial
              </Button>
            ) : null}
            <Button
              variant={canResume ? "secondary" : "primary"}
              disabled={!tutorial || tutorial.busy || tutorial.loading}
              onClick={() => tutorial?.start()}
            >
              {status && status !== "NOT_STARTED"
                ? "Volver a hacer el tutorial"
                : "Iniciar tutorial"}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function TutorialLesson({
  step,
  data,
}: {
  step: TutorialProgressDto["stepId"];
  data: BootstrapDto;
}) {
  const capabilities = tutorialCapabilities(data);
  const [practiced, setPracticed] = useState(false);
  const [sent, setSent] = useState(false);
  const [channel, setChannel] = useState(capabilities.channels[0] ?? "Pedido");
  const notes = (title: string, body: string) => (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h4 className="text-sm font-bold">{title}</h4>
      <p className="mt-1 text-sm leading-6 text-slate-600">{body}</p>
    </div>
  );
  const example = (children: ReactNode) => (
    <div className="rounded-2xl border border-brand-100 bg-brand-50/50 p-5">
      <p className="mb-4 text-[11px] font-bold uppercase tracking-widest text-brand-700">
        Ejemplo interactivo · no es una operación real
      </p>
      {children}
    </div>
  );
  if (step === "welcome")
    return (
      <>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
          Bienvenido a {data.settings.businessName || "tu negocio"}. Vas a
          recorrer lo esencial para trabajar con confianza, sin abrir cajas
          reales, crear ventas ni imprimir comprobantes.
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {[
            [
              Compass,
              "Encontrá cada sección",
              "La barra lateral conecta la operación, la gestión y el control del negocio.",
            ],
            [
              Receipt,
              "Practicá una venta",
              "Prepará el turno, armá el pedido y registrá un cobro de ejemplo.",
            ],
            [
              BookOpen,
              "Volvé cuando necesites",
              "Tu avance se guarda. El tutorial siempre está en Configuración → Tutorial.",
            ],
          ].map(([Icon, title, body]) => {
            const ItemIcon = Icon as typeof Compass;
            return (
              <div key={String(title)} className="rounded-2xl bg-slate-50 p-5">
                <ItemIcon
                  size={30}
                  weight="duotone"
                  className="mb-4 text-brand-700"
                />
                <h4 className="text-sm font-bold">{String(title)}</h4>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {String(body)}
                </p>
              </div>
            );
          })}
        </div>
        <p className="mt-4 text-xs text-slate-500">
          Los ejemplos son opcionales. Usá Siguiente para avanzar o Escape para
          salir.
        </p>
      </>
    );
  if (step === "preparation")
    return (
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          {notes(
            "1. Revisá Productos",
            "Antes de vender, verificá los productos y los precios del canal que vas a usar. Si tu rol no permite editarlos, pedile ayuda al administrador.",
          )}
          {notes(
            "2. Abrí el turno en Caja",
            capabilities.cash
              ? "Ingresá el efectivo inicial disponible para dar cambio y confirmá la apertura. El encabezado te indica si la caja está abierta."
              : "Pedile a una persona autorizada que abra la caja con el efectivo inicial. Tu rol no permite abrirla.",
          )}
          {notes(
            "Una base lista para operar",
            capabilities.settings
              ? "En Configuración revisá los datos del negocio, los canales habilitados y las impresoras. En Usuarios podés administrar el equipo y sus permisos."
              : "El administrador configura los canales, las impresoras y los permisos del equipo.",
          )}
        </div>
        {example(
          <>
            <CashRegister
              size={32}
              weight="duotone"
              className="text-brand-700"
            />
            <h4 className="mt-3 text-lg font-semibold">
              {practiced
                ? "Caja de ejemplo abierta"
                : "Prepará el cambio inicial"}
            </h4>
            <div className="my-4 rounded-xl bg-white p-4">
              <p className="text-xs text-slate-500">
                Efectivo inicial de ejemplo
              </p>
              <p className="mt-1 text-2xl font-bold">$ 10.000</p>
            </div>
            <Button
              variant="secondary"
              disabled={practiced}
              onClick={() => setPracticed(true)}
            >
              {practiced ? "Apertura practicada" : "Probar apertura de caja"}
            </Button>
            <p role="status" className="mt-3 text-sm text-brand-800">
              {practiced
                ? "¡Bien! En una apertura real, el monto debe coincidir con el efectivo disponible."
                : "Este botón solo cambia el ejemplo."}
            </p>
          </>,
        )}
      </div>
    );
  if (step === "order")
    return (
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          {notes(
            "1. Elegí el canal",
            capabilities.channels.length
              ? `Tenés habilitado: ${capabilities.channels.join(", ")}. ${data.settings.modules.diningRoom ? "En Salón, elegí una mesa para atenderla. " : ""}${data.settings.modules.takeaway || data.settings.modules.delivery ? "Desde Pedidos gestionás los pedidos para llevar o de delivery habilitados." : ""}`
              : "No hay canales habilitados. Pedile al administrador que los revise en Configuración.",
          )}
          {notes(
            "2. Agregá y revisá",
            capabilities.orders
              ? "Buscá el producto, agregalo y revisá las cantidades, el precio y las observaciones. Para llevar o delivery, completá los datos del cliente; en delivery verificá también la dirección."
              : "Tu rol no permite crear pedidos. Este ejemplo te muestra el flujo para que puedas coordinarlo con una persona autorizada.",
          )}
          {notes(
            "3. Confirmá la comanda",
            "Revisá el pedido antes de confirmarlo o enviarlo a cocina. Si la impresión falla, el pedido puede haber quedado guardado: revisá su estado antes de volver a cargarlo.",
          )}
        </div>
        {example(
          <>
            <div
              className="mb-4 flex flex-wrap gap-2"
              role="group"
              aria-label="Canal del ejemplo"
            >
              {capabilities.channels.map((name) => (
                <button
                  key={name}
                  type="button"
                  aria-pressed={channel === name}
                  onClick={() => setChannel(name)}
                  className={cn(
                    "focus-ring min-h-10 rounded-lg border px-3 text-xs font-semibold",
                    channel === name
                      ? "border-brand-600 bg-white text-brand-800"
                      : "border-transparent text-slate-500",
                  )}
                >
                  {name}
                </button>
              ))}
            </div>
            <div className="rounded-xl bg-white p-4">
              <div className="flex items-center gap-3">
                <Package size={24} className="text-brand-700" />
                <span className="font-semibold">Pizza muzzarella</span>
              </div>
              <p className="mt-2 text-sm text-slate-600">
                1 unidad · $ 8.000 · {channel}
              </p>
              <Button
                className="mt-4"
                variant="secondary"
                disabled={practiced}
                onClick={() => setPracticed(true)}
              >
                {practiced
                  ? "Producto agregado"
                  : "Agregar al pedido de ejemplo"}
              </Button>
            </div>
            <p
              role="status"
              className="mt-4 text-sm font-semibold text-brand-800"
            >
              {practiced
                ? "Pedido de ejemplo: 1 producto · Total $ 8.000"
                : "Probá agregar tu primer producto."}
            </p>
          </>,
        )}
      </div>
    );
  if (step === "payment")
    return (
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          {notes(
            "El pedido y el pago son distintos",
            "Enviar una comanda a cocina no significa que el pedido esté cobrado. Verificá el total y cualquier pago ya registrado antes de cobrar.",
          )}
          {notes(
            "Registrá el cobro",
            "Abrí el pedido y su opción de cobro. Elegí el medio de pago y el importe, revisá el saldo pendiente y confirmá. Usá el medio que realmente recibiste.",
          )}
          {notes(
            "Si necesitás corregir algo",
            "No dupliques el pedido ni el pago. Revisá los pagos registrados y pedí autorización si necesitás una devolución o una corrección. Nunca compartas tu PIN.",
          )}
        </div>
        {example(
          <>
            <Receipt size={32} weight="duotone" className="text-brand-700" />
            <h4 className="mt-3 text-lg font-semibold">Pedido de ejemplo</h4>
            <div className="my-4 space-y-2 rounded-xl bg-white p-4 text-sm">
              <div className="flex justify-between">
                <span>1 × Pizza muzzarella</span>
                <strong>$ 8.000</strong>
              </div>
              <div className="flex justify-between border-t pt-2">
                <span>Saldo pendiente</span>
                <strong>{practiced ? "$ 0" : "$ 8.000"}</strong>
              </div>
            </div>
            <Button
              variant="secondary"
              disabled={sent}
              onClick={() => setSent(true)}
            >
              {sent ? "Comanda enviada (ejemplo)" : "Simular envío a cocina"}
            </Button>
            <Button
              className="mt-2"
              disabled={!sent || practiced}
              onClick={() => setPracticed(true)}
            >
              {practiced ? "Cobro practicado" : "Simular cobro en efectivo"}
            </Button>
            <p role="status" className="mt-3 text-sm text-brand-800">
              {practiced
                ? "¡Listo! El pago de ejemplo canceló el saldo. No se registró dinero ni se imprimió nada."
                : sent
                  ? "La comanda está enviada, pero todavía falta cobrar $ 8.000."
                  : "Primero enviá la comanda de ejemplo."}
            </p>
          </>,
        )}
      </div>
    );
  return (
    <>
      <div className="mt-4 flex items-start gap-3 rounded-2xl bg-brand-50 p-5">
        <CheckCircle
          size={32}
          weight="duotone"
          className="shrink-0 text-brand-700"
        />
        <div>
          <h4 className="font-semibold text-brand-900">
            Preparar → tomar el pedido → cobrar
          </h4>
          <p className="mt-1 text-sm leading-6 text-brand-800">
            Ese es el flujo esencial. Ahora podés salir del tutorial y empezar
            con tus datos reales, a tu ritmo.
          </p>
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {notes(
          "Al terminar el turno",
          capabilities.closeCash
            ? "En Caja revisá los pedidos pendientes, contá todo el efectivo e indicá el cambio que vas a dejar. Revisá el resumen antes de confirmar el cierre definitivo."
            : "Coordiná el cierre con una persona autorizada. Antes, revisá que no queden pedidos pendientes de resolver.",
        )}
        {notes(
          "Seguimiento del negocio",
          capabilities.reports
            ? "En Resumen tenés una vista del día. En Informes podés revisar la actividad y consultar períodos anteriores."
            : "En Resumen encontrás la vista general. Pedile a una persona autorizada los informes que necesites.",
        )}
        {notes(
          "Cuidá tu información",
          capabilities.settings
            ? "En Configuración → Copias de seguridad podés crear un respaldo. Guardalo en un lugar seguro; restaurar una copia reemplaza los datos y requiere autorización."
            : "Pedile al administrador que mantenga copias de seguridad del negocio. Las autorizaciones y los PIN son personales.",
        )}
        {notes(
          "Siempre a mano",
          "Volvé a Configuración → Tutorial para repetir este recorrido. También encontrás ayuda contextual en las distintas secciones del programa.",
        )}
      </div>
    </>
  );
}
