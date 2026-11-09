import { Types } from "mongoose";
import { beforeEach, describe, expect, it } from "vitest";
import { TenantIsolationError } from "@/lib/db/plugins/tenantScope";
import { searchChunks } from "@/lib/rag/vectorSearch";
import { deleteKnowledgeBase } from "@/lib/services/knowledgeBase";
import { AssistantToken, KnowledgeBase, KnowledgeChunk, User } from "@/models";
import { kbInput, makeTenant } from "./helpers";

type Tenant = Awaited<ReturnType<typeof makeTenant>>;

describe("tenantScope plugin (hard guard)", () => {
  let a: Tenant;
  let b: Tenant;

  beforeEach(async () => {
    a = await makeTenant("org-a");
    b = await makeTenant("org-b");
  });

  const unscoped: Array<[string, () => Promise<unknown>]> = [
    ["find", () => KnowledgeBase.find({}).exec()],
    ["findOne", () => KnowledgeBase.findOne({}).exec()],
    ["findById", () => KnowledgeBase.findById(new Types.ObjectId()).exec()],
    ["exists", () => KnowledgeBase.exists({ title: "x" })],
    ["countDocuments", () => KnowledgeBase.countDocuments({}).exec()],
    ["estimatedDocumentCount", () => KnowledgeBase.estimatedDocumentCount().exec()],
    ["distinct", () => KnowledgeBase.distinct("title").exec()],
    ["updateOne", () => KnowledgeBase.updateOne({}, { $set: { title: "x" } }).exec()],
    ["updateMany", () => KnowledgeBase.updateMany({}, { $set: { title: "x" } }).exec()],
    ["findOneAndUpdate", () => KnowledgeBase.findOneAndUpdate({}, { $set: { title: "x" } }).exec()],
    ["replaceOne", () => KnowledgeBase.replaceOne({}, { title: "x" }).exec()],
    ["deleteOne", () => KnowledgeBase.deleteOne({}).exec()],
    ["deleteMany", () => KnowledgeBase.deleteMany({}).exec()],
    ["findOneAndDelete", () => KnowledgeBase.findOneAndDelete({}).exec()],
    ["aggregate", () => KnowledgeBase.aggregate([{ $match: {} }]).exec()],
    ["users.find", () => User.find({ email: "owner@org-b.test" }).exec()],
    ["tokens.find", () => AssistantToken.find({}).exec()],
    ["chunks.find", () => KnowledgeChunk.find({}).exec()],
  ];

  it.each(unscoped)("rejects %s without organizationId", async (_name, run) => {
    await expect(run()).rejects.toBeInstanceOf(TenantIsolationError);
  });

  it.each([
    ["$ne", (id: Types.ObjectId) => ({ $ne: id })],
    ["$in", (id: Types.ObjectId) => ({ $in: [id] })],
    ["$exists", () => ({ $exists: true })],
    ["$nin", (id: Types.ObjectId) => ({ $nin: [id] })],
    ["array (implicit $in)", (id: Types.ObjectId) => [id]],
    ["regex", () => /.*/],
    ["null", () => null],
  ])("rejects a non-exact organizationId filter: %s", async (_name, make) => {
    await expect(KnowledgeBase.find({ organizationId: make(a.org._id) }).exec()).rejects.toBeInstanceOf(
      TenantIsolationError,
    );
  });

  it("rejects organizationId hidden only inside $or / $and", async () => {
    const id = a.org._id;
    await expect(KnowledgeBase.find({ $or: [{ organizationId: id }, { title: "x" }] }).exec()).rejects.toBeInstanceOf(
      TenantIsolationError,
    );
    await expect(KnowledgeBase.find({ $and: [{ organizationId: id }] }).exec()).rejects.toBeInstanceOf(
      TenantIsolationError,
    );
  });

  it("allows exact ObjectId and { $eq } filters", async () => {
    await expect(KnowledgeBase.find({ organizationId: a.org._id }).exec()).resolves.toEqual([]);
    await expect(KnowledgeBase.find({ organizationId: { $eq: a.org._id } }).exec()).resolves.toEqual([]);
  });

  it("rejects updates that touch organizationId", async () => {
    const kb = await a.r.knowledgeBases.create(kbInput(a.ctx, "1"));
    const filter = { _id: kb._id, organizationId: a.org._id };
    for (const update of [
      { $set: { organizationId: b.org._id } },
      { $unset: { organizationId: 1 } },
      { $rename: { organizationId: "x" } },
      { organizationId: b.org._id },
      [{ $set: { organizationId: b.org._id } }],
    ]) {
      await expect(KnowledgeBase.updateOne(filter, update as never).exec()).rejects.toBeInstanceOf(
        TenantIsolationError,
      );
    }
    // Replacement documents may not drop or change the tenant.
    await expect(KnowledgeBase.replaceOne(filter, { title: "x" }).exec()).rejects.toBeInstanceOf(TenantIsolationError);
    await expect(
      KnowledgeBase.replaceOne(filter, { ...kbInput(a.ctx, "1"), organizationId: b.org._id }).exec(),
    ).rejects.toBeInstanceOf(TenantIsolationError);
    expect((await a.r.knowledgeBases.findById(kb._id))?.organizationId.toString()).toBe(a.org._id.toString());
  });

  it("rejects aggregates without a leading tenant stage and unsafe sub-pipelines", async () => {
    const org = a.org._id;
    const bad = [
      [{ $sort: { createdAt: -1 } }, { $match: { organizationId: org } }],
      [{ $match: { organizationId: org } }, { $lookup: { from: "users", localField: "uploadedBy", foreignField: "_id", as: "u" } }],
      [{ $match: { organizationId: org } }, { $lookup: { from: "users", pipeline: [{ $match: {} }], as: "u" } }],
      [{ $match: { organizationId: org } }, { $unionWith: "knowledgechunks" }],
      [{ $match: { organizationId: org } }, { $out: "leak" }],
      [{ $match: { organizationId: org } }, { $facet: { x: [{ $lookup: { from: "users", pipeline: [], as: "u" } }] } }],
    ];
    for (const pipeline of bad) {
      await expect(KnowledgeBase.aggregate(pipeline as never).exec()).rejects.toBeInstanceOf(TenantIsolationError);
    }
    await expect(
      KnowledgeBase.aggregate([
        { $match: { organizationId: org } },
        { $lookup: { from: "users", pipeline: [{ $match: { organizationId: org } }], as: "u" } },
      ]).exec(),
    ).resolves.toEqual([]);
  });

  it("rejects insertMany and bulkWrite without a tenant", async () => {
    const { organizationId: _o, ...noTenant } = { ...kbInput(a.ctx, "x"), organizationId: undefined };
    void _o;
    await expect(KnowledgeBase.insertMany([noTenant])).rejects.toThrow();
    await expect(
      KnowledgeBase.bulkWrite([{ updateMany: { filter: {}, update: { $set: { title: "x" } } } }]),
    ).rejects.toBeInstanceOf(TenantIsolationError);
    await expect(
      KnowledgeBase.bulkWrite([{ deleteMany: { filter: { organizationId: { $ne: a.org._id } } } }]),
    ).rejects.toBeInstanceOf(TenantIsolationError);
  });

  it("rejects a forged tenantBypass option", async () => {
    for (const tenantBypass of ["admin", { key: "guess", reason: "x" }, true]) {
      await expect(KnowledgeBase.find({}, null, { tenantBypass } as never).exec()).rejects.toBeInstanceOf(
        TenantIsolationError,
      );
    }
  });

  it("keeps document.save() and document.deleteOne() working via the shard-key filter", async () => {
    const doc = await KnowledgeBase.findOne({ organizationId: a.org._id, title: "none" });
    expect(doc).toBeNull();
    await a.r.knowledgeBases.create(kbInput(a.ctx, "2"));
    const loaded = (await KnowledgeBase.findOne({ organizationId: a.org._id }))!;
    loaded.title = "renamed";
    await loaded.save();
    await loaded.deleteOne();
    expect(await a.r.knowledgeBases.count()).toBe(0);
  });
});

