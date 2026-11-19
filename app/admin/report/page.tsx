"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  BarChart3,
  Download,
  Calendar,
  RefreshCw,
  TrendingUp,
  CreditCard,
  Sparkles,
  ArrowDownToLine,
  Scale,
  Search,
  Printer,
  ChevronRight,
  ShieldCheck,
  AlertTriangle,
  Server,
  Layers,
  ArrowUpRight,
  Filter,
  DollarSign,
  FileSpreadsheet,
  CheckCircle2,
  Clock,
  XCircle,
  HelpCircle,
} from "lucide-react";
import TablePagination from "@/app/admin/components/table-pagination";

interface DailyBookkeepingItem {
  date: string;
  label: string;
  dayName: string;
  ordersCount: number;
  completedCount: number;
  canceledCount: number;
  omset: number;
  modal: number;
  profit: number;
  marginPercent: number;
  successRate: number;
  depositsVolume: number;
  depositsCount: number;
  netCashflow: number;
}

interface ServicePerformanceItem {
  serviceId: string;
  serviceName: string;
  categoryName: string;
  providerName: string;
  ordersCount: number;
  omset: number;
  modal: number;
  profit: number;
  marginPercent: number;
  profitShare: number;
}

interface ProviderReconciliationItem {
  id: number;
  uuid: string;
  name: string;
  slug: string;
  url: string;
  balance: number;
  ordersCount: number;
  modalSpent: number;
  healthStatus: "healthy" | "warning" | "critical";
  lastUpdated: string;
}

interface OrderLedgerItem {
  id: number;
  invoice: string;
  orderId: string | null;
  createAt: string;
  username: string;
  userLevel: string;
  serviceId: string;
  serviceName: string;
  categoryName: string;
  providerName: string;
  serverArea: string;
  status: string;
  target: string;
  amount: number;
  priceApi: number;
  priceSale: number;
  profit: number;
  marginPercent: number;
}

