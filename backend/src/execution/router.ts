import type { FeatureDefinition } from "../features/types.js";
import type { Adapter, ExecutionContext, ExecutionResult } from "./types.js";
import { runN8n } from "./adapters/n8n.js";
import { runNode } from "./adapters/node.js";

export interface RoutedExecution {
  adapter: Adapter;
  result: ExecutionResult;
}

/**
 * Resolve a feature's executionType to its adapter and run it. "native" features
 * are handled directly inside their module and must never reach here — calling
 * the router for one is a programming error.
 */
export async function route(
  def: FeatureDefinition,
  ctx: ExecutionContext
): Promise<RoutedExecution> {
  switch (def.executionType) {
    case "n8n":
      return { adapter: "n8n", result: await runN8n(def, ctx) };
    case "node":
      return { adapter: "node", result: await runNode(def, ctx) };
    case "native":
      throw new Error(
        `Feature "${def.key}" is native (handled in-module); executeFeature must not be called for it`
      );
  }
}
