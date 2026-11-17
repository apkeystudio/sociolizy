import { MongoClient, Db, Collection } from "mongodb";
import {
  getActiveClusterConfig,
  getServerUri,
  getDiscoveredServers,
  getActiveEnvMap,
  ServerNodeConfig,
} from "@/lib/server-db";

/**
 * Order SMM Document Schema directly mapped to MongoDB according to database.md
 */
export interface OrderSmmDocument {
  id: number;
  uuid_user: string;
  uuid_api_provider: string | null;
  service_id: string;
  invoice: string;
  order_id: string | null;
  amount: number;
  price_api: number;
  price_sale: number;
  target: string;
  remains: number;
  start: number;
  refill: boolean;
  status: string;
  callback_url?: string | null;
  callback_status?: string | null;
  server_area?: string | null;
  refund_amount?: number;
  refunded?: boolean;
  create_at: Date;
  update_at: Date;
}

export type OrderSmmMongo = OrderSmmDocument;

// Global cache for MongoClients per connection URI to prevent connection exhaustion in serverless/Next.js
const globalForMongo = globalThis as unknown as {
  mongoClients: Map<string, MongoClient> | undefined;
};

if (!globalForMongo.mongoClients) {
  globalForMongo.mongoClients = new Map<string, MongoClient>();
}

/**
 * Deterministic string hash algorithm for consistent user-to-shard distribution
 */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/**
 * Normalizes region aliases (e.g. WDC -> DC, JAPAN -> JP)
 */
function normalizeRegionGroup(group: string): string {
  const g = group.toUpperCase().trim();
  if (g === "WDC") return "DC";
  if (g === "JAPAN") return "JP";
  if (g === "SIN") return "SG";
  return g;
}

/**
 * Retrieves all configured and active servers belonging to a specified region/group
 */
export function getServersForRegion(serverArea?: string): ServerNodeConfig[] {
  const servers = getDiscoveredServers().filter((s) => s.isConfigured);
  if (!serverArea) return servers;

  const target = serverArea.toUpperCase().trim();
  const normalizedTarget = normalizeRegionGroup(target);

  // 1. Exact Node Match (e.g. "SG_1", "SG_15", "WDC_5", "JP_12")
  const exact = servers.filter((s) => s.id === target);
  if (exact.length > 0) return exact;

  // 2. Region Group Match (e.g. "SG", "DC", "WDC", "JP", "JAPAN")
  const groupMatches = servers.filter((s) => {
    const sGroup = s.group.toUpperCase();
    return (
      sGroup === target ||
      sGroup === normalizedTarget ||
      normalizeRegionGroup(sGroup) === normalizedTarget
    );
  });

  return groupMatches;
}

/**
 * Automatically allocates a rolling, load-balanced MongoDB server node for a user.
 * Supports:
 *  - "AUTO" / "" / "ALL" / "GLOBAL": Full cluster multi-active rolling assignment across ALL configured servers
 *  - Specific region (e.g. "SG", "DC"): Rolling assignment across all configured servers in that region
 *  - Specific node (e.g. "SG_2", "DC_1"): Direct assignment to that node if configured
 *
 * Algorithm:
 *  1. Determines candidate server pool.
 *  2. Queries current user counts per server node in PostgreSQL.
 *     Accurately maps legacy group assignments (e.g. "SG" -> primary node "SG_1").
 *  3. Finds the least-loaded server(s).
 *  4. Resolves ties using round-robin rotation based on the latest registered user ID.
 */
