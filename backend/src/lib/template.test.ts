import { test } from "node:test";
import assert from "node:assert/strict";
import { renderTemplate, renderMissingFields } from "./template.js";

test("renderTemplate substitutes known placeholders", () => {
  const out = renderTemplate("partCode {partCode}, sasiu {chassisSeries}.", {
    partCode: "Filtru ulei",
    chassisSeries: "WVW001",
  });
  assert.equal(out, "partCode Filtru ulei, sasiu WVW001.");
});

test("renderTemplate leaves unknown placeholders intact", () => {
  const out = renderTemplate("hi {partCode} {altceva}", {
    partCode: "X",
    chassisSeries: "Y",
  });
  assert.equal(out, "hi X {altceva}");
});

test("renderMissingFields renders labels as a bulleted list", () => {
  const out = renderMissingFields(["Telefon", "Data dorită"]);
  assert.ok(out.includes("- Telefon\n- Data dorită"));
  assert.ok(out.includes("programa")); // body text present
});
