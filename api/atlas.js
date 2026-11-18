import { getDatabase } from "../server/mongo.mjs";
import { createAtlasHandler } from "../server/atlas.mjs";
export default createAtlasHandler({ getDatabase });