export async function allocateRollingServerNode(requestedRegion: string = "AUTO"): Promise<{
  assignedNode: string;
  regionGroup: string;
  serverNode: ServerNodeConfig | null;
}> {
  const allConfigured = getDiscoveredServers().filter((s) => s.isConfigured);
  if (allConfigured.length === 0) {
    return {
      assignedNode: "SG_1",
      regionGroup: "SG",
      serverNode: null,
    };
  }

  const rawTarget = (requestedRegion || "AUTO").toUpperCase().trim();
  const isAuto =
    rawTarget === "AUTO" ||
    rawTarget === "ALL" ||
    rawTarget === "GLOBAL" ||
    rawTarget === "" ||
    rawTarget === "DEFAULT";

  let candidates: ServerNodeConfig[] = [];

  if (isAuto) {
    // Pool is ALL configured servers across all regions (e.g. SG_1, SG_2, DC_1...)
    candidates = allConfigured;
  } else {
    // 1. Check exact node match (e.g. "SG_1", "SG_2", "DC_1")
    const exact = allConfigured.find((s) => s.id.toUpperCase() === rawTarget);
    if (exact) {
      return {
        assignedNode: exact.id,
        regionGroup: exact.group,
        serverNode: exact,
      };
    }

    // 2. Check region match (e.g. "SG", "DC", "SIN", "WDC")
    const normGroup = normalizeRegionGroup(rawTarget);
    const regionServers = allConfigured.filter((s) => {
      const g = s.group.toUpperCase();
      return g === rawTarget || g === normGroup || normalizeRegionGroup(g) === normGroup;
    });

    if (regionServers.length > 0) {
      candidates = regionServers;
    } else {
      // Fallback: If requested region has no configured servers, fallback to all configured servers
      candidates = allConfigured;
    }
  }

  // If only 1 candidate server exists, assign it directly
  if (candidates.length === 1) {
    return {
      assignedNode: candidates[0].id,
      regionGroup: candidates[0].group,
      serverNode: candidates[0],
    };
  }

  // Distribute across candidates using Least-Loaded + Deterministic Round-Robin tie breaker
  try {
    const { prisma } = await import("@/lib/prisma");

    // 1. Group existing users by server_area from PostgreSQL
    const counts = await prisma.user.groupBy({
      by: ["server_area"],
      _count: { id: true },
    });

    const countMap = new Map<string, number>();
    counts.forEach((c) => {
      if (c.server_area) {
        const areaUpper = c.server_area.toUpperCase().trim();
        countMap.set(areaUpper, (countMap.get(areaUpper) || 0) + c._count.id);
      }
    });

    // 2. Query the latest registered user ID to maintain seamless round-robin rotation progression
    const lastUser = await prisma.user.findFirst({
      orderBy: { id: "desc" },
      select: { id: true },
    });
    const lastId = lastUser?.id || 0;

    // 3. Compute effective load for each candidate node
    // (Legacy users with group-only "SG" count towards the group's index 1 server)
    const candidateLoads = candidates.map((node) => {
      const directCount = countMap.get(node.id.toUpperCase()) || 0;
      const groupCount = node.serverIndex === 1 ? (countMap.get(node.group.toUpperCase()) || 0) : 0;
      return {
        node,
        totalUsers: directCount + groupCount,
      };
    });

    // 4. Find the minimum user count
    const minUsers = Math.min(...candidateLoads.map((c) => c.totalUsers));

    // 5. Filter candidates that have the minimum load
    const leastLoaded = candidateLoads.filter((c) => c.totalUsers === minUsers);

    // 6. Tie-breaker: Round-robin rotate based on last registered user ID so each new user alternates
    const chosenIndex = (lastId + 1) % leastLoaded.length;
    const chosen = leastLoaded[chosenIndex].node;

    return {
      assignedNode: chosen.id,
      regionGroup: chosen.group,
      serverNode: chosen,
    };
  } catch (err) {
    console.warn("Failed to query DB for rolling server node, using pseudo-random rotation:", err);
    const idx = Math.floor(Math.random() * candidates.length);
    const chosen = candidates[idx];
    return {
      assignedNode: chosen.id,
      regionGroup: chosen.group,
      serverNode: chosen,
    };
  }
}

/**
 * Automatically and dynamically resolves the target MongoDB server node and URI.
 * - Supports arbitrary number of servers per region (e.g. 10, 20, 30+ servers)
 * - Automatically load balances across servers in the same region using consistent user hashing
 * - Instantly discovers newly added servers from .env on the fly
 */
export function resolveMongoServer(
  serverArea?: string,
  userIdentifier?: string
): { uri: string; nodeId: string } | null {
  const env = getActiveEnvMap();
  const regionServers = getServersForRegion(serverArea);

  if (regionServers.length > 0) {
    // If region has multiple server nodes (e.g. 10 or 30 servers in SG, 15 in Japan, 5 in WDC):
    // Distribute members evenly across servers using deterministic hashing
    if (userIdentifier && regionServers.length > 1) {
      const shardIndex = hashString(userIdentifier) % regionServers.length;
      const chosen = regionServers[shardIndex];
      return { uri: chosen.uri, nodeId: chosen.id };
    }
    const chosen = regionServers[0];
    return { uri: chosen.uri, nodeId: chosen.id };
  }

  // Fallback to active cluster config
  const activeConfig = getActiveClusterConfig();
  if (activeConfig?.uri && !activeConfig.uri.includes("CHANGE_PASSWORD")) {
    return { uri: activeConfig.uri, nodeId: activeConfig.server };
  }

  // Fallback to any first configured server
  const allServers = getDiscoveredServers().filter((s) => s.isConfigured);
  if (allServers.length > 0 && allServers[0].uri) {
    return { uri: allServers[0].uri, nodeId: allServers[0].id };
  }

  const defaultUri =
    process.env.NEXT_GROUP_SERVER_SG_1_MONGODB_URI ||
    process.env.MONGODB_URI ||
    null;

  if (defaultUri) {
    return { uri: defaultUri, nodeId: "SG_1" };
  }

  return null;
}

/**
 * Resolves URI (backward compatibility)
 */
export function resolveMongoUri(serverArea?: string, userIdentifier?: string): string | null {
  const resolved = resolveMongoServer(serverArea, userIdentifier);
  return resolved?.uri || null;
}

