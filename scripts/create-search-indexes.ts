/**
 * Creates (or updates) the Atlas Vector Search index on knowledge chunks.
 *
 *   npm run db:indexes            # create/update, then wait until queryable
 *   npm run db:indexes -- --no-wait
 *
 * Requires MongoDB Atlas (or the atlas-local Docker image); community
 * mongod does not support search indexes.
 */
import { config } from "dotenv";
import mongoose from "mongoose";

config({ path: [".env.local", ".env"], quiet: true });

async function main() {
  const { getEmbeddingConfig, getEnv } = await import("../src/lib/env");
  const { KnowledgeChunk } = await import("../src/models/KnowledgeChunk");

  const env = getEnv();
  const { dimensions, indexName } = getEmbeddingConfig();
  await mongoose.connect(env.MONGODB_URI, { dbName: env.MONGODB_DB });

  const db = mongoose.connection.db!;
  const collectionName = KnowledgeChunk.collection.collectionName;
  if (!(await db.listCollections({ name: collectionName }).hasNext())) {
    await db.createCollection(collectionName);
  }
  // Regular B-tree indexes (unique constraints) as declared on the schemas.
  const { Organization, User, KnowledgeBase, AssistantToken } = await import("../src/models");
  for (const m of [Organization, User, KnowledgeBase, KnowledgeChunk, AssistantToken]) await m.syncIndexes();

  const collection = db.collection(collectionName);
  const definition = {
    fields: [
      { type: "vector", path: "embedding", numDimensions: dimensions, similarity: "cosine" },
      // Filter fields let $vectorSearch pre-filter by tenant before scoring.
      { type: "filter", path: "organizationId" },
      { type: "filter", path: "knowledgeBaseId" },
    ],
  };

  type SearchIndexInfo = { latestDefinition?: unknown; queryable?: boolean; status?: string };
  const listIndex = async () =>
    ((await collection.listSearchIndexes(indexName).toArray()) as SearchIndexInfo[])[0];

  const existing = await listIndex();
  if (!existing) {
    await collection.createSearchIndex({ name: indexName, type: "vectorSearch", definition });
    console.log(`Created vector index "${indexName}" (${dimensions} dims) on ${collectionName}`);
  } else if (JSON.stringify(existing.latestDefinition) !== JSON.stringify(definition)) {
    await collection.updateSearchIndex(indexName, definition);
    console.log(`Updated vector index "${indexName}" to ${dimensions} dims`);
  } else {
    console.log(`Vector index "${indexName}" is up to date`);
  }

  if (!process.argv.includes("--no-wait")) {
    process.stdout.write("Waiting for index to become queryable");
    for (let i = 0; i < 120; i++) {
      const idx = await listIndex();
      if (idx?.queryable && idx.status === "READY") break;
      process.stdout.write(".");
      await new Promise((r) => setTimeout(r, 5000));
    }
    console.log(" ready");
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
