import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { LicenseStatusDto } from "@gastronomy/contracts";
import { Button, Card, Field, Input } from "@gastronomy/ui";
import { humanError } from "../lib";
import { normalizeSiteSlug, siteChoice } from "./web-site-input";
import { licenseQueryKey, useLicenseStatus } from "../hooks/use-license-status";
export { licenseQueryKey, useLicenseStatus } from "../hooks/use-license-status";

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
  const [includeSite, setIncludeSite] = useState(true);
  const [chosenSlug, setSiteSlug] = useState<string | null>(null);
  const siteSlug = chosenSlug ?? normalizeSiteSlug(businessName);
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const signIn = useMutation({
    mutationFn: () => {
      const credentials = { email: email.trim(), password };
      setPassword("");
      return window.gastronomy.signInLicenseAccount(credentials);
    },
    onSuccess: (status) => {
      queryClient.setQueryData(licenseQueryKey, status);
      setError(null);
    },
    onError: (value) => setError(humanError(value)),
    gcTime: 0,
  });
  const refresh = useMutation({
    mutationFn: () => window.gastronomy.refreshLicense(),
    onSuccess: (status) => {
      queryClient.setQueryData(licenseQueryKey, status);
      setError(null);
    },
    onError: (value) => setError(humanError(value)),
  });
  const request = useMutation({
    mutationFn: () =>
      window.gastronomy.requestLicenseAccess({
        businessName: businessName.trim(),
        webSite: includeSite ? siteChoice(siteSlug, whatsappNumber) : undefined,
      }),
    onSuccess: (status) => {
      queryClient.setQueryData(licenseQueryKey, status);
      if (status.canOperate) setBusinessName("");
      setError(null);
    },
    onError: (value) => setError(humanError(value)),
  });
  const status = statusQuery.data;
  const busy = request.isPending || refresh.isPending || signIn.isPending;
  const canRequest =
    status &&
    status.enrollment?.status !== "PENDING" &&
    (["NOT_CONFIGURED", "UNACTIVATED", "INVALID", "EXPIRED"].includes(
      status.state,
    ) ||
      (status.state === "ACTIVE" && status.enrollment?.status !== "APPROVED"));

  return (
    <Card id="settings-license" className="scroll-mt-20 overflow-hidden p-0">
      <div className="border-b border-slate-100 bg-gradient-to-r from-brand-50/70 to-white px-4 py-4">
        <h3 className="text-sm font-bold">Licencia</h3>
        <p className="mt-1 text-xs text-slate-600">
          Estado y vigencia del permiso de este equipo.
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
            {status.trial ? (
              <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-900">
                Prueba gratuita · {remainingDays(status.trial.endsAt) ?? 0} días restantes. Al finalizar no hay período de gracia.
              </p>
            ) : null}
            {status.account?.email ? <Info label="Cuenta de licencia" value={status.account.email} extra="Este equipo conserva su permiso local. No necesita iniciar sesión en cada venta." /> : null}
            {status.state !== "DEVELOPMENT" ? (
              <form className="grid gap-3 rounded-xl border border-brand-100 bg-brand-50/30 p-3" onSubmit={(event) => {
                event.preventDefault();
                if (busy) return;
                setError(null);
                signIn.mutate();
              }}>
                <div>
                  <h4 className="text-sm font-bold">Ingresar con mi cuenta</h4>
                  <p className="mt-1 text-xs leading-5 text-slate-600">Usá la cuenta de tu negocio. Si te registraste para probar el sistema, el primer ingreso inicia la prueba gratuita de 30 días y la vincula a esta PC; no se solicita tarjeta. No es el PIN del cajero ni del mozo. Internet se necesita para activar o actualizar el permiso, no para cada pedido local.</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Correo de la cuenta"><Input type="email" autoComplete="username" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
                  <Field label="Contraseña de la cuenta"><Input type="password" autoComplete="current-password" required maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} /></Field>
                </div>
                <div><Button type="submit" disabled={busy || !email.trim() || !password}>{signIn.isPending ? "Vinculando equipo…" : "Ingresar y activar este equipo"}</Button></div>
                <p className="text-xs text-slate-500">¿No tenés cuenta u olvidaste la contraseña? Contactá al administrador de Delta Nube. Las licencias anteriores siguen siendo válidas.</p>
              </form>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <Info
                label={status.trial ? "Vigencia de la prueba hasta" : "Vigencia abonada hasta"}
                value={exclusiveDate(status.paidThrough)}
                extra={
                  remainingDays(status.paidThrough) != null
                    ? `${remainingDays(status.paidThrough)} días restantes`
                    : undefined
                }
              />
              {!status.trial && status.graceUntil ? (
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
            {status.enrollment?.keyFingerprint ? (
              <Info
                label="Huella de clave del equipo"
                value={status.enrollment.keyFingerprint}
                mono
              />
            ) : null}
            {canRequest ? (
              <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-3">
                <Field
                  label="Nombre del negocio"
                  hint="Solicitaremos la habilitación segura para este equipo."
                >
                  <Input
                    value={businessName}
                    onChange={(event) => setBusinessName(event.target.value)}
                    autoComplete="organization"
                    placeholder="Nombre del negocio"
                  />
                </Field>
                <div className="border-t border-slate-100 pt-3">
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-800">
                    <input
                      type="checkbox"
                      checked={includeSite}
                      onChange={(e) => setIncludeSite(e.target.checked)}
                    />
                    Crear mi página de pedidos al habilitar el negocio
                  </label>
                  <p className="mt-1 text-xs leading-5 text-slate-600">
                    Te proponemos un subdominio a partir del nombre del negocio.
                    Podés cambiarlo o desmarcar esta opción para configurar la
                    web más adelante.
                  </p>
                  {includeSite && (
                    <>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <Field label="Subdominio">
                          <div className="flex min-w-0 items-center rounded-lg border border-slate-200 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-100">
                            <Input
                              aria-label="Subdominio"
                              className="min-w-0 border-0 focus:ring-0"
                              value={siteSlug}
                              onChange={(event) =>
                                setSiteSlug(event.target.value)
                              }
                              autoComplete="off"
                              placeholder="mi-negocio"
                            />
                            <span className="shrink-0 pr-3 text-xs text-slate-500">
                              .deltanubeweb.com
                            </span>
                          </div>
                        </Field>
                        <Field
                          label="WhatsApp de pedidos"
                          hint="Con código de país, por ejemplo +54 9 11 1234-5678."
                        >
                          <Input
                            type="tel"
                            value={whatsappNumber}
                            onChange={(event) =>
                              setWhatsappNumber(event.target.value)
                            }
                            autoComplete="tel"
                            placeholder="+54 9 11 1234-5678"
                          />
                        </Field>
                      </div>
                      {siteSlug ? (
                        <p className="mt-2 break-all text-xs text-brand-700">
                          Vista previa:{" "}
                          <strong>
                            {normalizeSiteSlug(siteSlug) || "tu-negocio"}
                            .deltanubeweb.com
                          </strong>
                        </p>
                      ) : null}
                      {(siteSlug.trim() || whatsappNumber.trim()) &&
                      !siteChoice(siteSlug, whatsappNumber) ? (
                        <p className="mt-2 text-xs font-medium text-amber-800">
                          Completá un subdominio y un WhatsApp con código de
                          país (8 a 15 dígitos).
                        </p>
                      ) : null}
                    </>
                  )}
                </div>
              </div>
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
              disabled={
                busy ||
                businessName.trim().length < 2 ||
                (includeSite && !siteChoice(siteSlug, whatsappNumber))
              }
            >
              {request.isPending
                ? "Enviando solicitud…"
                : "Solicitar habilitación"}
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
                ? status.enrollment?.status === "PENDING"
                  ? "Verificar habilitación"
                  : "Verificar licencia"
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
