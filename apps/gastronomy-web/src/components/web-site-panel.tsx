import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Field, Input } from "@gastronomy/ui";
import type { WebSiteStatus } from "@gastronomy/contracts";
import { humanError } from "../lib";
import { normalizeSiteSlug, siteChoice } from "./web-site-input";
import { getMerchantShareUrl } from "@gastronomy/contracts";

const websiteKey = ["website-status"] as const;
const stateLabels: Record<WebSiteStatus["state"], string> = {
  UNCONFIGURED: "Servicio no configurado",
  NOT_REGISTERED: "Todavía no solicitada",
  PENDING: "Solicitud pendiente",
  ACTIVE: "Activa",
  ERROR: "Requiere atención",
};

export function WebSitePanel() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: websiteKey,
    queryFn: () => window.gastronomy.getWebSiteStatus(),
    retry: false,
    refetchInterval: (q) =>
      q.state.data?.state === "PENDING" ||
      q.state.data?.state === "NOT_REGISTERED"
        ? 15_000
        : false,
  });
  const status = query.data;
  const [slug, setSlug] = useState("");
  const [phone, setPhone] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [tagline, setTagline] = useState("");
  const [accent, setAccent] = useState("#15803d");
  const [error, setError] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState<"open" | "copy" | "qr" | null>(
    null,
  );
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  useEffect(() => {
    if (!status) return;
    setSlug(status.slug ?? "");
    setDisplayName(status.displayName);
    setTagline(status.tagline);
    setAccent(status.accent || "#15803d");
  }, [status?.slug, status?.displayName, status?.tagline, status?.accent]);

  const updateStatus = (next: WebSiteStatus) => {
    queryClient.setQueryData(websiteKey, next);
    setError(null);
  };
  const register = useMutation({
    mutationFn: () =>
      window.gastronomy.registerWebSite(siteChoice(slug, phone)!),
    onSuccess: updateStatus,
    onError: (value) => setError(humanError(value)),
  });
  const saveBranding = useMutation({
    mutationFn: () =>
      window.gastronomy.updateWebSiteBranding({
        displayName: displayName.trim(),
        tagline: tagline.trim(),
        accent,
      }),
    onSuccess: updateStatus,
    onError: (value) => setError(humanError(value)),
  });
  const busy = register.isPending || saveBranding.isPending;
  const canRegister =
    status?.state !== "UNCONFIGURED" && status?.designMode !== "CUSTOM";
  const shareUrl = status
    ? getMerchantShareUrl({
        state: status.state,
        slug: status.slug,
        url: status.url,
      })
    : null;
  const share = async (action: "open" | "copy" | "qr") => {
    if (!shareUrl || shareBusy) return;
    setShareBusy(action);
    setShareError(null);
    setShareMessage(null);
    try {
      const result = await window.gastronomy.shareWebSite(action);
      if (result.completed) {
        setShareMessage(
          action === "open"
            ? "Carta abierta en el navegador."
            : action === "copy"
              ? "Enlace copiado."
              : "Código QR descargado.",
        );
      }
    } catch (value) {
      setShareError(humanError(value));
    } finally {
      setShareBusy(null);
    }
  };
  return (
    <Card id="settings-website" className="scroll-mt-20 overflow-hidden p-0">
      <div className="border-b border-slate-100 bg-gradient-to-r from-brand-50/70 to-white px-4 py-4">
        <h3 className="text-sm font-bold">Página web</h3>
        <p className="mt-1 text-xs text-slate-600">
          Gestioná el subdominio y la presentación básica de tu negocio.
        </p>
      </div>
      <div className="grid gap-4 p-4">
        {query.isPending && !status ? (
          <p role="status" className="text-xs text-slate-600">
            Consultando estado de la página…
          </p>
        ) : null}
        {query.isError ? (
          <p role="alert" className="text-xs text-rose-700">
            No se pudo consultar el estado: {humanError(query.error)}
          </p>
        ) : null}
        {status ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-600">
                  Estado
                </p>
                <p className="mt-1 text-sm font-extrabold text-slate-900">
                  {stateLabels[status.state]}
                </p>
              </div>
              {shareUrl ? (
                <label className="min-w-0 flex-1 text-xs text-slate-600">
                  Dirección pública
                  <Input
                    readOnly
                    value={shareUrl}
                    aria-label="Dirección pública de la carta"
                    onFocus={(e) => e.currentTarget.select()}
                  />
                </label>
              ) : null}
            </div>
            {status.message ? (
              <p className="text-xs leading-5 text-slate-600">
                {status.message}
              </p>
            ) : null}
            {status.state === "UNCONFIGURED" ? (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
                La página web no está configurada en esta instalación. Esto no
                afecta la solicitud ni el uso de la licencia.
              </p>
            ) : null}
            {status.designMode === "CUSTOM" ? (
              <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs leading-5 text-sky-900">
                El diseño personalizado está administrado por el equipo de Delta
                Nube. Podés consultar el estado, pero los cambios visuales se
                gestionan con el dueño del sitio.
              </p>
            ) : null}
            {shareUrl ? (
              <section
                aria-label="Compartir carta"
                className="grid gap-2 rounded-xl border border-slate-200 p-3"
              >
                <p className="text-xs font-bold text-slate-800">
                  Compartí tu carta
                </p>
                <p className="text-xs text-slate-600">
                  La carta está activa. Abrila, copiá el enlace o descargá un
                  código QR para compartirlo.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={!!shareBusy}
                    onClick={() => void share("open")}
                  >
                    {shareBusy === "open" ? "Abriendo…" : "Abrir carta"}
                  </Button>
                  <Button
                    disabled={!!shareBusy}
                    onClick={() => void share("copy")}
                  >
                    {shareBusy === "copy" ? "Copiando…" : "Copiar enlace"}
                  </Button>
                  <Button
                    disabled={!!shareBusy}
                    onClick={() => void share("qr")}
                  >
                    {shareBusy === "qr" ? "Preparando QR…" : "Descargar QR"}
                  </Button>
                </div>
                <div aria-live="polite" aria-atomic="true">
                  {shareMessage ? (
                    <p role="status" className="text-xs text-emerald-700">
                      {shareMessage}
                    </p>
                  ) : null}
                  {shareError ? (
                    <p role="alert" className="text-xs text-rose-700">
                      {shareError}
                    </p>
                  ) : null}
                </div>
              </section>
            ) : null}
            {canRegister && status.state !== "ACTIVE" ? (
              <div className="grid gap-3 rounded-xl border border-slate-200 p-3">
                <p className="text-xs font-bold text-slate-800">
                  Subdominio y pedidos
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Subdominio">
                    <div className="flex min-w-0 items-center rounded-lg border border-slate-200 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-100">
                      <Input
                        aria-label="Subdominio"
                        className="min-w-0 border-0 focus:ring-0"
                        value={slug}
                        onChange={(event) => setSlug(event.target.value)}
                        placeholder="mi-negocio"
                      />
                      <span className="shrink-0 pr-3 text-xs text-slate-500">
                        .deltanubeweb.com
                      </span>
                    </div>
                  </Field>
                  <Field label="WhatsApp de pedidos">
                    <Input
                      type="tel"
                      value={phone}
                      onChange={(event) => setPhone(event.target.value)}
                      placeholder="+54 9 11 1234-5678"
                      autoComplete="tel"
                    />
                  </Field>
                </div>
                <p className="break-all text-xs text-brand-700">
                  Vista previa:{" "}
                  <strong>
                    {normalizeSiteSlug(slug) || "tu-negocio"}.deltanubeweb.com
                  </strong>
                </p>
                <Button
                  onClick={() => register.mutate()}
                  disabled={busy || !siteChoice(slug, phone)}
                >
                  {register.isPending
                    ? "Enviando…"
                    : status.state === "PENDING" || status.state === "ERROR"
                      ? "Reintentar o actualizar solicitud"
                      : "Solicitar página web"}
                </Button>
              </div>
            ) : null}
            {status.state === "ACTIVE" && status.designMode === "STANDARD" ? (
              <div className="grid gap-3 rounded-xl border border-slate-200 p-3">
                <p className="text-xs font-bold text-slate-800">
                  Personalización básica
                </p>
                <Field label="Nombre visible">
                  <Input
                    value={displayName}
                    maxLength={80}
                    onChange={(event) => setDisplayName(event.target.value)}
                  />
                </Field>
                <Field label="Descripción breve">
                  <Input
                    value={tagline}
                    maxLength={160}
                    onChange={(event) => setTagline(event.target.value)}
                    placeholder="Qué hace especial a tu negocio"
                  />
                </Field>
                <Field label="Color de acento">
                  <div className="flex items-center gap-3">
                    <Input
                      aria-label="Color de acento"
                      type="color"
                      value={
                        /^#[0-9a-f]{6}$/i.test(accent) ? accent : "#15803d"
                      }
                      onChange={(event) => setAccent(event.target.value)}
                      className="h-10 w-16 p-1"
                    />
                    <span className="text-xs text-slate-600">
                      Se usa en botones y detalles de la página.
                    </span>
                  </div>
                </Field>
                <Button
                  onClick={() => saveBranding.mutate()}
                  disabled={busy || !displayName.trim()}
                >
                  {saveBranding.isPending
                    ? "Guardando…"
                    : "Guardar presentación"}
                </Button>
              </div>
            ) : null}
          </>
        ) : null}
        {error ? (
          <p
            role="alert"
            className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800"
          >
            {error}
          </p>
        ) : null}
      </div>
    </Card>
  );
}
