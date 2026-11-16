import { NextResponse } from "next/server";
import { connection } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/auth";
import { syncActiveOrdersFromProviders } from "@/lib/order-sync";
import { recordTrace } from "@/lib/trace-logger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Validates request authorization:
 * 1. Bearer token matches CRON_SECRET (Vercel Cron standard)
 * 2. URL query param ?key=... matches CRON_SECRET
 * 3. Header x-cron-secret matches CRON_SECRET
 * 4. Active Admin session cookie
 * 5. Open in development mode if CRON_SECRET is not configured
 */
async function isAuthorized(request: Request): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET;

  // If no CRON_SECRET set in environment, allow execution in dev or fallback
  if (!cronSecret) {
    return true;
  }

  // 1. Check Bearer Authorization Header
  const authHeader = request.headers.get("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7).trim();
    if (token === cronSecret) return true;
  }

  // 2. Check x-cron-secret Header
  const headerSecret = request.headers.get("x-cron-secret");
  if (headerSecret && headerSecret.trim() === cronSecret) {
    return true;
  }

  // 3. Check Query parameter ?key=...
  try {
    const url = new URL(request.url);
    const keyParam = url.searchParams.get("key");
    if (keyParam && keyParam.trim() === cronSecret) {
      return true;
    }
  } catch {}

  // 4. Check Admin Session Cookie
  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get("user_session")?.value;
    if (sessionToken) {
      const session = await verifySessionToken(sessionToken);
      if (session && session.level === "Admin") {
        return true;
      }
    }
  } catch {}

  return false;
}

async function handleCronExecution(request: Request) {
  await connection();
  const startTime = Date.now();

  // Verify access
  const authorized = await isAuthorized(request);
  if (!authorized) {
    return NextResponse.json(
      {
        success: false,
        message: "Unauthorized: Invalid or missing CRON_SECRET token.",
      },
      { status: 401 }
    );
  }

  try {
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get("limit") || "50", 10);
    const serverArea = url.searchParams.get("server_area") || "ALL";

    // Run active order status synchronization
    const result = await syncActiveOrdersFromProviders({
      limit: isNaN(limit) ? 50 : limit,
      serverArea,
    });

    // Record system trace log
    recordTrace({
      type: "smm",
      action: "CRON_ORDER_STATUS_UPDATE",
      status: "SUCCESS",
      status_code: 200,
      endpoint: "/api/cron/order-status",
      method: request.method,
      request_payload: { limit, serverArea },
      response_payload: {
        processed: result.totalProcessed,
        updated: result.totalUpdated,
        completed: result.totalCompleted,
        canceled: result.totalCanceled,
        partial: result.totalPartial,
        refunded_amount: result.totalRefundedAmount,
      },
      latency_ms: result.durationMs,
      metadata: {
        cron: true,
        errors_count: result.errors.length,
      },
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      summary: {
        processed: result.totalProcessed,
        updated: result.totalUpdated,
        completed: result.totalCompleted,
        canceled: result.totalCanceled,
        partial: result.totalPartial,
        refunded_usd: result.totalRefundedAmount,
        errors_count: result.errors.length,
        duration_ms: result.durationMs,
      },
      details: result.details,
      errors: result.errors.length > 0 ? result.errors : undefined,
    });
  } catch (error: any) {
    console.error("[Cron Order Status] Error:", error);

    recordTrace({
      type: "smm",
      action: "CRON_ORDER_STATUS_UPDATE",
      status: "FAILED",
      status_code: 500,
      endpoint: "/api/cron/order-status",
      method: request.method,
      error_message: error?.message || String(error),
      latency_ms: Date.now() - startTime,
      metadata: { cron: true },
    }).catch(() => {});

    return NextResponse.json(
      {
        success: false,
        message: error?.message || "Internal server error during order status sync.",
      },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  return handleCronExecution(request);
}

export async function POST(request: Request) {
  return handleCronExecution(request);
}

