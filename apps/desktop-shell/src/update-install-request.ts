import type { DesktopUpdater } from "./app-updater.ts";
import type { UpdateInstallGate } from "./update-install-gate.ts";

type Options = {
  updater: Pick<DesktopUpdater, "getStatus" | "install">;
  gate: UpdateInstallGate;
  readState: () => { permitted: boolean; cashOpen: boolean };
  confirm: (version: string) => Promise<boolean>;
};

/** Main-process confirmation; IPC itself is not a grant of installation consent. */
export function createUpdateInstallRequest({
  updater,
  gate,
  readState,
  confirm,
}: Options) {
  let inFlight = false;
  return async () => {
    if (inFlight)
      throw new Error("Ya hay una solicitud de instalación en curso.");
    const status = updater.getStatus();
    if (status.state !== "READY" || !status.availableVersion)
      throw new Error("No hay una actualización lista para instalar.");
    const state = readState();
    if (!state.permitted)
      throw new Error("No tenés permiso para instalar actualizaciones.");
    if (state.cashOpen)
      throw new Error("Cerrá la caja antes de instalar la actualización.");

    inFlight = true;
    try {
      if (!(await confirm(status.availableVersion))) return updater.getStatus();
      const now = updater.getStatus();
      if (
        now.state !== "READY" ||
        now.availableVersion !== status.availableVersion
      )
        throw new Error("La actualización ya no está lista para instalar.");

      // During the dialog the POS may continue working; re-read and lock now,
      // synchronously. Hold the lock through verification and process creation.
      gate.beginInstall(readState);
      try {
        const result = await updater.install();
        if (result.state !== "INSTALLING") gate.cancelInstall();
        return result;
      } catch (error) {
        gate.cancelInstall();
        throw error;
      }
    } finally {
      inFlight = false;
    }
  };
}
