import { ELIGIBLE_YEARS, GPA_SCALE, MAX_YEAR, MIN_GPA } from "./rules";

export type EligibilityResult =
  | {
      model: "checkEligibility";
      status: "decided";
      eligible: boolean;
      inputs: { gpa: number; year: number };
      reasons: string[];
      rule: string;
    }
  | {
      model: "checkEligibility";
      status: "insufficient_input";
      eligible: null;
      missing: Array<"gpa" | "year">;
      invalid: string[];
      rule: string;
    };

export const ELIGIBILITY_RULE = `GPA >= ${MIN_GPA.toFixed(1)} (on a ${GPA_SCALE.toFixed(1)} scale) AND year of study in {${ELIGIBLE_YEARS.join(", ")}}`;

/**
 * System 1 model: Boolean eligibility decision. Pure and deterministic, with no
 * I/O and no LLM. Missing or out-of-range inputs are reported, never guessed.
 */
export function checkEligibility(gpa: number | null | undefined, year: number | null | undefined): EligibilityResult {
  const missing: Array<"gpa" | "year"> = [];
  const invalid: string[] = [];

  if (gpa == null) missing.push("gpa");
  else if (!Number.isFinite(gpa) || gpa < 0 || gpa > GPA_SCALE) invalid.push(`gpa must be between 0 and ${GPA_SCALE} (got ${gpa})`);

  if (year == null) missing.push("year");
  else if (!Number.isInteger(year) || year < 1 || year > MAX_YEAR) invalid.push(`year must be a whole number from 1 to ${MAX_YEAR} (got ${year})`);

  if (missing.length || invalid.length) {
    return { model: "checkEligibility", status: "insufficient_input", eligible: null, missing, invalid, rule: ELIGIBILITY_RULE };
  }

  const g = gpa as number;
  const y = year as number;
  const gpaOk = g >= MIN_GPA;
  const yearOk = ELIGIBLE_YEARS.includes(y);

  return {
    model: "checkEligibility",
    status: "decided",
    eligible: gpaOk && yearOk,
    inputs: { gpa: g, year: y },
    reasons: [
      gpaOk ? `GPA ${g} meets the minimum of ${MIN_GPA.toFixed(1)}` : `GPA ${g} is below the minimum of ${MIN_GPA.toFixed(1)}`,
      yearOk ? `Year ${y} is an eligible year` : `Year ${y} is not an eligible year (eligible: ${ELIGIBLE_YEARS.join(", ")})`,
    ],
    rule: ELIGIBILITY_RULE,
  };
}
