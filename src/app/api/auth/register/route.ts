import { NextResponse } from "next/server";
import { readJson, withApi } from "@/lib/http/handler";
import { registerOrganization } from "@/lib/services/registration";

// TODO: rate-limit (and optionally gate) public signup before going live.
export const POST = withApi(async (req) => {
  const result = await registerOrganization(await readJson(req));
  return NextResponse.json(result, { status: 201 });
});
