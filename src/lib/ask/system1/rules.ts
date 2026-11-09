/**
 * Business rules for System 1. Everything the deterministic models decide is
 * defined here, in plain data, so the rules can be reviewed and changed
 * without touching any LLM prompt.
 */

/** checkEligibility: minimum GPA (inclusive) on a 4.0 scale. */
export const MIN_GPA = 3.0;
export const GPA_SCALE = 4.0;

/** checkEligibility: eligible years of study (1 = first year). */
export const ELIGIBLE_YEARS: readonly number[] = [2, 3, 4];
export const MAX_YEAR = 8;

export type PolicyTrack = {
  id: string;
  name: string;
  office: string;
  /** Normalised synonyms the router accepts for this category. */
  synonyms: readonly string[];
};

/** routePolicy: category → policy track. Order matters only for display. */
export const POLICY_TRACKS: readonly PolicyTrack[] = [
  {
    id: "academic",
    name: "Academic Standards Policy",
    office: "Office of the Registrar",
    synonyms: ["academic", "academics", "grades", "grade", "gpa", "course", "courses", "exam", "exams", "probation", "transcript"],
  },
  {
    id: "financial_aid",
    name: "Financial Aid & Scholarships Policy",
    office: "Financial Aid Office",
    synonyms: ["financial aid", "financial", "finance", "scholarship", "scholarships", "tuition", "fees", "grant", "grants", "loan", "loans", "funding"],
  },
  {
    id: "housing",
    name: "Residence & Housing Policy",
    office: "Housing Services",
    synonyms: ["housing", "residence", "dorm", "dormitory", "accommodation", "room", "hostel"],
  },
  {
    id: "conduct",
    name: "Student Conduct Policy",
    office: "Dean of Students",
    synonyms: ["conduct", "discipline", "disciplinary", "misconduct", "plagiarism", "integrity", "academic integrity", "behavior", "behaviour"],
  },
  {
    id: "health",
    name: "Health & Wellbeing Policy",
    office: "Student Health Services",
    synonyms: ["health", "medical", "wellbeing", "wellness", "mental health", "counseling", "counselling", "disability", "accessibility"],
  },
];