interface ReportApiResponse {
  success: boolean;
  period: string;
  dateRange: {
    startDate: string;
    endDate: string;
    startLabel: string;
    endLabel: string;
  };
  summary: {
    totalOrders: number;
    totalOmset: number;
    totalModal: number;
    totalProfit: number;
    profitMargin: number;
    avgOrderValue: number;
    avgProfitPerOrder: number;
    totalDepositsVolume: number;
    totalDepositsCount: number;
    pendingDepositsCount: number;
    totalMerchantVolume: number;
    totalMerchantAdminFee: number;
    netOperatingCashflow: number;
    userTotalBalance: number;
    totalProviderBalance: number;
    netLiquidityCushion: number;
    totalRegisteredUsers: number;
  };
  statusCounts: Record<string, { count: number; omset: number; modal: number; profit: number }>;
  dailyBookkeeping: DailyBookkeepingItem[];
  services: ServicePerformanceItem[];
  providers: ProviderReconciliationItem[];
  ledger: {
    orders: OrderLedgerItem[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
  message?: string;
}

export default function AdminFinancialReportPage() {
  // Query Filters State
  const [period, setPeriod] = useState<string>("30d");
  const [customStart, setCustomStart] = useState<string>("");
  const [customEnd, setCustomEnd] = useState<string>("");
  const [serverNode, setServerNode] = useState<string>("ALL");
  const [orderStatus, setOrderStatus] = useState<string>("ALL");

  // Ledger Filter & Pagination State
  const [ledgerSearch, setLedgerSearch] = useState<string>("");
  const [ledgerPage, setLedgerPage] = useState<number>(1);
  const [ledgerLimit, setLedgerLimit] = useState<number>(20);

  // Tab State: "daily" | "services" | "providers" | "cashflow" | "ledger"
  const [activeTab, setActiveTab] = useState<"daily" | "services" | "providers" | "cashflow" | "ledger">("daily");

  // Chart Interactive State
  const [chartSeries, setChartSeries] = useState<"all" | "omset" | "modal" | "profit" | "deposits">("all");
  const [hoveredPointIndex, setHoveredPointIndex] = useState<number | null>(null);

  // Service Table Search State
  const [serviceSearch, setServiceSearch] = useState<string>("");

  // Loading & Data State
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [data, setData] = useState<ReportApiResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Fetch Report Data
  const fetchReport = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const params = new URLSearchParams();
      params.set("period", period);
      if (period === "custom") {
        if (customStart) params.set("startDate", customStart);
        if (customEnd) params.set("endDate", customEnd);
      }
      if (serverNode !== "ALL") params.set("serverNode", serverNode);
      if (orderStatus !== "ALL") params.set("status", orderStatus);
      if (ledgerSearch.trim()) params.set("search", ledgerSearch.trim());
      params.set("page", String(ledgerPage));
      params.set("limit", String(ledgerLimit));

      const res = await fetch(`/api/admin/report?${params.toString()}`, {
        cache: "no-store",
      });
      const json: ReportApiResponse = await res.json();

      if (json.success) {
        setData(json);
      } else {
        setErrorMsg(json.message || "Gagal memuat data laporan keuangan.");
      }
    } catch (err: any) {
      console.error("Fetch report error:", err);
      setErrorMsg(err?.message || "Terjadi kesalahan jaringan.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, serverNode, orderStatus, ledgerPage, ledgerLimit]);

  // Debounced search for ledger
  useEffect(() => {
    const handler = setTimeout(() => {
      fetchReport();
    }, 400);
    return () => clearTimeout(handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledgerSearch]);

  // Currency format helper
  const formatUSD = (val: number | string | null | undefined, decimals = 2) => {
    const n = Number(val || 0);
    return `$${n.toLocaleString("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })}`;
  };

  // Export CSV Handler
  const handleExportCSV = (mode: "csv_summary" | "csv_orders") => {
    const params = new URLSearchParams();
    params.set("period", period);
    if (period === "custom") {
      if (customStart) params.set("startDate", customStart);
      if (customEnd) params.set("endDate", customEnd);
    }
    if (serverNode !== "ALL") params.set("serverNode", serverNode);
    if (orderStatus !== "ALL") params.set("status", orderStatus);
    if (ledgerSearch.trim()) params.set("search", ledgerSearch.trim());
    params.set("export", mode);

    window.open(`/api/admin/report?${params.toString()}`, "_blank");
  };

  // Grand totals for daily bookkeeping table
  const dailyTotals = useMemo(() => {
    if (!data?.dailyBookkeeping) return null;
    return data.dailyBookkeeping.reduce(
      (acc, curr) => ({
        ordersCount: acc.ordersCount + curr.ordersCount,
        completedCount: acc.completedCount + curr.completedCount,
        canceledCount: acc.canceledCount + curr.canceledCount,
        omset: acc.omset + curr.omset,
        modal: acc.modal + curr.modal,
        profit: acc.profit + curr.profit,
        depositsVolume: acc.depositsVolume + curr.depositsVolume,
        depositsCount: acc.depositsCount + curr.depositsCount,
        netCashflow: acc.netCashflow + curr.netCashflow,
      }),
      {
        ordersCount: 0,
        completedCount: 0,
        canceledCount: 0,
        omset: 0,
        modal: 0,
        profit: 0,
        depositsVolume: 0,
        depositsCount: 0,
        netCashflow: 0,
      }
    );
  }, [data]);

  // Filtered services for tab 2
  const filteredServices = useMemo(() => {
    if (!data?.services) return [];
    if (!serviceSearch.trim()) return data.services;
    const q = serviceSearch.toLowerCase();
    return data.services.filter(
      (s) =>
        s.serviceName.toLowerCase().includes(q) ||
        s.categoryName.toLowerCase().includes(q) ||
        s.providerName.toLowerCase().includes(q) ||
        s.serviceId.includes(q)
    );
  }, [data?.services, serviceSearch]);

  // Chart computation points
  const chartPoints = useMemo(() => {
    return data?.dailyBookkeeping || [];
  }, [data]);

  const maxChartValue = useMemo(() => {
    if (chartPoints.length === 0) return 100;
    const maxVal = Math.max(
      ...chartPoints.map((p) =>
        Math.max(p.omset, p.modal, p.profit, p.depositsVolume)
      ),
      10
    );
    return maxVal * 1.15; // 15% headroom
  }, [chartPoints]);

  return (
    <div className="space-y-6 pb-12 print:space-y-4 print:pb-0">
      {/* 1. Header & Executive Filter Toolbar */}
      <div className="p-5 sm:p-6 rounded-3xl bg-white border border-slate-200/80 shadow-xs print:shadow-none print:border-none print:p-0">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div className="flex items-start gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center text-white shadow-md shadow-emerald-500/20 shrink-0">
              <BarChart3 className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                  Laporan &amp; Pembukuan Keuangan
                </h1>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-emerald-50 text-emerald-700 border border-emerald-200">
                  Real-Time
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Rekapitulasi omzet, beban modal (HPP API), laba bersih, arus kas deposit, dan rekonsiliasi vendor.
                {data?.dateRange && (
                  <span className="inline-block font-semibold text-slate-700 ml-1">
                    Periode: {data.dateRange.startLabel} &ndash; {data.dateRange.endLabel}
                  </span>
                )}
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <button
              onClick={() => fetchReport()}
              disabled={isLoading}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 transition-colors shadow-2xs cursor-pointer disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-slate-500 ${isLoading ? "animate-spin text-emerald-600" : ""}`} />
              <span>Refresh</span>
            </button>

            <button
              onClick={() => handleExportCSV("csv_summary")}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-700 bg-white hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200 border border-slate-200 transition-colors shadow-2xs cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
              <span>Export Rekap CSV</span>
            </button>

            <button
              onClick={() => handleExportCSV("csv_orders")}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-700 bg-white hover:bg-sky-50 hover:text-sky-700 hover:border-sky-200 border border-slate-200 transition-colors shadow-2xs cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-sky-600" />
              <span>Export Jurnal CSV</span>
            </button>

            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 transition-colors shadow-2xs cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5 text-slate-500" />
              <span>Cetak Laporan</span>
            </button>
          </div>
        </div>

        {/* Filter Controls Row */}
        <div className="mt-5 pt-4 border-t border-slate-100 flex flex-col xl:flex-row xl:items-center justify-between gap-4 print:hidden">
          {/* Quick Period Buttons */}
          <div className="flex flex-wrap items-center gap-1.5">
            {[
              { id: "today", label: "Hari Ini" },
              { id: "yesterday", label: "Kemarin" },
              { id: "7d", label: "7 Hari" },
              { id: "30d", label: "30 Hari" },
              { id: "this_month", label: "Bulan Ini" },
              { id: "last_month", label: "Bulan Lalu" },
              { id: "this_year", label: "Tahun Ini" },
              { id: "custom", label: "Kustom" },
            ].map((p) => {
              const active = period === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => {
                    setPeriod(p.id);
                    setLedgerPage(1);
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer shadow-2xs ${
                    active
                      ? "bg-slate-900 text-white shadow-slate-900/10 scale-[1.02]"
                      : "bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200/80"
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          {/* Secondary Filters: Server Node & Status */}
          <div className="flex flex-wrap items-center gap-3">
            {period === "custom" && (
              <div className="flex items-center gap-1.5 bg-slate-50 p-1 rounded-xl border border-slate-200">
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="px-2 py-1 text-xs bg-white border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:border-emerald-500 font-medium"
                />
                <span className="text-xs text-slate-400 font-bold">&ndash;</span>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="px-2 py-1 text-xs bg-white border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:border-emerald-500 font-medium"
                />
                <button
                  onClick={() => fetchReport()}
                  className="px-2.5 py-1 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors cursor-pointer"
                >
                  Terapkan
                </button>
              </div>
            )}

            {/* Server Node Selection */}
            <div className="flex items-center gap-1.5">
              <Server className="w-3.5 h-3.5 text-slate-400" />
              <select
                value={serverNode}
                onChange={(e) => {
                  setServerNode(e.target.value);
                  setLedgerPage(1);
                }}
                className="px-2.5 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-700 hover:border-slate-300 focus:outline-none focus:border-emerald-500 cursor-pointer shadow-2xs"
              >
                <option value="ALL">Semua Node (Cluster Multi-Region)</option>
                <option value="SG_1">Node SG_1 (Singapura 1)</option>
                <option value="SG_2">Node SG_2 (Singapura 2)</option>
                <option value="DC_1">Node DC_1 (Washington DC 1)</option>
                <option value="DC_2">Node DC_2 (Washington DC 2)</option>
                <option value="JP_1">Node JP_1 (Tokyo Japan 1)</option>
              </select>
            </div>

            {/* Status Filter */}
            <div className="flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              <select
                value={orderStatus}
                onChange={(e) => {
                  setOrderStatus(e.target.value);
                  setLedgerPage(1);
                }}
                className="px-2.5 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-bold text-slate-700 hover:border-slate-300 focus:outline-none focus:border-emerald-500 cursor-pointer shadow-2xs"
              >
                <option value="ALL">Semua Status Order</option>
                <option value="Completed">Completed (Selesai)</option>
                <option value="Processing">Processing (Diproses)</option>
                <option value="In progress">In Progress (Berjalan)</option>
                <option value="Pending">Pending (Menunggu)</option>
                <option value="Partial">Partial (Parsial)</option>
                <option value="Canceled">Canceled (Batal)</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Error Notice */}
      {errorMsg && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button
            onClick={() => fetchReport()}
            className="font-bold underline cursor-pointer hover:text-rose-900"
          >
            Coba Lagi
          </button>
        </div>
      )}

      {/* 2. Executive KPI Cards (Ringkasan Keuangan Utama) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Card 1: Omzet Penjualan */}
        <div className="p-5 rounded-3xl bg-white border border-slate-200/80 shadow-xs hover:border-blue-200 transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              Omzet Penjualan
            </span>
            <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-slate-900 mt-2 font-mono tracking-tight">
            {data ? formatUSD(data.summary.totalOmset) : "..."}
          </div>
          <div className="text-[11px] text-slate-500 mt-1 flex items-center justify-between">
            <span>{data ? data.summary.totalOrders.toLocaleString() : "0"} Pesanan</span>
            <span className="font-semibold text-slate-700">
              AOV: {data ? formatUSD(data.summary.avgOrderValue) : "$0.00"}
            </span>
          </div>
        </div>

        {/* Card 2: Modal HPP API */}
        <div className="p-5 rounded-3xl bg-white border border-slate-200/80 shadow-xs hover:border-amber-200 transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              Beban Modal (HPP)
            </span>
            <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
              <CreditCard className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-amber-600 mt-2 font-mono tracking-tight">
            {data ? formatUSD(data.summary.totalModal) : "..."}
          </div>
          <div className="text-[11px] text-slate-500 mt-1 flex items-center justify-between">
            <span>Biaya API Supplier</span>
            <span className="font-bold text-amber-700">
              {data && data.summary.totalOmset > 0
                ? `${((data.summary.totalModal / data.summary.totalOmset) * 100).toFixed(1)}% Omzet`
                : "0%"}
            </span>
          </div>
        </div>

        {/* Card 3: Laba Bersih / Gross Profit */}
        <div className="p-5 rounded-3xl bg-white border border-emerald-200/80 shadow-xs hover:border-emerald-300 transition-colors bg-gradient-to-br from-white to-emerald-50/20">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-emerald-800 uppercase tracking-wider">
              Laba Bersih SMM
            </span>
            <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <Sparkles className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-emerald-600 mt-2 font-mono tracking-tight">
            {data ? formatUSD(data.summary.totalProfit) : "..."}
          </div>
          <div className="text-[11px] text-emerald-700 font-semibold mt-1 flex items-center justify-between">
            <span>Margin: {data ? `${data.summary.profitMargin}%` : "0%"}</span>
            <span>Avg: {data ? formatUSD(data.summary.avgProfitPerOrder) : "$0.00"}/ord</span>
          </div>
        </div>

        {/* Card 4: Deposit Masuk */}
        <div className="p-5 rounded-3xl bg-white border border-slate-200/80 shadow-xs hover:border-sky-200 transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              Arus Kas Deposit
            </span>
            <div className="w-8 h-8 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center">
              <ArrowDownToLine className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-sky-600 mt-2 font-mono tracking-tight">
            {data ? formatUSD(data.summary.totalDepositsVolume) : "..."}
          </div>
          <div className="text-[11px] text-slate-500 mt-1 flex items-center justify-between">
            <span>{data ? `${data.summary.totalDepositsCount} Deposit Lunas` : "0 Lunas"}</span>
            <span className="font-semibold text-slate-700">
              Net: {data ? formatUSD(data.summary.netOperatingCashflow) : "$0.00"}
            </span>
          </div>
        </div>

        {/* Card 5: Likuiditas & Float Neraca */}
        <div className="p-5 rounded-3xl bg-white border border-slate-200/80 shadow-xs hover:border-purple-200 transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              Bantalan Likuiditas
            </span>
            <div className="w-8 h-8 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
              <Scale className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-purple-700 mt-2 font-mono tracking-tight">
            {data ? formatUSD(data.summary.totalProviderBalance) : "..."}
          </div>
          <div className="text-[11px] text-slate-500 mt-1 flex items-center justify-between">
            <span>Saldo Member:</span>
            <span className="font-semibold text-slate-700">
              {data ? formatUSD(data.summary.userTotalBalance) : "$0.00"}
            </span>
          </div>
        </div>
      </div>

      {/* 3. Interactive Multi-Metric SVG Financial Trend Visualizer */}
      <div className="p-5 sm:p-6 rounded-3xl bg-white border border-slate-200/80 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
          <div>
            <h3 className="font-black text-slate-900 text-sm tracking-tight flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-600" />
              <span>Tren Finansial Harian (Omzet, Modal, Laba, Deposit)</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Visualisasi pergerakan volume keuangan harian sepanjang periode terpilih.
            </p>
          </div>

          {/* Series Toggle Selector */}
          <div className="flex items-center gap-1 bg-slate-50 p-1 rounded-xl border border-slate-200/80 self-start sm:self-auto text-xs">
            {[
              { id: "all", label: "Semua Metrik" },
              { id: "omset", label: "Omzet" },
              { id: "modal", label: "Modal HPP" },
              { id: "profit", label: "Laba Bersih" },
              { id: "deposits", label: "Deposit" },
            ].map((s) => (
              <button
                key={s.id}
                onClick={() => setChartSeries(s.id as any)}
                className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                  chartSeries === s.id
                    ? "bg-white text-slate-900 shadow-2xs border border-slate-200"
                    : "text-slate-500 hover:text-slate-900"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* SVG Chart Canvas */}
        <div className="relative bg-slate-50/50 rounded-2xl border border-slate-200/70 p-4 overflow-hidden">
          {/* Hover Tooltip Popup */}
          {hoveredPointIndex !== null && chartPoints[hoveredPointIndex] && (
            <div className="absolute top-3 right-4 z-20 bg-white/95 backdrop-blur-md border border-slate-200 shadow-xl rounded-2xl p-3 text-xs pointer-events-none min-w-[200px] animate-in fade-in duration-100">
              <div className="font-bold text-slate-800 border-b border-slate-100 pb-1 mb-2 flex items-center justify-between">
                <span>{chartPoints[hoveredPointIndex].label}</span>
                <span className="text-[10px] uppercase font-bold text-slate-400">
                  {chartPoints[hoveredPointIndex].dayName}
                </span>
              </div>
              <div className="space-y-1.5 font-mono">
                <div className="flex items-center justify-between text-blue-700 font-bold">
                  <span className="font-sans text-slate-500 font-normal">Omzet:</span>
                  <span>{formatUSD(chartPoints[hoveredPointIndex].omset)}</span>
                </div>
                <div className="flex items-center justify-between text-amber-700 font-bold">
                  <span className="font-sans text-slate-500 font-normal">Modal (HPP):</span>
                  <span>{formatUSD(chartPoints[hoveredPointIndex].modal)}</span>
                </div>
                <div className="flex items-center justify-between text-emerald-700 font-bold">
                  <span className="font-sans text-slate-500 font-normal">Laba Bersih:</span>
                  <span>{formatUSD(chartPoints[hoveredPointIndex].profit)}</span>
                </div>
                <div className="flex items-center justify-between text-sky-700 font-bold border-t border-slate-100 pt-1">
                  <span className="font-sans text-slate-500 font-normal">Deposit:</span>
                  <span>{formatUSD(chartPoints[hoveredPointIndex].depositsVolume)}</span>
                </div>
                <div className="text-[10px] font-sans text-slate-400 pt-1 flex items-center justify-between">
                  <span>Pesanan: {chartPoints[hoveredPointIndex].ordersCount}</span>
                  <span>Margin: {chartPoints[hoveredPointIndex].marginPercent}%</span>
                </div>
              </div>
            </div>
          )}

          {/* Interactive SVG */}
          {chartPoints.length > 0 ? (
            <div className="w-full h-48 sm:h-64 flex items-end">
              <svg
                viewBox="0 0 1000 240"
                className="w-full h-full overflow-visible"
                preserveAspectRatio="none"
              >
                <defs>
                  {/* Gradients */}
                  <linearGradient id="gradOmset" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.25" />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.0" />
                  </linearGradient>
                  <linearGradient id="gradProfit" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity="0.3" />
                    <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
                  </linearGradient>
                  <linearGradient id="gradModal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.2" />
                    <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.0" />
                  </linearGradient>
                  <linearGradient id="gradDeposit" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.25" />
                    <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.0" />
                  </linearGradient>
                </defs>

                {/* Grid guidelines */}
                {[0.25, 0.5, 0.75, 1.0].map((ratio) => {
                  const y = 220 - ratio * 190;
                  return (
                    <line
                      key={ratio}
                      x1="0"
                      y1={y}
                      x2="1000"
                      y2={y}
                      stroke="#e2e8f0"
                      strokeDasharray="4 4"
                      strokeWidth="1"
                    />
                  );
                })}

                {/* Render Curves */}
                {(() => {
                  const n = chartPoints.length;
                  const step = 1000 / Math.max(1, n - 1);

                  const getCoords = (valGetter: (p: DailyBookkeepingItem) => number) => {
                    return chartPoints.map((p, i) => {
                      const x = i * step;
                      const val = valGetter(p);
                      const y = 220 - (val / maxChartValue) * 190;
                      return { x, y: Math.max(10, Math.min(220, y)) };
                    });
                  };

                  const makePath = (coords: Array<{ x: number; y: number }>) => {
                    if (coords.length === 0) return "";
                    return coords.reduce((acc, pt, i) => {
                      if (i === 0) return `M ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
                      return `${acc} L ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
                    }, "");
                  };

                  const omsetCoords = getCoords((p) => p.omset);
                  const modalCoords = getCoords((p) => p.modal);
                  const profitCoords = getCoords((p) => p.profit);
                  const depCoords = getCoords((p) => p.depositsVolume);

                  return (
                    <>
                      {/* Omzet Line */}
                      {(chartSeries === "all" || chartSeries === "omset") && (
                        <>
                          <path
                            d={`${makePath(omsetCoords)} L 1000 220 L 0 220 Z`}
                            fill="url(#gradOmset)"
                          />
                          <path
                            d={makePath(omsetCoords)}
                            fill="none"
                            stroke="#3b82f6"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                          />
                        </>
                      )}

                      {/* Modal HPP Line */}
                      {(chartSeries === "all" || chartSeries === "modal") && (
                        <>
                          <path
                            d={`${makePath(modalCoords)} L 1000 220 L 0 220 Z`}
                            fill="url(#gradModal)"
                          />
                          <path
                            d={makePath(modalCoords)}
                            fill="none"
                            stroke="#f59e0b"
                            strokeWidth="2"
                            strokeDasharray="3 3"
                            strokeLinecap="round"
                          />
                        </>
                      )}

                      {/* Laba Bersih Line */}
                      {(chartSeries === "all" || chartSeries === "profit") && (
                        <>
                          <path
                            d={`${makePath(profitCoords)} L 1000 220 L 0 220 Z`}
                            fill="url(#gradProfit)"
                          />
                          <path
                            d={makePath(profitCoords)}
                            fill="none"
                            stroke="#10b981"
                            strokeWidth="3"
                            strokeLinecap="round"
                          />
                        </>
                      )}

                      {/* Deposit Masuk Line */}
                      {(chartSeries === "all" || chartSeries === "deposits") && (
                        <>
                          <path
                            d={`${makePath(depCoords)} L 1000 220 L 0 220 Z`}
                            fill="url(#gradDeposit)"
                          />
                          <path
                            d={makePath(depCoords)}
                            fill="none"
                            stroke="#0ea5e9"
                            strokeWidth="2"
                            strokeLinecap="round"
                          />
                        </>
                      )}

                      {/* Interactive hover points */}
                      {chartPoints.map((p, i) => {
                        const x = i * step;
                        const isHovered = hoveredPointIndex === i;
                        return (
                          <g
                            key={i}
                            onMouseEnter={() => setHoveredPointIndex(i)}
                            onMouseLeave={() => setHoveredPointIndex(null)}
                            className="cursor-pointer"
                          >
                            <rect
                              x={Math.max(0, x - step / 2)}
                              y="0"
                              width={step}
                              height="240"
                              fill="transparent"
                            />
                            {isHovered && (
                              <line
                                x1={x}
                                y1="10"
                                x2={x}
                                y2="220"
                                stroke="#94a3b8"
                                strokeWidth="1.5"
                                strokeDasharray="2 2"
                              />
                            )}
                            <circle
                              cx={x}
                              cy={profitCoords[i]?.y || 220}
                              r={isHovered ? 6 : 3}
                              fill="#10b981"
                              stroke="#ffffff"
                              strokeWidth="2"
                            />
                          </g>
                        );
                      })}
                    </>
                  );
                })()}
              </svg>
            </div>
          ) : (
            <div className="h-48 flex items-center justify-center text-slate-400 text-xs">
              Belum ada data transaksi dalam rentang periode ini.
            </div>
          )}

          {/* Legend Badges */}
          <div className="flex flex-wrap items-center justify-center gap-5 pt-3 border-t border-slate-200/60 text-xs font-semibold">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-blue-500 shadow-xs" />
              <span className="text-slate-700">Omzet Penjualan</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-amber-500 shadow-xs" />
              <span className="text-slate-700">Modal API (HPP)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-emerald-500 shadow-xs" />
              <span className="text-slate-700">Laba Bersih</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-sky-500 shadow-xs" />
              <span className="text-slate-700">Deposit Masuk</span>
            </div>
          </div>
        </div>
      </div>

      {/* 4. Tab Navigation Header */}
      <div className="flex items-center gap-2 border-b border-slate-200 overflow-x-auto pb-1 text-xs sm:text-sm font-bold">
        {[
          { id: "daily", label: "Rekap Pembukuan Harian", count: data?.dailyBookkeeping.length },
          { id: "services", label: "Analisis Produk & Layanan", count: data?.services.length },
          { id: "providers", label: "Rekonsiliasi Provider API", count: data?.providers.length },
          { id: "cashflow", label: "Arus Kas & Neraca", count: null },
          { id: "ledger", label: "Jurnal Transaksi Pesanan", count: data?.ledger.total },
        ].map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-4 py-2.5 rounded-2xl transition-all cursor-pointer whitespace-nowrap flex items-center gap-2 ${
                active
                  ? "bg-slate-900 text-white shadow-xs"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
              }`}
            >
              <span>{tab.label}</span>
              {tab.count !== null && (
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                    active ? "bg-white/20 text-white" : "bg-slate-200 text-slate-700"
                  }`}
                >
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* =========================================================================
          TAB 1: REKAP PEMBUKUAN HARIAN
         ========================================================================= */}
      {activeTab === "daily" && (
        <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/50">
            <div>
              <h3 className="font-black text-slate-900 text-sm">
                Rekap Buku Kas &amp; Penjualan Harian
              </h3>
              <p className="text-xs text-slate-500">
                Laporan harian mencakup volume pesanan, omzet kotor, modal biaya API, laba bersih, deposit, dan tingkat kesuksesan.
              </p>
            </div>
            <button
              onClick={() => handleExportCSV("csv_summary")}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-slate-700 bg-white border border-slate-200 hover:border-emerald-300 hover:text-emerald-700 transition-colors cursor-pointer self-start sm:self-auto shadow-2xs"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download CSV Rekap</span>
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100/70 border-b border-slate-200 text-slate-600 uppercase font-black text-[10px] tracking-wider">
                <tr>
                  <th className="py-3 px-4">Tanggal</th>
                  <th className="py-3 px-4 text-center">Pesanan Selesai</th>
                  <th className="py-3 px-4 text-right">Omzet Penjualan ($)</th>
                  <th className="py-3 px-4 text-right">Modal API ($)</th>
                  <th className="py-3 px-4 text-right">Laba Bersih ($)</th>
                  <th className="py-3 px-4 text-center">Margin (%)</th>
                  <th className="py-3 px-4 text-right">Deposit Masuk ($)</th>
                  <th className="py-3 px-4 text-right">Net Cashflow ($)</th>
                  <th className="py-3 px-4 text-center">Success Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700 font-mono">
                {data?.dailyBookkeeping && data.dailyBookkeeping.length > 0 ? (
                  data.dailyBookkeeping.map((row) => (
                    <tr key={row.date} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4 font-sans font-bold text-slate-900">
                        <div className="flex items-center gap-2">
                          <span className="w-7 text-[10px] uppercase font-bold text-slate-400">
                            {row.dayName}
                          </span>
                          <span>{row.label}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-center font-sans">
                        <span className="font-bold text-slate-800">{row.ordersCount}</span>
                        {row.canceledCount > 0 && (
                          <span className="text-[10px] text-rose-500 font-semibold ml-1">
                            ({row.canceledCount} batal)
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-slate-900">
                        {formatUSD(row.omset)}
                      </td>
                      <td className="py-3 px-4 text-right text-amber-600 font-semibold">
                        {formatUSD(row.modal)}
                      </td>
                      <td className="py-3 px-4 text-right font-extrabold text-emerald-600">
                        +{formatUSD(row.profit)}
                      </td>
                      <td className="py-3 px-4 text-center font-sans">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            row.marginPercent >= 25
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                              : row.marginPercent > 0
                              ? "bg-blue-50 text-blue-700 border border-blue-200"
                              : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {row.marginPercent}%
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-semibold text-sky-700">
                        {formatUSD(row.depositsVolume)}
                      </td>
                      <td
                        className={`py-3 px-4 text-right font-bold ${
                          row.netCashflow >= 0 ? "text-emerald-700" : "text-rose-600"
                        }`}
                      >
                        {row.netCashflow >= 0 ? `+${formatUSD(row.netCashflow)}` : formatUSD(row.netCashflow)}
                      </td>
                      <td className="py-3 px-4 text-center font-sans">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-slate-100 text-slate-700">
                          {row.successRate}%
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-slate-400 font-sans">
                      Tidak ada catatan pembukuan pada periode ini.
                    </td>
                  </tr>
                )}
              </tbody>

              {/* Grand Total Footer */}
              {dailyTotals && (
                <tfoot className="bg-slate-900 text-white font-mono font-bold text-xs border-t-2 border-slate-900">
                  <tr>
                    <td className="py-3.5 px-4 font-sans font-black uppercase tracking-wider">
                      TOTAL PERIODE
                    </td>
                    <td className="py-3.5 px-4 text-center font-sans font-black">
                      {dailyTotals.ordersCount.toLocaleString()} Order
                    </td>
                    <td className="py-3.5 px-4 text-right font-black text-blue-300">
                      {formatUSD(dailyTotals.omset)}
                    </td>
                    <td className="py-3.5 px-4 text-right font-black text-amber-300">
                      {formatUSD(dailyTotals.modal)}
                    </td>
                    <td className="py-3.5 px-4 text-right font-black text-emerald-300 text-sm">
                      +{formatUSD(dailyTotals.profit)}
                    </td>
                    <td className="py-3.5 px-4 text-center font-sans">
                      <span className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-900/60 text-emerald-200 border border-emerald-600 font-extrabold">
                        {dailyTotals.omset > 0
                          ? `${((dailyTotals.profit / dailyTotals.omset) * 100).toFixed(1)}%`
                          : "0%"}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-right font-black text-sky-300">
                      {formatUSD(dailyTotals.depositsVolume)}
                    </td>
                    <td className="py-3.5 px-4 text-right font-black text-white">
                      {dailyTotals.netCashflow >= 0
                        ? `+${formatUSD(dailyTotals.netCashflow)}`
                        : formatUSD(dailyTotals.netCashflow)}
                    </td>
                    <td className="py-3.5 px-4 text-center font-sans text-slate-300">
                      {dailyTotals.ordersCount > 0
                        ? `${((dailyTotals.completedCount / dailyTotals.ordersCount) * 100).toFixed(1)}%`
                        : "100%"}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {/* =========================================================================
          TAB 2: ANALISIS PRODUK & LAYANAN
         ========================================================================= */}
      {activeTab === "services" && (
        <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50/50">
            <div>
              <h3 className="font-black text-slate-900 text-sm">
                Performa Layanan &amp; Profitabilitas Produk
              </h3>
              <p className="text-xs text-slate-500">
                Peringkat layanan berdasarkan perolehan laba kotor tertinggi dan margin keuntungan.
              </p>
            </div>

            {/* Search Service */}
            <div className="relative w-full sm:w-64">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={serviceSearch}
                onChange={(e) => setServiceSearch(e.target.value)}
                placeholder="Cari nama layanan / ID..."
                className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-slate-200 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-emerald-500 bg-white"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100/70 border-b border-slate-200 text-slate-600 uppercase font-black text-[10px] tracking-wider">
                <tr>
                  <th className="py-3 px-4">Layanan &amp; Kategori</th>
                  <th className="py-3 px-4">Provider API</th>
                  <th className="py-3 px-4 text-center">Jumlah Order</th>
                  <th className="py-3 px-4 text-right">Total Omzet ($)</th>
                  <th className="py-3 px-4 text-right">Modal API ($)</th>
                  <th className="py-3 px-4 text-right">Laba Bersih ($)</th>
                  <th className="py-3 px-4 text-center">Margin (%)</th>
                  <th className="py-3 px-4">Pangsa Laba (%)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {filteredServices.length > 0 ? (
                  filteredServices.map((svc) => (
                    <tr key={svc.serviceId} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900 line-clamp-1">
                          {svc.serviceName}
                        </div>
                        <div className="text-[11px] text-slate-400 flex items-center gap-1.5 mt-0.5">
                          <span>#{svc.serviceId}</span>
                          <span>&bull;</span>
                          <span className="text-slate-600">{svc.categoryName}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200/80">
                          {svc.providerName}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center font-bold text-slate-800 font-mono">
                        {svc.ordersCount}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-slate-900">
                        {formatUSD(svc.omset)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-amber-600">
                        {formatUSD(svc.modal)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-extrabold text-emerald-600">
                        +{formatUSD(svc.profit)}
                      </td>
                      <td className="py-3 px-4 text-center font-mono">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            svc.marginPercent >= 25
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                              : svc.marginPercent > 0
                              ? "bg-blue-50 text-blue-700 border border-blue-200"
                              : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {svc.marginPercent}%
                        </span>
                      </td>
                      <td className="py-3 px-4 w-36">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                            <div
                              className="h-full bg-emerald-500 rounded-full"
                              style={{ width: `${Math.min(100, Math.max(0, svc.profitShare))}%` }}
                            />
                          </div>
                          <span className="font-mono text-[11px] font-bold text-slate-600 shrink-0">
                            {svc.profitShare}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-400">
                      Tidak ada data layanan yang cocok.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* =========================================================================
          TAB 3: REKONSILIASI PROVIDER API
         ========================================================================= */}
      {activeTab === "providers" && (
        <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/50">
            <div>
              <h3 className="font-black text-slate-900 text-sm">
                Rekonsiliasi Pengeluaran Supplier / Provider API
              </h3>
              <p className="text-xs text-slate-500">
                Laporan beban modal keluar per provider dan pemantauan sisa saldo kas yang mengendap di server API vendor.
              </p>
            </div>
            <a
              href="/admin/provider"
              className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 hover:text-emerald-700 hover:underline"
            >
              <span>Kelola API Provider</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </a>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100/70 border-b border-slate-200 text-slate-600 uppercase font-black text-[10px] tracking-wider">
                <tr>
                  <th className="py-3 px-4">Nama Provider</th>
                  <th className="py-3 px-4">Endpoint API URL</th>
                  <th className="py-3 px-4 text-center">Pesanan Diteruskan</th>
                  <th className="py-3 px-4 text-right">Total Beban Modal ($)</th>
                  <th className="py-3 px-4 text-right">Sisa Saldo Tersedia ($)</th>
                  <th className="py-3 px-4 text-center">Status Kesehatan Saldo</th>
                  <th className="py-3 px-4 text-center">Aksi / Tindakan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {data?.providers && data.providers.length > 0 ? (
                  data.providers.map((prov) => (
                    <tr key={prov.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4 font-bold text-slate-900">
                        {prov.name}
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px] text-slate-500 max-w-xs truncate">
                        {prov.url}
                      </td>
                      <td className="py-3 px-4 text-center font-bold text-slate-800 font-mono">
                        {prov.ordersCount} Order
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-amber-700">
                        {formatUSD(prov.modalSpent)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-extrabold text-slate-900 text-sm">
                        {formatUSD(prov.balance)}
                      </td>
                      <td className="py-3 px-4 text-center">
                        {prov.healthStatus === "healthy" ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>Saldo Aman</span>
                          </span>
                        ) : prov.healthStatus === "warning" ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                            <Clock className="w-3 h-3" />
                            <span>Saldo Menipis</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                            <XCircle className="w-3 h-3" />
                            <span>Kritis / Top-up</span>
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <a
                          href={`/admin/provider/${prov.id}/edit`}
                          className="px-2.5 py-1 rounded-lg text-[11px] font-bold text-slate-700 hover:text-emerald-700 bg-slate-100 hover:bg-emerald-50 transition-colors"
                        >
                          Cek Saldo
                        </a>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-400">
                      Tidak ada data API provider yang terdaftar.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* =========================================================================
          TAB 4: ARUS KAS & LAPORAN POSISI KEUANGAN (NERACA)
         ========================================================================= */}
      {activeTab === "cashflow" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Laporan Arus Kas Operasional */}
          <div className="p-5 sm:p-6 rounded-3xl bg-white border border-slate-200/80 shadow-xs">
            <h3 className="font-black text-slate-900 text-sm tracking-tight flex items-center gap-2 mb-1">
              <ArrowDownToLine className="w-4 h-4 text-emerald-600" />
              <span>Laporan Arus Kas Bersih (Cash Flow Statement)</span>
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Aliran dana masuk dari deposit pengguna dan aliran dana keluar untuk beban modal API.
            </p>

            <div className="space-y-3 font-mono text-xs">
              <div className="p-3.5 rounded-2xl bg-emerald-50/50 border border-emerald-100 flex items-center justify-between">
                <div>
                  <div className="font-bold text-emerald-900 font-sans">
                    1. Arus Kas Masuk (Inflow Deposit)
                  </div>
                  <div className="text-[11px] text-emerald-700 font-sans mt-0.5">
                    Deposit Cryptomus Lunas ({data?.summary.totalDepositsCount || 0} Transaksi)
                  </div>
                </div>
                <div className="text-base font-black text-emerald-700">
                  +{data ? formatUSD(data.summary.totalDepositsVolume) : "$0.00"}
                </div>
              </div>

              {data && data.summary.totalMerchantAdminFee > 0 && (
                <div className="p-3.5 rounded-2xl bg-purple-50/50 border border-purple-100 flex items-center justify-between">
                  <div>
                    <div className="font-bold text-purple-900 font-sans">
                      2. Pendapatan Fee Merchant Gateway
                    </div>
                    <div className="text-[11px] text-purple-700 font-sans mt-0.5">
                      Komisi bersih admin dari transaksi gateway merchant
                    </div>
                  </div>
                  <div className="text-base font-black text-purple-700">
                    +{formatUSD(data.summary.totalMerchantAdminFee)}
                  </div>
                </div>
              )}

              <div className="p-3.5 rounded-2xl bg-amber-50/50 border border-amber-100 flex items-center justify-between">
                <div>
                  <div className="font-bold text-amber-900 font-sans">
                    3. Arus Kas Keluar (Beban HPP Provider)
                  </div>
                  <div className="text-[11px] text-amber-700 font-sans mt-0.5">
                    Biaya eksekusi pesanan ke seluruh API Provider
                  </div>
                </div>
                <div className="text-base font-black text-amber-700">
                  -{data ? formatUSD(data.summary.totalModal) : "$0.00"}
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-slate-900 text-white flex items-center justify-between mt-4">
                <div>
                  <div className="font-bold font-sans text-sm">
                    Kas Bersih Operasional (Net Cashflow)
                  </div>
                  <div className="text-[11px] text-slate-400 font-sans mt-0.5">
                    Surplus / defisit kas dari operasional periode ini
                  </div>
                </div>
                <div className="text-lg font-black text-emerald-400">
                  {data && data.summary.netOperatingCashflow >= 0
                    ? `+${formatUSD(data.summary.netOperatingCashflow)}`
                    : formatUSD(data?.summary.netOperatingCashflow)}
                </div>
              </div>
            </div>
          </div>

          {/* Laporan Posisi Likuiditas (Neraca SMM) */}
          <div className="p-5 sm:p-6 rounded-3xl bg-white border border-slate-200/80 shadow-xs">
            <h3 className="font-black text-slate-900 text-sm tracking-tight flex items-center gap-2 mb-1">
              <Scale className="w-4 h-4 text-purple-600" />
              <span>Posisi Likuiditas &amp; Neraca (Assets vs Liabilities)</span>
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Perbandingan antara kewajiban saldo pengguna terhadap aset kas mengendap di supplier.
            </p>

            <div className="space-y-3 font-mono text-xs">
              <div className="p-3.5 rounded-2xl bg-purple-50/50 border border-purple-100 flex items-center justify-between">
                <div>
                  <div className="font-bold text-purple-900 font-sans">
                    Aset Kas Provider (Prepaid Supplier Float)
                  </div>
                  <div className="text-[11px] text-purple-700 font-sans mt-0.5">
                    Total deposit yang masih tersedia di semua akun API Provider
                  </div>
                </div>
                <div className="text-base font-black text-purple-700">
                  {data ? formatUSD(data.summary.totalProviderBalance) : "$0.00"}
                </div>
              </div>

              <div className="p-3.5 rounded-2xl bg-rose-50/50 border border-rose-100 flex items-center justify-between">
                <div>
                  <div className="font-bold text-rose-900 font-sans">
                    Liabilitas Saldo Member (Customer Balance Payable)
                  </div>
                  <div className="text-[11px] text-rose-700 font-sans mt-0.5">
                    Total saldo aktif milik {data?.summary.totalRegisteredUsers || 0} pengguna yang belum dibelanjakan
                  </div>
                </div>
                <div className="text-base font-black text-rose-600">
                  {data ? formatUSD(data.summary.userTotalBalance) : "$0.00"}
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-slate-900 text-white flex items-center justify-between mt-4">
                <div>
                  <div className="font-bold font-sans text-sm">
                    Bantalan Cadangan Kas (Net Liquidity Cushion)
                  </div>
                  <div className="text-[11px] text-slate-400 font-sans mt-0.5">
                    Tingkat kecukupan cadangan kas untuk menampung order member
                  </div>
                </div>
                <div className="text-lg font-black text-purple-300">
                  {data ? formatUSD(data.summary.netLiquidityCushion) : "$0.00"}
                </div>
              </div>
            </div>

            <div className="mt-4 p-3 rounded-2xl bg-slate-50 border border-slate-200/70 text-[11px] text-slate-600 flex items-start gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>
                <strong>Analisis Finansial:</strong> Untuk menjaga kelancaran otomatisasi SMM, pastikan total saldo di API Provider selalu melebihi estimasi volume pesanan harian.
              </span>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          TAB 5: JURNAL RINCIAN TRANSAKSI PESANAN (ORDER LEDGER)
         ========================================================================= */}
      {activeTab === "ledger" && (
        <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50/50">
            <div>
              <h3 className="font-black text-slate-900 text-sm">
                Buku Jurnal Rincian Pesanan
              </h3>
              <p className="text-xs text-slate-500">
                Log terperinci setiap transaksi pesanan beserta margin laba dan modal API masing-masing.
              </p>
            </div>

            <div className="flex items-center gap-2">
              {/* Search input */}
              <div className="relative w-full sm:w-64">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={ledgerSearch}
                  onChange={(e) => {
                    setLedgerSearch(e.target.value);
                    setLedgerPage(1);
                  }}
                  placeholder="Cari invoice, user, layanan..."
                  className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-slate-200 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-emerald-500 bg-white"
                />
              </div>

              <button
                onClick={() => handleExportCSV("csv_orders")}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-slate-700 bg-white border border-slate-200 hover:border-sky-300 hover:text-sky-700 transition-colors cursor-pointer shadow-2xs shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                <span>CSV Jurnal</span>
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100/70 border-b border-slate-200 text-slate-600 uppercase font-black text-[10px] tracking-wider">
                <tr>
                  <th className="py-3 px-4">Invoice / Waktu</th>
                  <th className="py-3 px-4">Member</th>
                  <th className="py-3 px-4">Layanan</th>
                  <th className="py-3 px-4 text-center">Status</th>
                  <th className="py-3 px-4 text-right">Modal API ($)</th>
                  <th className="py-3 px-4 text-right">Harga Jual ($)</th>
                  <th className="py-3 px-4 text-right">Laba ($)</th>
                  <th className="py-3 px-4 text-center">Margin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700 font-mono">
                {data?.ledger.orders && data.ledger.orders.length > 0 ? (
                  data.ledger.orders.map((ord) => (
                    <tr key={ord.id || ord.invoice} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900">{ord.invoice}</div>
                        <div className="text-[10px] text-slate-400 font-sans mt-0.5">
                          {new Date(ord.createAt).toLocaleString("id-ID", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </div>
                      </td>
                      <td className="py-3 px-4 font-sans">
                        <span className="font-bold text-slate-800">{ord.username}</span>
                        <div className="text-[10px] text-slate-400">Node: {ord.serverArea}</div>
                      </td>
                      <td className="py-3 px-4 font-sans max-w-xs">
                        <div className="font-bold text-slate-900 truncate">
                          {ord.serviceName}
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          Target: <span className="font-mono text-slate-600">{ord.target}</span> • Jml: {ord.amount}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-center font-sans">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            ord.status.toLowerCase() === "completed"
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                              : ord.status.toLowerCase() === "processing" || ord.status.toLowerCase() === "in progress"
                              ? "bg-blue-50 text-blue-700 border border-blue-200"
                              : ord.status.toLowerCase() === "canceled"
                              ? "bg-rose-50 text-rose-700 border border-rose-200"
                              : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {ord.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right text-amber-600 font-semibold">
                        {formatUSD(ord.priceApi, 4)}
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-slate-900">
                        {formatUSD(ord.priceSale, 4)}
                      </td>
                      <td className="py-3 px-4 text-right font-extrabold text-emerald-600">
                        +{formatUSD(ord.profit, 4)}
                      </td>
                      <td className="py-3 px-4 text-center font-sans">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">
                          {ord.marginPercent}%
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-400 font-sans">
                      Tidak ada data transaksi pesanan yang sesuai filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {data?.ledger && (
            <TablePagination
              currentPage={data.ledger.page}
              totalPages={data.ledger.totalPages}
              totalItems={data.ledger.total}
              itemsPerPage={data.ledger.limit}
              onPageChange={(p) => setLedgerPage(p)}
              onItemsPerPageChange={(l) => setLedgerLimit(l)}
              pageSizeOptions={[10, 20, 50, 100]}
            />
          )}
        </div>
      )}
    </div>
  );
}
