import { describe, expect, test } from "vitest";
import { deriveFieldKey } from "./appointments";

describe("deriveFieldKey", () => {
  test("camelCases and strips diacritics", () => {
    expect(deriveFieldKey("Data dorită", [])).toBe("dataDorita");
    expect(deriveFieldKey("Serviciu dorit", [])).toBe("serviciuDorit");
  });

  test("drops non-alphanumerics", () => {
    expect(deriveFieldKey("Nr. înmatriculare (auto)", [])).toBe("nrInmatriculareAuto");
  });

  test("prefixes f when starting with a digit", () => {
    expect(deriveFieldKey("4x4", [])).toBe("f4x4");
  });

  test("appends counter on collision", () => {
    expect(deriveFieldKey("Telefon", ["telefon"])).toBe("telefon2");
    expect(deriveFieldKey("Telefon", ["telefon", "telefon2"])).toBe("telefon3");
  });

  test("falls back to camp for empty label", () => {
    expect(deriveFieldKey("", [])).toBe("camp");
    expect(deriveFieldKey("!!!", ["camp"])).toBe("camp2");
  });
});
