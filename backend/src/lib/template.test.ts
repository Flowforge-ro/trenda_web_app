import { test } from "node:test";
import assert from "node:assert/strict";
import { renderTemplate } from "./template.js";

test("renderTemplate substitutes known placeholders", () => {
  const out = renderTemplate("piesa {piesa}, sasiu {serieSasiu}.", {
    piesa: "Filtru ulei",
    serieSasiu: "WVW001",
  });
  assert.equal(out, "piesa Filtru ulei, sasiu WVW001.");
});

test("renderTemplate leaves unknown placeholders intact", () => {
  const out = renderTemplate("hi {piesa} {altceva}", {
    piesa: "X",
    serieSasiu: "Y",
  });
  assert.equal(out, "hi X {altceva}");
});
