import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export interface StatusRequestVars {
  [key: string]: string;
  piesa: string;
  serieSasiu: string;
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
