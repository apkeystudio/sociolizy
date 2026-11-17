import crypto from "crypto";
import { updateOrderInAllServers, OrderSmmDocument } from "@/lib/mongodb";

export interface WebhookOrderPayload {
  event: "order.created" | "order.updated" | "order.completed" | "order.canceled" | "order.partial" | "ping";
  order: number | string;
  order_id?: string | number | null;
  invoice: string;
  service_id: string;
  status: string;
  order_status?: string;
  charge: string;
  start_count: number;
  start?: number;
  remains: number;
  currency: string;
  target?: string;
  timestamp: string;
}

export interface DispatchResult {
  success: boolean;
  statusCode?: number;
  error?: string;
  durationMs?: number;
}

/**
 * Dispatches an automated callback/webhook to the client's callback URL
 * whenever an order status is updated, completed, canceled, or modified.
 */
export async function dispatchOrderWebhook(
  order: OrderSmmDocument,
  apiKey?: string | null,
  event: WebhookOrderPayload["event"] = "order.updated"
): Promise<DispatchResult> {
  let callbackUrl = (order.callback_url || "").trim();
  if (!callbackUrl) {
    return { success: false, error: "No valid callback URL provided for this order" };
  }
  if (!callbackUrl.startsWith("http://") && !callbackUrl.startsWith("https://")) {
    callbackUrl = `https://${callbackUrl}`;
  }

  const rawStatus = order.status || "Pending";
  const lowerStatus = rawStatus.toLowerCase();

  const payload: WebhookOrderPayload = {
    event,
    order: order.id,
    order_id: order.order_id || order.id,
    invoice: order.invoice,
    service_id: String(order.service_id),
    status: lowerStatus,
    order_status: rawStatus,
    charge: Number(order.price_sale || 0).toFixed(4),
    start_count: order.start ?? 0,
    start: order.start ?? 0,
    remains: order.remains ?? 0,
    currency: "USD",
    target: order.target,
    timestamp: new Date().toISOString(),
  };

  const bodyString = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "Master-SMM-Webhook-Engine/1.0",
    "X-SMM-Event": event,
    "X-SMM-Delivery": crypto.randomUUID(),
  };

  // If apiKey is available, sign payload using HMAC-SHA256 for integrity verification
  if (apiKey) {
    const signature = crypto.createHmac("sha256", apiKey).update(bodyString).digest("hex");
    headers["X-SMM-Signature"] = signature;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000); // 6s timeout
  const startTime = Date.now();

  try {
    const response = await fetch(callbackUrl, {
      method: "POST",
      headers,
      body: bodyString,
      signal: controller.signal,
      redirect: "follow",
    });

    const durationMs = Date.now() - startTime;
    const isSuccess = response.ok;
    let responseSnippet = "";
    try {
      const text = await response.text();
      if (text) {
        responseSnippet = text.trim().slice(0, 100);
      }
    } catch {}

    const statusRecord = isSuccess ? "sent" : `failed_${response.status}`;

    // Record delivery status and effective callback_url back into the order document
    updateOrderInAllServers(
      order.invoice,
      {
        callback_url: callbackUrl,
        callback_status: statusRecord,
      },
      order.server_area || undefined
    ).catch(() => {});

    return {
      success: isSuccess,
      statusCode: response.status,
      durationMs,
      error: isSuccess
        ? undefined
        : `Target server responded with HTTP ${response.status}${responseSnippet ? `: ${responseSnippet}` : ""}`,
    };
  } catch (error: any) {
    const durationMs = Date.now() - startTime;
    const errorMsg = error?.name === "AbortError" ? "Connection timed out (6s limit)" : error?.message || "Delivery failed";

    updateOrderInAllServers(
      order.invoice,
      {
        callback_url: callbackUrl,
        callback_status: "failed_timeout",
      },
      order.server_area || undefined
    ).catch(() => {});

    return {
      success: false,
      error: errorMsg,
      durationMs,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Sends a test ping webhook to verify client's webhook endpoint
 */
export async function sendTestWebhookPing(
  callbackUrl: string,
  apiKey?: string | null
): Promise<DispatchResult> {
  if (!callbackUrl || !callbackUrl.startsWith("http")) {
    return { success: false, error: "Invalid URL (must start with http:// or https://)" };
  }

  const payload = {
    event: "ping",
    message: "Master SMM Webhook connection test successful",
    timestamp: new Date().toISOString(),
    sample_order: {
      order: 1001,
      invoice: "INV-TEST-0001",
      status: "completed",
      charge: "0.5000",
      start_count: 500,
      remains: 0,
      currency: "USD",
    },
  };

  const bodyString = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "Master-SMM-Webhook-Engine/1.0",
    "X-SMM-Event": "ping",
    "X-SMM-Delivery": crypto.randomUUID(),
  };

  if (apiKey) {
    const signature = crypto.createHmac("sha256", apiKey).update(bodyString).digest("hex");
    headers["X-SMM-Signature"] = signature;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);
  const startTime = Date.now();

  try {
    const response = await fetch(callbackUrl, {
      method: "POST",
      headers,
      body: bodyString,
      signal: controller.signal,
    });

    const durationMs = Date.now() - startTime;
    return {
      success: response.ok,
      statusCode: response.status,
      durationMs,
      error: response.ok ? undefined : `Target server returned HTTP ${response.status}`,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.name === "AbortError" ? "Connection timed out (6s limit)" : err?.message || "Connection failed",
      durationMs: Date.now() - startTime,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

