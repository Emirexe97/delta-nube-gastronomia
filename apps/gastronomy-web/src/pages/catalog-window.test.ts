import { describe, expect, it } from "vitest";
import { catalogOffsets, catalogWindow } from "./catalog-window";

describe("ventana del catálogo", () => {
  it("no agrega espaciadores a listas chicas o vacías", () => {
    expect(catalogWindow([0], 999, 100)).toEqual({start: 0, end: 0, top: 0, bottom: 0});
    expect(catalogWindow([0, 90, 140], 60, 64)).toEqual({start: 0, end: 2, top: 0, bottom: 0});
  });
  it("al medir filas de alturas distintas no reescala las 3000; el final sigue accesible", () => {
    const rows = Array.from({length:3000}, (_, i) => ({product: {id:String(i)}}));
    const offsets = catalogOffsets(rows, new Map([["0", 120], ["10", 42]]));
    expect(offsets.at(-1)).toBe(3000 * 60 + 60 - 18);
    for (const scroll of [0, 1000, 100_000, 999_999]) {
      const w = catalogWindow(offsets, scroll, 600);
      expect(w.end - w.start).toBeLessThan(35);
      expect(w.top + (offsets[w.end]! - offsets[w.start]!) + w.bottom).toBe(offsets.at(-1));
    }
    expect(catalogWindow(offsets, 999_999, 600)).toMatchObject({end: 3000, bottom: 0});
  });
});