describe("tenantRepo (scoped access)", () => {
  let a: Tenant;
  let b: Tenant;

  beforeEach(async () => {
    a = await makeTenant("org-a");
    b = await makeTenant("org-b");
  });

  it("cannot read, update or delete another tenant's document by id", async () => {
    const bDoc = await b.r.knowledgeBases.create(kbInput(b.ctx, "secret"));

    expect(await a.r.knowledgeBases.findById(bDoc._id)).toBeNull();
    expect(await a.r.knowledgeBases.findOne({ _id: bDoc._id })).toBeNull();
    expect(await a.r.knowledgeBases.find({ _id: bDoc._id })).toEqual([]);
    expect(await a.r.knowledgeBases.updateById(bDoc._id, { $set: { title: "pwned" } })).toBeNull();
    expect(await a.r.knowledgeBases.updateMany({}, { $set: { title: "pwned" } })).toBe(0);
    expect(await a.r.knowledgeBases.deleteById(bDoc._id)).toBeNull();
    expect(await a.r.knowledgeBases.deleteMany({})).toBe(0);
    await expect(deleteKnowledgeBase(a.ctx, bDoc._id.toString())).rejects.toMatchObject({ status: 404 });

    const still = await b.r.knowledgeBases.findById(bDoc._id);
    expect(still?.title).toBe("Doc secret");
  });

  it("overrides an organizationId smuggled into filters or payloads", async () => {
    await b.r.knowledgeBases.create(kbInput(b.ctx, "b1"));
    expect(await a.r.knowledgeBases.find({ organizationId: b.org._id } as never)).toEqual([]);

    const created = await a.r.knowledgeBases.create({ ...kbInput(a.ctx, "a1"), organizationId: b.org._id } as never);
    expect(created.organizationId.toString()).toBe(a.org._id.toString());
    expect(await b.r.knowledgeBases.count()).toBe(1);
  });

  it("returns null for malformed ids instead of throwing", async () => {
    expect(await a.r.knowledgeBases.findById("not-an-id")).toBeNull();
    expect(await a.r.knowledgeBases.findById({ $ne: null })).toBeNull();
  });

  it("allows the same PDF checksum in two tenants but not twice in one", async () => {
    await a.r.knowledgeBases.create(kbInput(a.ctx, "same"));
    await b.r.knowledgeBases.create(kbInput(b.ctx, "same"));
    await expect(a.r.knowledgeBases.create(kbInput(a.ctx, "same"))).rejects.toMatchObject({ code: 11000 });
  });

  it("allows the same email in two tenants", async () => {
    const users = await User.find({ organizationId: a.org._id }).lean();
    expect(users).toHaveLength(1);
    expect((await b.r.users.find()).map((u) => u.email)).toEqual(["owner@org-b.test"]);
  });

  it("scopes aggregate pipelines", async () => {
    await a.r.knowledgeBases.create(kbInput(a.ctx, "a1"));
    await b.r.knowledgeBases.create(kbInput(b.ctx, "b1"));
    await b.r.knowledgeBases.create(kbInput(b.ctx, "b2"));
    const [res] = await a.r.knowledgeBases.aggregate<{ n: number }>([{ $count: "n" }]);
    expect(res.n).toBe(1);
  });

  it("deletes a knowledge base together with only its own chunks", async () => {
    const kb = await a.r.knowledgeBases.create(kbInput(a.ctx, "handbook"));

    const chunk = (ctx: typeof a.ctx, kbId: Types.ObjectId, i: number) => ({
      knowledgeBaseId: kbId,
      documentName: "handbook.pdf",
      pageNumber: 1,
      chunkIndex: i,
      text: `chunk ${i}`,
      embedding: [0.1, 0.2, 0.3, 0.4],
      embeddingModel: "test",
      organizationId: ctx.organizationId,
    });
    await a.r.knowledgeChunks.create(chunk(a.ctx, kb._id, 0));
    await a.r.knowledgeChunks.create(chunk(a.ctx, kb._id, 1));
    // Chunk in B that (maliciously) references A's knowledge base id.
    await b.r.knowledgeChunks.create(chunk(b.ctx, kb._id, 0));

    expect(await deleteKnowledgeBase(a.ctx, kb._id.toString())).toMatchObject({ chunksDeleted: 2 });
    expect(await b.r.knowledgeChunks.count()).toBe(1);
  });

  it("validates embedding dimensions", async () => {
    const kb = await a.r.knowledgeBases.create(kbInput(a.ctx, "dims"));
    await expect(
      a.r.knowledgeChunks.create({
        knowledgeBaseId: kb._id,
        documentName: "dims.pdf",
        pageNumber: 1,
        chunkIndex: 0,
        text: "x",
        embedding: [1, 2, 3],
        embeddingModel: "test",
      }),
    ).rejects.toThrow(/exactly 4/);
  });
});

describe("searchChunks", () => {
  it("rejects vectors with the wrong dimension before querying", async () => {
    const a = await makeTenant("org-a");
    await expect(searchChunks(a.ctx, [1, 2])).rejects.toMatchObject({ status: 400 });
  });

  it("never widens an assistant token's knowledge-base restriction", async () => {
    const a = await makeTenant("org-a");
    const ctx = {
      organizationId: a.org._id,
      principal: { type: "assistantToken" as const, tokenId: new Types.ObjectId(), knowledgeBaseIds: [new Types.ObjectId()], scopes: ["chat"] },
    };
    // Asking only for a KB outside the token's allow-list yields nothing without hitting Atlas.
    await expect(searchChunks(ctx, [0, 0, 0, 1], { knowledgeBaseIds: [new Types.ObjectId().toString()] })).resolves.toEqual([]);
  });
});
