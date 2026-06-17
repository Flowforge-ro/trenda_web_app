import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export interface StatusRequestVars {
  [key: string]: string;
  partCode: string;
  chassisSeries: string;
}

export function renderTemplate(
  template: string,
  vars: Record<string, string>
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? vars[key] : match
  );
}

const TEMPLATE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../templates/status-request-template"
);

export function renderStatusRequest(vars: StatusRequestVars): string {
  const template = readFileSync(TEMPLATE_PATH, "utf8");
  return renderTemplate(template, vars);
}

const MISSING_FIELDS_TEMPLATE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../templates/appointment-missing-fields"
);

export interface OfferAcceptanceVars {
  [key: string]: string;
  partCode: string;
  chassisSeries: string;
}

const OFFER_ACCEPTANCE_TEMPLATE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../templates/offer-acceptance-template"
);

export function renderOfferAcceptance(vars: OfferAcceptanceVars): string {
  const template = readFileSync(OFFER_ACCEPTANCE_TEMPLATE_PATH, "utf8");
  return renderTemplate(template, vars);
}

export function renderMissingFields(labels: string[]): string {
  const template = readFileSync(MISSING_FIELDS_TEMPLATE_PATH, "utf8");
  return renderTemplate(template, { missingFields: labels.map((l) => `- ${l}`).join("\n") });
}
