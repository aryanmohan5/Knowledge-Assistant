import { describe, expect, it } from "vitest";
import type { Decomposition } from "@/lib/ask/decomposer";
import { checkEligibility, hasDecision, routePolicy, runSystem1 } from "@/lib/ask/system1";

describe("checkEligibility (System 1, Boolean)", () => {
  it.each([
    [3.0, 2, true],
    [2.99, 2, false],
    [4.0, 4, true],
    [3.5, 1, false],
    [3.5, 5, false],
    [0, 3, false],
  ])("gpa %s, year %s -> eligible %s", (gpa, year, eligible) => {
    const r = checkEligibility(gpa, year);
    expect(r.status).toBe("decided");
    expect(r.eligible).toBe(eligible);
  });

  it("explains each criterion", () => {
    const r = checkEligibility(2.5, 1);
    expect(r.status === "decided" && r.reasons).toEqual([
      "GPA 2.5 is below the minimum of 3.0",
      "Year 1 is not an eligible year (eligible: 2, 3, 4)",
    ]);
  });

  it("reports missing inputs instead of guessing", () => {
    expect(checkEligibility(null, null)).toMatchObject({ status: "insufficient_input", eligible: null, missing: ["gpa", "year"] });
    expect(checkEligibility(3.6, undefined)).toMatchObject({ status: "insufficient_input", missing: ["year"] });
  });

  it("rejects out-of-range inputs", () => {
    expect(checkEligibility(4.5, 2)).toMatchObject({ status: "insufficient_input", invalid: [expect.stringContaining("gpa")] });
    expect(checkEligibility(3.2, 2.5)).toMatchObject({ status: "insufficient_input", invalid: [expect.stringContaining("year")] });
    expect(checkEligibility(Number.NaN, 2)).toMatchObject({ status: "insufficient_input" });
  });
});

describe("routePolicy (System 1, choice)", () => {
  it.each([
    ["financial_aid", "financial_aid", "id"],
    ["Scholarship", "financial_aid", "synonym"],
    ["dorm", "housing", "synonym"],
    ["Academic Integrity", "conduct", "synonym"],
    ["mental-health", "health", "synonym"],
    ["GRADES", "academic", "synonym"],
  ])("%s -> %s", (category, track, matchedBy) => {
    expect(routePolicy(category)).toMatchObject({ status: "routed", track, matchedBy });
  });

  it("returns the office responsible", () => {
    expect(routePolicy("housing")).toMatchObject({ office: "Housing Services", trackName: "Residence & Housing Policy" });
  });

  it("never guesses an unknown category", () => {
    expect(routePolicy("parking")).toMatchObject({ status: "unrouted", track: "unrouted" });
    expect(routePolicy(null)).toMatchObject({ status: "insufficient_input" });
    expect(routePolicy("   ")).toMatchObject({ status: "insufficient_input" });
  });

  it("is deterministic", () => {
    expect(routePolicy("loans")).toEqual(routePolicy("loans"));
  });
});

describe("runSystem1 dispatcher", () => {
  const d = (intent: Decomposition["intent"], p: Partial<Decomposition["parameters"]> = {}): Decomposition => ({
    intent,
    parameters: { gpa: null, year: null, category: null, ...p },
    confidence: 1,
  });

  it("selects models purely from intent", () => {
    expect(runSystem1(d("eligibility", { gpa: 3.4, year: 3 })).map((r) => r.model)).toEqual(["checkEligibility"]);
    expect(runSystem1(d("eligibility", { gpa: 3.4, year: 3, category: "scholarship" })).map((r) => r.model)).toEqual([
      "checkEligibility",
      "routePolicy",
    ]);
    expect(runSystem1(d("policy_choice", { category: "housing" })).map((r) => r.model)).toEqual(["routePolicy"]);
    expect(runSystem1(d("general_knowledge", { gpa: 3.9, year: 2, category: "housing" }))).toEqual([]);
  });

  it("distinguishes decisions from requests for more input", () => {
    expect(hasDecision(runSystem1(d("eligibility")))).toBe(false);
    expect(hasDecision(runSystem1(d("eligibility", { gpa: 3.1, year: 2 })))).toBe(true);
    expect(hasDecision(runSystem1(d("policy_choice", { category: "parking" })))).toBe(false);
  });
});
