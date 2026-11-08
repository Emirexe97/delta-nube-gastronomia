import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { StaticRouter } from "react-router-dom/server";
import type { BootstrapDto } from "@gastronomy/contracts";
import { SettingsPage } from "../pages/settings-page";

const bootstrap = {
  settings: {
    businessName: "Local",
    currency: "ARS",
    halfAndHalfPricingMode: "HALF_PLUS_HALF",
    halfAndHalfEnabled: true,
    maxConcurrentCashSessions: 1,
    stockEnabled: true,
    allowCloseWithPendingOrders: false,
    touchProductPanelEnabled: false,
    deliverySettlementEnabled: false,
    deliveryFeeBelongsToDriver: true,
    enabledOrderStatuses: [],
    quickDelayMinutes: [],
    modules: {
      diningRoom: true,
      takeaway: true,
      delivery: true,
      modifiers: true,
      discounts: true,
      advancedStatuses: false,
    },
    printing: {
      terminalLabel: "",
      kitchen: {},
      bill: {},
      receiptTemplate: {},
    },
  },
} as unknown as BootstrapDto;

describe("settings section navigation", () => {
  it("exposes accessible tabs and keeps unopened panels lazy", () => {
    const client = new QueryClient();
    const markup = renderToStaticMarkup(
      <StaticRouter location="/configuracion">
        <QueryClientProvider client={client}>
          <SettingsPage data={bootstrap} />
        </QueryClientProvider>
      </StaticRouter>,
    );

    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('role="tab"');
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain('aria-controls="panel-settings-license"');
    expect(markup).toContain('id="panel-settings-license"');
    expect(markup).not.toContain('id="settings-license"');
    for (const [, panelId] of markup.matchAll(/aria-controls="(panel-settings-[^"]+)"/g)) {
      expect(markup).toContain(`id="${panelId}"`);
    }
    expect(markup).toContain('data-enter-navigation');
  });

  it("does not display an ADMIN PIN field until restoration is requested", () => {
    const markup = renderToStaticMarkup(
      <StaticRouter location="/configuracion#settings-backup">
        <QueryClientProvider client={new QueryClient()}>
          <SettingsPage data={bootstrap} />
        </QueryClientProvider>
      </StaticRouter>,
    );
    expect(markup).toContain('id="settings-backup"');
    expect(markup).toContain("Restaurar copia");
    expect(markup).not.toContain('id="restore-admin-pin"');
  });
});
