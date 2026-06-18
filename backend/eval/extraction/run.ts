/**
 * Extraction eval harness — runs the REAL LLM extraction over a folder of
 * sample files and checks the result against an expected-values manifest.
 *
 * This is NOT part of `npm test`: it hits the OpenAI/Gemini APIs (costs money,
 * non-deterministic, slow). Run it manually:
 *
 *   npm run eval:extraction            # all cases in expected.json
 *   npm run eval:extraction -- foo.txt # only cases whose file matches "foo.txt"
 *
 * Files live in ./cases, expected values in ./expected.json. See README.md.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, extname, join } from "node:path";
import { extractOrderInfo, type ExtractionSource, type ExtractionResult } from "../../src/lib/extraction.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CASES_DIR = join(HERE, "cases");

type Expected = Partial<{
  orderNumber: string | null;
  deliveryTime: string | null;
  deliveryEarliest: string | null;
  deliveryLatest: string | null;
  isOffer: boolean;
  price: string | null;
  status: "extracted" | "needs_review";
}>;

interface Case {
  file: string;
  today?: string;
  partCode?: string | null;
  expect: Expected;
}

interface Manifest {
  defaults?: { today?: string; partCode?: string | null };
  cases: Case[];
}

const TEXT_EXT = new Set([".txt", ".md", ".eml", ".html", ".htm"]);
const BINARY_MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

function buildSource(file: string): ExtractionSource {
  const ext = extname(file).toLowerCase();
  const path = join(CASES_DIR, file);
  if (TEXT_EXT.has(ext)) return { kind: "text", body: readFileSync(path, "utf8") };
  const mimeType = BINARY_MIME[ext];
  if (!mimeType) throw new Error(`Unsupported file extension "${ext}" for ${file}`);
  return { kind: "binary", bytes: new Uint8Array(readFileSync(path)), mimeType };
}

/** Flatten an ExtractionResult into the same comparable shape as Expected. */
function comparable(r: ExtractionResult): Required<Expected> {
  return {
    orderNumber: r.orderNumber,
    deliveryTime: r.deliveryTime,
    deliveryEarliest: r.deliveryEarliest ? r.deliveryEarliest.toISOString().slice(0, 10) : null,
    deliveryLatest: r.deliveryLatest ? r.deliveryLatest.toISOString().slice(0, 10) : null,
    isOffer: r.isOffer,
    price: r.price,
    status: r.status,
  };
}

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

async function main() {
  if (!process.env.OPENAI_API_KEY && !process.env.GOOGLE_LLM_API_KEY) {
    console.error(`${RED}No LLM API key set.${RESET} Set OPENAI_API_KEY (or GOOGLE_LLM_API_KEY) in backend/.env first.`);
    process.exit(2);
  }

  const manifest = JSON.parse(readFileSync(join(HERE, "expected.json"), "utf8")) as Manifest;
  const filter = process.argv[2];
  const cases = manifest.cases.filter((c) => !filter || c.file.includes(filter));

  if (cases.length === 0) {
    console.error(`No cases${filter ? ` matching "${filter}"` : ""} in expected.json`);
    process.exit(1);
  }

  let failures = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  for (const c of cases) {
    const today = c.today ?? manifest.defaults?.today;
    if (!today) {
      console.error(`${RED}✗ ${c.file}${RESET} — no "today" (set it on the case or in defaults)`);
      failures++;
      continue;
    }
    const partCode = c.partCode ?? manifest.defaults?.partCode ?? null;

    let got: Required<Expected>;
    let usage: ExtractionResult["usage"];
    try {
      const result = await extractOrderInfo(buildSource(c.file), today, { partCode });
      got = comparable(result);
      usage = result.usage;
    } catch (err) {
      console.error(`${RED}✗ ${c.file}${RESET} — extraction threw: ${(err as Error).message}`);
      failures++;
      continue;
    }
    inputTokens += usage?.inputTokens ?? 0;
    outputTokens += usage?.outputTokens ?? 0;

    const mismatches: string[] = [];
    for (const key of Object.keys(c.expect) as (keyof Expected)[]) {
      const exp = c.expect[key];
      const act = got[key];
      if (exp !== act) mismatches.push(`    ${key}: expected ${JSON.stringify(exp)}, got ${JSON.stringify(act)}`);
    }

    if (mismatches.length === 0) {
      console.log(`${GREEN}✓${RESET} ${c.file} ${DIM}(${usage?.provider ?? "?"})${RESET}`);
    } else {
      failures++;
      console.log(`${RED}✗${RESET} ${c.file} ${DIM}(${usage?.provider ?? "?"})${RESET}`);
      for (const m of mismatches) console.log(`${RED}${m}${RESET}`);
    }
  }

  console.log(
    `\n${failures === 0 ? GREEN : RED}${cases.length - failures}/${cases.length} passed${RESET} ` +
      `${DIM}· tokens in/out: ${inputTokens}/${outputTokens}${RESET}`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main();
