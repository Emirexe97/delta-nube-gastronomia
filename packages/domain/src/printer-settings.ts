import type { PrinterMode } from "@gastronomy/contracts";

/** Whether a kitchen profile can enqueue direct printing to a named device. */
export function isDirectKitchenPrinterConfigured(profile: {
  mode: PrinterMode;
  deviceName: string | null | undefined;
}): boolean {
  return (profile.mode === "SYSTEM_DIRECT" || profile.mode === "ESC_POS") && Boolean(profile.deviceName?.trim());
}
