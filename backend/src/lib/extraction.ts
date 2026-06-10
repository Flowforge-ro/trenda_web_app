import { GoogleGenAI, Type } from "@google/genai";

const MODEL = "gemini-3.5-flash";

export type ExtractionSource =
  | { kind: "text"; body: string }
  | { kind: "binary"; bytes: Uint8Array; mimeType: string };

export type ContentPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

export interface ExtractionDeps {
  generate: (parts: ContentPart[]) => Promise<string>;
}

export interface ExtractionResult {
  numarComanda: string | null;
  timpLivrare: string | null;
  deliveryEarliest: Date | null;
  deliveryLatest: Date | null;
  status: "extracted" | "needs_review";
}

interface ParsedFields {
  numarComanda: string | null;
  timpLivrare: string | null;
  deliveryEarliest: string | null;
  deliveryLatest: string | null;
}

function instructions(today: string): string[] {
  return [
    "Ești un asistent care extrage date dintr-un email de la un furnizor de piese auto.",
    `Data de azi este ${today}.`,
    "Extrage numărul de comandă al furnizorului (numarComanda) și data livrării, dacă există.",
    "Pentru livrare: returnează deliveryEarliest și deliveryLatest în format ISO YYYY-MM-DD.",
    "Dacă data este precisă, deliveryEarliest și deliveryLatest sunt egale.",
    'Dacă este vagă ("săptămâna viitoare", "în câteva zile"), returnează un interval plauzibil rezolvat față de data de azi.',
    "timpLivrare = expresia exactă despre livrare așa cum este scrisă.",
    "Dacă o valoare lipsește cu adevărat, returnează null pentru ea. Nu inventa niciodată valori.",
  ];
}

function buildParts(source: ExtractionSource, today: string): ContentPart[] {
  const lines = instructions(today);
  if (source.kind === "text") {
    return [{ text: [...lines, "", "Conținutul emailului:", source.body].join("\n") }];
  }
  return [
    { text: [...lines, "", "Extrage din documentul/imaginea atașat(ă):"].join("\n") },
    {
      inlineData: {
        mimeType: source.mimeType,
        data: Buffer.from(source.bytes).toString("base64"),
      },
    },
  ];
}

async function defaultGenerate(parts: ContentPart[]): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_LLM_API_KEY! });
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: parts,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          numarComanda: { type: Type.STRING, nullable: true },
          timpLivrare: { type: Type.STRING, nullable: true },
          deliveryEarliest: { type: Type.STRING, nullable: true },
          deliveryLatest: { type: Type.STRING, nullable: true },
        },
      },
    },
  });
  return response.text ?? "";
}

const defaultDeps: ExtractionDeps = { generate: defaultGenerate };

function parseIsoDate(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function extractOrderInfo(
  source: ExtractionSource,
  today: string,
  deps: ExtractionDeps = defaultDeps
): Promise<ExtractionResult> {
  const jsonText = await deps.generate(buildParts(source, today));
  const parsed = JSON.parse(jsonText) as ParsedFields;

  const numarComanda = parsed.numarComanda || null;

  let timpLivrare: string | null = null;
  let deliveryEarliest: Date | null = null;
  let deliveryLatest: Date | null = null;
  if (parsed.deliveryEarliest && parsed.deliveryLatest) {
    const earliest = parseIsoDate(parsed.deliveryEarliest);
    const latest = parseIsoDate(parsed.deliveryLatest);
    if (earliest && latest) {
      deliveryEarliest = earliest;
      deliveryLatest = latest;
      timpLivrare = parsed.timpLivrare;
    }
  }

  const status: ExtractionResult["status"] =
    numarComanda && deliveryEarliest ? "extracted" : "needs_review";
  return { numarComanda, timpLivrare, deliveryEarliest, deliveryLatest, status };
}

export function mergeMissing(
  base: ExtractionResult,
  extra: ExtractionResult
): ExtractionResult {
  const numarComanda = base.numarComanda ?? extra.numarComanda;
  let { timpLivrare, deliveryEarliest, deliveryLatest } = base;
  if (deliveryEarliest === null && extra.deliveryEarliest !== null) {
    timpLivrare = extra.timpLivrare;
    deliveryEarliest = extra.deliveryEarliest;
    deliveryLatest = extra.deliveryLatest;
  }
  const status: ExtractionResult["status"] =
    numarComanda && deliveryEarliest ? "extracted" : "needs_review";
  return { numarComanda, timpLivrare, deliveryEarliest, deliveryLatest, status };
}
