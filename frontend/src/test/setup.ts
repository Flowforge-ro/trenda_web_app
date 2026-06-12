import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// RTL's auto-cleanup relies on a global `afterEach` which isn't present when
// vitest globals are off. Wire it up explicitly so each test gets a clean DOM.
afterEach(() => {
  cleanup();
});
