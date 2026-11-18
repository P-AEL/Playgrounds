import { loadLocalEnvironment } from "../server/env.mjs";
import { getDatabase, closeDatabase } from "../server/mongo.mjs";
try {
  loadLocalEnvironment();
  await (await getDatabase()).command({ ping: 1 });
  console.log("MongoDB connection verified. Credentials were not printed.");
} catch {
  console.error("MongoDB connection failed. Check MONGODB_URI, the database user and Atlas network access. Credentials were not printed.");
  process.exitCode = 1;
} finally { await closeDatabase(); }
