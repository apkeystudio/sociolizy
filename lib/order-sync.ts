import { prisma } from "@/lib/prisma";
import {
  OrderSmmDocument,
  getMongoClientByNode,
  updateOrderInAllServers,
} from "@/lib/mongodb";
import { getDiscoveredServers, ServerNodeConfig } from "@/lib/server-db";
import {
  checkOrderStatusFromProvider,
  normalizeOrderStatus,
  calculateOrderRefund,
} from "@/lib/provider-api";

export interface SyncOrdersOptions {
  limit?: number;
  serverArea?: string;
  invoices?: string[];
}

export interface SyncOrdersResult {
  totalProcessed: number;
  totalUpdated: number;
  totalCompleted: number;
  totalCanceled: number;
  totalPartial: number;
  totalRefundedAmount: number;
  durationMs: number;
  details: Array<{
    invoice: string;
    orderId?: string | null;
    serviceId?: string;
    providerName?: string;
    oldStatus: string;
    newStatus: string;
    remains: number;
    startCount: number;
    refunded: boolean;
    refundAmount: number;
  }>;
  errors: Array<{
    invoice: string;
    error: string;
  }>;
}

/**
 * Scans all MongoDB server clusters for active orders and updates their statuses from SMM Provider APIs.
 * Automatically processes balance refunds if status changes to Canceled or Partial.
 */
