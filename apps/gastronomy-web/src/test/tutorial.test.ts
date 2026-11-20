import { describe, expect, it } from "vitest";
import {
  createDemoApi,
  DEMO_STORAGE_KEY,
  type DemoStorage,
} from "../demo/demo-api";
import {
  TUTORIAL_STEPS,
  tutorialCapabilities,
  tutorialStepIndex,
} from "../components/tutorial-content";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  } satisfies DemoStorage;
}

describe("user tutorial", () => {
  it("starts new users at welcome and persists progress across reloads without changing business data", async () => {
    const storage = memoryStorage();
    const api = createDemoApi(storage);
    await api.bootstrap();
    expect(await api.getTutorialProgress()).toEqual({
      version: 1,
      status: "NOT_STARTED",
      stepId: "welcome",
    });
    for (const status of ["IN_PROGRESS", "SKIPPED", "COMPLETED"] as const) {
      const stepId = status === "COMPLETED" ? "finish" : "order";
      const current = createDemoApi(storage);
      await current.bootstrap();
      const { tutorialProgress: previous, ...before } = JSON.parse(
        storage.getItem(DEMO_STORAGE_KEY)!,
      );
      await current.saveTutorialProgress({ version: 1, status, stepId });
      const { tutorialProgress, ...after } = JSON.parse(
        storage.getItem(DEMO_STORAGE_KEY)!,
      );
      expect(tutorialProgress).toBeTruthy();
      expect(after).toEqual(before);
      expect(await createDemoApi(storage).getTutorialProgress()).toEqual({
        version: 1,
        status,
        stepId,
      });
    }
  });

  it("isolates users and supports restarting a completed tutorial", async () => {
    const storage = memoryStorage();
    const api = createDemoApi(storage);
    await api.saveTutorialProgress({
      version: 1,
      status: "COMPLETED",
      stepId: "finish",
    });
    await api.saveTutorialProgress({
      version: 1,
      status: "IN_PROGRESS",
      stepId: "welcome",
    });
    expect((await api.getTutorialProgress()).status).toBe("IN_PROGRESS");
    const saved = JSON.parse(storage.getItem(DEMO_STORAGE_KEY)!);
    saved.data.currentUser.id = "other-user";
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(saved));
    expect((await createDemoApi(storage).getTutorialProgress()).status).toBe(
      "NOT_STARTED",
    );
  });

  it("rejects invalid input and does not claim persistence when storage fails", async () => {
    const storage = memoryStorage();
    const api = createDemoApi(storage);
    await expect(
      api.saveTutorialProgress({
        version: 99,
        status: "COMPLETED",
        stepId: "missing",
      } as never),
    ).rejects.toThrow();
    storage.setItem = () => {
      throw new Error("Disk full");
    };
    await expect(
      api.saveTutorialProgress({
        version: 1,
        status: "SKIPPED",
        stepId: "welcome",
      }),
    ).rejects.toThrow("Disk full");
    expect((await api.getTutorialProgress()).status).toBe("NOT_STARTED");
  });

  it("adapts guidance to enabled channels and permissions", async () => {
    const data = await createDemoApi(memoryStorage()).bootstrap();
    data.settings.modules.diningRoom = false;
    data.settings.modules.delivery = false;
    data.settings.modules.takeaway = true;
    data.currentUser.permissions = ["orders.create"];
    expect(tutorialCapabilities(data)).toEqual({
      cash: false,
      closeCash: false,
      orders: true,
      settings: false,
      reports: false,
      channels: ["Para llevar"],
    });
    data.currentUser.permissions = ["*"];
    expect(tutorialCapabilities(data).cash).toBe(true);
    expect(TUTORIAL_STEPS).toHaveLength(5);
    expect(tutorialStepIndex("missing")).toBe(0);
    expect(tutorialStepIndex("payment")).toBe(3);
  });
});
