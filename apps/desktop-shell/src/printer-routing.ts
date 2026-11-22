import type { PrinterProfileDto } from "@gastronomy/contracts";

export type PrinterDevice = {
  name: string;
  isDefault?: boolean;
  options?: {
    "printer-make-and-model"?: string;
    system_driverinfo?: string;
    "printer-state"?: string;
    "printer-state-reasons"?: string;
    "printer-is-accepting-jobs"?: string;
  };
};

/** Direct kitchen tickets must never silently fall back to an unrelated default printer. */
export function resolvePrinterTarget(
  profile: PrinterProfileDto,
  printers: PrinterDevice[],
  requireExplicitDevice = false,
  platform: NodeJS.Platform = process.platform,
) {
  if (
    (requireExplicitDevice || profile.mode === "ESC_POS") &&
    !profile.deviceName
  )
    return null;
  const printer = profile.deviceName
    ? printers.find((item) => item.name === profile.deviceName)
    : printers.find((item) => item.isDefault === true);
  if (printer && platform === "darwin" && profile.mode === "ESC_POS") {
    const info = printer.options;
    const reasons = info?.["printer-state-reasons"] ?? "";
    if (
      info?.["printer-state"] === "5" ||
      info?.["printer-is-accepting-jobs"] === "false" ||
      /\b(?:offline|paused|shutdown)\b/i.test(reasons)
    ) {
      throw new Error(
        `La cola «${printer.name}» figura detenida o sin conexión. Revisá la conexión y el Centro de Impresión de la Mac antes de enviar el ticket.`,
      );
    }
  }
  if (printer && platform === "darwin" && profile.mode !== "ESC_POS") {
    const model =
      printer.options?.["printer-make-and-model"] ||
      printer.options?.system_driverinfo;
    if (
      model &&
      /^(?:(?:local|generic) )?raw(?: printer| queue)?$/i.test(model.trim())
    ) {
      throw new Error(
        `La cola «${printer.name}» recibe datos RAW. Si tu térmica usa ESC/POS, elegí «Térmica ESC/POS (Mac)» en Configuración > Impresión. Para impresión gráfica, elegí una cola con el controlador del modelo.`,
      );
    }
  }
  return printer?.name ?? null;
}
