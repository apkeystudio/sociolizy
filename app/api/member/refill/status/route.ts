import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySessionToken } from "@/lib/auth";
import { checkRefillStatusFromProvider } from "@/lib/provider-api";
import { findRefillInMongo, updateRefillStatusInMongo } from "@/lib/mongodb";

/**
 * POST /api/member/refill/status
 * Queries live refill status from provider and updates MongoDB
 * Body: { refill_id: string } or { id: number }
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
    const { refill_id, id } = body;
    const identifier = refill_id || id;

    if (!identifier) {
      return NextResponse.json(
        { success: false, message: "Refill ID is required." },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { uuid: session.uuid },
      select: { server_area: true },
    });

    const userRegion = user?.server_area || "SG";

    // 1. Find refill record
    const refill = await findRefillInMongo(identifier, userRegion);
    if (!refill) {
      return NextResponse.json(
        { success: false, message: `Refill #${identifier} was not found.` },
        { status: 404 }
      );
    }

    // Security check: ensure refill belongs to the authenticated user
    if (refill.uuid_user !== session.uuid) {
      return NextResponse.json(
        { success: false, message: "Access denied." },
        { status: 403 }
      );
    }

    // 2. Fetch provider configuration
    const serviceNumericId = parseInt(String(refill.service_id), 10);
    const service = await prisma.service.findFirst({
      where: isNaN(serviceNumericId)
        ? { service_id: String(refill.service_id) }
        : { OR: [{ id: serviceNumericId }, { service_id: String(refill.service_id) }] },
      include: {
        api_provider: true,
      },
    });

    if (!service?.api_provider?.url || !service?.api_provider?.api_key) {
      return NextResponse.json(
        { success: false, message: "API Provider for this service is not configured." },
        { status: 400 }
      );
    }

    // 3. Check refill status from provider
    // Request: action='refill_status', order='$refill_id'
    const statusResult = await checkRefillStatusFromProvider({
      url: service.api_provider.url,
      apiKey: service.api_provider.api_key,
      refillId: refill.refill_id,
    });

    if (!statusResult.success || !statusResult.status) {
      return NextResponse.json(
        {
          success: false,
          message: statusResult.error || "Failed to retrieve status from provider.",
          currentStatus: refill.status,
        },
        { status: 400 }
      );
    }

    const newStatus = statusResult.status;

    // 4. Update MongoDB if status changed
    if (newStatus !== refill.status) {
      await updateRefillStatusInMongo(refill.refill_id, newStatus, userRegion);
    }

    return NextResponse.json({
      success: true,
      status: newStatus,
      message: `Refill #${refill.refill_id} status is: ${newStatus}`,
    });
  } catch (error) {
    console.error("POST /api/member/refill/status error:", error);
    const message = error instanceof Error ? error.message : "Failed to check refill status.";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
