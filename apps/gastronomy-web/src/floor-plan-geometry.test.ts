import { describe, expect, it } from "vitest";
import {
  clampNormalizedRect,
  globalPointsToLocalGeometry,
  moveLocalNode,
  resizeNormalizedRect,
  svgPoints,
} from "./floor-plan-geometry";

describe("clampNormalizedRect", () => {
  it("clamps position and size to the canvas", () => {
    expect(
      clampNormalizedRect({ x: -4, y: 95, width: 30, height: 20 }, 2, 2),
    ).toEqual({
      x: 0,
      y: 80,
      width: 30,
      height: 20,
    });
  });

  it("enforces the minimum even at an edge", () => {
    expect(
      clampNormalizedRect({ x: 100, y: 100, width: 0, height: 0 }, 8, 9),
    ).toEqual({
      x: 92,
      y: 91,
      width: 8,
      height: 9,
    });
  });
});

describe("resizeNormalizedRect", () => {
  it("supports all eight handles and keeps bounds", () => {
    const handles = ["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const;
    for (const handle of handles) {
      const result = resizeNormalizedRect(
        { x: 20, y: 20, width: 30, height: 30 },
        handle,
        { x: -50, y: 150 },
        10,
        10,
      );
      expect(result.x).toBeGreaterThanOrEqual(0);
      expect(result.y).toBeGreaterThanOrEqual(0);
      expect(result.x + result.width).toBeLessThanOrEqual(100);
      expect(result.y + result.height).toBeLessThanOrEqual(100);
      expect(result.width).toBeGreaterThanOrEqual(10);
      expect(result.height).toBeGreaterThanOrEqual(10);
    }
  });

  it("resizes from west and north while preserving the opposite edge", () => {
    expect(
      resizeNormalizedRect({ x: 30, y: 25, width: 30, height: 30 }, "nw", {
        x: 10,
        y: 5,
      }),
    ).toEqual({
      x: 10,
      y: 5,
      width: 50,
      height: 50,
    });
    expect(
      resizeNormalizedRect(
        { x: 30, y: 25, width: 30, height: 30 },
        "nw",
        { x: 55, y: 55 },
        8,
        8,
      ),
    ).toEqual({
      x: 52,
      y: 47,
      width: 8,
      height: 8,
    });
  });

  it("respects maximum dimensions", () => {
    expect(
      resizeNormalizedRect(
        { x: 20, y: 20, width: 20, height: 20 },
        "se",
        { x: 90, y: 95 },
        6,
        8,
        40,
        40,
      ),
    ).toEqual({ x: 20, y: 20, width: 40, height: 40 });
  });
});

describe("globalPointsToLocalGeometry", () => {
  it("returns a bounding box and local 0..100 polygon points", () => {
    expect(
      globalPointsToLocalGeometry([
        { x: 10, y: 20 },
        { x: 30, y: 50 },
        { x: 20, y: 20 },
      ]),
    ).toEqual({
      bounds: { x: 10, y: 20, width: 20, height: 30 },
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
        { x: 50, y: 0 },
      ],
    });
  });

  it("handles empty and degenerate polygons", () => {
    expect(globalPointsToLocalGeometry([])).toEqual({
      bounds: { x: 0, y: 0, width: 0, height: 0 },
      points: [],
    });
    expect(
      globalPointsToLocalGeometry([
        { x: 4, y: 4 },
        { x: 4, y: 9 },
      ]),
    ).toEqual({
      bounds: { x: 4, y: 4, width: 0, height: 5 },
      points: [
        { x: 0, y: 0 },
        { x: 0, y: 100 },
      ],
    });
  });
});

describe("moveLocalNode and svgPoints", () => {
  it("clamps moved nodes", () => {
    expect(moveLocalNode({ x: 98, y: 1 }, { x: 10, y: -5 })).toEqual({
      x: 100,
      y: 0,
    });
  });

  it("serializes SVG points without noisy decimals", () => {
    expect(
      svgPoints([
        { x: 0, y: 0 },
        { x: 12.345, y: 99.999 },
      ]),
    ).toBe("0,0 12.35,100");
  });
});
