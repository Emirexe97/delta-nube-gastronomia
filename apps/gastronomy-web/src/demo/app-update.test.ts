import { expect, it } from "vitest";
import { createDemoApi, type DemoStorage } from "./demo-api";

class MemoryStorage implements DemoStorage {
  getItem() {
    return null;
  }
  setItem() {}
  removeItem() {}
}

it("keeps automatic updates disabled in demo mode without network activity", async () => {
  const api = createDemoApi(new MemoryStorage());
  const status = await api.getAppUpdateStatus();
  expect(status).toMatchObject({
    state: "DISABLED",
    availableVersion: null,
    progress: null,
  });
  expect(status.message).toMatch(
    /solo están disponibles.*escritorio instalad[oa]/i,
  );
  expect(await api.checkAppUpdate()).toEqual(status);
  expect(await api.installAppUpdate()).toEqual(status);
});
