import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { TenantIsolationError } from "@/lib/db/plugins/tenantScope";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const unauthorized = (msg = "Authentication required") => new HttpError(401, "unauthorized", msg);
export const forbidden = (msg = "Forbidden") => new HttpError(403, "forbidden", msg);
export const notFound = (msg = "Not found") => new HttpError(404, "not_found", msg);
export const conflict = (msg = "Conflict") => new HttpError(409, "conflict", msg);

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: number }).code === 11000;
}

export function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
  }
  if (err instanceof ZodError) {
    return NextResponse.json({ error: "invalid_request", issues: err.issues }, { status: 400 });
  }
  if (err instanceof TenantIsolationError) {
    // Always a server bug: a code path tried to query without a tenant.
    console.error("[SECURITY] tenant isolation guard tripped", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
  if (
    err instanceof mongoose.Error.ValidationError ||
    err instanceof mongoose.Error.CastError ||
    err instanceof mongoose.Error.StrictModeError
  ) {
    return NextResponse.json({ error: "invalid_request", message: err.message }, { status: 400 });
  }
  if (isDuplicateKeyError(err)) {
    return NextResponse.json({ error: "conflict", message: "Resource already exists" }, { status: 409 });
  }
  console.error(err);
  return NextResponse.json({ error: "internal_error" }, { status: 500 });
}
