const CURRENCY: Record<string, string> = {
  ron: "RON", lei: "RON", eur: "EUR", "€": "EUR", usd: "USD", $: "USD",
};

export function parseOfferPrice(raw: string | null): { amount: number; currency: string } | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  let currency: string | null = null;
  for (const token of Object.keys(CURRENCY)) {
    if (lower.includes(token)) { currency = CURRENCY[token]; break; }
  }
  if (!currency) return null;

  // grab the first number; support "1.250,50" (EU) and "1250.50" (US)
  const m = raw.match(/[\d.,]*\d/);
  if (!m) return null;
  let num = m[0];
  if (num.includes(".") && num.includes(",")) num = num.replace(/\./g, "").replace(",", ".");
  else if (num.includes(",")) num = num.replace(",", ".");
  const amount = Number(num);
  if (!Number.isFinite(amount)) return null;
  return { amount, currency };
}
