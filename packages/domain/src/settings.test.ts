import assert from "node:assert/strict";
import test from "node:test";
import type { AppSettingsDto } from "@gastronomy/contracts";
import { assertAppSettings } from "./settings";

const valid: AppSettingsDto = {
  businessName: "Local",
  currency: "ARS" as const,
  halfAndHalfPricingMode: "HALF_PLUS_HALF" as const,
  stockEnabled: false,
  maxConcurrentCashSessions: 1,
  allowCloseWithPendingOrders: false,
  touchProductPanelEnabled: false,
  deliverySettlementEnabled: false,
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
    terminalLabel: "Caja",
    kitchen: {
      profileName: "Cocina",
      deviceName: "",
      mode: "SYSTEM_DIALOG" as const,
      paperWidth: "80mm" as const,
      charsPerLine: 42,
      copies: 1,
      cutter: true,
      cutMode: "PARTIAL" as const,
      feedLinesBeforeCut: 4,
    },
    bill: {
      profileName: "Cuenta",
      deviceName: "",
      mode: "SYSTEM_DIALOG" as const,
      paperWidth: "80mm" as const,
      charsPerLine: 42,
      copies: 1,
      cutter: true,
      cutMode: "PARTIAL" as const,
      feedLinesBeforeCut: 4,
    },
    receiptTemplate: {
      kitchenHeader: "",
      kitchenFooter: "",
      title: "",
      subtitle: "",
      footer: "",
      nonFiscalLegend: "",
      showOrderNumber: true,
      showDate: true,
      showTable: true,
      showWaiter: true,
      showCustomer: true,
      showItemQuantity: true,
      showItemUnitPrice: true,
      showItemTotal: true,
      showPaymentSummary: true,
    },
  },
};

test("settings accepts absent and boolean half-and-half flag but rejects non-booleans", () => {
  assert.equal(assertAppSettings(valid), valid);
  assert.equal(
    assertAppSettings({ ...valid, halfAndHalfEnabled: true })
      .halfAndHalfEnabled,
    true,
  );
  assert.equal(
    assertAppSettings({ ...valid, halfAndHalfEnabled: false })
      .halfAndHalfEnabled,
    false,
  );
  for (const value of ["false", 0, 1, null])
    assert.throws(
      () =>
        assertAppSettings({
          ...valid,
          halfAndHalfEnabled: value,
        } as unknown as AppSettingsDto),
      /mitad y mitad/,
    );
});
