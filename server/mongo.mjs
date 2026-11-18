import { MongoClient } from "mongodb";

let connection;
let activeClient;

export function mongoConfiguration(env = process.env) {
  const uri = env.MONGODB_URI?.trim();
  if (!uri || !/^mongodb(?:\+srv)?:\/\//.test(uri) || /<(?:db_)?(?:username|password)>/.test(uri)) {
    throw new Error("Set a complete MONGODB_URI in the backend environment.");
  }
  const database = env.MONGODB_DB?.trim() || "playground_atlas";
  if (!/^[A-Za-z0-9_-]{1,63}$/.test(database)) throw new Error("MONGODB_DB must be a valid database name.");
  return { uri, database };
}

export async function getDatabase() {
  if (!connection) {
    const { uri, database } = mongoConfiguration();
    const client = new MongoClient(uri, {
      appName: "PlaygroundAtlas", maxPoolSize: 5, minPoolSize: 0,
      maxIdleTimeMS: 60000, serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000, socketTimeoutMS: 15000
    });
    activeClient = client;
    connection = (async () => {
      await client.connect();
      const db = client.db(database);
      await db.collection("playground_visits").createIndex({ playground_id: 1, visited_at: -1 });
      return db;
    })().catch(async () => {
      connection = undefined; activeClient = undefined;
      await client.close().catch(() => {});
      // Driver errors can contain credentials/hosts. Never expose them to clients.
      throw new Error("MongoDB is unavailable. Check backend configuration and Atlas network access.");
    });
  }
  return connection;
}

export async function closeDatabase() {
  const client = activeClient;
  connection = undefined; activeClient = undefined;
  await client?.close();
}
