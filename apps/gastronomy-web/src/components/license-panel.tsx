import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LicenseStatusDto } from "@gastronomy/contracts";
import { Button, Card, Field, Input } from "@gastronomy/ui";
import { humanError } from "../lib";

export const licenseQueryKey = ["license-status"] as const;

export function useLicenseStatus() {
  return useQuery({
    queryKey: licenseQueryKey,
    queryFn: () => window.gastronomy.getLicenseStatus(),
    refetchInterval: 60_000,
    retry: false,
  });
}

const labels: Record<LicenseStatusDto["state"], string> = {
  DEVELOPMENT: "Modo de desarrollo",
  NOT_CONFIGURED: "Sin configurar",
  UNACTIVATED: "Pendiente de activación",
  ACTIVE: "Activa",
  GRACE: "Período de gracia",
  EXPIRED: "Vencida",
  SUSPENDED: "Suspendida",
  INVALID: "No válida",
  CLOCK_ROLLBACK: "Reloj del equipo desajustado",
};

function exclusiveDate(value: string | null) {
  if (!value) return "Sin fecha informada";
  if (new Date(value).getUTCFullYear() >= 9999) return "Sin vencimiento";
  const date = new Date(new Date(value).getTime() - 1000);
  return Number.isNaN(date.getTime())
    ? "Sin fecha informada"
    : date.toLocaleString("es-AR", {
        day: "2-digit",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

function remainingDays(value: string | null) {
  if (!value) return null;
  const end = new Date(value).getTime();
  if (!Number.isFinite(end)) return null;
  return Math.max(0, Math.ceil((end - Date.now()) / 86_400_000));
}

export function LicensePanel() {
  const queryClient = useQueryClient();
  const statusQuery = useLicenseStatus();
  const [businessName, setBusinessName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const refresh = useMutation({
    mutationFn: () => window.gastronomy.refreshLicense(),
    onSuccess: (status) => {
      queryClient.setQueryData(licenseQueryKey, status);
      setError(null);
    },
    onError: (value) => setError(humanError(value)),
  });
  const request = useMutation({
    mutationFn: () => window.gastronomy.requestLicenseAccess({ businessName: businessName.trim() }),
    onSuccess: (status) => {
      queryClient.setQueryData(licenseQueryKey, status);
      if (status.canOperate) setBusinessName("");
      setError(null);
    },
    onError: (value) => setError(humanError(value)),
  });
  const status = statusQuery.data;
  const busy = request.isPending || refresh.isPending;
  const canRequest =
    status &&
    status.enrollment?.status !== "PENDING" &&
    ["NOT_CONFIGURED", "UNACTIVATED", "INVALID", "EXPIRED"].includes(
      status.state,
    );

  return (
    <Card id="settings-license" className="scroll-mt-20 overflow-hidden p-0">
      <div className="border-b border-slate-100 bg-gradient-to-r from-brand-50/70 to-white px-4 py-4">
        <h3 className="text-sm font-bold">Licencia</h3>
        <p className="mt-1 text-xs text-slate-600">
          Estado del acceso de este equipo y período contratado.
        </p>
      </div>
      <div className="grid gap-4 p-4">
        {statusQuery.isPending && !status ? (
          <p role="status" className="text-xs text-slate-600">
            Consultando estado de licencia…
          </p>
        ) : status ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-600">
                  Estado
                </p>
                <p className="mt-1 text-sm font-extrabold text-slate-900">
                  {labels[status.state]}
                </p>
              </div>
              {status.businessName || status.enrollment?.businessName ? (
                <p className="text-sm font-semibold text-slate-700">
                  {status.businessName ?? status.enrollment?.businessName}
                </p>
              ) : null}
            </div>
            {status.message ? (
              <p className="text-xs leading-5 text-slate-600">
                {status.message}
              </p>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <Info
                label="Período abonado hasta"
                value={exclusiveDate(status.paidThrough)}
                extra={
                  remainingDays(status.paidThrough) != null
                    ? `${remainingDays(status.paidThrough)} días restantes`
                    : undefined
                }
              />
              {status.graceUntil ? (
                <Info
                  label="Gracia hasta"
                  value={exclusiveDate(status.graceUntil)}
                  extra={
                    status.state === "GRACE" &&
                    remainingDays(status.graceUntil) != null
                      ? `${remainingDays(status.graceUntil)} días de gracia restantes`
                      : "3 días adicionales al período abonado"
                  }
                />
              ) : null}
              <Info
                label="Identificador de instalación"
                value={status.installationId || "No disponible"}
                mono
              />
              {status.lastVerifiedAt ? (
                <Info
                  label="Última verificación"
                  value={new Date(status.lastVerifiedAt).toLocaleString(
                    "es-AR",
                  )}
                />
              ) : null}
            </div>
            {status.verificationOverdue ? (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
                La verificación está demorada. El período abonado sigue teniendo
                prioridad.
              </p>
            ) : null}
            {status.enrollment?.keyFingerprint ? <Info label="Huella de clave del equipo" value={status.enrollment.keyFingerprint} mono /> : null}
            {canRequest ? (
              <Field
                label="Nombre del negocio"
                hint="Solicitaremos la habilitación segura para este equipo."
              >
                <Input
                  value={businessName}
                  onChange={(event) => setBusinessName(event.target.value)}
                  autoComplete="off"
                  placeholder="Nombre del negocio"
                />
              </Field>
            ) : null}
          </>
        ) : (
          <p className="text-xs text-slate-600">
            No se pudo consultar el estado. Conservamos la última información
            disponible; podés reintentar cuando vuelva la conexión.
          </p>
        )}
        {error || (statusQuery.isError && status) ? (
          <p
            role="alert"
            className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800"
          >
            {error ??
              `No se pudo actualizar la licencia: ${humanError(statusQuery.error)}`}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {canRequest ? (
            <Button
              onClick={() => request.mutate()}
              disabled={busy || businessName.trim().length < 2}
            >
              {request.isPending ? "Enviando solicitud…" : "Solicitar habilitación"}
            </Button>
          ) : null}
          <Button
            variant="secondary"
            onClick={() => refresh.mutate()}
            disabled={busy}
          >
            {refresh.isPending
              ? "Verificando…"
              : status
                ? status.enrollment?.status === "PENDING" ? "Verificar habilitación" : "Verificar licencia"
                : "Reintentar"}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function Info({
  label,
  value,
  extra,
  mono = false,
}: {
  label: string;
  value: string;
  extra?: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-100 bg-white p-3">
      <p className="text-xs font-bold text-slate-600">{label}</p>
      <p
        className={`mt-1 break-all text-sm font-semibold text-slate-900 ${mono ? "font-mono text-xs" : ""}`}
      >
        {value}
      </p>
      {extra ? <p className="mt-1 text-xs text-slate-600">{extra}</p> : null}
    </div>
  );
}
