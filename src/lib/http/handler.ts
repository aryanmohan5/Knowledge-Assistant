import "server-only";
import type { NextRequest } from "next/server";
import { connectToDatabase } from "@/lib/db/connect";
import { HttpError, toErrorResponse } from "./errors";

/** Wraps a route handler with DB connection and uniform error mapping. */
export function withApi<C>(handler: (req: NextRequest, ctx: C) => Promise<Response>) {
  return async (req: NextRequest, ctx: C): Promise<Response> => {
    try {
      await connectToDatabase();
      return await handler(req, ctx);
    } catch (err) {
      return toErrorResponse(err);
    }
  };
}

export async function readJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, "invalid_request", "Body must be valid JSON");
  }
}
