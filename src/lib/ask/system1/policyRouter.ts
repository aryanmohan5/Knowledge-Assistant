import { POLICY_TRACKS } from "./rules";

export type PolicyRouteResult =
  | {
      model: "routePolicy";
      status: "routed";
      category: string;
      track: string;
      trackName: string;
      office: string;
      matchedBy: "id" | "synonym";
    }
  | {
      model: "routePolicy";
      status: "unrouted" | "insufficient_input";
      category: string | null;
      track: "unrouted";
      availableTracks: string[];
    };

function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[_\-]+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * System 1 model: maps a category to exactly one policy track (a choice
 * among fixed options). Pure lookup, with no fuzzy matching and no LLM, so the
 * same category always routes the same way.
 */
export function routePolicy(category: string | null | undefined): PolicyRouteResult {
  const availableTracks = POLICY_TRACKS.map((t) => t.id);
  if (!category || !normalise(category)) {
    return { model: "routePolicy", status: "insufficient_input", category: category ?? null, track: "unrouted", availableTracks };
  }

  const key = normalise(category);
  for (const t of POLICY_TRACKS) {
    const matchedBy = normalise(t.id) === key ? "id" : t.synonyms.some((s) => normalise(s) === key) ? "synonym" : null;
    if (matchedBy) {
      return {
        model: "routePolicy",
        status: "routed",
        category,
        track: t.id,
        trackName: t.name,
        office: t.office,
        matchedBy,
      };
    }
  }
  return { model: "routePolicy", status: "unrouted", category, track: "unrouted", availableTracks };
}
