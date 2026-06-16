import type { ExtractionResult } from "./extraction.js";

export type ConfidenceLevel = "high" | "low";

export interface FieldConfidence {
  orderNumber: ConfidenceLevel;
  delivery: ConfidenceLevel;
  // Human-readable (Romanian) explanations, shown in the review dialog.
  reasons: string[];
}

// Tunable thresholds. See confidence.test.ts for the calibration cases; tune
// these against a labeled set of real supplier replies before trusting them.
const MAX_DELIVERY_HORIZON_DAYS = 365;
const MAX_DELIVERY_RANGE_DAYS = 30;
const PAST_TOLERANCE_DAYS = 1;

const MS_PER_DAY = 86_400_000;

/** Lowercase, strip diacritics, collapse whitespace — for forgiving matching. */
function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** True when the model's quoted span occurs (normalized) in the source body. */
export function quoteInBody(quote: string | null, body: string): boolean {
  if (!quote || !quote.trim()) return false;
  return normalize(body).includes(normalize(quote));
}

function wholeDaysBetween(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / MS_PER_DAY);
}

/**
 * Deterministic per-field confidence: presence/format/date sanity plus grounding
 * (the value's source span was found in the email). Any "low" field routes the
 * order to human review.
 */
export function scoreConfidence(result: ExtractionResult, today: string): FieldConfidence {
  const reasons: string[] = [];
  let orderNumber: ConfidenceLevel = "high";
  let delivery: ConfidenceLevel = "high";

  // --- orderNumber ---
  const on = result.orderNumber?.trim() ?? "";
  if (on.length < 2 || on.length > 40 || !/[a-z0-9]/i.test(on) || on.split(/\s+/).length > 6) {
    orderNumber = "low";
    reasons.push("Număr comandă lipsă sau neclar");
  } else if (!result.orderNumberGrounded) {
    orderNumber = "low";
    reasons.push("Numărul comenzii nu apare în email");
  }

  // --- delivery ---
  const e = result.deliveryEarliest;
  const l = result.deliveryLatest;
  if (!e || !l) {
    delivery = "low";
    reasons.push("Data livrării lipsește");
  } else {
    const todayDate = new Date(`${today}T00:00:00.000Z`);
    if (e.getTime() > l.getTime()) {
      delivery = "low";
      reasons.push("Interval de livrare invalid");
    } else if (wholeDaysBetween(e, todayDate) < -PAST_TOLERANCE_DAYS) {
      delivery = "low";
      reasons.push("Data livrării este în trecut");
    } else if (wholeDaysBetween(e, todayDate) > MAX_DELIVERY_HORIZON_DAYS) {
      delivery = "low";
      reasons.push("Dată de livrare prea îndepărtată");
    } else if (wholeDaysBetween(l, e) > MAX_DELIVERY_RANGE_DAYS) {
      delivery = "low";
      reasons.push("Interval de livrare prea vag");
    } else if (!result.deliveryGrounded) {
      delivery = "low";
      reasons.push("Expresia livrării nu apare în email");
    }
  }

  return { orderNumber, delivery, reasons };
}

export function needsReview(fc: FieldConfidence): boolean {
  return fc.orderNumber === "low" || fc.delivery === "low";
}
