import { Schema, Types, type Aggregate, type Query } from "mongoose";
import { isValidBypass } from "@/lib/db/bypass";

export const TENANT_FIELD = "organizationId";

/** Spread into every tenant-owned schema definition (keeps type inference). */
export const tenantOwned = {
  organizationId: {
    type: Schema.Types.ObjectId,
    ref: "Organization",
    required: true,
    immutable: true,
  },
} as const;

export class TenantIsolationError extends Error {
  constructor(message: string) {
    super(`Tenant isolation violation: ${message}`);
    this.name = "TenantIsolationError";
  }
}

// ---------------------------------------------------------------------------
// Filter / update inspection
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && Object.getPrototypeOf(v) === Object.prototype;
}

function isObjectIdLike(v: unknown): boolean {
  if (v instanceof Types.ObjectId) return true;
  if (typeof v === "object" && v !== null && (v as { _bsontype?: string })._bsontype === "ObjectId") return true;
  return typeof v === "string" && /^[a-f0-9]{24}$/i.test(v);
}

/**
 * True only for an exact, single-tenant equality: `<ObjectId>` or
 * `{ $eq: <ObjectId> }`. Arrays (implicit `$in`), `$ne`, `$in`, `$exists`,
 * regexes and nested operators are all rejected.
 */
export function isExactTenantValue(v: unknown): boolean {
  if (isObjectIdLike(v)) return true;
  if (isPlainObject(v)) {
    const keys = Object.keys(v);
    return keys.length === 1 && keys[0] === "$eq" && isObjectIdLike(v.$eq);
  }
  return false;
}

/**
 * Top-level conditions in a MongoDB filter are ANDed, so a top-level exact
 * `organizationId` confines the whole query to one tenant no matter what
 * `$or`, `$expr` or other clauses sit beside it.
 */
export function assertTenantFilter(filter: unknown, where: string): void {
  if (!isPlainObject(filter) || !(TENANT_FIELD in filter)) {
    throw new TenantIsolationError(`${where} is missing a top-level ${TENANT_FIELD} filter`);
  }
  if (!isExactTenantValue(filter[TENANT_FIELD])) {
    throw new TenantIsolationError(`${where} must filter ${TENANT_FIELD} by a single exact ObjectId`);
  }
}

function touchesTenantField(key: string): boolean {
  return key === TENANT_FIELD || key.startsWith(`${TENANT_FIELD}.`);
}

/** Operator-style updates may never modify the tenant key. */
export function assertTenantSafeUpdate(update: unknown, where: string): void {
  if (update == null) return;
  if (Array.isArray(update)) {
    throw new TenantIsolationError(`${where}: aggregation-pipeline updates are not allowed on tenant collections`);
  }
  if (!isPlainObject(update)) return;
  for (const [key, value] of Object.entries(update)) {
    if (key.startsWith("$")) {
      if (isPlainObject(value) && Object.keys(value).some(touchesTenantField)) {
        throw new TenantIsolationError(`${where}: ${key} may not modify ${TENANT_FIELD}`);
      }
    } else if (touchesTenantField(key)) {
      throw new TenantIsolationError(`${where}: update may not modify ${TENANT_FIELD}`);
    }
  }
}

/** A full replacement must carry the same tenant as its filter. */
function assertTenantSafeReplacement(filter: Record<string, unknown>, replacement: unknown, where: string): void {
  if (!isPlainObject(replacement) || !(TENANT_FIELD in replacement)) {
    throw new TenantIsolationError(`${where}: replacement document must include ${TENANT_FIELD}`);
  }
  const expected = String(isPlainObject(filter[TENANT_FIELD]) ? (filter[TENANT_FIELD] as { $eq: unknown }).$eq : filter[TENANT_FIELD]);
  if (String(replacement[TENANT_FIELD]) !== expected) {
    throw new TenantIsolationError(`${where}: replacement may not change ${TENANT_FIELD}`);
  }
}

// ---------------------------------------------------------------------------
// Aggregation pipeline inspection
// ---------------------------------------------------------------------------

