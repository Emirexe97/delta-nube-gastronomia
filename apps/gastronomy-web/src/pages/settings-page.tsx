import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type {
  AppSettingsDto,
  BootstrapDto,
  PrinterDeviceDto,
  PrinterProfileDto,
} from "@gastronomy/contracts";
import {
  ArrowClockwise,
  Database,
  GearSix,
  Printer,
  SlidersHorizontal,
  TextT,
} from "@phosphor-icons/react";
import {
  Button,
  Card,
  Field,
  HelpTip,
  Input,
  Select,
  Textarea,
  cn,
} from "@gastronomy/ui";
import { useApiMutation } from "../api";
import { humanError } from "../lib";
import { useLocation, useNavigate } from "react-router-dom";
import { LicensePanel } from "../components/license-panel";
import { AppUpdatePanel } from "../components/app-update-panel";
import { WaiterDeskPanel } from "../components/waiter-desk-panel";
import { WebSitePanel } from "../components/web-site-panel";

const SETTINGS_SECTIONS = [
  ["settings-general", "General"],
  ["settings-printing", "Impresión"],
  ["settings-waiter", "Modo Mozo"],
  ["settings-print-texts", "Textos"],
  ["settings-backup", "Copias de seguridad"],
  ["settings-license", "Licencia"],
  ["settings-website", "Página web"],
  ["settings-updates", "Actualizaciones"],
] as const;

