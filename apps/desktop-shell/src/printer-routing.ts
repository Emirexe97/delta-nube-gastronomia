import type { PrinterProfileDto } from "@gastronomy/contracts";

export type PrinterDevice = { name: string; isDefault?: boolean };

/** Direct kitchen tickets must never silently fall back to an unrelated default printer. */
export function resolvePrinterTarget(
  profile: PrinterProfileDto,
  printers: PrinterDevice[],
  requireExplicitDevice = false,
) {
  if (requireExplicitDevice && !profile.deviceName) return null;
  if (profile.deviceName) {
    const printer = printers.find((item) => item.name === profile.deviceName);
    return printer ? printer.name : null;
  }
  return printers.find((item) => item.isDefault === true)?.name ?? null;
}
