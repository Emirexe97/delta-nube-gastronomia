import { describe, expect, it } from "vitest";
import { getNavigationAction } from "./use-enter-navigation";

describe("enter navigation decisions", () => {
  it("advances, retreats, and preserves the final native submit", () => {
    expect(getNavigationAction(0, 3, false)).toBe("next");
    expect(getNavigationAction(1, 3, true)).toBe("previous");
    expect(getNavigationAction(2, 3, false)).toBe("submit");
  });

  it("never submits while moving backwards", () => {
    expect(getNavigationAction(0, 1, true)).toBe("none");
    expect(getNavigationAction(0, 0, true)).toBe("none");
  });
});
