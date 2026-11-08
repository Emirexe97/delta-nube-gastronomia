import { describe, expect, it, vi } from "vitest";
import { checkInitialAdminPin, configureInitialAdminPin } from "./initial-admin-pin-gate";

describe("initial admin PIN renderer gate", () => {
  it("holds access until a successful first change is reflected by status", async () => {
    let pending = true;
    const api = {
      isInitialAdminPinSetupRequired: vi.fn(async () => pending),
      setInitialAdminPin: vi.fn(async () => { pending = false; return { configured: true as const }; }),
    };
    expect(await checkInitialAdminPin(api)).toBe(true);
    await configureInitialAdminPin(api, { currentPin: "1234", newPin: "5729", confirmPin: "5729" });
    expect(await checkInitialAdminPin(api)).toBe(false);
    expect(api.setInitialAdminPin).toHaveBeenCalledWith({ currentPin: "1234", newPin: "5729" });
  });

  it("fails closed on status network errors and surfaces failed PIN changes", async () => {
    const offline = { isInitialAdminPinSetupRequired: vi.fn().mockRejectedValue(new Error("offline")) };
    await expect(checkInitialAdminPin(offline)).rejects.toThrow("offline");
    const failed = { setInitialAdminPin: vi.fn().mockRejectedValue(new Error("PIN actual incorrecto")) };
    await expect(configureInitialAdminPin(failed, { currentPin: "x", newPin: "5729", confirmPin: "5729" })).rejects.toThrow("PIN actual incorrecto");
    expect(failed.setInitialAdminPin).toHaveBeenCalledTimes(1);
  });

  it("does not call the bridge unless new PIN confirmation matches", async () => {
    const api = { setInitialAdminPin: vi.fn() };
    await expect(configureInitialAdminPin(api, { currentPin: "1234", newPin: "5729", confirmPin: "5728" })).rejects.toThrow("no coinciden");
    expect(api.setInitialAdminPin).not.toHaveBeenCalled();
  });
});
