import { describe, it, expect } from "vitest";
import { formatDeliveryCountdown } from "./orders";

// Fixed reference days (UTC). 2026-06-17 is a Wednesday, 2026-06-19 a Friday.
const wed = new Date("2026-06-17T09:00:00Z");
const fri = new Date("2026-06-19T09:00:00Z");
const sat = new Date("2026-06-20T09:00:00Z");

describe("formatDeliveryCountdown (working-day countdown)", () => {
  it("returns — when a date is missing", () => {
    expect(formatDeliveryCountdown(null, "2026-06-24", wed)).toBe("—");
    expect(formatDeliveryCountdown("2026-06-24", null, wed)).toBe("—");
  });

  it("counts only Mon–Fri to the target (a +5 working-day date reads as 5 zile)", () => {
    // Wed + 5 business days = Wed 2026-06-24 (the calendar date spans a weekend).
    expect(formatDeliveryCountdown("2026-06-24", "2026-06-24", wed)).toBe("5 zile");
  });

  it("shows a working-day range matching the lead time", () => {
    // Wed: +5 b.d. = 06-24, +7 b.d. = 06-26.
    expect(formatDeliveryCountdown("2026-06-24", "2026-06-26", wed)).toBe("în 5–7 zile");
  });

  it("does not tick down across the weekend", () => {
    // Target Wed 06-24. From Friday and from Saturday the working-day count is identical.
    expect(formatDeliveryCountdown("2026-06-24", "2026-06-24", fri)).toBe(
      formatDeliveryCountdown("2026-06-24", "2026-06-24", sat)
    );
  });

  it("returns azi when the target is today", () => {
    expect(formatDeliveryCountdown("2026-06-17", "2026-06-17", wed)).toBe("azi");
  });

  it("returns întârziat once the window has passed", () => {
    expect(formatDeliveryCountdown("2026-06-10", "2026-06-10", wed)).toBe("întârziat");
  });

  it("clamps the low end at 0 in a range that straddles today", () => {
    // earliest in the past, latest in the future -> "în 0–N zile".
    expect(formatDeliveryCountdown("2026-06-15", "2026-06-19", wed)).toBe("în 0–2 zile");
  });
});