export async function syncActiveOrdersFromProviders(
  options: SyncOrdersOptions = {}
): Promise<SyncOrdersResult> {
  const startTime = Date.now();
  const limit = Math.min(200, Math.max(1, options.limit || 50));
  const serverArea = options.serverArea || "ALL";

  const allServers = getDiscoveredServers().filter((s: ServerNodeConfig) => s.isConfigured);
  const targetServers =
    serverArea && serverArea !== "ALL"
      ? allServers.filter((s: ServerNodeConfig) => s.id.toUpperCase() === serverArea.toUpperCase())
      : allServers;

  // Statuses that need checking
  const activeStatuses = [
    "Pending",
    "Processing",
    "In progress",
    "pending",
    "processing",
    "in progress",
  ];

  const mongoFilter: any = {
    status: { $in: activeStatuses },
    order_id: { $ne: null, $nin: ["", "0", null] },
  };

  if (options.invoices && options.invoices.length > 0) {
    mongoFilter.invoice = { $in: options.invoices };
  }

  // 1. Gather active orders across all servers
  const collectedOrders: Array<{ order: OrderSmmDocument; nodeArea: string }> = [];
  const seenInvoices = new Set<string>();

  for (const srv of targetServers) {
    if (collectedOrders.length >= limit) break;
    try {
      const client = await getMongoClientByNode(srv);
      if (!client) continue;

      const col = client.db("master_smm").collection<OrderSmmDocument>("order_smm");
      const docs = await col
        .find(mongoFilter)
        .sort({ update_at: 1, create_at: 1 })
        .limit(limit - collectedOrders.length)
        .toArray();

      for (const doc of docs) {
        if (!seenInvoices.has(doc.invoice)) {
          seenInvoices.add(doc.invoice);
          collectedOrders.push({
            order: {
              ...doc,
              create_at: doc.create_at ? new Date(doc.create_at) : new Date(),
              update_at: doc.update_at ? new Date(doc.update_at) : new Date(),
            },
            nodeArea: srv.id,
          });
        }
      }
    } catch (err: any) {
      console.warn(`[OrderSync] Error querying active orders on node ${srv.id}:`, err?.message);
    }
  }

  if (collectedOrders.length === 0) {
    return {
      totalProcessed: 0,
      totalUpdated: 0,
      totalCompleted: 0,
      totalCanceled: 0,
      totalPartial: 0,
      totalRefundedAmount: 0,
      durationMs: Date.now() - startTime,
      details: [],
      errors: [],
    };
  }

  // 2. Pre-fetch API Providers & Services for lookup
  const [providers, services] = await Promise.all([
    prisma.apiProvider.findMany(),
    prisma.service.findMany({
      include: { api_provider: true },
    }),
  ]);

  const providerByUuid = new Map<string, any>();
  const providerById = new Map<number, any>();
  providers.forEach((p) => {
    if (p.uuid) providerByUuid.set(p.uuid, p);
    providerById.set(p.id, p);
  });

  const serviceMap = new Map<string, any>();
  services.forEach((s) => {
    if (s.service_id) serviceMap.set(s.service_id, s);
    serviceMap.set(String(s.id), s);
  });

  const details: SyncOrdersResult["details"] = [];
  const errors: SyncOrdersResult["errors"] = [];
  let totalUpdated = 0;
  let totalCompleted = 0;
  let totalCanceled = 0;
  let totalPartial = 0;
  let totalRefundedAmount = 0;

  // 3. Process each active order
  for (const item of collectedOrders) {
    const { order, nodeArea } = item;

    if (!order.order_id) {
      continue;
    }

    // Resolve provider
    let provider: any = null;
    if (order.uuid_api_provider && providerByUuid.has(order.uuid_api_provider)) {
      provider = providerByUuid.get(order.uuid_api_provider);
    }

    if (!provider && order.service_id && serviceMap.has(order.service_id)) {
      const s = serviceMap.get(order.service_id);
      provider = s.api_provider;
    }

    if (!provider || !provider.url || !provider.api_key) {
      errors.push({
        invoice: order.invoice,
        error: "Provider API tidak ditemukan atau belum memiliki API Key.",
      });
      continue;
    }

    // Query status from Provider
    try {
      const providerRes = await checkOrderStatusFromProvider({
        url: provider.url,
        apiKey: provider.api_key,
        orderId: order.order_id,
      });

      if (!providerRes.success || !providerRes.status) {
        errors.push({
          invoice: order.invoice,
          error: providerRes.error || "Gagal mendapatkan respon valid dari provider.",
        });
        continue;
      }

      const rawStatus = providerRes.status;
      const normalizedStatus = normalizeOrderStatus(rawStatus);
      const remains =
        providerRes.remains !== undefined ? Number(providerRes.remains) : order.remains;
      const startCount =
        providerRes.startCount !== undefined ? Number(providerRes.startCount) : order.start;

      const isStatusChanged = normalizedStatus.toLowerCase() !== (order.status || "").toLowerCase();
      const isRemainsChanged = remains !== order.remains;
      const isStartChanged = startCount !== order.start;

      if (isStatusChanged || isRemainsChanged || isStartChanged) {
        // Calculate refund if Canceled or Partial
        const refundCalc = calculateOrderRefund(order, normalizedStatus, remains);

        let refundApplied = false;
        if (refundCalc.shouldRefund && refundCalc.refundAmount > 0 && order.uuid_user) {
          try {
            await prisma.user.update({
              where: { uuid: order.uuid_user },
              data: {
                balance: {
                  increment: refundCalc.refundAmount,
                },
              },
            });
            refundApplied = true;
            totalRefundedAmount += refundCalc.refundAmount;
          } catch (uErr: any) {
            console.error(`[OrderSync] Refund error for user ${order.uuid_user}:`, uErr?.message);
          }
        }

        // Update in MongoDB
        const updateData: Partial<OrderSmmDocument> = {
          status: normalizedStatus,
          remains,
          start: startCount,
          refund_amount: refundCalc.totalRefundDue,
          refunded: refundCalc.totalRefundDue > 0,
          update_at: new Date(),
        };

        await updateOrderInAllServers(order.invoice, updateData, nodeArea);

        totalUpdated++;
        if (normalizedStatus === "Completed") totalCompleted++;
        else if (normalizedStatus === "Canceled") totalCanceled++;
        else if (normalizedStatus === "Partial") totalPartial++;

        // Pusher Realtime Broadcast
        try {
          const { pusherServer } = await import("@/lib/pusher");
          const payload = {
            invoice: order.invoice,
            status: normalizedStatus,
            remains,
            start: startCount,
            refunded: refundCalc.shouldRefund,
            refund_amount: refundCalc.refundAmount,
          };

          if (order.uuid_user) {
            await pusherServer.trigger(`member-${order.uuid_user}`, "order-status-updated", payload);
            if (refundApplied) {
              await pusherServer.trigger(`member-${order.uuid_user}`, "balance-updated", {
                refund_amount: refundCalc.refundAmount,
                reason: `Refund pesanan #${order.invoice} (${normalizedStatus})`,
              });
            }
          }
          await pusherServer.trigger("admin-orders", "order-status-updated", payload);
          await pusherServer.trigger("admin-notifications", "order-status-updated", payload);
        } catch {}

        // Automated Webhook / Callback trigger to client endpoint
        try {
          let userRecordForCb: { callback_url: string | null; api_key: string | null } | null = null;
          if (order.uuid_user) {
            userRecordForCb = await prisma.user.findUnique({
              where: { uuid: order.uuid_user },
              select: { callback_url: true, api_key: true },
            });
          }

          const effectiveCbUrl = order.callback_url || userRecordForCb?.callback_url || null;
          if (effectiveCbUrl) {
            const { dispatchOrderWebhook } = await import("@/lib/webhook-dispatcher");
            dispatchOrderWebhook(
              {
                ...order,
                ...updateData,
                callback_url: effectiveCbUrl,
              },
              userRecordForCb?.api_key || null,
              "order.updated"
            ).catch(() => {});
          }
        } catch {}

        details.push({
          invoice: order.invoice,
          orderId: order.order_id,
          serviceId: order.service_id,
          providerName: provider.name || provider.slug,
          oldStatus: order.status,
          newStatus: normalizedStatus,
          remains,
          startCount,
          refunded: refundApplied,
          refundAmount: refundCalc.refundAmount,
        });
      } else {
        // Just touch update_at so next cron cycle prioritizes other orders
        await updateOrderInAllServers(order.invoice, { update_at: new Date() }, nodeArea);
      }
    } catch (err: any) {
      errors.push({
        invoice: order.invoice,
        error: err?.message || String(err),
      });
    }
  }

  return {
    totalProcessed: collectedOrders.length,
    totalUpdated,
    totalCompleted,
    totalCanceled,
    totalPartial,
    totalRefundedAmount: Number(totalRefundedAmount.toFixed(4)),
    durationMs: Date.now() - startTime,
    details,
    errors,
  };
}