export function SettingsPage({ data }: { data: BootstrapDto }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [settings, setSettings] = useState<AppSettingsDto>(data.settings);
  const [message, setMessage] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState(() => {
    const section = location.hash.slice(1);
    return SETTINGS_SECTIONS.some(([id]) => id === section)
      ? section
      : "settings-general";
  });
  const [visitedSections, setVisitedSections] = useState<Set<string>>(
    () => new Set([activeSection]),
  );
  const settingsAtLastRender = useRef(data.settings);
  const submittedSettings = useRef<AppSettingsDto | null>(null);
  // Bootstrap refreshes can happen while a form is dirty. Only adopt refreshed
  // server state when the user hasn't diverged from the previous baseline.
  useEffect(() => {
    if (
      JSON.stringify(settings) === JSON.stringify(settingsAtLastRender.current)
    ) {
      setSettings(data.settings);
    }
    settingsAtLastRender.current = data.settings;
  }, [data.settings, settings]);
  useEffect(() => {
    const requested = location.hash.slice(1);
    const section = SETTINGS_SECTIONS.some(([id]) => id === requested) ? requested : "settings-general";
    setActiveSection(section);
    setVisitedSections((current) => current.has(section) ? current : new Set(current).add(section));
  }, [location.hash]);
  const selectSection = (id: string) => {
    setActiveSection(id);
    setVisitedSections((current) => new Set(current).add(id));
    if (location.hash !== `#${id}`) {
      navigate(
        { pathname: location.pathname, search: location.search, hash: `#${id}` },
        { state: location.state, replace: true },
      );
    }
  };
  const mutation = useApiMutation(
    (value: AppSettingsDto) => window.gastronomy.saveSettings(value),
    {
      onSuccess: (saved) => {
        setSettings((current) => current === submittedSettings.current ? saved : current);
        settingsAtLastRender.current = saved;
        setMessage("Configuración guardada.");
      },
      onError: (value) => setMessage(humanError(value)),
    },
  );
  const backup = useApiMutation(() => window.gastronomy.createBackup(), {
    onSuccess: (value) =>
      setMessage(
        value.path ? `Copia creada en ${value.path}` : "Copia cancelada.",
      ),
    onError: (value) => setMessage(humanError(value)),
  });
  const restore = useApiMutation(() => window.gastronomy.restoreBackup(), {
    onSuccess: (value) =>
      setMessage(
        value.restored
          ? `Copia restaurada desde ${value.path}`
          : "Restauración cancelada.",
      ),
    onError: (value) => setMessage(humanError(value)),
  });
  const toggleModule = (key: keyof AppSettingsDto["modules"]) =>
    setSettings((current) => ({
      ...current,
      modules: { ...current.modules, [key]: !current.modules[key] },
    }));
  const hasUnsavedSettings =
    JSON.stringify(settings) !== JSON.stringify(data.settings);
  return (
    <div
      data-navigation-dirty={hasUnsavedSettings ? "true" : undefined}
      data-enter-navigation
      className="panel-enter mx-auto max-w-[1100px] space-y-4"
    >
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold tracking-tight">Configuración de Gastronomía</h2>
        <HelpTip label="Ayuda de configuración">
          Ajustá el programa a tu negocio. Los cambios no borran tu historial.
        </HelpTip>
      </div>
      <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3">
        <nav
          role="tablist"
          aria-label="Secciones de configuración"
          className="flex flex-wrap gap-1"
          onKeyDown={(event) => {
            const index = SETTINGS_SECTIONS.findIndex(([id]) => id === activeSection);
            let next = index;
            if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % SETTINGS_SECTIONS.length;
            else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + SETTINGS_SECTIONS.length) % SETTINGS_SECTIONS.length;
            else if (event.key === "Home") next = 0;
            else if (event.key === "End") next = SETTINGS_SECTIONS.length - 1;
            else return;
            event.preventDefault();
            const id = SETTINGS_SECTIONS[next]![0];
            selectSection(id);
            document.getElementById(`tab-${id}`)?.focus();
          }}
        >
          {SETTINGS_SECTIONS.map(([id, label]) => (
            <button
              key={id}
              id={`tab-${id}`}
              type="button"
              role="tab"
              aria-selected={activeSection === id}
              aria-controls={`panel-${id}`}
              tabIndex={activeSection === id ? 0 : -1}
              onClick={() => selectSection(id)}
              className={cn("focus-ring min-h-10 rounded-lg px-3 py-2 text-xs font-bold", activeSection === id ? "bg-brand-50 text-brand-800" : "text-slate-600 hover:bg-slate-50")}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
          {message ? (
            <p
              role="status"
              aria-live="polite"
              className="w-full max-w-[520px] break-words rounded-lg bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-800 sm:w-auto"
              title={message}
            >
              {message}
            </p>
          ) : null}
          <Button
            onClick={() => {
              submittedSettings.current = settings;
              mutation.mutate({ ...settings });
            }}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? "Guardando…" : "Guardar configuración"}
          </Button>
        </div>
      </div>
      <div id="panel-settings-general" role="tabpanel" aria-labelledby="tab-settings-general" hidden={activeSection !== "settings-general"} className="space-y-4">
      <section id="settings-general" className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <Card className="p-4">
          <SectionTitle
            icon={GearSix}
            title="Datos generales"
            detail="Preferencias del negocio"
          />
          <div className="mt-4 grid gap-4">
            <Field label="Nombre visible">
              <Input
                value={settings.businessName}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    businessName: event.target.value,
                  }))
                }
              />
            </Field>
            <Field label="Cajas simultáneas">
              <Input
                type="number"
                min={1}
                max={1}
                value={settings.maxConcurrentCashSessions}
                disabled
              />
              <p className="text-xs leading-5 text-slate-600">
                La operación actual admite una caja abierta a la vez.
              </p>
            </Field>
            <Field label="Precio mitad y mitad">
              <Select
                value={settings.halfAndHalfPricingMode}
                disabled={settings.halfAndHalfEnabled === false}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    halfAndHalfPricingMode: event.target
                      .value as AppSettingsDto["halfAndHalfPricingMode"],
                  }))
                }
              >
                <option value="HALF_PLUS_HALF">50% + 50%</option>
                <option value="MOST_EXPENSIVE">Variedad más cara</option>
              </Select>
            </Field>
            <label className="flex items-center gap-3 rounded-lg border border-slate-100 p-3 text-xs font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={settings.halfAndHalfEnabled ?? true}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    halfAndHalfEnabled: event.target.checked,
                  }))
                }
                className="h-4 w-4 accent-brand-600"
              />
              Habilitar pizzas mitad y mitad
            </label>
          </div>
        </Card>
        <Card className="p-4">
          <SectionTitle
            icon={SlidersHorizontal}
            title="Módulos visibles"
            detail="Ocultar no destruye datos"
          />
          <div className="mt-4 divide-y divide-slate-100">
            {(
              [
                ["diningRoom", "Salón y mesas"],
                ["takeaway", "Para retirar"],
                ["delivery", "Envíos"],
                ["modifiers", "Modificadores y extras"],
                ["discounts", "Descuentos"],
                ["advancedStatuses", "Estados avanzados"],
              ] as const
            ).map(([key, label]) => (
              <label
                key={key}
                className="flex cursor-pointer items-center justify-between py-3"
              >
                <div>
                  <p className="text-xs font-semibold text-slate-700">
                    {label}
                  </p>
                  <p className="text-xs text-slate-600">
                    {settings.modules[key]
                      ? "Visible y operativo"
                      : "Oculto; datos preservados"}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings.modules[key]}
                  aria-label={`${label}: ${settings.modules[key] ? "visible" : "oculto"}`}
                  onClick={() => toggleModule(key)}
                  className={`relative h-6 w-11 rounded-full transition ${settings.modules[key] ? "bg-brand-600" : "bg-slate-200"}`}
                >
                  <span
                    className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition ${settings.modules[key] ? "left-6" : "left-1"}`}
                  />
                </button>
              </label>
            ))}
          </div>
        </Card>
      </section>
      <Card className="p-4">
        <h3 className="text-sm font-bold">Opciones operativas</h3>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {(
            [
              ["stockEnabled", "Control de stock"],
              ["touchProductPanelEnabled", "Panel táctil de productos"],
              ["deliverySettlementEnabled", "Liquidación de repartidores"],
              ["allowCloseWithPendingOrders", "Permitir cierre con pendientes"],
            ] as const
          ).map(([key, label]) => (
            <label
              key={key}
              className="flex items-center gap-3 rounded-lg border border-slate-100 p-3 text-xs font-semibold text-slate-600"
            >
              <input
                type="checkbox"
                checked={settings[key]}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    [key]: event.target.checked,
                  }))
                }
                className="h-4 w-4 accent-brand-600"
              />
              {label}
            </label>
          ))}
        </div>
        <label className="mt-3 flex items-start gap-3 rounded-lg border border-slate-100 p-3 text-xs font-semibold text-slate-700">
          <input
            type="checkbox"
            checked={settings.deliveryFeeBelongsToDriver ?? true}
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                deliveryFeeBelongsToDriver: event.target.checked,
                deliverySettlementEnabled: event.target.checked
                  ? true
                  : current.deliverySettlementEnabled,
              }))
            }
            className="mt-0.5 h-4 w-4 accent-brand-600"
          />
          <span>
            <span className="block">
              El cobro del envío corresponde al repartidor
            </span>
            <span className="mt-1 block font-normal text-slate-600">
              Activado: el envío se paga al repartidor. Desactivado: queda para el negocio.
              Los pagos al repartidor se descuentan de caja.
            </span>
          </span>
        </label>
        <div className="mt-1 flex justify-end">
          <HelpTip label="Sobre el cobro del envío">
            Activar esta opción también habilita la liquidación de repartidores.
            Cada pedido mantiene esta elección desde su primer pago, aunque después cambies la configuración.
          </HelpTip>
        </div>
        {settings.deliverySettlementEnabled &&
        (settings.deliveryFeeBelongsToDriver ?? true) ? (
          <div className="mt-4 rounded-xl border border-sky-100 bg-sky-50/50 p-3.5 space-y-2">
            <label className="text-xs font-bold text-slate-800">
              Modalidad de pago a repartidores
            </label>
            <p className="text-xs text-slate-600">
              Elegí si los envíos se abonan en el momento del cobro o se
              acumulan para su rendición en lote:
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <label
                className={cn(
                  "flex items-start gap-2.5 rounded-lg border p-2.5 text-xs font-medium cursor-pointer transition",
                  (settings.deliveryDriverPaymentMode ?? "ACCUMULATED") ===
                    "ACCUMULATED"
                    ? "border-brand-500 bg-white shadow-sm text-slate-900"
                    : "border-slate-200 bg-white/50 text-slate-600 hover:bg-white",
                )}
              >
                <input
                  type="radio"
                  name="deliveryDriverPaymentMode"
                  value="ACCUMULATED"
                  checked={
                    (settings.deliveryDriverPaymentMode ?? "ACCUMULATED") ===
                    "ACCUMULATED"
                  }
                  onChange={() =>
                    setSettings((current) => ({
                      ...current,
                      deliveryDriverPaymentMode: "ACCUMULATED",
                    }))
                  }
                  className="mt-0.5 h-3.5 w-3.5 accent-brand-600"
                />
                <div>
                  <span className="font-bold block">
                    Acumular en Repartidores
                  </span>
                  <span className="text-xs text-slate-600">
                    Los envíos quedan en la cuenta del repartidor para
                    liquidarse en lote al final del turno.
                  </span>
                </div>
              </label>
              <label
                className={cn(
                  "flex items-start gap-2.5 rounded-lg border p-2.5 text-xs font-medium cursor-pointer transition",
                  settings.deliveryDriverPaymentMode === "ON_ORDER_PAYMENT"
                    ? "border-brand-500 bg-white shadow-sm text-slate-900"
                    : "border-slate-200 bg-white/50 text-slate-600 hover:bg-white",
                )}
              >
                <input
                  type="radio"
                  name="deliveryDriverPaymentMode"
                  value="ON_ORDER_PAYMENT"
                  checked={
                    settings.deliveryDriverPaymentMode === "ON_ORDER_PAYMENT"
                  }
                  onChange={() =>
                    setSettings((current) => ({
                      ...current,
                      deliveryDriverPaymentMode: "ON_ORDER_PAYMENT",
                    }))
                  }
                  className="mt-0.5 h-3.5 w-3.5 accent-brand-600"
                />
                <div>
                  <span className="font-bold block">
                    Pagar al cobrar pedido
                  </span>
                  <span className="text-xs text-slate-600">
                    Al cobrar o entregar, se preselecciona pagar el envío y se
                    registra el egreso de caja en el momento.
                  </span>
                </div>
              </label>
            </div>
          </div>
        ) : null}
      </Card>
      </div>
      <div id="panel-settings-printing" role="tabpanel" aria-labelledby="tab-settings-printing" hidden={activeSection !== "settings-printing"}>
      {visitedSections.has("settings-printing") ? <PrintingSettingsCard
        settings={settings}
        onChange={setSettings}
        onMessage={setMessage}
      /> : null}
      </div>
      <div id="panel-settings-print-texts" role="tabpanel" aria-labelledby="tab-settings-print-texts" hidden={activeSection !== "settings-print-texts"}>
      {visitedSections.has("settings-print-texts") ? <PrintTextSettingsCard settings={settings} onChange={setSettings} /> : null}
      </div>
      <div id="panel-settings-license" role="tabpanel" aria-labelledby="tab-settings-license" hidden={activeSection !== "settings-license"}>
      {visitedSections.has("settings-license") ? <LicensePanel /> : null}
      </div>
      <div id="panel-settings-waiter" role="tabpanel" aria-labelledby="tab-settings-waiter" hidden={activeSection !== "settings-waiter"}>
      {visitedSections.has("settings-waiter") ? <WaiterDeskPanel data={data} /> : null}
      </div>
      <div id="panel-settings-website" role="tabpanel" aria-labelledby="tab-settings-website" hidden={activeSection !== "settings-website"}>
      {visitedSections.has("settings-website") ? <WebSitePanel /> : null}
      </div>
      <div id="panel-settings-updates" role="tabpanel" aria-labelledby="tab-settings-updates" hidden={activeSection !== "settings-updates"}>
      {visitedSections.has("settings-updates") ? <AppUpdatePanel /> : null}
      </div>
      <div id="panel-settings-backup" role="tabpanel" aria-labelledby="tab-settings-backup" hidden={activeSection !== "settings-backup"}>
      {visitedSections.has("settings-backup") ? <Card id="settings-backup" className="p-4">
        <SectionTitle
          icon={Database}
          title="Copias de seguridad y restauración"
          detail="Guardá una copia de los datos o recuperá una copia anterior"
        />
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => backup.mutate()}
            disabled={backup.isPending || restore.isPending}
          >
            <Database />
            Crear copia local
          </Button>
          <Button
            variant="secondary"
            onClick={() => restore.mutate()}
            disabled={backup.isPending || restore.isPending}
          >
            <ArrowClockwise />
            Restaurar copia
          </Button>
        </div>
      </Card> : null}
      </div>
    </div>
  );
}

function PrintingSettingsCard({
  settings,
  onChange,
  onMessage,
}: {
  settings: AppSettingsDto;
  onChange(value: AppSettingsDto): void;
  onMessage(value: string): void;
}) {
  const [scan, rescan] = useState(0);
  const [printers, setPrinters] = useState<PrinterDeviceDto[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    window.gastronomy
      .listPrinters()
      .then((rows) => {
        if (!cancelled) setPrinters(rows);
      })
      .catch((error) => {
        if (!cancelled) onMessage(humanError(error));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [scan]);
  const updatePrinting = (patch: Partial<AppSettingsDto["printing"]>) =>
    onChange({ ...settings, printing: { ...settings.printing, ...patch } });
  const updateProfile = (key: "kitchen" | "bill", profile: PrinterProfileDto) =>
    updatePrinting({ [key]: profile });
  // A test print uses the previewed form, but must never save/reset its unsaved choices.
  const test = useMutation({
    mutationFn: (kind: "KITCHEN_ORDER" | "CUSTOMER_BILL") => window.gastronomy.testPrinter({ kind, settings }),
    onSuccess: (result) => onMessage(result.message),
    onError: (error) => onMessage(humanError(error)),
  });
  return (
      <Card id="settings-printing" className="p-4">
      <div className="flex items-start justify-between gap-3">
        <SectionTitle
          icon={Printer}
          title="Impresión"
          detail="Comandas de cocina y cuentas de clientes"
        />
        <HelpTip label="Cómo se imprimen las comandas">
          Los pedidos del mozo salen por una sola impresora de cocina. Desde el pedido
          podés imprimir la comanda completa, sólo los agregados o una copia.
          El corte del papel depende de la impresora y su controlador.
        </HelpTip>
      </div>
      <Button variant="secondary" disabled={loading} onClick={() => rescan(n=>n+1)}>
        {loading ? "Buscando impresoras…" : "Actualizar lista de impresoras"}
      </Button>
      <div className="mt-4 grid gap-4">
        <Field
          label="Nombre de la terminal"
          hint="Identifica esta caja en tickets y pruebas."
        >
          <Input
            value={settings.printing.terminalLabel}
            onChange={(event) =>
              updatePrinting({ terminalLabel: event.target.value })
            }
          />
        </Field>
        <div className="grid gap-4 lg:grid-cols-2">
          <PrinterProfileEditor
            title="Comanda de cocina"
            profile={settings.printing.kitchen}
            printers={printers}
            loading={loading}
            requireExplicitDevice
            onChange={(profile) => updateProfile("kitchen", profile)}
            onTest={() => test.mutate("KITCHEN_ORDER")}
            testing={test.isPending}
          />
          <PrinterProfileEditor
            title="Cuenta del cliente"
            profile={settings.printing.bill}
            printers={printers}
            loading={loading}
            onChange={(profile) => updateProfile("bill", profile)}
            onTest={() => test.mutate("CUSTOMER_BILL")}
            testing={test.isPending}
          />
        </div>
        <p className="text-xs leading-5 text-slate-600">
          La prueba confirma el envío a la impresora. Verificá que haya salido en papel.
        </p>
      </div>
    </Card>
  );
}

function PrintTextSettingsCard({
  settings,
  onChange,
}: {
  settings: AppSettingsDto;
  onChange(value: AppSettingsDto): void;
}) {
  const template = settings.printing.receiptTemplate;
  const updateTemplate = (patch: Partial<typeof template>) =>
    onChange({
      ...settings,
      printing: {
        ...settings.printing,
        receiptTemplate: { ...template, ...patch },
      },
    });
  return (
    <Card id="settings-print-texts" className="p-4">
      <SectionTitle
        icon={TextT}
        title="Textos de impresión"
        detail="Encabezados, pies y datos visibles de comanda y cuenta"
      />
      <div className="mt-4 grid items-start gap-4 lg:grid-cols-2">
        <section
          aria-label="Textos de comanda"
          className="rounded-xl border border-brand-100 bg-brand-50/30 p-3"
        >
          <h4 className="text-xs font-extrabold text-slate-800">
            Comanda de cocina
          </h4>
          <p className="mt-0.5 text-xs text-slate-600">
            Personalizá el inicio y el cierre que recibe cocina.
          </p>
          <div className="mt-3 grid gap-3">
            <Field label="Encabezado de comanda">
              <Input
                maxLength={120}
                value={template.kitchenHeader}
                onChange={(event) =>
                  updateTemplate({ kitchenHeader: event.target.value })
                }
                placeholder="COMANDA"
              />
            </Field>
            <Field label="Pie de comanda">
              <Textarea
                maxLength={500}
                rows={3}
                value={template.kitchenFooter}
                onChange={(event) =>
                  updateTemplate({ kitchenFooter: event.target.value })
                }
                placeholder="Opcional"
              />
            </Field>
          </div>
        </section>
        <section
          aria-label="Textos de cuenta"
          className="rounded-xl border border-slate-200 bg-slate-50/70 p-3"
        >
          <h4 className="text-xs font-extrabold text-slate-800">
            Cuenta del cliente
          </h4>
          <p className="mt-0.5 text-xs text-slate-600">
            Personalizá el encabezado, subtítulo y pie del comprobante.
          </p>
          <div className="mt-3 grid gap-3">
            <Field label="Encabezado de cuenta">
              <Input
                maxLength={120}
                value={template.title}
                onChange={(event) =>
                  updateTemplate({ title: event.target.value })
                }
              />
            </Field>
            <Field label="Subtítulo de cuenta">
              <Input
                maxLength={160}
                value={template.subtitle}
                onChange={(event) =>
                  updateTemplate({ subtitle: event.target.value })
                }
                placeholder="Opcional"
              />
            </Field>
            <Field label="Pie de cuenta">
              <Textarea
                maxLength={500}
                rows={3}
                value={template.footer}
                onChange={(event) =>
                  updateTemplate({ footer: event.target.value })
                }
              />
            </Field>
            <Field label="Leyenda no fiscal">
              <Input
                maxLength={160}
                value={template.nonFiscalLegend}
                onChange={(event) =>
                  updateTemplate({ nonFiscalLegend: event.target.value })
                }
              />
            </Field>
          </div>
        </section>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {(
          [
            ["showOrderNumber", "Número de pedido"],
            ["showDate", "Fecha y hora"],
            ["showTable", "Mesa / modalidad"],
            ["showWaiter", "Mozo"],
            ["showCustomer", "Cliente y dirección"],
            ["showItemQuantity", "Cantidades"],
            ["showItemUnitPrice", "Precio unitario"],
            ["showItemTotal", "Total por línea"],
            ["showPaymentSummary", "Resumen de pagos"],
          ] as const
        ).map(([key, label]) => (
          <label
            key={key}
            className="flex items-center gap-2 rounded-lg border border-slate-100 bg-white px-3 py-2 text-xs font-semibold text-slate-600"
          >
            <input
              type="checkbox"
              checked={template[key]}
              onChange={(event) =>
                updateTemplate({ [key]: event.target.checked })
              }
              className="h-4 w-4 accent-brand-600"
            />
            {label}
          </label>
        ))}
      </div>
      <p className="mt-3 rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
        La hora operativa se imprime como <strong>Hora de entrega</strong> tanto
        en la comanda como en la cuenta.
      </p>
    </Card>
  );
}

function PrinterProfileEditor({
  title,
  profile,
  printers,
  loading,
  onChange,
  onTest,
  testing,
  requireExplicitDevice = false,
}: {
  title: string;
  profile: PrinterProfileDto;
  printers: PrinterDeviceDto[];
  loading: boolean;
  onChange(value: PrinterProfileDto): void;
  onTest(): void;
  testing: boolean;
  requireExplicitDevice?: boolean;
}) {
  const update = <K extends keyof PrinterProfileDto>(
    key: K,
    value: PrinterProfileDto[K],
  ) => onChange({ ...profile, [key]: value });
  return (
    <section
      aria-label={title}
      className="rounded-xl border border-brand-100 bg-brand-50/30 p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <h4 className="text-xs font-extrabold text-slate-800">{title}</h4>
          <p className="text-xs text-slate-600">{profile.profileName}</p>
        </div>
        <Button
          variant="secondary"
          className="h-8"
          onClick={onTest}
          disabled={testing}
        >
          {testing ? "Probando…" : "Imprimir prueba"}
        </Button>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Nombre del perfil">
          <Input
            value={profile.profileName}
            onChange={(event) => update("profileName", event.target.value)}
          />
        </Field>
        <Field
          label="Modo"
          hint={profile.mode === "SYSTEM_DIRECT"
            ? requireExplicitDevice
              ? "Para Modo Mozo tenés que elegir el comandero por nombre. Los pedidos desde escritorio también admiten la predeterminada."
              : "Si no elegís una impresora, se usará la predeterminada del sistema."
            : "Podés revisar la cuenta o comanda y elegir una impresora antes de imprimir."}
        >
          <Select
            value={profile.mode}
            onChange={(event) =>
              update("mode", event.target.value as PrinterProfileDto["mode"])
            }
          >
            <option value="SYSTEM_DIALOG">
              Vista previa
            </option>
            <option value="SYSTEM_DIRECT">
              Impresión directa
            </option>
          </Select>
        </Field>
        {requireExplicitDevice && !loading && profile.deviceName && !printers.some((printer) => printer.name === profile.deviceName) ? (
          <p role="status" className="text-xs font-semibold text-amber-800 sm:col-span-2">
            La impresora seleccionada no está disponible. Conectala o elegí otro dispositivo; no se reemplazará por la predeterminada.
          </p>
        ) : null}
        <Field
          label="Impresora"
          hint={loading ? "Buscando impresoras…" : undefined}
          hintMode="inline"
        >
          <Select
            value={profile.deviceName}
            disabled={profile.mode === "SYSTEM_DIALOG"}
            onChange={(event) => update("deviceName", event.target.value)}
          >
            <option value="">Predeterminada del sistema</option>
            {profile.deviceName &&
            !printers.some((printer) => printer.name === profile.deviceName) ? (
              <option value={profile.deviceName}>
                {profile.deviceName} · no detectada
              </option>
            ) : null}
            {printers.map((printer) => (
              <option key={printer.name} value={printer.name}>
                {printer.displayName}
                {printer.isDefault ? " · predeterminada" : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Ancho de papel">
          <Select
            value={profile.paperWidth}
            onChange={(event) => {
              const paperWidth = event.target
                .value as PrinterProfileDto["paperWidth"];
              onChange({
                ...profile,
                paperWidth,
                charsPerLine: paperWidth === "58mm" ? 32 : 42,
              });
            }}
          >
            <option value="80mm">Térmico 80 mm</option>
            <option value="58mm">Térmico 58 mm</option>
          </Select>
        </Field>
        <Field label="Caracteres por línea">
          <Input
            type="number"
            min={20}
            max={64}
            value={profile.charsPerLine}
            onChange={(event) =>
              update("charsPerLine", Number(event.target.value))
            }
          />
        </Field>
        <Field label="Copias">
          <Input
            type="number"
            min={1}
            max={3}
            value={profile.copies}
            onChange={(event) => update("copies", Number(event.target.value))}
          />
        </Field>
      </div>
      <div className="mt-3 grid items-start gap-2 sm:grid-cols-3">
        <label className="mt-[1.625rem] flex min-h-10 items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-slate-600">
          <input
            type="checkbox"
            checked={profile.cutter}
            onChange={(event) => update("cutter", event.target.checked)}
            className="h-4 w-4 accent-brand-600"
          />
          Cortador
        </label>
        <Field label="Tipo de corte">
          <Select
            disabled={!profile.cutter}
            value={profile.cutMode}
            onChange={(event) =>
              update(
                "cutMode",
                event.target.value as PrinterProfileDto["cutMode"],
              )
            }
          >
            <option value="PARTIAL">Parcial</option>
            <option value="FULL">Completo</option>
          </Select>
        </Field>
        <Field label="Líneas antes del corte">
          <Input
            disabled={!profile.cutter}
            type="number"
            min={0}
            max={8}
            value={profile.feedLinesBeforeCut}
            onChange={(event) =>
              update("feedLinesBeforeCut", Number(event.target.value))
            }
          />
        </Field>
      </div>
    </section>
  );
}

function SectionTitle({
  icon: Icon,
  title,
  detail,
}: {
  icon: typeof GearSix;
  title: string;
  detail: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand-700">
        <Icon size={21} />
      </div>
      <div>
        <h3 className="text-sm font-bold">{title}</h3>
        <p className="text-xs text-slate-600">{detail}</p>
      </div>
    </div>
  );
}