/**
 * Get connected MongoDB Client for a specific serverArea or active cluster
 */
export async function getMongoClient(serverArea?: string, userIdentifier?: string): Promise<MongoClient | null> {
  const resolved = resolveMongoServer(serverArea, userIdentifier);
  if (!resolved?.uri) {
    console.warn(`[MongoDB] No valid MongoDB URI configured for area: "${serverArea}"`);
    return null;
  }

  const { uri } = resolved;
  const clients = globalForMongo.mongoClients!;
  if (clients.has(uri)) {
    return clients.get(uri)!;
  }

  try {
    const client = new MongoClient(uri, {
      maxPoolSize: 15,
      serverSelectionTimeoutMS: 5000,
    });
    await client.connect();
    clients.set(uri, client);
    return client;
  } catch (error) {
    console.error(`[MongoDB] Failed to connect to MongoDB (${resolved.nodeId}):`, error);
    return null;
  }
}

/**
 * Get MongoDB Database instance for a specific region/node
 */
export async function getMongoDb(
  serverArea?: string,
  userIdentifier?: string,
  dbName: string = "master_smm"
): Promise<Db | null> {
  const client = await getMongoClient(serverArea, userIdentifier);
  if (!client) return null;
  return client.db(dbName);
}

/**
 * Get typed collection for order_smm in MongoDB
 */
export async function getOrderSmmCollection(
  serverArea?: string,
  userIdentifier?: string
): Promise<Collection<OrderSmmDocument> | null> {
  const db = await getMongoDb(serverArea, userIdentifier);
  if (!db) return null;

  const collection = db.collection<OrderSmmDocument>("order_smm");

  // Ensure background indexes
  collection.createIndex({ id: 1 }, { unique: true, background: true }).catch(() => {});
  collection.createIndex({ invoice: 1 }, { unique: true, background: true }).catch(() => {});
  collection.createIndex({ uuid_user: 1, create_at: -1 }, { background: true }).catch(() => {});
  collection.createIndex({ uuid_api_provider: 1 }, { background: true }).catch(() => {});
  collection.createIndex({ server_area: 1 }, { background: true }).catch(() => {});
  collection.createIndex({ status: 1 }, { background: true }).catch(() => {});

  return collection;
}

/**
 * Sequential auto-increment integer generator per region database
 */
export async function getNextSequence(
  sequenceName: string,
  serverArea?: string,
  userIdentifier?: string
): Promise<number> {
  const db = await getMongoDb(serverArea, userIdentifier);
  if (!db) return Date.now();

  try {
    const counters = db.collection<{ _id: string; seq: number }>("counters");
    const result = await counters.findOneAndUpdate(
      { _id: sequenceName },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: "after" }
    );
    return result?.seq ?? Date.now();
  } catch (err) {
    console.warn(`[MongoDB] getNextSequence fallback for area ${serverArea}:`, err);
    return Date.now();
  }
}

/**
 * Creates and stores an order directly into the specific region's MongoDB database.
 * Automatically selects the appropriate server node in that region.
 */
export async function createOrderInMongo(
  data: Omit<OrderSmmDocument, "id" | "create_at" | "update_at"> & {
    id?: number;
    create_at?: Date;
    update_at?: Date;
  },
  serverArea?: string
): Promise<OrderSmmDocument> {
  const resolved = resolveMongoServer(serverArea, data.uuid_user);
  const targetNode = resolved?.nodeId || serverArea || "SG_1";

  const col = await getOrderSmmCollection(serverArea, data.uuid_user);
  if (!col) {
    throw new Error(`Gagal terhubung ke database MongoDB klaster region: ${serverArea || "default"}`);
  }

  const nextId = data.id ?? (await getNextSequence("order_smm", serverArea, data.uuid_user));
  const doc: OrderSmmDocument = {
    id: nextId,
    uuid_user: data.uuid_user,
    uuid_api_provider: data.uuid_api_provider ?? null,
    service_id: String(data.service_id),
    invoice: data.invoice,
    order_id: data.order_id ? String(data.order_id) : null,
    amount: Number(data.amount),
    price_api: Number(data.price_api),
    price_sale: Number(data.price_sale),
    target: data.target,
    remains: data.remains !== undefined ? Number(data.remains) : Number(data.amount),
    start: data.start !== undefined ? Number(data.start) : 0,
    refill: Boolean(data.refill),
    status: data.status || "Pending",
    callback_url: data.callback_url || null,
    callback_status: data.callback_status || (data.callback_url ? "pending" : null),
    server_area: targetNode,
    create_at: data.create_at || new Date(),
    update_at: data.update_at || new Date(),
  };

  await col.insertOne(doc as any);
  return doc;
}

/**
 * Fetch orders directly from MongoDB for a specific user.
 * If the user's region has multiple servers (e.g. 10 or 30 servers),
 * it queries in parallel across all active servers in that region and combines them cleanly!
 */
