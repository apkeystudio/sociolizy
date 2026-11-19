import { NextResponse, connection } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifySessionToken } from "@/lib/auth";
import { getOrdersFinancialReportData } from "@/lib/mongodb";

/**
 * Helper to generate calendar dates between start and end (YYYY-MM-DD)
 */
function getDatesInRange(startDate: Date, endDate: Date): string[] {
  const dates: string[] = [];
  const curr = new Date(startDate);
  curr.setHours(0, 0, 0, 0);

  const stop = new Date(endDate);
  stop.setHours(23, 59, 59, 999);

  while (curr <= stop) {
    dates.push(curr.toISOString().slice(0, 10));
    curr.setDate(curr.getDate() + 1);
  }
  return dates;
}

/**
 * Format a Date to readable Indonesian day & date (e.g., "Sen, 26 Okt 2026")
 */
function formatDateLabel(dateStr: string): { label: string; dayName: string } {
  try {
    const d = new Date(`${dateStr}T12:00:00Z`);
    const dayNames = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
    const monthNames = [
      "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
      "Jul", "Agu", "Sep", "Okt", "Nov", "Des"
    ];
    const dayName = dayNames[d.getUTCDay()] || "";
    const label = `${d.getUTCDate()} ${monthNames[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    return { label, dayName };
  } catch {
    return { label: dateStr, dayName: "" };
  }
}

export async function GET(request: Request) {
  await connection();

  try {
    // 1. Admin Authentication Check
    const cookieStore = await cookies();
    const token = cookieStore.get("user_session")?.value;
    const session = await verifySessionToken(token);

    if (!session || session.level !== "Admin") {
      return NextResponse.json(
        { success: false, message: "Akses ditolak. Memerlukan hak akses Admin." },
        { status: 403 }
      );
    }

    // 2. Parse Query Params
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "30d";
    const rawStart = searchParams.get("startDate");
    const rawEnd = searchParams.get("endDate");
    const serverNode = searchParams.get("serverNode") || "ALL";
    const status = searchParams.get("status") || "ALL";
    const search = (searchParams.get("search") || "").trim().toLowerCase();
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "25", 10)));
    const exportMode = searchParams.get("export") || "";

    // 3. Determine Exact Date Range
    const now = new Date();
    let startDate: Date;
    let endDate: Date;

    switch (period) {
      case "today":
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
        endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
        break;

      case "yesterday": {
        const y = new Date(now);
        y.setDate(y.getDate() - 1);
        startDate = new Date(y.getFullYear(), y.getMonth(), y.getDate(), 0, 0, 0, 0);
        endDate = new Date(y.getFullYear(), y.getMonth(), y.getDate(), 23, 59, 59, 999);
        break;
      }

      case "7d":
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6, 0, 0, 0, 0);
        endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
        break;

      case "this_month":
        startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
        endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
        break;

      case "last_month":
        startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
        endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
        break;

      case "this_year":
        startDate = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
        endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
        break;

      case "custom":
        if (rawStart && rawEnd) {
          startDate = new Date(`${rawStart}T00:00:00.000Z`);
          endDate = new Date(`${rawEnd}T23:59:59.999Z`);
        } else {
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29, 0, 0, 0, 0);
          endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
        }
        break;

      case "30d":
      default:
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29, 0, 0, 0, 0);
        endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
        break;
    }

    // 4. Query Order Reports from MongoDB Multi-Cluster & PostgreSQL in Parallel
    const [
      ordersReport,
      paidDeposits,
      pendingDepositsCount,
      userBalancesAgg,
      apiProviders,
      merchantPaidTxs,
    ] = await Promise.all([
      getOrdersFinancialReportData({
        startDate,
        endDate,
        serverNode,
        status,
      }),
      prisma.cryptomusTransaction.findMany({
        where: {
          payment_status: "paid",
          create_at: { gte: startDate, lte: endDate },
        },
        select: {
          id: true,
          amount: true,
          crypto_amount: true,
          crypto_currency: true,
          create_at: true,
        },
        orderBy: { create_at: "asc" },
      }),
      prisma.cryptomusTransaction.count({
        where: {
          payment_status: "pending",
          create_at: { gte: startDate, lte: endDate },
        },
      }),
      prisma.user.aggregate({
        _sum: { balance: true },
        _count: { id: true },
      }),
      prisma.apiProvider.findMany({
        select: {
          id: true,
          uuid: true,
          name: true,
          slug: true,
          url: true,
          balance: true,
          update_at: true,
        },
        orderBy: { id: "asc" },
      }),
      prisma.merchantTransaction.findMany({
        where: {
          paymentStatus: "PAID",
          createdAt: { gte: startDate, lte: endDate },
        },
        select: {
          amountUsd: true,
          adminFee: true,
          createdAt: true,
        },
      }),
    ]);

    // 5. Aggregate Deposits by Date
    let totalDepositsVolume = 0;
    const dailyDepositsMap: Record<string, { volume: number; count: number }> = {};
    for (const dep of paidDeposits) {
      const amt = Number(dep.amount || 0);
      totalDepositsVolume += amt;
      const d = new Date(dep.create_at);
      const dKey = !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : "";
      if (dKey) {
        if (!dailyDepositsMap[dKey]) {
          dailyDepositsMap[dKey] = { volume: 0, count: 0 };
        }
        dailyDepositsMap[dKey].volume += amt;
        dailyDepositsMap[dKey].count += 1;
      }
    }

    // 6. Aggregate Merchant Gateway
    let totalMerchantVolume = 0;
    let totalMerchantAdminFee = 0;
    for (const m of merchantPaidTxs) {
      totalMerchantVolume += Number(m.amountUsd || 0);
      totalMerchantAdminFee += Number(m.adminFee || 0);
    }

    // 7. Aggregate Provider Balances & Status
    let totalProviderBalance = 0;
    const providerMap = new Map<string, typeof apiProviders[0]>();
    const providerUuidMap = new Map<string, typeof apiProviders[0]>();
    apiProviders.forEach((p) => {
      const bal = Number(p.balance || 0);
      totalProviderBalance += bal;
      providerMap.set(String(p.id), p);
      providerUuidMap.set(p.uuid, p);
    });

    // 8. Fetch Services & Users for Enrichment
    const rawOrders = ordersReport.orders;
    const uniqueServiceIds = Array.from(new Set(rawOrders.map((o) => o.service_id)));
    const uniqueUserUuids = Array.from(new Set(rawOrders.map((o) => o.uuid_user)));

    const [servicesData, usersData] = await Promise.all([
      uniqueServiceIds.length > 0
        ? prisma.service.findMany({
            where: {
              OR: [
                { service_id: { in: uniqueServiceIds } },
                ...uniqueServiceIds
                  .filter((id) => !isNaN(parseInt(id, 10)))
                  .map((id) => ({ id: parseInt(id, 10) })),
              ],
            },
            select: {
              id: true,
              service_id: true,
              service_name: true,
              rate_api: true,
              rate_sale: true,
              id_api_provider: true,
              category: { select: { name: true } },
              api_provider: { select: { id: true, name: true, uuid: true } },
            },
          })
        : [],
      uniqueUserUuids.length > 0
        ? prisma.user.findMany({
            where: { uuid: { in: uniqueUserUuids } },
            select: { uuid: true, username: true, email: true, level: true },
          })
        : [],
    ]);

    const serviceLookup = new Map<string, typeof servicesData[0]>();
    servicesData.forEach((s) => {
      serviceLookup.set(String(s.service_id), s);
      serviceLookup.set(String(s.id), s);
    });

    const userLookup = new Map<string, typeof usersData[0]>();
    usersData.forEach((u) => {
      userLookup.set(u.uuid, u);
    });

    // 9. Build Continuous Daily Breakdown (No missing date gaps for chart and table)
    const calendarDates = getDatesInRange(startDate, endDate);
    const dailyBookkeeping = calendarDates.map((dKey) => {
      const orderDay = ordersReport.dailyBreakdown[dKey] || {
        date: dKey,
        ordersCount: 0,
        omset: 0,
        modal: 0,
        profit: 0,
        completedCount: 0,
        canceledCount: 0,
      };

      const depDay = dailyDepositsMap[dKey] || { volume: 0, count: 0 };
      const { label, dayName } = formatDateLabel(dKey);

      const omset = Number(orderDay.omset.toFixed(4));
      const modal = Number(orderDay.modal.toFixed(4));
      const profit = Number(orderDay.profit.toFixed(4));
      const margin = omset > 0 ? Number(((profit / omset) * 100).toFixed(2)) : 0;
      const successRate =
        orderDay.ordersCount > 0
          ? Number(((orderDay.completedCount / orderDay.ordersCount) * 100).toFixed(1))
          : 100;
      const depositsVol = Number(depDay.volume.toFixed(2));
      const netCashflow = Number((depositsVol - modal).toFixed(2));

      return {
        date: dKey,
        label,
        dayName,
        ordersCount: orderDay.ordersCount,
        completedCount: orderDay.completedCount,
        canceledCount: orderDay.canceledCount,
        omset,
        modal,
        profit,
        marginPercent: margin,
        successRate,
        depositsVolume: depositsVol,
        depositsCount: depDay.count,
        netCashflow,
      };
    });

    // 10. Build Detailed Service Performance Table
    const totalProfit = ordersReport.totalProfit || 0.0001; // Avoid divide by zero
    const serviceList = Object.values(ordersReport.serviceBreakdown)
      .map((s) => {
        const meta = serviceLookup.get(s.service_id);
        const omset = Number(s.omset.toFixed(4));
        const modal = Number(s.modal.toFixed(4));
        const profit = Number(s.profit.toFixed(4));
        const marginPercent = omset > 0 ? Number(((profit / omset) * 100).toFixed(2)) : 0;
        const profitShare = Number(((profit / totalProfit) * 100).toFixed(2));

        return {
          serviceId: s.service_id,
          serviceName: meta?.service_name || `Layanan #${s.service_id}`,
          categoryName: meta?.category?.name || "Umum",
          providerName: meta?.api_provider?.name || "Internal / SMM API",
          ordersCount: s.ordersCount,
          omset,
          modal,
          profit,
          marginPercent,
          profitShare,
        };
      })
      .sort((a, b) => b.profit - a.profit);

    // 11. Build Detailed Provider Reconciliation Table
    const providerList = apiProviders.map((p) => {
      const breakdown = ordersReport.providerBreakdown[p.uuid] || {
        providerUuid: p.uuid,
        ordersCount: 0,
        modal: 0,
      };

      const bal = Number(p.balance || 0);
      let healthStatus: "healthy" | "warning" | "critical" = "healthy";
      if (bal < 5) {
        healthStatus = "critical";
      } else if (bal < 20) {
        healthStatus = "warning";
      }

      return {
        id: p.id,
        uuid: p.uuid,
        name: p.name,
        slug: p.slug,
        url: p.url,
        balance: bal,
        ordersCount: breakdown.ordersCount,
        modalSpent: Number(breakdown.modal.toFixed(4)),
        healthStatus,
        lastUpdated: p.update_at.toISOString(),
      };
    });

    // 12. Build Enriched Transaction Ledger / Log
    const enrichedOrders = rawOrders.map((ord) => {
      const sMeta = serviceLookup.get(ord.service_id);
      const uMeta = userLookup.get(ord.uuid_user);
      const pMeta = ord.uuid_api_provider
        ? providerUuidMap.get(ord.uuid_api_provider)
        : sMeta?.api_provider;

      return {
        id: ord.id,
        invoice: ord.invoice,
        orderId: ord.order_id,
        createAt: ord.create_at,
        username: uMeta?.username || "Unknown",
        userLevel: uMeta?.level || "Member",
        serviceId: ord.service_id,
        serviceName: sMeta?.service_name || `Layanan #${ord.service_id}`,
        categoryName: sMeta?.category?.name || "Umum",
        providerName: pMeta?.name || "Internal / SMM API",
        serverArea: ord.server_area,
        status: ord.status,
        target: ord.target,
        amount: ord.amount,
        priceApi: ord.price_api,
        priceSale: ord.price_sale,
        profit: ord.profit,
        marginPercent: ord.marginPercent,
      };
    });

    // Filter by search if specified
    const filteredOrders = search
      ? enrichedOrders.filter(
          (o) =>
            o.invoice.toLowerCase().includes(search) ||
            (o.orderId && o.orderId.toLowerCase().includes(search)) ||
            o.username.toLowerCase().includes(search) ||
            o.serviceName.toLowerCase().includes(search) ||
            o.categoryName.toLowerCase().includes(search) ||
            o.target.toLowerCase().includes(search)
        )
      : enrichedOrders;

    // 13. Handle Export CSV Requests
    if (exportMode === "csv_summary") {
      const header = "Tanggal,Hari,Jumlah Pesanan,Omset ($),Modal HPP ($),Laba Bersih ($),Margin (%),Deposit Masuk ($),Net Cashflow ($),Success Rate (%)\n";
      const rows = dailyBookkeeping
        .map(
          (d) =>
            `"${d.date}","${d.dayName}","${d.ordersCount}","${d.omset}","${d.modal}","${d.profit}","${d.marginPercent}%","${d.depositsVolume}","${d.netCashflow}","${d.successRate}%"`
        )
        .join("\n");

      return new NextResponse(header + rows, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="laporan-rekap-harian-${startDate.toISOString().slice(0, 10)}-to-${endDate.toISOString().slice(0, 10)}.csv"`,
        },
      });
    }

    if (exportMode === "csv_orders") {
      const header = "Invoice,Order ID,Tanggal,Username,Layanan,Kategori,Provider,Status,Target,Jumlah,Modal ($),Omset ($),Laba ($),Margin (%)\n";
      const rows = filteredOrders
        .map(
          (o) =>
            `"${o.invoice}","${o.orderId || "-"}","${o.createAt}","${o.username}","${o.serviceName.replace(/"/g, '""')}","${o.categoryName}","${o.providerName}","${o.status}","${o.target.replace(/"/g, '""')}","${o.amount}","${o.priceApi}","${o.priceSale}","${o.profit}","${o.marginPercent}%"`
        )
        .join("\n");

      return new NextResponse(header + rows, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="laporan-transaksi-pesanan-${startDate.toISOString().slice(0, 10)}-to-${endDate.toISOString().slice(0, 10)}.csv"`,
        },
      });
    }

    // 14. Pagination for Ledger
    const totalMatchedOrders = filteredOrders.length;
    const skip = (page - 1) * limit;
    const paginatedOrders = filteredOrders.slice(skip, skip + limit);
    const totalPages = Math.ceil(totalMatchedOrders / limit) || 1;

    // 15. Financial Statement & Cash Flow Snapshot
    const userTotalBalance = Number(userBalancesAgg._sum.balance || 0);
    const netOperatingCashflow = Number((totalDepositsVolume + totalMerchantAdminFee - ordersReport.totalModal).toFixed(2));
    const netLiquidityCushion = Number((totalProviderBalance + netOperatingCashflow - userTotalBalance).toFixed(2));

    return NextResponse.json({
      success: true,
      period,
      dateRange: {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        startLabel: formatDateLabel(startDate.toISOString().slice(0, 10)).label,
        endLabel: formatDateLabel(endDate.toISOString().slice(0, 10)).label,
      },
      summary: {
        totalOrders: ordersReport.totalOrders,
        totalOmset: ordersReport.totalOmset,
        totalModal: ordersReport.totalModal,
        totalProfit: ordersReport.totalProfit,
        profitMargin: ordersReport.profitMargin,
        avgOrderValue: ordersReport.avgOrderValue,
        avgProfitPerOrder: ordersReport.avgProfitPerOrder,
        totalDepositsVolume: Number(totalDepositsVolume.toFixed(2)),
        totalDepositsCount: paidDeposits.length,
        pendingDepositsCount,
        totalMerchantVolume: Number(totalMerchantVolume.toFixed(2)),
        totalMerchantAdminFee: Number(totalMerchantAdminFee.toFixed(2)),
        netOperatingCashflow,
        userTotalBalance: Number(userTotalBalance.toFixed(2)),
        totalProviderBalance: Number(totalProviderBalance.toFixed(2)),
        netLiquidityCushion,
        totalRegisteredUsers: userBalancesAgg._count.id || 0,
      },
      statusCounts: ordersReport.statusCounts,
      dailyBookkeeping,
      services: serviceList,
      providers: providerList,
      ledger: {
        orders: paginatedOrders,
        total: totalMatchedOrders,
        page,
        limit,
        totalPages,
      },
    });
  } catch (error: any) {
    console.error("[Admin Financial Report API Error]:", error);
    return NextResponse.json(
      { success: false, message: error?.message || "Terjadi kesalahan saat memproses laporan keuangan." },
      { status: 500 }
    );
  }
}
