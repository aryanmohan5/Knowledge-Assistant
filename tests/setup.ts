import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll } from "vitest";

// Small dimension so test vectors stay readable.
process.env.EMBEDDING_DIMENSIONS = "4";

let replSet: MongoMemoryReplSet;

beforeAll(async () => {
  // Replica set so registration transactions work like on Atlas.
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  process.env.MONGODB_URI = replSet.getUri();
  await mongoose.connect(replSet.getUri(), { dbName: "test" });
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
});

afterEach(async () => {
  const db = mongoose.connection.db!;
  for (const c of await db.collections()) await c.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
  await replSet?.stop();
});