export async function getOrdersFromMongo(
  uuid_user?: string,
  limit: number = 50,
  serverArea?: string
): Promise<OrderSmmDocument[]> {
  try {
    const regionServers = getServersForRegion(serverArea);

    // If only 1 server in region or exact node specified:
    if (regionServers.length <= 1) {
      const col = await getOrderSmmCollection(serverArea, uuid_user);
      if (!col) return [];
      const filter = uuid_user ? { uuid_user } : {};
      const docs = await col.find(filter).sort({ create_at: -1, id: -1 }).limit(limit).toArray();
      return mapOrderDocs(docs, serverArea || "SG");
    }

    // If multiple servers in this region (e.g. SG_1 through SG_30):
    // Query all active servers in that region in parallel so no historical order is missed!
    const queryPromises = regionServers.map(async (srv) => {
      try {
        const client = await getMongoClient(srv.id);
        if (!client) return [];
        const col = client.db("master_smm").collection<OrderSmmDocument>("order_smm");
        const filter = uuid_user ? { uuid_user } : {};
        const docs = await col.find(filter).sort({ create_at: -1, id: -1 }).limit(limit).toArray();
        return mapOrderDocs(docs, srv.id);
      } catch {
        return [];
      }
    });

    const results = await Promise.allSettled(queryPromises);
    const combined: OrderSmmDocument[] = [];
    const seenInvoices = new Set<string>();

    for (const res of results) {
      if (res.status === "fulfilled" && Array.isArray(res.value)) {
        for (const item of res.value) {
          if (!seenInvoices.has(item.invoice)) {
            seenInvoices.add(item.invoice);
            combined.push(item);
          }
        }
      }
    }

    // Sort combined by create_at descending and apply limit
    combined.sort((a, b) => new Date(b.create_at).getTime() - new Date(a.create_at).getTime());
    return combined.slice(0, limit);
  } catch (error) {
    console.error(`[MongoDB] Failed to query orders from region ${serverArea}:`, error);
    return [];
  }
}

/**
 * Count total orders across all active servers in the specific region
 */
export async function countOrdersInMongo(
  uuid_user?: string,
  serverArea?: string
): Promise<number> {
  try {
    const regionServers = getServersForRegion(serverArea);

    if (regionServers.length <= 1) {
      const col = await getOrderSmmCollection(serverArea, uuid_user);
      if (!col) return 0;
      const filter = uuid_user ? { uuid_user } : {};
      return await col.countDocuments(filter);
    }

    // Query in parallel across all servers in the region
    const countPromises = regionServers.map(async (srv) => {
      try {
        const client = await getMongoClient(srv.id);
        if (!client) return 0;
        const col = client.db("master_smm").collection<OrderSmmDocument>("order_smm");
        const filter = uuid_user ? { uuid_user } : {};
        return await col.countDocuments(filter);
      } catch {
        return 0;
      }
    });

    const results = await Promise.allSettled(countPromises);
    let totalCount = 0;
    for (const res of results) {
      if (res.status === "fulfilled" && typeof res.value === "number") {
        totalCount += res.value;
      }
    }
    return totalCount;
  } catch (error) {
    console.error(`[MongoDB] Failed to count orders in region ${serverArea}:`, error);
    return 0;
  }
}

/**
 * Retrieve a single order for a specific user by its numeric ID, invoice, or provider order_id
 */
export async function getOrderByIdForUser(
  userUuid: string,
  orderIdentifier: number | string,
  serverArea?: string
): Promise<OrderSmmDocument | null> {
  try {
    const regionServers = getServersForRegion(serverArea);
    const numericId = Number(orderIdentifier);
    const isNum = !isNaN(numericId);

    const conditions: any[] = [
      { invoice: String(orderIdentifier) },
      { order_id: String(orderIdentifier) },
    ];
    if (isNum) {
      conditions.unshift({ id: numericId });
    }

    const filter = {
      uuid_user: userUuid,
      $or: conditions,
    };

    if (regionServers.length <= 1) {
      const col = await getOrderSmmCollection(serverArea, userUuid);
      if (!col) return null;
      const doc = await col.findOne(filter);
      return doc ? mapOrderDocs([doc], serverArea || "SG")[0] : null;
    }

    const promises = regionServers.map(async (srv) => {
      try {
        const client = await getMongoClient(srv.id);
        if (!client) return null;
        const col = client.db("master_smm").collection<OrderSmmDocument>("order_smm");
        const doc = await col.findOne(filter);
        return doc ? mapOrderDocs([doc], srv.id)[0] : null;
      } catch {
        return null;
      }
    });

    const results = await Promise.allSettled(promises);
    for (const res of results) {
      if (res.status === "fulfilled" && res.value) {
        return res.value;
      }
    }

    // Fallback: If not found in primary region (e.g. user was migrated or serverArea changed),
    // perform a quick check across all other configured servers
    const otherServers = getDiscoveredServers().filter(
      (s) => s.isConfigured && !regionServers.some((rs) => rs.id === s.id)
    );
    if (otherServers.length > 0) {
      const fallbackPromises = otherServers.map(async (srv) => {
        try {
          const client = await getMongoClient(srv.id);
          if (!client) return null;
          const col = client.db("master_smm").collection<OrderSmmDocument>("order_smm");
          const doc = await col.findOne(filter);
          return doc ? mapOrderDocs([doc], srv.id)[0] : null;
        } catch {
          return null;
        }
      });
      const fallbackResults = await Promise.allSettled(fallbackPromises);
      for (const res of fallbackResults) {
        if (res.status === "fulfilled" && res.value) {
          return res.value;
        }
      }
    }

    return null;
  } catch (error) {
    console.error(`[MongoDB] getOrderByIdForUser error:`, error);
    return null;
  }
}

