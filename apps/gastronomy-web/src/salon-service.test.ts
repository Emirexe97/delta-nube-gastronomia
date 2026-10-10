import { describe, expect, it } from "vitest";
import { formatServiceAge, getServiceAge, sortByOldestService } from "./salon-service";

const order = (id: string, createdAt: string, servicePendingSince: string | null = null, servedAt: string | null = null) => ({
  id,
  createdAt,
  servicePendingSince,
  servedAt,
});

describe("salon service helpers", () => {
  it("sorts oldest order first and leaves ties stable", () => {
    const orders = [order("later", "2026-01-02"), order("tie-a", "2026-01-01"), order("tie-b", "2026-01-01")];
    expect(sortByOldestService(orders).map(({ id }) => id)).toEqual(["tie-a", "tie-b", "later"]);
  });

  it("uses exact 15 and 35 minute boundaries", () => {
    const now = Date.parse("2026-01-01T12:35:00.000Z");
    expect(getServiceAge(order("a", "", "2026-01-01T12:20:00.000Z"), now)).toBe("pending");
    expect(getServiceAge(order("b", "", "2026-01-01T12:00:00.000Z"), now)).toBe("late");
    expect(getServiceAge(order("c", "", "2026-01-01T12:20:00.001Z"), now)).toBe("neutral");
    expect(formatServiceAge(order("a", "", "2026-01-01T12:20:00.000Z"), now)).toBe("15 min");
  });

  it("stops the clock once served and treats missing consumption as neutral", () => {
    const now = Date.parse("2026-01-01T13:00:00.000Z");
    expect(getServiceAge(order("served", "", "2026-01-01T12:00:00.000Z", "2026-01-01T12:30:00.000Z"), now)).toBe("neutral");
    expect(formatServiceAge(order("empty", ""), now)).toBe("Sin consumo");
  });
});
