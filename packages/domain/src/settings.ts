import type { AppSettingsDto } from "@gastronomy/contracts";

export function assertAppSettings(settings: AppSettingsDto) {
  if (!settings.businessName.trim())
    throw new Error("Ingresá el nombre visible del negocio.");
  if (settings.maxConcurrentCashSessions !== 1)
    throw new Error("La versión local admite una sola caja abierta a la vez.");
  for (const profile of [settings.printing.kitchen, settings.printing.bill]) {
    if (!profile.profileName.trim())
      throw new Error("Cada perfil de impresión necesita un nombre.");
    if (
      !Number.isInteger(profile.copies) ||
      profile.copies < 1 ||
      profile.copies > 3
    )
      throw new Error("Las copias deben estar entre 1 y 3.");
    if (
      !Number.isInteger(profile.charsPerLine) ||
      profile.charsPerLine < 20 ||
      profile.charsPerLine > 64
    )
      throw new Error("Los caracteres por línea deben estar entre 20 y 64.");
    if (
      !Number.isInteger(profile.feedLinesBeforeCut) ||
      profile.feedLinesBeforeCut < 0 ||
      profile.feedLinesBeforeCut > 8
    )
      throw new Error("Las líneas antes del corte deben estar entre 0 y 8.");
  }
  return settings;
}