/**
 * Retrieve multiple orders for a user given a list of IDs/invoices
 */
export async function getOrdersByIdsForUser(
  userUuid: string,
  orderIdentifiers: Array<number | string>,
  serverArea?: string
): Promise<Map<string, OrderSmmDocument>> {
  const resultMap = new Map<string, OrderSmmDocument>();
  if (!orderIdentifiers || orderIdentifiers.length === 0) return resultMap;

  try {
    const regionServers = getServersForRegion(serverArea);
    const numIds: number[] = [];
    const strIds: string[] = [];

    for (const raw of orderIdentifiers) {
      const str = String(raw).trim();
      if (!str) continue;
      const num = Number(str);
      if (!isNaN(num)) numIds.push(num);
      strIds.push(str);
    }

    const orConditions: any[] = [
      { invoice: { $in: strIds } },
      { order_id: { $in: strIds } },
    ];
    if (numIds.length > 0) {
      orConditions.push({ id: { $in: numIds } });
    }

    const filter = {
      uuid_user: userUuid,
      $or: orConditions,
    };

    const targetServers =
      regionServers.length > 0
        ? regionServers
        : [{ id: serverArea || "SG_1", isConfigured: true, group: "SG" } as any];

    const promises = targetServers.map(async (srv: any) => {
      try {
        const client = await getMongoClient(srv.id);
        if (!client) return [];
        const col = client.db("master_smm").collection<OrderSmmDocument>("order_smm");
        const docs = await col.find(filter).toArray();
        return mapOrderDocs(docs, srv.id);
      } catch {
        return [];
      }
    });

    const results = await Promise.allSettled(promises);
    for (const res of results) {
      if (res.status === "fulfilled" && Array.isArray(res.value)) {
        for (const doc of res.value) {
          resultMap.set(String(doc.id), doc);
          resultMap.set(doc.invoice, doc);
          if (doc.order_id) resultMap.set(doc.order_id, doc);
        }
      }
    }
  } catch (error) {
    console.error(`[MongoDB] getOrdersByIdsForUser error:`, error);
  }

  return resultMap;
}

function mapOrderDocs(docs: any[], defaultArea: string): OrderSmmDocument[] {
  return docs.map((doc: any) => ({
    id: doc.id,
    uuid_user: doc.uuid_user,
    uuid_api_provider: doc.uuid_api_provider || null,
    service_id: doc.service_id,
    invoice: doc.invoice,
    order_id: doc.order_id || null,
    amount: doc.amount,
    price_api: doc.price_api,
    price_sale: doc.price_sale,
    target: doc.target,
    remains: doc.remains ?? doc.amount,
    start: doc.start ?? 0,
    refill: Boolean(doc.refill),
    status: doc.status || "Pending",
    callback_url: doc.callback_url || null,
    callback_status: doc.callback_status || null,
    server_area: doc.server_area || defaultArea,
    create_at: doc.create_at ? new Date(doc.create_at) : new Date(),
    update_at: doc.update_at ? new Date(doc.update_at) : new Date(),
  }));
}

/**
 * Connect directly to a specific ServerNodeConfig node
 */
export async function getMongoClientByNode(node: ServerNodeConfig): Promise<MongoClient | null> {
  if (!node.uri || !node.isConfigured) return null;
  const clients = globalForMongo.mongoClients!;
  if (clients.has(node.uri)) {
    return clients.get(node.uri)!;
  }
  try {
    const client = new MongoClient(node.uri, {
      maxPoolSize: 15,
      serverSelectionTimeoutMS: 5000,
    });
    await client.connect();
    clients.set(node.uri, client);
    return client;
  } catch (error) {
    console.error(`[MongoDB] Failed to connect to node ${node.id}:`, error);
    return null;
  }
}

export interface AdminOrderQueryOptions {
  serverNode?: string; // "ALL" or "SG_1", "SG_2", etc.
  status?: string; // "ALL" or "Pending", "Processing", etc.
  search?: string;
  userUuids?: string[];
  page?: number;
  limit?: number;
}

