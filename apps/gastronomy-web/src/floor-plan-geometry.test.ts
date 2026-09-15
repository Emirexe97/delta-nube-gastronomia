import { describe, expect, it } from "vitest";
import {
  clampNormalizedRect,
  findAvailableTablePosition,
  globalPointsToLocalGeometry,
  moveLocalNode,
  rectsOverlap,
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

describe("rectsOverlap", () => {
  it("detects direct intersection", () => {
    expect(
      rectsOverlap(
        { x: 5, y: 5, width: 7, height: 7 },
        { x: 8, y: 8, width: 7, height: 7 },
      ),
    ).toBe(true);
  });

  it("returns false for distant rectangles", () => {
    expect(
      rectsOverlap(
        { x: 5, y: 5, width: 7, height: 7 },
        { x: 20, y: 5, width: 7, height: 7 },
      ),
    ).toBe(false);
  });

  it("considers safety margin", () => {
    // 5 + 7 = 12. Next starts at 12.2 (distance 0.2 < margin 0.5)
    expect(
      rectsOverlap(
        { x: 5, y: 5, width: 7, height: 7 },
        { x: 12.2, y: 5, width: 7, height: 7 },
        0.5,
      ),
    ).toBe(true);
  });
});

describe("findAvailableTablePosition", () => {
  it("places the first table at (5, 5)", () => {
    const pos = findAvailableTablePosition([]);
    expect(pos).toEqual({ x: 5, y: 5 });
  });

  it("places the second table in the adjacent slot without overlapping", () => {
    const first = { x: 5, y: 5, width: 7, height: 7 };
    const pos = findAvailableTablePosition([first]);
    expect(pos.x).toBeGreaterThan(5);
    expect(
      rectsOverlap(first, { x: pos.x, y: pos.y, width: 7, height: 7 }),
    ).toBe(false);
  });

  it("supports placing 100 consecutive tables without any pair overlapping", () => {
    const placed: Array<{ x: number; y: number; width: number; height: number }> =
      [];
    for (let i = 0; i < 100; i++) {
      const pos = findAvailableTablePosition(placed, 7, 7);
      const newRect = { x: pos.x, y: pos.y, width: 7, height: 7 };

      // Ensure it does not overlap any previously placed table
      for (let j = 0; j < placed.length; j++) {
        expect(
          rectsOverlap(newRect, placed[j]!, 0.3),
          `Table ${i + 1} overlaps with Table ${j + 1}`,
        ).toBe(false);
      }

      // Ensure it stays fully within the canvas bounds (0..100)
      expect(newRect.x).toBeGreaterThanOrEqual(0);
      expect(newRect.y).toBeGreaterThanOrEqual(0);
      expect(newRect.x + newRect.width).toBeLessThanOrEqual(100);
      expect(newRect.y + newRect.height).toBeLessThanOrEqual(100);

      placed.push(newRect);
    }
    expect(placed.length).toBe(100);
  });

  it("reuses holes when a table is removed", () => {
    const table1 = { x: 5, y: 5, width: 7, height: 7 };
    const table2 = { x: 14.2, y: 5, width: 7, height: 7 };
    const table3 = { x: 23.4, y: 5, width: 7, height: 7 };

    // table2 is deleted, so (14.2, 5) should be filled next
    const pos = findAvailableTablePosition([table1, table3]);
    expect(pos).toEqual({ x: 14.2, y: 5 });
  });

  it("gracefully provides a fallback position when canvas is saturated", () => {
    const pos = findAvailableTablePosition(
      Array.from({ length: 110 }, (_, i) => ({
        x: (i % 10) * 9,
        y: Math.floor(i / 10) * 8,
        width: 8,
        height: 7,
      })),
    );
    expect(pos.x).toBeGreaterThanOrEqual(0);
    expect(pos.y).toBeGreaterThanOrEqual(0);
    expect(pos.x + 7).toBeLessThanOrEqual(100);
    expect(pos.y + 7).toBeLessThanOrEqual(100);
  });
});
