import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySessionToken } from "@/lib/auth";
import { submitRefillToProvider } from "@/lib/provider-api";
import {
  getOrderByIdForUser,
  createRefillInMongo,
  getRefillsFromMongo,
} from "@/lib/mongodb";

/**
 * GET /api/member/refill
 * Retrieves the logged-in member's refill history from MongoDB
 */
export async function GET(request: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("user_session")?.value;
    const session = await verifySessionToken(token);

    if (!session?.uuid) {
      return NextResponse.json(
        { success: false, message: "Unauthorized. Please log in first." },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 100);

    const user = await prisma.user.findUnique({
      where: { uuid: session.uuid },
      select: { server_area: true },
    });

    const userRegion = user?.server_area || "SG";
    const refills = await getRefillsFromMongo(session.uuid, limit, userRegion);

    return NextResponse.json({
      success: true,
      data: refills,
    });
  } catch (error) {
    console.error("GET /api/member/refill error:", error);
    const message = error instanceof Error ? error.message : "Failed to retrieve refill records.";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}

/**
 * POST /api/member/refill
 * Submits a refill request for an order to the SMM provider API
 * Body: { order_id: string | number } (can be invoice, numeric id, or provider order_id)
 */
export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("user_session")?.value;
    const session = await verifySessionToken(token);

    if (!session?.uuid) {
      return NextResponse.json(
        { success: false, message: "Unauthorized. Please log in first." },
        { status: 401 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { order_id, invoice } = body;
    const orderIdentifier = order_id || invoice;

    if (!orderIdentifier) {
      return NextResponse.json(
        { success: false, message: "Order ID or Invoice is required." },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { uuid: session.uuid },
      select: { id: true, uuid: true, username: true, server_area: true },
    });

    if (!user) {
      return NextResponse.json(
        { success: false, message: "User account not found." },
        { status: 404 }
      );
    }

    const userRegion = user.server_area || "SG";

    // 1. Find the order in MongoDB
    const order = await getOrderByIdForUser(session.uuid, orderIdentifier, userRegion);

    if (!order) {
      return NextResponse.json(
        { success: false, message: `Order '${orderIdentifier}' was not found in your account.` },
        { status: 404 }
      );
    }

    if (!order.order_id) {
      return NextResponse.json(
        { success: false, message: "This order does not have an external provider order ID yet." },
        { status: 400 }
      );
    }

    const normalizedStatus = (order.status || "").toLowerCase();
    if (normalizedStatus === "canceled" || normalizedStatus === "error") {
      return NextResponse.json(
        { success: false, message: `Cannot request a refill for an order with status '${order.status}'.` },
        { status: 400 }
      );
    }

    // 2. Fetch service & provider configuration from PostgreSQL
    const serviceNumericId = parseInt(String(order.service_id), 10);
    const service = await prisma.service.findFirst({
      where: isNaN(serviceNumericId)
        ? { service_id: String(order.service_id) }
        : { OR: [{ id: serviceNumericId }, { service_id: String(order.service_id) }] },
      include: {
        api_provider: true,
      },
    });

    if (!service || !service.api_provider || !service.api_provider.url || !service.api_provider.api_key) {
      return NextResponse.json(
        {
          success: false,
          message: "API Provider for this service is not configured or missing credentials.",
        },
        { status: 400 }
      );
    }

    // 3. Send refill request to the SMM provider API
    // Request: action='refill', order='$order_id'
    const providerResult = await submitRefillToProvider({
      url: service.api_provider.url,
      apiKey: service.api_provider.api_key,
      orderId: order.order_id,
    });

    if (!providerResult.success) {
      return NextResponse.json(
        {
          success: false,
          message: providerResult.error || "Provider rejected the refill request.",
          raw: providerResult.rawResponse,
        },
        { status: 400 }
      );
    }

    const providerRefillId = providerResult.refillId ? String(providerResult.refillId) : "1";

    // 4. Record the refill in MongoDB
    const refillDoc = await createRefillInMongo(
      {
        refill_id: providerRefillId,
        invoice: order.invoice,
        order_id: String(order.order_id),
        service_id: order.service_id,
        service_name: service.service_name,
        target: order.target,
        amount: order.amount,
        uuid_user: user.uuid,
        uuid_api_provider: service.api_provider.uuid,
        status: "Pending",
        server_area: order.server_area || userRegion,
      },
      userRegion
    );

    // 5. Trigger Pusher notifications if available
    try {
      const { pusherServer } = await import("@/lib/pusher");
      await pusherServer.trigger(`member-${user.uuid}`, "refill-created", {
        refill_id: refillDoc.refill_id,
        invoice: refillDoc.invoice,
        order_id: refillDoc.order_id,
        service_name: service.service_name,
        status: "Pending",
        created_at: refillDoc.create_at,
      });
      await pusherServer.trigger("admin-notifications", "refill-requested", {
        username: user.username,
        invoice: refillDoc.invoice,
        order_id: refillDoc.order_id,
        refill_id: refillDoc.refill_id,
      });
    } catch (pushErr) {
      // Ignore notification warning
    }

    return NextResponse.json({
      success: true,
      message: `Refill #${providerRefillId} submitted successfully to provider!`,
      data: refillDoc,
    });
  } catch (error) {
    console.error("POST /api/member/refill error:", error);
    const message = error instanceof Error ? error.message : "Failed to submit refill request.";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