export interface AdminOrderQueryResult {
  orders: OrderSmmDocument[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  serverCounts: Record<string, number>;
  statusCounts: Record<string, number>;
  totalOmset: number;
  totalModal: number;
  totalProfit: number;
  activeServers: Array<{
    id: string;
    group: string;
    regionName: string;
    flag: string;
    isOnline: boolean;
    pingMs: number | null;
    ordersCount: number;
  }>;
}

/**
 * Queries orders across ALL configured MongoDB cluster servers simultaneously.
 * Aggregates statistics, status distributions, and server allocations.
 */
export async function getAllOrdersAcrossAllServers(
  options: AdminOrderQueryOptions = {}
): Promise<AdminOrderQueryResult> {
  const {
    serverNode = "ALL",
    status = "ALL",
    search = "",
    userUuids = [],
    page = 1,
    limit = 20,
  } = options;

  const allServers = getDiscoveredServers().filter((s) => s.isConfigured);
  const targetServers =
    serverNode && serverNode !== "ALL"
      ? allServers.filter((s) => s.id.toUpperCase() === serverNode.toUpperCase())
      : allServers;

  // Build MongoDB query filter
  const mongoFilter: any = {};

  if (status && status !== "ALL") {
    mongoFilter.status = { $regex: new RegExp(`^${status}$`, "i") };
  }

  if (search.trim()) {
    const term = search.trim();
    const orConditions: any[] = [
      { invoice: { $regex: term, $options: "i" } },
      { order_id: { $regex: term, $options: "i" } },
      { target: { $regex: term, $options: "i" } },
      { service_id: { $regex: term, $options: "i" } },
    ];
    if (userUuids && userUuids.length > 0) {
      orConditions.push({ uuid_user: { $in: userUuids } });
    }
    mongoFilter.$or = orConditions;
  }

  const serverCounts: Record<string, number> = {};
  const statusCounts: Record<string, number> = {
    Pending: 0,
    Processing: 0,
    "In progress": 0,
    Completed: 0,
    Partial: 0,
    Canceled: 0,
  };

  let totalOmset = 0;
  let totalModal = 0;

  const serverHealthList: AdminOrderQueryResult["activeServers"] = [];
  const fetchedOrders: OrderSmmDocument[] = [];
  const seenInvoices = new Set<string>();

  // Query each server in parallel
  const promises = allServers.map(async (srv) => {
    const startPing = Date.now();
    let isOnline = false;
    let pingMs: number | null = null;
    let serverTotalOrders = 0;

    try {
      const client = await getMongoClientByNode(srv);
      if (client) {
        pingMs = Date.now() - startPing;
        isOnline = true;
        const col = client.db("master_smm").collection<OrderSmmDocument>("order_smm");

        // Server total orders count (unfiltered)
        serverTotalOrders = await col.countDocuments({});
        serverCounts[srv.id] = serverTotalOrders;

        // If this server is within targetServers, execute filtered search
        const isTarget = targetServers.some((ts) => ts.id === srv.id);
        if (isTarget) {
          const docs = await col
            .find(mongoFilter)
            .sort({ create_at: -1, id: -1 })
            .limit(500)
            .toArray();

          const mapped = mapOrderDocs(docs, srv.id);
          for (const item of mapped) {
            if (!seenInvoices.has(item.invoice)) {
              seenInvoices.add(item.invoice);
              fetchedOrders.push(item);

              // Accumulate totals
              totalOmset += Number(item.price_sale || 0);
              totalModal += Number(item.price_api || 0);

              // Status count
              const sKey = item.status || "Pending";
              statusCounts[sKey] = (statusCounts[sKey] || 0) + 1;
            }
          }
        }
      }
    } catch (err) {
      console.warn(`[MongoDB] Error reading from node ${srv.id}:`, err);
    }

    serverHealthList.push({
      id: srv.id,
      group: srv.group,
      regionName: srv.regionName,
      flag: srv.flag,
      isOnline,
      pingMs,
      ordersCount: serverTotalOrders,
    });
  });

  await Promise.allSettled(promises);

  // Sort orders descending by create_at
  fetchedOrders.sort(
    (a, b) => new Date(b.create_at).getTime() - new Date(a.create_at).getTime()
  );

  const totalMatched = fetchedOrders.length;
  const skip = (Math.max(1, page) - 1) * limit;
  const paginatedOrders = fetchedOrders.slice(skip, skip + limit);
  const totalPages = Math.ceil(totalMatched / limit) || 1;

  return {
    orders: paginatedOrders,
    total: totalMatched,
    page,
    limit,
    totalPages,
    serverCounts,
    statusCounts,
    totalOmset: Number(totalOmset.toFixed(4)),
    totalModal: Number(totalModal.toFixed(4)),
    totalProfit: Number((totalOmset - totalModal).toFixed(4)),
    activeServers: serverHealthList.sort((a, b) => a.id.localeCompare(b.id)),
  };
}

/**
 * Retrieves a single order document by invoice across all configured MongoDB cluster servers.
 */
export async function getOrderByInvoiceAcrossServers(
  invoice: string,
  serverArea?: string
): Promise<{ order: OrderSmmDocument; serverNode: ServerNodeConfig } | null> {
  const allServers = getDiscoveredServers().filter((s) => s.isConfigured);
  const targetServers =
    serverArea && serverArea !== "ALL"
      ? allServers.filter((s) => s.id.toUpperCase() === serverArea.toUpperCase())
      : allServers;

  for (const srv of targetServers) {
    try {
      const client = await getMongoClientByNode(srv);
      if (!client) continue;
      const col = client.db("master_smm").collection<OrderSmmDocument>("order_smm");
      const order = await col.findOne({ invoice });
      if (order) {
        return { order, serverNode: srv };
      }
    } catch (err) {
      console.warn(`[MongoDB] Find order error on node ${srv.id}:`, err);
    }
  }

  return null;
}

/**
 * Updates an order document across the cluster by invoice
 */
export async function updateOrderInAllServers(
  invoice: string,
  updates: Partial<OrderSmmDocument>,
  serverArea?: string
): Promise<boolean> {
  const allServers = getDiscoveredServers().filter((s) => s.isConfigured);
  const targetServers =
    serverArea && serverArea !== "ALL"
      ? allServers.filter((s) => s.id.toUpperCase() === serverArea.toUpperCase())
      : allServers;

  let updated = false;

  for (const srv of targetServers) {
    try {
      const client = await getMongoClientByNode(srv);
      if (!client) continue;
      const col = client.db("master_smm").collection<OrderSmmDocument>("order_smm");

      const updatePayload: any = {
        ...updates,
        update_at: new Date(),
      };
      delete updatePayload.id;
      delete updatePayload.invoice;

      const res = await col.updateOne({ invoice }, { $set: updatePayload });
      if (res.matchedCount > 0) {
        updated = true;
        break;
      }
    } catch (err) {
      console.warn(`[MongoDB] Update order error on node ${srv.id}:`, err);
    }
  }

  return updated;
}

/**
 * Backward compatibility alias
 */
export const saveOrderToMongo = async (
  order: OrderSmmDocument,
  serverArea?: string
): Promise<boolean> => {
  try {
    await createOrderInMongo(order, serverArea);
    return true;
  } catch {
    return false;
  }
};

/**
 * =============================================================================
 * REFILL SMM MONGO MODEL & OPERATIONS
 * =============================================================================
 */

export interface RefillSmmDocument {
  id: number;
  refill_id: string;
  invoice: string;
  order_id: string;
  service_id: string;
  service_name?: string;
  target: string;
  amount: number;
  uuid_user: string;
  uuid_api_provider: string | null;
  status: string; // "Pending", "In progress", "Completed", "Rejected", "Error"
  response_msg?: string | null;
  server_area?: string | null;
  create_at: Date;
  update_at: Date;
}

function mapRefillDocs(docs: any[], defaultArea: string): RefillSmmDocument[] {
  return docs.map((doc: any) => ({
    id: doc.id,
    refill_id: String(doc.refill_id ?? ""),
    invoice: String(doc.invoice ?? ""),
    order_id: String(doc.order_id ?? ""),
    service_id: String(doc.service_id ?? ""),
    service_name: doc.service_name || undefined,
    target: String(doc.target ?? ""),
    amount: Number(doc.amount || 0),
    uuid_user: String(doc.uuid_user ?? ""),
    uuid_api_provider: doc.uuid_api_provider ? String(doc.uuid_api_provider) : null,
    status: String(doc.status || "Pending"),
    response_msg: doc.response_msg || null,
    server_area: doc.server_area || defaultArea,
    create_at: doc.create_at ? new Date(doc.create_at) : new Date(),
    update_at: doc.update_at ? new Date(doc.update_at) : new Date(),
  }));
}

export async function getRefillSmmCollection(
  serverArea?: string,
  userIdentifier?: string
): Promise<Collection<RefillSmmDocument> | null> {
  const db = await getMongoDb(serverArea, userIdentifier);
  if (!db) return null;

  const collection = db.collection<RefillSmmDocument>("refill_smm");
  collection.createIndex({ id: 1 }, { unique: true, background: true }).catch(() => {});
  collection.createIndex({ refill_id: 1 }, { background: true }).catch(() => {});
  collection.createIndex({ uuid_user: 1 }, { background: true }).catch(() => {});
  collection.createIndex({ order_id: 1 }, { background: true }).catch(() => {});
  collection.createIndex({ invoice: 1 }, { background: true }).catch(() => {});
  return collection;
}

export async function createRefillInMongo(
  data: Partial<RefillSmmDocument> & {
    uuid_user: string;
    order_id: string;
    invoice: string;
  },
  serverArea?: string
): Promise<RefillSmmDocument> {
  const targetNode = serverArea || "SG";
  const col = await getRefillSmmCollection(targetNode, data.uuid_user);
  if (!col) {
    throw new Error(`[MongoDB] Cannot connect to refill collection for area "${targetNode}"`);
  }

  const nextId = data.id ?? (await getNextSequence("refill_smm", serverArea, data.uuid_user));
  const doc: RefillSmmDocument = {
    id: nextId,
    refill_id: String(data.refill_id || nextId),
    invoice: data.invoice,
    order_id: String(data.order_id),
    service_id: String(data.service_id || ""),
    service_name: data.service_name || undefined,
    target: data.target || "",
    amount: Number(data.amount || 0),
    uuid_user: data.uuid_user,
    uuid_api_provider: data.uuid_api_provider ?? null,
    status: data.status || "Pending",
    response_msg: data.response_msg || null,
    server_area: targetNode,
    create_at: data.create_at || new Date(),
    update_at: data.update_at || new Date(),
  };

  await col.insertOne(doc as any);
  return doc;
}

export async function getRefillsFromMongo(
  uuid_user?: string,
  limit: number = 50,
  serverArea?: string
): Promise<RefillSmmDocument[]> {
  try {
    const regionServers = getServersForRegion(serverArea);

    if (regionServers.length <= 1) {
      const col = await getRefillSmmCollection(serverArea, uuid_user);
      if (!col) return [];
      const filter = uuid_user ? { uuid_user } : {};
      const docs = await col.find(filter).sort({ create_at: -1, id: -1 }).limit(limit).toArray();
      return mapRefillDocs(docs, serverArea || "SG");
    }

    const queryPromises = regionServers.map(async (srv) => {
      try {
        const client = await getMongoClient(srv.id);
        if (!client) return [];
        const col = client.db("master_smm").collection<RefillSmmDocument>("refill_smm");
        const filter = uuid_user ? { uuid_user } : {};
        const docs = await col.find(filter).sort({ create_at: -1, id: -1 }).limit(limit).toArray();
        return mapRefillDocs(docs, srv.id);
      } catch {
        return [];
      }
    });

    const results = await Promise.allSettled(queryPromises);
    const combined: RefillSmmDocument[] = [];
    const seenIds = new Set<string>();

    for (const res of results) {
      if (res.status === "fulfilled" && Array.isArray(res.value)) {
        for (const item of res.value) {
          const key = `${item.invoice}_${item.refill_id}`;
          if (!seenIds.has(key)) {
            seenIds.add(key);
            combined.push(item);
          }
        }
      }
    }

    combined.sort((a, b) => new Date(b.create_at).getTime() - new Date(a.create_at).getTime());
    return combined.slice(0, limit);
  } catch (error) {
    console.error(`[MongoDB] Failed to query refills from region ${serverArea}:`, error);
    return [];
  }
}

export async function findRefillInMongo(
  refillIdentifier: string | number,
  serverArea?: string
): Promise<RefillSmmDocument | null> {
  const regionServers = getServersForRegion(serverArea);
  const numericId = Number(refillIdentifier);
  const isNum = !isNaN(numericId);

  const filter: any = {
    $or: [
      { refill_id: String(refillIdentifier) },
      ...(isNum ? [{ id: numericId }] : []),
    ],
  };

  for (const srv of regionServers) {
    try {
      const client = await getMongoClient(srv.id);
      if (!client) continue;
      const col = client.db("master_smm").collection<RefillSmmDocument>("refill_smm");
      const doc = await col.findOne(filter);
      if (doc) {
        return mapRefillDocs([doc], srv.id)[0];
      }
    } catch (err) {
      console.warn(`[MongoDB] Find refill error on node ${srv.id}:`, err);
    }
  }
  return null;
}

export async function updateRefillStatusInMongo(
  refillIdentifier: string | number,
  newStatus: string,
  serverArea?: string
): Promise<boolean> {
  const regionServers = getServersForRegion(serverArea);
  const numericId = Number(refillIdentifier);
  const isNum = !isNaN(numericId);

  const filter: any = {
    $or: [
      { refill_id: String(refillIdentifier) },
      ...(isNum ? [{ id: numericId }] : []),
    ],
  };

  let updated = false;
  for (const srv of regionServers) {
    try {
      const client = await getMongoClient(srv.id);
      if (!client) continue;
      const col = client.db("master_smm").collection<RefillSmmDocument>("refill_smm");
      const res = await col.updateOne(filter, {
        $set: {
          status: newStatus,
          update_at: new Date(),
        },
      });
      if (res.matchedCount > 0) {
        updated = true;
        break;
      }
    } catch (err) {
      console.warn(`[MongoDB] Update refill error on node ${srv.id}:`, err);
    }
  }
  return updated;
}
