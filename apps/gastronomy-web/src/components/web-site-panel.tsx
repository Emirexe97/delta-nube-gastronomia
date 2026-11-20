import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Field, Input } from "@gastronomy/ui";
import type { ProductDto, WebSiteStatus } from "@gastronomy/contracts";
import { humanError } from "../lib";
import { normalizeSiteSlug, siteChoice } from "./web-site-input";
import { getMerchantShareUrl } from "@gastronomy/contracts";
import {
  fileFromImageDataUrl,
  normalizeSiteBanner,
  normalizeSiteImage,
} from "./web-site-banner";
import { getStorefrontProductPrice } from "./web-site-products";
import {
  renderStorefrontCover,
  renderStorefrontProductPreview,
  storefrontCoverCss,
  storefrontAccentForeground,
  storefrontProductCss,
} from "@gastronomy/ui/storefront-cover";

const websiteKey = ["website-status"] as const;
const stateLabels: Record<WebSiteStatus["state"], string> = {
  UNCONFIGURED: "Servicio no configurado",
  NOT_REGISTERED: "Todavía no solicitada",
  PENDING: "Solicitud pendiente",
  ACTIVE: "Activa",
  ERROR: "Requiere atención",
};

export function WebSitePanel({ products }: { products: ProductDto[] }) {
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
  const [slug, setSlug] = useState(status?.slug ?? "");
  const [phone, setPhone] = useState("");
  const [displayName, setDisplayName] = useState(status?.displayName ?? "");
  const [tagline, setTagline] = useState(status?.tagline ?? "");
  const [accent, setAccent] = useState(status?.accent || "#15803d");
  const [bannerSrc, setBannerSrc] = useState<string | null>(
    status?.bannerDataUrl ?? null,
  );
  const [bannerChanged, setBannerChanged] = useState(false);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [bannerBusy, setBannerBusy] = useState(false);
  const [logoSrc, setLogoSrc] = useState<string | null>(
    status?.logoDataUrl ?? null,
  );
  const [logoChanged, setLogoChanged] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const logoRequestId = useRef(0);
  const [productQuery, setProductQuery] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<ProductDto | null>(
    null,
  );
  const [productPublishedPhoto, setProductPublishedPhoto] = useState<
    string | null
  >(null);
  const [productPosPhoto, setProductPosPhoto] = useState<string | null>(null);
  const [productPhotoSrc, setProductPhotoSrc] = useState<string | null>(null);
  const [productPhotoChanged, setProductPhotoChanged] = useState(false);
  const [productPhotoBusy, setProductPhotoBusy] = useState(false);
  const [productPhotoError, setProductPhotoError] = useState<string | null>(
    null,
  );
  const [productPhotoReadState, setProductPhotoReadState] = useState<
    "idle" | "none" | "published" | "pos" | "pending" | "error"
  >("idle");
  const [productWebPhotoUnknown, setProductWebPhotoUnknown] = useState(false);
  const [productPhotoRetry, setProductPhotoRetry] = useState(0);
  const productPhotoRequestId = useRef(0);
  const [phonePreview, setPhonePreview] = useState<{
    url: string;
    qrDataUrl: string;
    expiresAt: string;
  } | null>(null);
  const [phonePreviewInvalidated, setPhonePreviewInvalidated] = useState(false);
  const phonePreviewWasCreated = useRef(false);
  const [phonePreviewBusy, setPhonePreviewBusy] = useState(false);
  const [phonePreviewError, setPhonePreviewError] = useState<string | null>(
    null,
  );
  const [phonePreviewCopyMessage, setPhonePreviewCopyMessage] = useState<
    string | null
  >(null);
  const phonePreviewRequestId = useRef(0);
  const bannerRequestId = useRef(0);
  const statusContext = status
    ? `${status.state}|${status.designMode}|${status.slug}`
    : "";
  const hydratedContext = useRef(statusContext);
  const lastStatus = useRef(status);
  const [error, setError] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState<"open" | "copy" | "qr" | null>(
    null,
  );
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  useEffect(() => {
    if (!status) return;
    if (lastStatus.current === status) return;
    const previous = lastStatus.current;
    lastStatus.current = status;
    const contextChanged = hydratedContext.current !== statusContext;
    if (
      hydratedContext.current === statusContext &&
      previous &&
      (bannerBusy ||
        bannerChanged ||
        logoBusy ||
        logoChanged ||
        productPhotoBusy ||
        productPhotoChanged ||
        displayName !== previous.displayName ||
        tagline !== previous.tagline ||
        accent !== (previous.accent || "#15803d"))
    )
      return;
    if (contextChanged) setSlug(status.slug ?? "");
    hydratedContext.current = statusContext;
    setDisplayName(status.displayName);
    setTagline(status.tagline);
    setAccent(status.accent || "#15803d");
    setBannerSrc(status.bannerDataUrl ?? null);
    setLogoSrc(status.logoDataUrl ?? null);
    bannerRequestId.current += 1;
    logoRequestId.current += 1;
    productPhotoRequestId.current += 1;
    setBannerBusy(false);
    setLogoBusy(false);
    setProductPhotoBusy(false);
    setBannerChanged(false);
    setLogoChanged(false);
    if (contextChanged) {
      setSelectedProduct(null);
      setProductPhotoSrc(null);
      setProductPublishedPhoto(null);
      setProductPosPhoto(null);
      setProductPhotoChanged(false);
      setProductWebPhotoUnknown(false);
    }
    setBannerError(null);
  }, [
    status,
    statusContext,
    bannerBusy,
    bannerChanged,
    displayName,
    tagline,
    accent,
    logoBusy,
    logoChanged,
    productPhotoBusy,
    productPhotoChanged,
  ]);

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
        ...(bannerChanged ? { bannerDataUrl: bannerSrc } : {}),
        ...(logoChanged ? { logoDataUrl: logoSrc } : {}),
        ...(selectedProduct && productPhotoChanged
          ? {
              productPhoto: {
                productRef: selectedProduct.id,
                dataUrl: productPhotoSrc,
              },
            }
          : {}),
      }),
    onSuccess: (next) => {
      setDisplayName(next.displayName);
      setTagline(next.tagline);
      setAccent(next.accent || "#15803d");
      setBannerSrc(next.bannerDataUrl ?? null);
      setLogoSrc(next.logoDataUrl ?? null);
      setBannerChanged(false);
      setLogoChanged(false);
      setProductPhotoChanged(false);
      setProductPublishedPhoto(productPhotoSrc);
      if (productPhotoSrc) setProductPhotoReadState("published");
      setBannerError(null);
      lastStatus.current = next;
      hydratedContext.current = `${next.state}|${next.designMode}|${next.slug}`;
      updateStatus(next);
    },
    onError: (value) => setError(humanError(value)),
  });
  const busy =
    register.isPending ||
    saveBranding.isPending ||
    bannerBusy ||
    logoBusy ||
    productPhotoBusy;
  const previewMarkup = useMemo(
    () =>
      renderStorefrontCover({
        displayName: displayName.trim(),
        tagline: tagline.trim(),
        accent: /^#[0-9a-f]{6}$/i.test(accent) ? accent : "#15803d",
        bannerSrc,
        logoSrc,
      }),
    [displayName, tagline, accent, bannerSrc, logoSrc],
  );
  const hasDraftChanges =
    !!status &&
    (displayName.trim() !== status.displayName ||
      tagline.trim() !== status.tagline ||
      accent !== (status.accent || "#15803d") ||
      bannerChanged);
  const hasAnyDraftChanges =
    hasDraftChanges || logoChanged || productPhotoChanged;
  const productPreviewMarkup = useMemo(
    () =>
      selectedProduct
        ? renderStorefrontProductPreview({
            name: selectedProduct.name,
            category: selectedProduct.categoryName,
            priceMinor: getStorefrontProductPrice(selectedProduct) ?? 0,
            photoSrc: productPhotoSrc,
          })
        : "",
    [selectedProduct, productPhotoSrc],
  );
  const visibleProducts = useMemo(() => {
    const term = productQuery.trim().toLocaleLowerCase();
    if (!term) return [];
    return products
      .filter(
        (p) =>
          !p.comboDefinition &&
          `${p.name} ${p.code ?? ""}`.toLocaleLowerCase().includes(term),
      )
      .slice(0, 20);
  }, [products, productQuery]);
  useEffect(() => {
    if (!selectedProduct) return;
    let live = true;
    const requestId = ++productPhotoRequestId.current;
    setProductPhotoBusy(true);
    setProductPhotoError(null);
    setProductPhotoReadState("idle");
    setProductWebPhotoUnknown(false);
    const preserveProductDraft = productPhotoChanged;
    if (!preserveProductDraft) {
      setProductPublishedPhoto(null);
      setProductPosPhoto(null);
      setProductPhotoSrc(null);
      setProductPhotoChanged(false);
    }
    void (async () => {
      let published: string | null = null;
      let publishedReadError: unknown = null;
      try {
        const result = await window.gastronomy.getWebProductPhoto({
          productRef: selectedProduct.id,
        });
        published = result.dataUrl;
      } catch (value) {
        publishedReadError = value;
      }
      let pos: string | null = null;
      let posReadError: unknown = null;
      try {
        pos = await window.gastronomy.getProductImage({
          productId: selectedProduct.id,
        });
      } catch (value) {
        posReadError = value;
      }
      if (!live || requestId !== productPhotoRequestId.current) return;
      setProductWebPhotoUnknown(!!publishedReadError);
      setProductPublishedPhoto(published);
      setProductPosPhoto(pos);
      if (!preserveProductDraft) setProductPhotoSrc(published);
      setProductPhotoReadState(
        publishedReadError
          ? "error"
          : preserveProductDraft && productPhotoChanged
            ? "pending"
            : published
              ? "published"
              : "none",
      );
      if (publishedReadError || posReadError)
        setProductPhotoError(
          publishedReadError
            ? "No se pudo leer la foto publicada. No se asumió que esté vacía."
            : "No se pudo leer la foto local del POS; el estado de la carta web sí se pudo consultar.",
        );
      setProductPhotoBusy(false);
    })();
    return () => {
      live = false;
    };
  }, [selectedProduct?.id, productPhotoRetry]);
  useEffect(() => {
    if (phonePreviewWasCreated.current) setPhonePreviewInvalidated(true);
    phonePreviewWasCreated.current = false;
    setPhonePreview(null);
    setPhonePreviewError(null);
    setPhonePreviewCopyMessage(null);
    setPhonePreviewBusy(false);
    phonePreviewRequestId.current += 1;
  }, [
    displayName,
    tagline,
    accent,
    bannerSrc,
    logoSrc,
    selectedProduct?.id,
    productPhotoSrc,
  ]);
  const chooseBanner = async (file?: File) => {
    if (!file) return;
    setBannerBusy(true);
    setBannerError(null);
    const requestId = ++bannerRequestId.current;
    try {
      const normalized = await normalizeSiteBanner(file);
      if (requestId !== bannerRequestId.current) return;
      setBannerSrc(normalized);
      setBannerChanged(normalized !== (status?.bannerDataUrl ?? null));
    } catch (value) {
      if (requestId !== bannerRequestId.current) return;
      setBannerError(
        value instanceof Error
          ? value.message
          : "No se pudo procesar la imagen.",
      );
    } finally {
      if (requestId === bannerRequestId.current) setBannerBusy(false);
    }
  };
  const discardDraft = () => {
    if (!status) return;
    setDisplayName(status.displayName);
    setTagline(status.tagline);
    setAccent(status.accent || "#15803d");
    setBannerSrc(status.bannerDataUrl ?? null);
    setLogoSrc(status.logoDataUrl ?? null);
    bannerRequestId.current += 1;
    setBannerChanged(false);
    setLogoChanged(false);
    productPhotoRequestId.current += 1;
    setSelectedProduct(null);
    setProductPublishedPhoto(null);
    setProductPosPhoto(null);
    setProductPhotoSrc(null);
    setProductPhotoChanged(false);
    setProductPhotoError(null);
    setProductWebPhotoUnknown(false);
    setBannerError(null);
    setError(null);
    saveBranding.reset();
  };
  const selectProduct = (next: ProductDto) => {
    if (selectedProduct?.id === next.id) return;
    if (getStorefrontProductPrice(next) === null) return;
    if (
      productPhotoChanged &&
      !window.confirm(
        "La foto de este producto tiene cambios sin publicar. ¿Descartarla y cambiar de producto?",
      )
    )
      return;
    setSelectedProduct(next);
    setProductQuery("");
    setProductPhotoSrc(null);
    setProductPhotoChanged(false);
    setProductPhotoError(null);
  };
  const clearSelectedProduct = () => {
    if (
      productPhotoChanged &&
      !window.confirm(
        "La foto de este producto tiene cambios sin publicar. ¿Descartarla y quitar el producto de la vista previa?",
      )
    )
      return;
    productPhotoRequestId.current += 1;
    setSelectedProduct(null);
    setProductPublishedPhoto(null);
    setProductPosPhoto(null);
    setProductPhotoSrc(null);
    setProductPhotoChanged(false);
    setProductPhotoError(null);
    setProductPhotoBusy(false);
    setProductPhotoReadState("idle");
    setProductWebPhotoUnknown(false);
  };
  const chooseBrandImage = async (kind: "logo" | "product", file?: File) => {
    if (!file) return;
    const requestId =
      kind === "logo"
        ? ++logoRequestId.current
        : ++productPhotoRequestId.current;
    kind === "logo" ? setLogoBusy(true) : setProductPhotoBusy(true);
    kind === "logo" ? setLogoError(null) : setProductPhotoError(null);
    try {
      const dataUrl = await normalizeSiteImage(file, kind);
      if (
        requestId !==
        (kind === "logo"
          ? logoRequestId.current
          : productPhotoRequestId.current)
      )
        return;
      if (kind === "logo") {
        setLogoSrc(dataUrl);
        setLogoChanged(dataUrl !== (status?.logoDataUrl ?? null));
      } else {
        setProductPhotoSrc(dataUrl);
        setProductPhotoChanged(dataUrl !== productPublishedPhoto);
        setProductPhotoReadState(dataUrl ? "pending" : "none");
      }
    } catch (value) {
      if (
        requestId !==
        (kind === "logo"
          ? logoRequestId.current
          : productPhotoRequestId.current)
      )
        return;
      const message =
        value instanceof Error
          ? value.message
          : "No se pudo procesar la imagen.";
      kind === "logo" ? setLogoError(message) : setProductPhotoError(message);
    } finally {
      if (
        requestId ===
        (kind === "logo"
          ? logoRequestId.current
          : productPhotoRequestId.current)
      )
        kind === "logo" ? setLogoBusy(false) : setProductPhotoBusy(false);
    }
  };
  const usePosPhoto = async () => {
    if (!productPosPhoto || productWebPhotoUnknown) return;
    const requestId = ++productPhotoRequestId.current;
    setProductPhotoBusy(true);
    setProductPhotoError(null);
    try {
      const file = fileFromImageDataUrl(
        productPosPhoto,
        `${selectedProduct?.id ?? "producto"}.image`,
      );
      const normalized = await normalizeSiteImage(file, "product");
      if (requestId !== productPhotoRequestId.current) return;
      setProductPhotoSrc(normalized);
      setProductPhotoChanged(normalized !== productPublishedPhoto);
      setProductPhotoReadState("pos");
    } catch (value) {
      if (requestId !== productPhotoRequestId.current) return;
      setProductPhotoError(
        value instanceof Error
          ? value.message
          : "No se pudo preparar la foto del POS.",
      );
    } finally {
      if (requestId === productPhotoRequestId.current)
        setProductPhotoBusy(false);
    }
  };
  const createPhonePreview = async () => {
    if (
      !status ||
      status.designMode !== "STANDARD" ||
      phonePreviewBusy ||
      busy ||
      productWebPhotoUnknown
    )
      return;
    const requestId = ++phonePreviewRequestId.current;
    setPhonePreviewBusy(true);
    setPhonePreviewError(null);
    setPhonePreviewCopyMessage(null);
    try {
      const result = await window.gastronomy.createWebSitePreview({
        displayName: displayName.trim(),
        tagline: tagline.trim(),
        accent,
        bannerDataUrl: bannerSrc,
        logoDataUrl: logoSrc,
        product: selectedProduct
          ? {
              productRef: selectedProduct.id,
              name: selectedProduct.name,
              category: selectedProduct.categoryName,
              priceMinor: getStorefrontProductPrice(selectedProduct)!,
              photoDataUrl: productPhotoSrc,
            }
          : null,
      });
      if (requestId === phonePreviewRequestId.current) {
        phonePreviewWasCreated.current = true;
        setPhonePreviewInvalidated(false);
        setPhonePreview(result);
      }
    } catch (value) {
      if (requestId === phonePreviewRequestId.current)
        setPhonePreviewError(humanError(value));
    } finally {
      if (requestId === phonePreviewRequestId.current)
        setPhonePreviewBusy(false);
    }
  };
  const copyPhonePreviewLink = async () => {
    if (!phonePreview) return;
    try {
      await navigator.clipboard.writeText(phonePreview.url);
      setPhonePreviewCopyMessage("Enlace privado copiado.");
    } catch {
      setPhonePreviewCopyMessage(
        "No se pudo copiar automáticamente. Seleccioná el campo y copialo manualmente.",
      );
    }
  };
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
              <div className="grid gap-3 rounded-xl border border-slate-200 p-3 lg:grid-cols-2">
                <div className="lg:col-span-2">
                  <h4 className="text-base font-bold text-slate-900">
                    Portada de tu carta
                  </h4>
                  <p className="mt-1 text-sm text-slate-600">
                    Probá una foto y revisá cómo queda en un celular. Tus
                    clientes no verán el borrador hasta que publiques.
                  </p>
                </div>
                <div className="grid content-start gap-3">
                  <Field label="Nombre visible">
                    <Input
                      value={displayName}
                      maxLength={80}
                      disabled={busy}
                      onChange={(event) => setDisplayName(event.target.value)}
                    />
                  </Field>
                  <Field label="Descripción breve">
                    <Input
                      value={tagline}
                      maxLength={160}
                      disabled={busy}
                      onChange={(event) => setTagline(event.target.value)}
                      placeholder="Qué hace especial a tu negocio"
                    />
                  </Field>
                  <Field label="Color de acento">
                    <div className="flex items-center gap-3">
                      <Input
                        aria-label="Color de acento"
                        type="color"
                        disabled={busy}
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
                  <section
                    aria-label="Imagen de portada"
                    className="grid gap-2"
                  >
                    <p className="text-xs font-semibold text-slate-800">
                      Imagen de portada
                    </p>
                    <p
                      id="web-cover-formats"
                      className="text-xs text-slate-600"
                    >
                      JPG, PNG o WebP, hasta 8 MB. Usá una foto horizontal: se
                      recorta desde el centro a formato 5:2.
                    </p>
                    <label className="relative flex min-h-12 items-center justify-center rounded-lg border border-dashed border-slate-400 bg-slate-50 px-4 text-sm font-semibold text-slate-800 focus-within:ring-2 focus-within:ring-brand-700 hover:bg-slate-100">
                      {bannerSrc
                        ? "Elegir otra imagen"
                        : "Elegir imagen de portada"}
                      <input
                        aria-label="Elegir imagen de portada"
                        aria-describedby="web-cover-formats"
                        className="absolute inset-0 w-full cursor-pointer opacity-0 disabled:cursor-wait"
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        disabled={busy}
                        onChange={(event) => {
                          void chooseBanner(event.currentTarget.files?.[0]);
                          event.currentTarget.value = "";
                        }}
                      />
                    </label>
                    {bannerBusy ? (
                      <p role="status" className="text-xs text-slate-600">
                        Procesando portada…
                      </p>
                    ) : null}
                    {bannerSrc ? (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="secondary"
                          disabled={busy}
                          onClick={() => {
                            bannerRequestId.current += 1;
                            setBannerSrc(null);
                            setBannerError(null);
                            setBannerChanged(!!status.bannerDataUrl);
                          }}
                        >
                          Quitar portada
                        </Button>
                        <span className="self-center text-xs text-slate-600">
                          {bannerChanged
                            ? "Portada pendiente de publicar"
                            : "Portada publicada"}
                        </span>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-600">
                        {bannerChanged
                          ? "La portada se quitará al publicar."
                          : "Sin portada publicada."}
                      </p>
                    )}
                    {bannerError ? (
                      <p role="alert" className="text-xs text-rose-700">
                        {bannerError}
                      </p>
                    ) : null}
                  </section>
                  <section aria-label="Logo del negocio" className="grid gap-2">
                    <p className="text-xs font-semibold text-slate-800">
                      Logo del negocio
                    </p>
                    <p id="web-logo-formats" className="text-xs text-slate-600">
                      JPG, PNG o WebP, hasta 8 MB. Se contiene sin recortar ni
                      deformar sobre fondo blanco.
                    </p>
                    <label className="relative flex min-h-12 items-center justify-center rounded-lg border border-dashed border-slate-400 bg-slate-50 px-4 text-sm font-semibold text-slate-800 focus-within:ring-2 focus-within:ring-brand-700 hover:bg-slate-100">
                      {logoSrc ? "Elegir otro logo" : "Elegir logo del negocio"}
                      <input
                        aria-label="Elegir logo del negocio"
                        aria-describedby="web-logo-formats"
                        className="absolute inset-0 w-full cursor-pointer opacity-0 disabled:cursor-wait"
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        disabled={busy}
                        onChange={(event) => {
                          void chooseBrandImage(
                            "logo",
                            event.currentTarget.files?.[0],
                          );
                          event.currentTarget.value = "";
                        }}
                      />
                    </label>
                    {logoBusy ? (
                      <p role="status" className="text-xs text-slate-600">
                        Procesando logo…
                      </p>
                    ) : null}
                    {logoSrc ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <img
                          src={logoSrc}
                          alt="Vista previa del logo"
                          className="h-12 w-12 rounded border border-slate-200 bg-white object-contain p-1"
                        />
                        <Button
                          variant="secondary"
                          disabled={busy}
                          onClick={() => {
                            logoRequestId.current += 1;
                            setLogoSrc(null);
                            setLogoChanged(!!status.logoDataUrl);
                            setLogoError(null);
                          }}
                        >
                          Quitar logo
                        </Button>
                        <span className="text-xs text-slate-600">
                          {logoChanged
                            ? "Logo pendiente de publicar"
                            : "Logo publicado"}
                        </span>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-600">
                        {logoChanged
                          ? "El logo se quitará al publicar."
                          : "Sin logo publicado."}
                      </p>
                    )}
                    {logoError ? (
                      <p role="alert" className="text-xs text-rose-700">
                        {logoError}
                      </p>
                    ) : null}
                  </section>
                  <section
                    aria-label="Foto de producto"
                    className="grid gap-2 rounded-xl border border-slate-200 p-3"
                  >
                    <h5 className="text-xs font-bold text-slate-800">
                      Foto de un producto
                    </h5>
                    <p className="text-xs leading-5 text-slate-600">
                      Elegí un producto para editar su foto de carta. Se
                      consulta solo ese producto; el catálogo completo no carga
                      fotos. Los combos no aparecen.
                    </p>
                    <Field label="Buscar producto">
                      <Input
                        aria-label="Buscar producto"
                        value={productQuery}
                        disabled={busy}
                        onChange={(event) =>
                          setProductQuery(event.target.value)
                        }
                        placeholder="Nombre o código"
                        autoComplete="off"
                      />
                    </Field>
                    {visibleProducts.length ? (
                      <ul
                        aria-label="Resultados de productos"
                        className="grid max-h-52 gap-1 overflow-y-auto rounded-lg border border-slate-200 p-1"
                      >
                        {visibleProducts.map((product) => (
                          <li key={product.id}>
                            <button
                              type="button"
                              disabled={
                                getStorefrontProductPrice(product) === null
                              }
                              className="w-full rounded-md px-2 py-2 text-left text-sm hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
                              onClick={() => selectProduct(product)}
                            >
                              {product.name}
                              <span className="ml-2 text-xs text-slate-500">
                                {product.code ?? "Sin código"}
                                {getStorefrontProductPrice(product) === null
                                  ? " · Cargá un precio de retiro para publicarlo"
                                  : ""}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : productQuery.trim() ? (
                      <p className="text-xs text-slate-600">
                        No se encontraron productos con ese nombre o código.
                      </p>
                    ) : null}
                    {selectedProduct ? (
                      <div className="grid gap-2 rounded-lg bg-white p-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-slate-900">
                            {selectedProduct.name}
                          </p>
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={busy}
                            onClick={clearSelectedProduct}
                          >
                            Cambiar producto
                          </Button>
                        </div>
                        {!selectedProduct.webPublished ? (
                          <p className="text-xs text-amber-900">
                            Este producto está oculto en la carta web. Podés
                            preparar su foto; no se mostrará hasta que habilites
                            su publicación.
                          </p>
                        ) : null}
                        {productPhotoBusy ? (
                          <p role="status" className="text-xs text-slate-600">
                            Consultando fotos de este producto…
                          </p>
                        ) : null}
                        {productPhotoReadState === "published" ? (
                          <p className="text-xs text-emerald-800">
                            Foto actual de la carta web.
                          </p>
                        ) : null}
                        {productPhotoReadState === "pending" ? (
                          <p className="text-xs text-amber-900">
                            Foto preparada; todavía no publicada.
                          </p>
                        ) : null}
                        {productPhotoReadState === "none" ? (
                          <p className="text-xs text-slate-600">
                            No hay foto seleccionada para la carta web.
                            {productPosPhoto
                              ? " Podés cargar la foto original del POS si querés reutilizarla."
                              : ""}
                          </p>
                        ) : null}
                        {productPhotoReadState === "error" ? (
                          <p role="alert" className="text-xs text-rose-700">
                            No se pudo consultar la foto publicada; no se asumió
                            que esté vacía.
                          </p>
                        ) : null}
                        {productPhotoError ? (
                          <p role="alert" className="text-xs text-rose-700">
                            {productPhotoError}
                          </p>
                        ) : null}
                        {productWebPhotoUnknown ? (
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={busy}
                            onClick={() =>
                              setProductPhotoRetry((value) => value + 1)
                            }
                          >
                            Reintentar lectura de fotos
                          </Button>
                        ) : null}
                        {!productPhotoBusy &&
                        productPosPhoto &&
                        productPhotoReadState !== "pos" ? (
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={busy || productWebPhotoUnknown}
                            onClick={() => void usePosPhoto()}
                          >
                            Usar foto del POS
                          </Button>
                        ) : null}
                        {productPhotoReadState === "pos" && productPhotoSrc ? (
                          <p className="text-xs text-slate-600">
                            Foto copiada para la carta web. El original del POS
                            no se modifica.
                          </p>
                        ) : null}
                        <label className="relative flex min-h-11 items-center justify-center rounded-lg border border-dashed border-slate-400 bg-slate-50 px-3 text-sm font-semibold text-slate-800 focus-within:ring-2 focus-within:ring-brand-700 hover:bg-slate-100">
                          {productPhotoSrc
                            ? "Reemplazar foto del producto"
                            : "Elegir foto del producto"}
                          <input
                            aria-label="Elegir foto del producto"
                            className="absolute inset-0 w-full cursor-pointer opacity-0 disabled:cursor-wait"
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            disabled={busy}
                            onChange={(event) => {
                              void chooseBrandImage(
                                "product",
                                event.currentTarget.files?.[0],
                              );
                              event.currentTarget.value = "";
                            }}
                          />
                        </label>
                        {productPhotoSrc ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              type="button"
                              variant="secondary"
                              disabled={busy}
                              onClick={() => {
                                productPhotoRequestId.current += 1;
                                setProductPhotoSrc(null);
                                setProductPhotoChanged(!!productPublishedPhoto);
                                setProductPhotoReadState("none");
                                setProductPhotoError(null);
                              }}
                            >
                              Quitar foto del producto
                            </Button>
                            <span className="text-xs text-slate-600">
                              {productPhotoChanged
                                ? "Foto pendiente de publicar"
                                : "Foto publicada"}
                            </span>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </section>
                </div>
                <section
                  aria-label="Vista previa móvil"
                  className="grid content-start gap-3 rounded-xl bg-slate-50 px-3 py-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-slate-800">
                      Vista previa móvil
                    </p>
                    <span
                      className={`rounded-full px-2 py-1 text-[11px] font-semibold ${hasAnyDraftChanges ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900"}`}
                    >
                      {hasAnyDraftChanges
                        ? "Borrador · sin publicar"
                        : "Publicado"}
                    </span>
                  </div>
                  <div className="mx-auto w-full max-w-[390px] overflow-hidden rounded-[1.5rem] border-[5px] border-slate-900 bg-[#faf9f5] shadow-lg">
                    <style>{storefrontCoverCss}</style>
                    <div dangerouslySetInnerHTML={{ __html: previewMarkup }} />
                    {selectedProduct ? (
                      <div
                        className="w-full px-4 pb-4 pt-5"
                        style={
                          {
                            container: "storefront-products / inline-size",
                            "--ink": "#222520",
                            "--muted": "#5b6159",
                            "--line": "#dadbd2",
                            "--card": "#fffefa",
                            "--accent": accent,
                            "--accent-foreground":
                              storefrontAccentForeground(accent),
                          } as CSSProperties
                        }
                      >
                        <style>{storefrontProductCss}</style>
                        <div
                          dangerouslySetInnerHTML={{
                            __html: productPreviewMarkup,
                          }}
                        />
                      </div>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => void createPhonePreview()}
                    disabled={
                      busy ||
                      phonePreviewBusy ||
                      status.state !== "ACTIVE" ||
                      status.designMode !== "STANDARD" ||
                      productWebPhotoUnknown
                    }
                  >
                    {phonePreviewBusy
                      ? "Preparando vista privada…"
                      : "Ver en mi celular"}
                  </Button>
                  <p className="text-xs text-slate-600">
                    Vista simulada en este panel. La vista por celular crea un
                    enlace privado temporal y no publica la carta ni admite
                    pedidos. Si elegiste un producto, su nombre, precio y foto
                    preparada se incluyen en el enlace.
                  </p>
                  {phonePreview ? (
                    <div className="grid justify-items-center gap-2 rounded-lg border border-slate-200 bg-white p-3">
                      <img
                        src={phonePreview.qrDataUrl}
                        alt="Código QR de vista previa privada"
                        className="h-40 w-40"
                      />
                      <p className="text-center text-xs font-semibold text-slate-800">
                        Escaneá el QR o compartí este enlace manualmente
                      </p>
                      <Input
                        readOnly
                        value={phonePreview.url}
                        aria-label="Enlace privado de vista previa"
                        onFocus={(event) => event.currentTarget.select()}
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => void copyPhonePreviewLink()}
                      >
                        Copiar enlace privado
                      </Button>
                      {phonePreviewCopyMessage ? (
                        <p role="status" className="text-xs text-slate-600">
                          {phonePreviewCopyMessage}
                        </p>
                      ) : null}
                      <p className="text-center text-xs text-slate-600">
                        Privado para quien tenga el enlace. Vence en 10 minutos
                        y no permite hacer pedidos.
                      </p>
                    </div>
                  ) : null}
                  {phonePreviewInvalidated ? (
                    <p role="status" className="text-xs text-amber-900">
                      El borrador cambió y el QR/enlace se ocultaron en esta
                      pantalla. Esto no revoca enlaces anteriores: quien los
                      tenga todavía puede ver el borrador previo hasta su
                      vencimiento. Generá un enlace nuevo para compartir los
                      cambios.
                    </p>
                  ) : null}
                  {phonePreviewError ? (
                    <p role="alert" className="text-xs text-rose-700">
                      {phonePreviewError}
                    </p>
                  ) : null}
                </section>
                <div className="flex flex-wrap gap-2 lg:col-span-2">
                  <Button
                    onClick={() => saveBranding.mutate()}
                    disabled={
                      busy ||
                      !displayName.trim() ||
                      !hasAnyDraftChanges ||
                      (productWebPhotoUnknown && productPhotoChanged)
                    }
                  >
                    {saveBranding.isPending
                      ? "Publicando…"
                      : "Publicar cambios"}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={discardDraft}
                    disabled={busy || !hasAnyDraftChanges}
                  >
                    Descartar cambios
                  </Button>
                </div>
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
        {saveBranding.isSuccess && !hasAnyDraftChanges ? (
          <p role="status" className="text-xs font-semibold text-emerald-700">
            Cambios publicados correctamente.
          </p>
        ) : null}
      </div>
    </Card>
  );
}
