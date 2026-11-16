import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getMerchantGatewaySettings,
  calculateMerchantFees,
  createCryptomusDirectPayment,
  DEFAULT_SUPPORTED_COINS,
} from "@/lib/merchant-gateway";
import crypto from "crypto";
import { traceMerchantApi, extractClientIp } from "@/lib/trace-logger";

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  const ip = extractClientIp(req);
  const userAgent = req.headers.get("user-agent");

  try {
    const apiKey =
      req.headers.get("x-api-key") ||
      req.headers.get("authorization")?.replace("Bearer ", "");
    const secretKey = req.headers.get("x-secret-key");

    if (!apiKey) {
      traceMerchantApi({
        action: "INVOICE_CREATE",
        status: "FAILED",
        status_code: 401,
        ip,
        user_agent: userAgent,
        endpoint: "/api/v1/gateway/invoices/create",
        method: "POST",
        error_message: "Missing API Key header",
        latency_ms: Date.now() - startTime,
      });

      return NextResponse.json(
        { success: false, message: "Missing API Key header (x-api-key or Authorization Bearer)" },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const {
      order_id,
      amount,
      currency = "USD",
      to_currency,
      network,
      description,
      customer_email,
      return_url,
      callback_url,
    } = body;

    if (!order_id || !amount || Number(amount) <= 0) {
      return NextResponse.json(
        { success: false, message: "Parameters 'order_id' and 'amount' (> 0) are required." },
        { status: 400 }
      );
    }

    // Verify website & merchant
    const website = await prisma.merchantWebsite.findUnique({
      where: { apiKey },
      include: {
        merchant: true,
      },
    });

    if (!website || website.status !== "ACTIVE" || website.merchant.status !== "ACTIVE") {
      return NextResponse.json(
        { success: false, message: "Invalid API Key or merchant website is inactive." },
        { status: 401 }
      );
    }

    if (secretKey && website.secretKey !== secretKey) {
      return NextResponse.json(
        { success: false, message: "Secret Key does not match." },
        { status: 401 }
      );
    }

    const amountUsd = Number(amount);
    const settings = await getMerchantGatewaySettings();
    const feeInfo = calculateMerchantFees(
      amountUsd,
      Number(settings.adminFeePercent),
      Number(settings.adminFeeFixed)
    );

    const invoiceUuid = crypto.randomUUID();
    const appBaseUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      req.headers.get("origin") ||
      `http://${req.headers.get("host")}`;

    const internalWebhook = `${appBaseUrl}/api/gateway/cryptomus/webhook`;
    const checkoutUrl = `${appBaseUrl}/pay/${invoiceUuid}`;

    let payAddress: string | null = null;
    let cryptoAmount: number | null = null;
    let cryptoCurrency: string | null = null;
    let cryptoNetwork: string | null = null;
    let cryptomusOrderId: string | null = null;

    // If to_currency & network are provided, we can pre-generate the crypto payment address immediately
    if (to_currency && network) {
      try {
        const cryptoPayment = await createCryptomusDirectPayment({
          amountUsd,
          orderId: invoiceUuid,
          cryptoCurrency: to_currency,
          cryptoNetwork: network,
          callbackUrl: internalWebhook,
          returnUrl: return_url || website.returnUrl || undefined,
        });

        payAddress = cryptoPayment.payAddress;
        cryptoAmount = cryptoPayment.cryptoAmount;
        cryptoCurrency = cryptoPayment.cryptoCurrency;
        cryptoNetwork = cryptoPayment.cryptoNetwork;
        cryptomusOrderId = cryptoPayment.cryptomusOrderId;
      } catch (err: any) {
        console.warn("Direct address pre-generation deferred to checkout view:", err?.message);
      }
    }

    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    const tx = await prisma.merchantTransaction.create({
      data: {
        uuid: invoiceUuid,
        orderId: String(order_id),
        merchantId: website.merchantId,
        websiteId: website.id,
        amountUsd,
        adminFee: feeInfo.adminFee,
        netAmountUsd: feeInfo.netAmountUsd,
        cryptoCurrency,
        cryptoNetwork,
        cryptoAmount,
        payAddress,
        cryptomusOrderId: cryptomusOrderId || invoiceUuid,
        paymentStatus: "PENDING",
        description: description || `Order #${order_id}`,
        customerEmail: customer_email || null,
        returnUrl: return_url || website.returnUrl || null,
        callbackUrl: callback_url || website.webhookUrl || null,
        expiresAt,
        rawPayload: JSON.stringify(body),
      },
    });

    traceMerchantApi({
      action: "INVOICE_CREATE",
      status: "SUCCESS",
      status_code: 200,
      user_id: website.merchant.userId,
      username: website.merchant.name,
      ip,
      user_agent: userAgent,
      endpoint: "/api/v1/gateway/invoices/create",
      method: "POST",
      request_payload: body,
      response_payload: { invoice_id: tx.uuid, order_id: tx.orderId, amount_usd: Number(tx.amountUsd) },
      latency_ms: Date.now() - startTime,
    });

    return NextResponse.json({
      success: true,
      data: {
        invoice_id: tx.uuid,
        order_id: tx.orderId,
        amount_usd: Number(tx.amountUsd),
        admin_fee: Number(tx.adminFee),
        net_amount_usd: Number(tx.netAmountUsd),
        checkout_url: checkoutUrl,
        pay_address: tx.payAddress,
        crypto_amount: tx.cryptoAmount ? Number(tx.cryptoAmount) : null,
        crypto_currency: tx.cryptoCurrency,
        crypto_network: tx.cryptoNetwork,
        status: tx.paymentStatus,
        expires_at: tx.expiresAt,
      },
    });
  } catch (error: any) {
    console.error("Gateway invoice creation error:", error);
    traceMerchantApi({
      action: "INVOICE_CREATE",
      status: "FAILED",
      status_code: 500,
      ip,
      user_agent: userAgent,
      endpoint: "/api/v1/gateway/invoices/create",
      method: "POST",
      error_message: error?.message || "Internal server error",
      latency_ms: Date.now() - startTime,
    });

    return NextResponse.json(
      { success: false, message: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}

