import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button, Card, Field, HelpTip, Input } from "@gastronomy/ui";
import { sharedThemeCss } from "@gastronomy/ui/theme";

describe("shared UI contract", () => {
  it("uses shared color tokens in desktop controls instead of duplicating the palette", () => {
    const markup = renderToStaticMarkup(
      <>
        <Button>Guardar</Button>
        <Card>
          <Input />
        </Card>
      </>,
    );
    expect(markup).toContain("bg-dn-primary");
    expect(markup).toContain("hover:bg-dn-primary-hover");
    expect(markup).toContain("border-dn-border");
    expect(markup).toContain("bg-dn-surface");
  });
  it("exposes the agreed shared palette, type and radius tokens", () => {
    expect(sharedThemeCss).toContain("--dn-color-primary: #c2410c");
    expect(sharedThemeCss).toContain("--dn-color-background: #f5f7fa");
    expect(sharedThemeCss).toContain("--dn-color-surface-2: #f8fafc");
    expect(sharedThemeCss).toContain("--dn-font-sans:");
    expect(sharedThemeCss).toContain("--dn-radius-control: 10px");
    expect(sharedThemeCss).toContain("--dn-radius-card: 16px");
  });

  it("renders help outside the associated label and preserves inline status", () => {
    const markup = renderToStaticMarkup(
      <>
        <Field label="Nombre" hint="Dato útil">
          <input />
        </Field>
        <Field
          label="Dispositivos"
          hint="Buscando dispositivos…"
          hintMode="inline"
        >
          <input />
        </Field>
      </>,
    );
    const labelPart = markup.match(/<label[^>]*>[\s\S]*?<\/label>/)?.[0] ?? "";
    expect(labelPart).not.toContain("<button");
    expect(markup).toContain('aria-label="Ayuda: Nombre"');
    expect(markup).toContain('role="status">Buscando dispositivos…</span>');
  });

  it("keeps HelpTip trigger available in server-rendered output", () => {
    const markup = renderToStaticMarkup(
      <HelpTip label="Ayuda de prueba">Explicación</HelpTip>,
    );
    expect(markup).toContain('aria-label="Ayuda de prueba"');
    expect(markup).toContain('aria-expanded="false"');
  });
});
