import { useEffect, useState } from "react";
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
import { Button, Card, Field, Input, Select, Textarea } from "@gastronomy/ui";
import { useApiMutation } from "../api";
import { humanError } from "../lib";

export function SettingsPage({ data }: { data: BootstrapDto }) {
  const [settings, setSettings] = useState<AppSettingsDto>(data.settings);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => setSettings(data.settings), [data.settings]);
  const mutation = useApiMutation(
    (value: AppSettingsDto) => window.gastronomy.saveSettings(value),
    {
      onSuccess: () => setMessage("Configuración guardada."),
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
      className="panel-enter mx-auto max-w-[1100px] space-y-4"
    >
      <div>
        <h2 className="text-lg font-extrabold">Configuración de Gastronomía</h2>
        <p className="text-xs text-slate-400">
          Adaptá la operación sin perder información histórica
        </p>
      </div>
      <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white/95 p-2 shadow-sm backdrop-blur">
        <nav
          aria-label="Secciones de configuración"
          className="flex flex-wrap gap-1"
        >
          {(
            [
              ["settings-general", "General"],
              ["settings-printing", "Impresión"],
              ["settings-print-texts", "Textos"],
              ["settings-backup", "Backup"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() =>
                document
                  .getElementById(id)
                  ?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
              className="focus-ring rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-slate-500 hover:bg-brand-50 hover:text-brand-700"
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
              className="w-full max-w-[520px] break-words rounded-lg bg-sky-50 px-3 py-2 text-[11px] font-semibold text-sky-800 sm:w-auto sm:truncate"
              title={message}
            >
              {message}
            </p>
          ) : null}
          <Button
            onClick={() => mutation.mutate(settings)}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? "Guardando…" : "Guardar configuración"}
          </Button>
        </div>
      </div>
      <section
        id="settings-general"
        className="scroll-mt-20 grid gap-4 lg:grid-cols-[1fr_1.2fr]"
      >
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
            <Field
              label="Cajas simultáneas"
              hint="Esta versión local opera con una sola caja. La multi-caja se habilitará al integrar terminales identificadas del POS."
            >
              <Input
                type="number"
                min={1}
                max={1}
                value={settings.maxConcurrentCashSessions}
                disabled
              />
            </Field>
            <Field label="Precio mitad y mitad">
              <Select
                value={settings.halfAndHalfPricingMode}
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
                  <p className="text-[10px] text-slate-400">
                    {settings.modules[key]
                      ? "Visible y operativo"
                      : "Oculto; datos preservados"}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings.modules[key]}
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
      </Card>
      <PrintingSettingsCard
        settings={settings}
        onChange={setSettings}
        onMessage={setMessage}
      />
      <PrintTextSettingsCard settings={settings} onChange={setSettings} />
      <Card id="settings-backup" className="scroll-mt-20 p-4">
        <SectionTitle
          icon={Database}
          title="Backup y recuperación"
          detail="SQLite con verificación de integridad"
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
      </Card>
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
  }, []);
  const updatePrinting = (patch: Partial<AppSettingsDto["printing"]>) =>
    onChange({ ...settings, printing: { ...settings.printing, ...patch } });
  const updateProfile = (key: "kitchen" | "bill", profile: PrinterProfileDto) =>
    updatePrinting({ [key]: profile });
  const test = useApiMutation(
    async (kind: "KITCHEN_ORDER" | "CUSTOMER_BILL") =>
      window.gastronomy.testPrinter({ kind, settings }),
    {
      onSuccess: (result) => onMessage(result.message),
      onError: (error) => onMessage(humanError(error)),
    },
  );
  return (
    <Card id="settings-printing" className="scroll-mt-20 p-4">
      <SectionTitle
        icon={Printer}
        title="Impresión"
        detail="Perfiles separados para comanda y cuenta, compatibles con el modelo del POS"
      />
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
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-[10px] text-amber-800">
          El corte automático depende del controlador de Windows y de la
          impresora. El perfil conserva el modo de corte y las líneas de avance
          para la integración térmica.
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
    <Card id="settings-print-texts" className="scroll-mt-20 p-4">
      <SectionTitle
        icon={TextT}
        title="Textos de impresión"
        detail="Encabezados, pies y datos visibles de comanda y cuenta"
      />
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section
          aria-label="Textos de comanda"
          className="rounded-xl border border-brand-100 bg-brand-50/30 p-3"
        >
          <h4 className="text-xs font-extrabold text-slate-800">
            Comanda de cocina
          </h4>
          <p className="mt-0.5 text-[10px] text-slate-400">
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
          <p className="mt-0.5 text-[10px] text-slate-400">
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
            className="flex items-center gap-2 rounded-lg border border-slate-100 bg-white px-3 py-2 text-[11px] font-semibold text-slate-600"
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
      <p className="mt-3 rounded-lg bg-slate-50 p-2 text-[10px] text-slate-500">
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
}: {
  title: string;
  profile: PrinterProfileDto;
  printers: PrinterDeviceDto[];
  loading: boolean;
  onChange(value: PrinterProfileDto): void;
  onTest(): void;
  testing: boolean;
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
          <p className="text-[10px] text-slate-400">{profile.profileName}</p>
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
          hint="Sin impresora disponible se abrirá una vista previa."
        >
          <Select
            value={profile.mode}
            onChange={(event) =>
              update("mode", event.target.value as PrinterProfileDto["mode"])
            }
          >
            <option value="SYSTEM_DIALOG">
              Vista previa y diálogo del sistema
            </option>
            <option value="SYSTEM_DIRECT">Impresión directa</option>
          </Select>
        </Field>
        <Field
          label="Impresora"
          hint={loading ? "Buscando dispositivos…" : undefined}
        >
          <Select
            value={profile.deviceName}
            disabled={profile.mode === "SYSTEM_DIALOG"}
            onChange={(event) => update("deviceName", event.target.value)}
          >
            <option value="">Predeterminada de Windows</option>
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
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <label className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-[11px] font-semibold text-slate-600">
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
        <p className="text-[10px] text-slate-400">{detail}</p>
      </div>
    </div>
  );
}
