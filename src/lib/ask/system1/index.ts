import type { Decomposition } from "../decomposer";
import { checkEligibility, type EligibilityResult } from "./eligibility";
import { routePolicy, type PolicyRouteResult } from "./policyRouter";

export { checkEligibility } from "./eligibility";
export { routePolicy } from "./policyRouter";

export type System1Result = EligibilityResult | PolicyRouteResult;

/**
 * Runs the deterministic models selected by the Decomposer's structured
 * output, and nothing else: no question text, no retrieved context, no LLM.
 * Given the same Decomposition it always returns the same results.
 *
 * - eligibility       → checkEligibility(gpa, year), plus routePolicy(category) if one was named
 * - policy_choice     → routePolicy(category)
 * - general_knowledge → no models (pure retrieval answer)
 */
export function runSystem1(d: Decomposition): System1Result[] {
  const { gpa, year, category } = d.parameters;
  switch (d.intent) {
    case "eligibility":
      return category ? [checkEligibility(gpa, year), routePolicy(category)] : [checkEligibility(gpa, year)];
    case "policy_choice":
      return [routePolicy(category)];
    case "general_knowledge":
      return [];
  }
}

/** True when at least one model produced an actual decision (not just "need more input"). */
export function hasDecision(results: System1Result[]): boolean {
  return results.some((r) => r.status === "decided" || r.status === "routed");
}
