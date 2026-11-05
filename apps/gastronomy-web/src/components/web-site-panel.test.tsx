import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { WebSiteStatus } from "@gastronomy/contracts";
import { WebSitePanel } from "./web-site-panel";
import { LicensePanel } from "./license-panel";

function render(status: WebSiteStatus) {
  const client = new QueryClient();
  client.setQueryData(["website-status"], status);
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client }, createElement(WebSitePanel)),
  );
}
const base: WebSiteStatus = {
  state: "NOT_REGISTERED",
  slug: null,
  url: null,
  displayName: "",
  tagline: "",
  accent: "#15803d",
  designMode: "STANDARD",
  message: "",
};

describe("web site settings renderer", () => {
  it("shows subdomain preview and WhatsApp field for an unregistered site", () => {
    const html = render(base);
    expect(html).toContain("Subdominio");
    expect(html).toContain("WhatsApp de pedidos");
    expect(html).toContain("deltanubeweb.com");
    expect(html).toContain("Solicitar página web");
  });

  it("renders customization controls only for an active standard design", () => {
    const standard = render({
      ...base,
      state: "ACTIVE",
      slug: "cafe-norte",
      url: "https://cafe-norte.deltanubeweb.com",
      displayName: "Café Norte",
    });
    expect(standard).toContain("Guardar presentación");
    expect(standard).toContain("Color de acento");
    expect(standard).toContain("Abrir carta");
    expect(standard).toContain("Copiar enlace");
    expect(standard).toContain("Descargar QR");
    const custom = render({
      ...base,
      state: "ACTIVE",
      designMode: "CUSTOM",
      slug: "cafe-norte",
      url: "https://cafe-norte.deltanubeweb.com",
    });
    expect(custom).toContain("administrado por el equipo de Delta Nube");
    expect(custom).not.toContain("Guardar presentación");
    expect(custom).toContain("Descargar QR");
  });

  it("makes unavailable infrastructure explicit without implying that demo publishes a site", () => {
    const html = render({
      ...base,
      state: "UNCONFIGURED",
      message: "Modo demostración: no hay servicio.",
    });
    expect(html).toContain("no está configurada en esta instalación");
    expect(html).toContain("no hay servicio");
    expect(html).not.toContain("Solicitar página web");
    expect(html).not.toContain("Abrir carta");
  });

  it("does not offer sharing for inactive or unsafe URLs", () => {
    expect(
      render({ ...base, state: "PENDING", url: "cafe-norte.deltanubeweb.com" }),
    ).not.toContain("Copiar enlace");
    expect(
      render({
        ...base,
        state: "ACTIVE",
        slug: "cafe-norte",
        url: "javascript:alert(1)",
      }),
    ).not.toContain("Abrir carta");
  });

  it("keeps the existing license enrollment path and includes optional storefront fields in its form", () => {
    const client = new QueryClient();
    client.setQueryData(["license-status"], {
      state: "UNACTIVATED",
      canOperate: false,
      installationId: "install-1",
      businessName: null,
      paidThrough: null,
      graceUntil: null,
      lastVerifiedAt: null,
      verificationOverdue: false,
      message: "Pendiente",
    });
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client },
        createElement(LicensePanel),
      ),
    );
    expect(html).toContain("Nombre del negocio");
    expect(html).toContain(
      "Crear mi página de pedidos al habilitar el negocio",
    );
    expect(html).toContain('checked=""');
    expect(html).toContain("WhatsApp de pedidos");
    expect(html).toContain("Solicitar habilitación");
  });
});