type Stage = Record<string, unknown>;

function stageName(stage: Stage): string {
  const keys = Object.keys(stage);
  if (keys.length !== 1) throw new TenantIsolationError("aggregate stage must have exactly one operator");
  return keys[0];
}

function isTenantLeadingStage(stage: Stage | undefined): boolean {
  if (!stage || !isPlainObject(stage)) return false;
  if (isPlainObject(stage.$match)) {
    return TENANT_FIELD in stage.$match && isExactTenantValue(stage.$match[TENANT_FIELD]);
  }
  if (isPlainObject(stage.$vectorSearch)) {
    const filter = stage.$vectorSearch.filter;
    return isPlainObject(filter) && TENANT_FIELD in filter && isExactTenantValue(filter[TENANT_FIELD]);
  }
  if (isPlainObject(stage.$geoNear)) {
    const query = stage.$geoNear.query;
    return isPlainObject(query) && TENANT_FIELD in query && isExactTenantValue(query[TENANT_FIELD]);
  }
  return false;
}

const FORBIDDEN_STAGES = new Set(["$out", "$merge", "$search", "$searchMeta", "$collStats", "$indexStats", "$planCacheStats", "$currentOp", "$listSessions", "$documents"]);

/**
 * Every pipeline that reads a collection must begin with a tenant match, and
 * any stage that reaches into another collection must carry its own.
 */
