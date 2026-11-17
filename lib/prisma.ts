import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  pgPool: Pool | undefined;
};

/**
 * Normalizes PostgreSQL connection string to eliminate the pg-connection-string
 * deprecation warning (upgrading sslmode=require/prefer/verify-ca to verify-full).
 */
function normalizeConnectionString(rawUrl?: string): string | undefined {
  if (!rawUrl) return rawUrl;
  try {
    const parsed = new URL(rawUrl);
    const sslmode = parsed.searchParams.get("sslmode");
    if (sslmode === "require" || sslmode === "prefer" || sslmode === "verify-ca") {
      parsed.searchParams.set("sslmode", "verify-full");
      return parsed.toString();
    }
    return rawUrl;
  } catch {
    return rawUrl.replace(/sslmode=(?:require|prefer|verify-ca)/g, "sslmode=verify-full");
  }
}

const getOrCreatePool = (): Pool => {
  if (globalForPrisma.pgPool) {
    return globalForPrisma.pgPool;
  }

  const rawConnectionString = process.env.DATABASE_URL;
  if (!rawConnectionString) {
    throw new Error("DATABASE_URL is not defined in environment variables");
  }

  const connectionString = normalizeConnectionString(rawConnectionString);

  // Configure high-performance persistent connection pooling with TCP keep-alive
  const pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    keepAlive: true,
  });

  globalForPrisma.pgPool = pool;
  return pool;
};

const createPrismaClient = () => {
  const pool = getOrCreatePool();
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
};

// Reuse Prisma client and connection pool globally to prevent TLS handshake lag and connection exhaustion
export const prisma = globalForPrisma.prisma ?? createPrismaClient();
export const db = prisma;

globalForPrisma.prisma = prisma;

export default prisma;
