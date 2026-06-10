import { test } from "node:test";
import assert from "node:assert/strict";
import { contentDisposition } from "./orders.routes.js";

test("contentDisposition strips quotes and CRLF from the ascii filename", () => {
  const out = contentDisposition('evil".pdf\r\nX-Injected: y');
  assert.ok(!/[\r\n]/.test(out), "no raw CRLF");
  assert.ok(!out.includes('"evil"'), "quote neutralized");
  assert.ok(out.includes('filename="evil_.pdf'), out);
});

test("contentDisposition percent-encodes non-ascii in filename*", () => {
  const out = contentDisposition("comandă.pdf");
  assert.ok(out.includes("filename*=UTF-8''"), out);
  assert.ok(out.includes(encodeURIComponent("comandă.pdf")), out);
});