export function assertTenantPipeline(pipeline: unknown, where: string, requireLeadingMatch = true): void {
  if (!Array.isArray(pipeline)) throw new TenantIsolationError(`${where}: pipeline must be an array`);
  if (requireLeadingMatch && !isTenantLeadingStage(pipeline[0])) {
    throw new TenantIsolationError(
      `${where}: first stage must be $match/$vectorSearch/$geoNear with an exact ${TENANT_FIELD}`,
    );
  }

  pipeline.forEach((stage: Stage, i) => {
    const name = stageName(stage);
    const body = stage[name];
    const at = `${where}[${i}].${name}`;

    if (FORBIDDEN_STAGES.has(name)) throw new TenantIsolationError(`${at} is not allowed on tenant collections`);
    if (name === "$vectorSearch" && i !== 0) throw new TenantIsolationError(`${at} must be the first stage`);

    if (name === "$lookup") {
      if (!isPlainObject(body) || !Array.isArray(body.pipeline)) {
        throw new TenantIsolationError(`${at} must use a sub-pipeline that starts with a tenant $match`);
      }
      assertTenantPipeline(body.pipeline, at, true);
    } else if (name === "$unionWith") {
      if (!isPlainObject(body) || !Array.isArray(body.pipeline)) {
        throw new TenantIsolationError(`${at} must use a sub-pipeline that starts with a tenant $match`);
      }
      assertTenantPipeline(body.pipeline, at, true);
    } else if (name === "$graphLookup") {
      const restrict = isPlainObject(body) ? body.restrictSearchWithMatch : undefined;
      if (!isPlainObject(restrict) || !isExactTenantValue(restrict[TENANT_FIELD])) {
        throw new TenantIsolationError(`${at} requires restrictSearchWithMatch.${TENANT_FIELD}`);
      }
    } else if (name === "$facet" && isPlainObject(body)) {
      for (const [facet, sub] of Object.entries(body)) assertTenantPipeline(sub, `${at}.${facet}`, false);
    }
  });
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const FILTER_OPS = [
  "find",
  "findOne",
  "countDocuments",
  "distinct",
  "deleteOne",
  "deleteMany",
  "findOneAndDelete",
] as const;

const UPDATE_OPS = ["updateOne", "updateMany", "findOneAndUpdate"] as const;
const REPLACE_OPS = ["replaceOne", "findOneAndReplace"] as const;

type AnyQuery = Query<unknown, unknown>;

function hasBypass(query: AnyQuery): boolean {
  const opts = query.getOptions() as { tenantBypass?: unknown };
  if (opts.tenantBypass === undefined) return false;
  if (!isValidBypass(opts.tenantBypass)) {
    throw new TenantIsolationError("invalid tenantBypass option (only src/lib/db/system.ts may bypass)");
  }
  return true;
}

function where(query: AnyQuery): string {
  return `${query.model.modelName}.${(query as unknown as { op?: string }).op}`;
}

/**
 * Hard guard for tenant-owned collections. Any query, update, aggregate,
 * insert or bulk write that is not pinned to exactly one organization throws
 * `TenantIsolationError` before it reaches MongoDB.
 */
export function tenantScope(schema: Schema): void {
  const path = schema.path(TENANT_FIELD);
  if (!path || !path.isRequired || !(path.options as { immutable?: boolean }).immutable) {
    throw new Error(`tenantScope: schema must spread \`tenantOwned\` (required, immutable ${TENANT_FIELD})`);
  }

  // Makes document.save()/deleteOne() include organizationId in their filter.
  schema.set("shardKey", { [TENANT_FIELD]: 1 });

  for (const op of FILTER_OPS) {
    schema.pre(op, { document: false, query: true }, function (this: AnyQuery, next) {
      try {
        if (!hasBypass(this)) assertTenantFilter(this.getFilter(), where(this));
        next();
      } catch (err) {
        next(err as Error);
      }
    });
  }

  for (const op of UPDATE_OPS) {
    schema.pre(op, { document: false, query: true }, function (this: AnyQuery, next) {
      try {
        if (!hasBypass(this)) assertTenantFilter(this.getFilter(), where(this));
        assertTenantSafeUpdate(this.getUpdate(), where(this));
        next();
      } catch (err) {
        next(err as Error);
      }
    });
  }

  for (const op of REPLACE_OPS) {
    schema.pre(op, { document: false, query: true }, function (this: AnyQuery, next) {
      try {
        assertTenantFilter(this.getFilter(), where(this));
        assertTenantSafeReplacement(this.getFilter(), this.getUpdate(), where(this));
        next();
      } catch (err) {
        next(err as Error);
      }
    });
  }

  schema.pre("estimatedDocumentCount", function (this: AnyQuery, next) {
    next(new TenantIsolationError(`${where(this)} counts across tenants; use countDocuments`));
  });

  schema.pre("aggregate", function (this: Aggregate<unknown>, next) {
    try {
      assertTenantPipeline(this.pipeline(), `${this.model().modelName}.aggregate`);
      next();
    } catch (err) {
      next(err as Error);
    }
  });

  schema.pre("save", function (next) {
    if (!this.get(TENANT_FIELD)) return next(new TenantIsolationError(`save without ${TENANT_FIELD}`));
    next();
  });

  schema.pre("insertMany", function (next, docs: unknown) {
    const list = Array.isArray(docs) ? docs : [docs];
    const missing = list.some((d) => {
      const value = d && typeof d === "object" ? (d as Record<string, unknown>)[TENANT_FIELD] : undefined;
      return !isObjectIdLike(value);
    });
    if (missing) return next(new TenantIsolationError(`insertMany without ${TENANT_FIELD} on every document`));
    next();
  });

  schema.pre("bulkWrite", function (next, ops: unknown) {
    try {
      if (!Array.isArray(ops)) throw new TenantIsolationError("bulkWrite: ops must be an array");
      ops.forEach((op: Record<string, Record<string, unknown>>, i) => {
        const [kind] = Object.keys(op);
        const body = op[kind];
        const at = `bulkWrite[${i}].${kind}`;
        if (kind === "insertOne") {
          const doc = body.document as Record<string, unknown> | undefined;
          if (!doc || !isObjectIdLike(doc[TENANT_FIELD])) throw new TenantIsolationError(`${at} without ${TENANT_FIELD}`);
          return;
        }
        assertTenantFilter(body.filter, at);
        if (kind === "updateOne" || kind === "updateMany") assertTenantSafeUpdate(body.update, at);
        if (kind === "replaceOne") assertTenantSafeReplacement(body.filter as Record<string, unknown>, body.replacement, at);
      });
      next();
    } catch (err) {
      next(err as Error);
    }
  });
}
