# Extraction eval

End-to-end check of the **real** LLM extraction (`extractOrderInfo`) against a
folder of sample files and a manifest of expected values.

> ⚠️ This calls the OpenAI/Gemini APIs — it costs money, is non-deterministic,
> and is slow. It is intentionally **not** part of `npm test`. Run it manually.

## Run

```bash
npm run eval:extraction              # every case in expected.json
npm run eval:extraction -- bosch     # only cases whose file name contains "bosch"
```

Needs `OPENAI_API_KEY` (or `GOOGLE_LLM_API_KEY`) in `backend/.env`.
Exit code is non-zero if any expected field mismatches.

## Add a case

1. Drop the file in `cases/`:
   - Text body: `.txt`, `.md`, `.eml`, `.html` (read as the email body).
   - Attachment: `.pdf`, `.jpg`, `.jpeg`, `.png` (sent to the model as binary).
2. Add an entry to `expected.json`:

```json
{
  "file": "oferta-bosch.pdf",
  "today": "2026-06-17",
  "partCode": "FIL-9921",
  "expect": {
    "isOffer": true,
    "orderNumber": "CMD-4471",
    "deliveryEarliest": "2026-06-24",
    "deliveryLatest": "2026-06-26",
    "status": "extracted"
  }
}
```

- `today` pins relative-date resolution (e.g. "5-7 zile lucrătoare"). Falls back
  to `defaults.today` if omitted.
- `partCode` selects the matching line when a file lists several parts. Falls
  back to `defaults.partCode`.
- `expect` checks **only the keys you list**. Checkable keys:
  `orderNumber`, `deliveryEarliest`, `deliveryLatest` (as `YYYY-MM-DD`),
  `isOffer`, `price`, `status`, `deliveryTime`.

## What to assert

Prefer the deterministic fields: `orderNumber`, the resolved
`deliveryEarliest`/`deliveryLatest`, `isOffer`, `status`, and the normalized
`price` (lei/ron → RON). Avoid pinning `deliveryTime` — its exact wording is the
model's free text and varies between runs; assert the resolved dates instead.

> Note: files in `cases/` may contain real vendor email content. If that's
> sensitive, add `cases/` to `.gitignore` before committing.
