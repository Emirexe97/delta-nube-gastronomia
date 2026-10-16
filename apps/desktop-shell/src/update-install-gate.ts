/** Shared admission gate: acquire before the first await of any desktop operation. */
export class UpdateInstallGate {
  private active = 0;
  private restoring = false;
  private installing = false;

  get installationInProgress() {
    return this.installing;
  }

  enterOperation(): () => void {
    if (this.installing)
      throw new Error(
        "Se está instalando una actualización. Esperá a que termine.",
      );
    if (this.restoring)
      throw new Error("Hay una restauración en curso. Esperá a que termine.");
    this.active++;
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.active--;
      }
    };
  }

  beginRestore(): void {
    if (this.installing || this.restoring || this.active > 0)
      throw new Error(
        "Esperá a que termine la operación actual y volvé a restaurar la copia.",
      );
    this.restoring = true;
  }

  endRestore(): void {
    this.restoring = false;
  }

  beginInstall(
    readState: () => { permitted: boolean; cashOpen: boolean },
  ): void {
    if (this.installing || this.restoring || this.active > 0)
      throw new Error(
        "Esperá a que terminen las operaciones, impresiones o restauraciones antes de actualizar.",
      );
    // This callback is synchronous: state validation and admission lock are atomic.
    const state = readState();
    if (!state.permitted)
      throw new Error("No tenés permiso para instalar actualizaciones.");
    if (state.cashOpen)
      throw new Error("Cerrá la caja antes de instalar la actualización.");
    this.installing = true;
  }

  cancelInstall(): void {
    this.installing = false;
  }
}
