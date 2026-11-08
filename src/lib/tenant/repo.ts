import { isValidObjectId, Types, type FilterQuery, type Model, type PipelineStage, type UpdateQuery } from "mongoose";
import type { TenantContext } from "./types";

type FindOptions = {
  projection?: Record<string, 0 | 1>;
  sort?: Record<string, 1 | -1>;
  limit?: number;
  skip?: number;
};

const MAX_LIMIT = 500;

/**
 * Data access bound to one organization. Every call forces
 * `organizationId` into the filter, payload or pipeline (overriding anything
 * the caller passed), so a record from another tenant is simply invisible:
 * guessing its id yields `null`, never the document.
 *
 * The tenantScope plugin independently rejects any query that slips past this
 * layer without a tenant filter.
 */
export function tenantRepo<T>(model: Model<T>, ctx: TenantContext) {
  const organizationId = ctx.organizationId;
  if (!(organizationId instanceof Types.ObjectId)) {
    throw new Error("tenantRepo requires an ObjectId organizationId");
  }

  const scope = (filter: FilterQuery<T> = {}): FilterQuery<T> =>
    ({ ...filter, organizationId }) as FilterQuery<T>;

  const byId = (id: unknown): FilterQuery<T> | null =>
    isValidObjectId(id) ? scope({ _id: new Types.ObjectId(String(id)) } as FilterQuery<T>) : null;

  return {
    organizationId,

    find(filter?: FilterQuery<T>, opts: FindOptions = {}) {
      const limit = Math.min(Math.max(opts.limit ?? 100, 1), MAX_LIMIT);
      return model
        .find(scope(filter), opts.projection)
        .sort(opts.sort ?? { createdAt: -1 })
        .skip(opts.skip ?? 0)
        .limit(limit)
        .lean()
        .exec();
    },

    findOne(filter?: FilterQuery<T>, projection?: Record<string, 0 | 1>) {
      return model.findOne(scope(filter), projection).lean().exec();
    },

    async findById(id: unknown, projection?: Record<string, 0 | 1>) {
      const filter = byId(id);
      return filter ? model.findOne(filter, projection).lean().exec() : null;
    },

    count(filter?: FilterQuery<T>) {
      return model.countDocuments(scope(filter)).exec();
    },

    async create(data: Omit<Partial<T>, "organizationId"> & { _id?: Types.ObjectId }) {
      const doc = await model.create({ ...data, organizationId });
      return doc.toObject();
    },

    /** Bulk insert; every document is stamped with this tenant. Returns the count inserted. */
    async insertMany(docs: Array<Omit<Partial<T>, "organizationId">>) {
      if (docs.length === 0) return 0;
      const inserted = await model.insertMany(
        docs.map((d) => ({ ...d, organizationId })),
        { ordered: true },
      );
      return inserted.length;
    },

    updateOne(filter: FilterQuery<T>, update: UpdateQuery<T>) {
      return model
        .findOneAndUpdate(scope(filter), update, { new: true, runValidators: true })
        .lean()
        .exec();
    },

    async updateById(id: unknown, update: UpdateQuery<T>) {
      const filter = byId(id);
      if (!filter) return null;
      return model.findOneAndUpdate(filter, update, { new: true, runValidators: true }).lean().exec();
    },

    async updateMany(filter: FilterQuery<T>, update: UpdateQuery<T>) {
      const res = await model.updateMany(scope(filter), update, { runValidators: true }).exec();
      return res.modifiedCount;
    },

    async deleteById(id: unknown) {
      const filter = byId(id);
      return filter ? model.findOneAndDelete(filter).lean().exec() : null;
    },

    async deleteMany(filter: FilterQuery<T>) {
      const res = await model.deleteMany(scope(filter)).exec();
      return res.deletedCount;
    },

    /**
     * Prepends a tenant `$match`. A leading `$vectorSearch` must stay first,
     * so the tenant is injected into its pre-filter and re-checked right after.
     */
    aggregate<R = unknown>(pipeline: PipelineStage[]) {
      const tenantMatch: PipelineStage.Match = { $match: { organizationId } };
      const [first, ...rest] = pipeline;
      if (first && "$vectorSearch" in first) {
        const vs = (first as { $vectorSearch: Record<string, unknown> }).$vectorSearch;
        const filter = { ...((vs.filter as Record<string, unknown>) ?? {}), organizationId: { $eq: organizationId } };
        return model
          .aggregate<R>([{ $vectorSearch: { ...vs, filter } } as PipelineStage, tenantMatch, ...rest])
          .exec();
      }
      return model.aggregate<R>([tenantMatch, ...pipeline]).exec();
    },
  };
}

export type TenantRepo<T> = ReturnType<typeof tenantRepo<T>>;
