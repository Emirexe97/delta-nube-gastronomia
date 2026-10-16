import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AppUpdateStatusDto } from "@gastronomy/contracts";
import {
  ArrowClockwise,
  DownloadSimple,
  WarningCircle,
} from "@phosphor-icons/react";
import { Button, Card, Modal } from "@gastronomy/ui";
import { humanError } from "../lib";

export const appUpdateQueryKey = ["app-update-status"] as const;

export function useAppUpdateStatus() {
  return useQuery({
    queryKey: appUpdateQueryKey,
    queryFn: () => window.gastronomy.getAppUpdateStatus(),
    refetchInterval: (query) =>
      query.state.data?.state === "DOWNLOADING" ? 2_000 : 10_000,
    retry: false,
  });
}

export function AppUpdatePanel() {
  const queryClient = useQueryClient();
  const [confirmInstall, setConfirmInstall] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const statusQuery = useAppUpdateStatus();
  const check = useMutation({
    mutationFn: () => window.gastronomy.checkAppUpdate(),
    onSuccess: (status) => {
      queryClient.setQueryData(appUpdateQueryKey, status);
      setActionError(null);
    },
    onError: (error) => setActionError(humanError(error)),
  });
  const install = useMutation({
    mutationFn: () => window.gastronomy.installAppUpdate(),
    onSuccess: (status) => {
      queryClient.setQueryData(appUpdateQueryKey, status);
      setActionError(null);
      setConfirmInstall(false);
    },
    // Keep the last status (especially READY) visible if install is refused, e.g. an open cash session.
    onError: (error) => {
      setActionError(humanError(error));
      setConfirmInstall(false);
    },
  });
  const status = statusQuery.data;
  const busy =
    check.isPending ||
    install.isPending ||
    status?.state === "CHECKING" ||
    status?.state === "DOWNLOADING" ||
    status?.state === "INSTALLING";
  const stateLabels: Record<AppUpdateStatusDto["state"], string> = {
    DISABLED: "No disponible en esta instalación",
    IDLE: "Al día para consultar",
    CHECKING: "Buscando actualizaciones…",
    CURRENT: "La aplicación está actualizada",
    DOWNLOADING: "Descargando actualización…",
    READY: "Actualización lista para instalar",
    INSTALLING: "Preparando instalación…",
    ERROR: "No se pudo completar la actualización",
  };

  return (
    <Card id="settings-updates" className="scroll-mt-20 overflow-hidden p-0">
      <div className="border-b border-slate-100 bg-gradient-to-r from-brand-50/70 to-white px-4 py-4">
        <h3 className="text-sm font-bold">Actualizaciones</h3>
        <p className="mt-1 text-xs text-slate-600">
          Consultá y prepará una versión nueva sin interrumpir la operación.
        </p>
      </div>
      <div className="grid gap-4 p-4">
        {statusQuery.isPending && !status ? (
          <p role="status" className="text-xs text-slate-600">
            Consultando estado de actualizaciones…
          </p>
        ) : status ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-600">
                  Estado
                </p>
                <p className="mt-1 text-sm font-extrabold text-slate-900">
                  {stateLabels[status.state]}
                </p>
              </div>
              <div className="text-right text-xs text-slate-600">
                <p>
                  Versión instalada{" "}
                  <strong className="text-slate-900">
                    {status.currentVersion || "No disponible"}
                  </strong>
                </p>
                {status.availableVersion && (
                  <p className="mt-1">
                    Disponible{" "}
                    <strong className="text-slate-900">
                      {status.availableVersion}
                    </strong>
                  </p>
                )}
              </div>
            </div>
            {status.message && (
              <p className="text-xs leading-5 text-slate-600">
                {status.message}
              </p>
            )}
            {status.state === "DOWNLOADING" && (
              <div aria-live="polite" className="space-y-1">
                <div className="flex justify-between text-xs font-semibold">
                  <span>Descarga</span>
                  <span>
                    {status.progress == null
                      ? "En curso"
                      : `${Math.round(status.progress)}%`}
                  </span>
                </div>
                <progress
                  aria-label="Progreso de descarga"
                  max={100}
                  value={status.progress ?? undefined}
                  className="h-2 w-full accent-brand-600"
                />
              </div>
            )}
          </>
        ) : (
          <p className="text-xs text-slate-600">
            No se pudo consultar el estado de actualizaciones.
          </p>
        )}
        {(actionError || statusQuery.isError) && (
          <p
            role="alert"
            className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800"
          >
            <WarningCircle className="mr-1 inline" />
            {actionError ??
              `No se pudo consultar: ${humanError(statusQuery.error)}`}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => check.mutate()}
            disabled={!status || status.state === "DISABLED" || busy}
          >
            {check.isPending ? (
              "Buscando…"
            ) : (
              <>
                <ArrowClockwise className="mr-1 inline" />
                Buscar actualizaciones
              </>
            )}
          </Button>
          {status?.state === "READY" && (
            <Button onClick={() => setConfirmInstall(true)} disabled={busy}>
              <DownloadSimple className="mr-1 inline" />
              Instalar y reiniciar
            </Button>
          )}
        </div>
        <Modal
          open={confirmInstall}
          onClose={() => setConfirmInstall(false)}
          title="¿Instalar la actualización?"
          description="Confirmá que la operación está lista antes de reiniciar la aplicación."
          closeDisabled={install.isPending}
          width="max-w-md"
        >
          <div className="grid gap-3 p-4">
            <p className="text-sm leading-6 text-slate-600">
              La aplicación se cerrará y reiniciará para completar la
              instalación. Cerrá la caja antes de continuar, esperá a que
              terminen de imprimirse los comprobantes y guardá cualquier trabajo
              pendiente.
            </p>
            <p className="text-xs font-semibold text-amber-800">
              El sistema volverá a validar la caja antes de instalar; esta
              confirmación no fuerza el reinicio.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => setConfirmInstall(false)}
                disabled={install.isPending}
              >
                Ahora no
              </Button>
              <Button
                onClick={() => install.mutate()}
                disabled={install.isPending}
              >
                {install.isPending ? "Preparando…" : "Confirmar instalación"}
              </Button>
            </div>
          </div>
        </Modal>
      </div>
    </Card>
  );
}
