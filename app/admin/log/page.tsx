"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  ScrollText,
  Search,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Eye,
  Filter,
  Users,
  Smartphone,
  Store,
  Server,
  Loader2,
  Clock,
  Terminal,
  Copy,
  Check,
  ChevronRight,
} from "lucide-react";
import TablePagination from "@/app/admin/components/table-pagination";
import { useToast } from "@/app/admin/components/toast-context";

interface TraceLog {
  _id: string;
  type: "user" | "smm" | "merchant" | "mobile";
  action: string;
  status: "SUCCESS" | "FAILED" | "WARNING";
  status_code?: number;
  user_id?: string | number | null;
  username?: string | null;
  ip?: string | null;
  user_agent?: string | null;
  endpoint: string;
  method: string;
  request_payload?: any;
  response_payload?: any;
  latency_ms?: number;
  error_message?: string | null;
  metadata?: Record<string, any>;
  create_at: string;
}

interface LogStats {
  total: number;
  userCount: number;
  smmCount: number;
  merchantCount: number;
  mobileCount: number;
  failedCount: number;
  successCount: number;
}

export default function AdminLogPage() {
  const { toast } = useToast();

  const [logs, setLogs] = useState<TraceLog[]>([]);
  const [stats, setStats] = useState<LogStats>({
    total: 0,
    userCount: 0,
    smmCount: 0,
    merchantCount: 0,
    mobileCount: 0,
    failedCount: 0,
    successCount: 0,
  });

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<"all" | "user" | "smm" | "merchant" | "mobile">("all");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(15);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);

  // Detail Modal State
  const [selectedLog, setSelectedLog] = useState<TraceLog | null>(null);
  const [copiedSection, setCopiedSection] = useState<string | null>(null);

  const fetchLogs = useCallback(
    async (showLoading = true) => {
      if (showLoading) setIsLoading(true);
      else setIsRefreshing(true);

      try {
        const query = new URLSearchParams({
          page: String(currentPage),
          limit: String(itemsPerPage),
          type: activeTab,
          status: statusFilter,
          search: search.trim(),
        });

        const res = await fetch(`/api/admin/log?${query.toString()}`);
        const json = await res.json();

        if (json.success) {
          setLogs(json.data || []);
          if (json.pagination) {
            setTotalPages(json.pagination.totalPages || 1);
            setTotalItems(json.pagination.total || 0);
          }
          if (json.stats) {
            setStats(json.stats);
          }
        } else {
          toast.error("Gagal Memuat Log", json.message || "Gagal memuat log dari MongoDB.");
        }
      } catch (err: any) {
        toast.error("Kesalahan Jaringan", err?.message || "Terjadi kesalahan saat memuat log.");
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [currentPage, itemsPerPage, activeTab, statusFilter, search, toast]
  );

  useEffect(() => {
    fetchLogs(true);
  }, [fetchLogs]);

  // Handle Generate Test Trace
  const handleCreateTestLog = async (type: string) => {
    try {
      const res = await fetch("/api/admin/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "TEST_VERIFICATION",
          type,
          message: `Manual verification trace for ${type.toUpperCase()}`,
        }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success("Test Trace Berhasil", json.message);
        fetchLogs(false);
      } else {
        toast.error("Gagal", json.message);
      }
    } catch (err: any) {
      toast.error("Gagal", err?.message);
    }
  };

  const handleCopy = (text: string, section: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSection(section);
    setTimeout(() => setCopiedSection(null), 2000);
  };

  const getTypeBadge = (type: string) => {
    switch (type) {
      case "user":
        return {
          bg: "bg-blue-50 text-blue-700 border-blue-200",
          icon: Users,
          label: "USER",
        };
      case "smm":
        return {
          bg: "bg-purple-50 text-purple-700 border-purple-200",
          icon: Server,
          label: "SMM API",
        };
      case "merchant":
        return {
          bg: "bg-emerald-50 text-emerald-700 border-emerald-200",
          icon: Store,
          label: "MERCHANT",
        };
      case "mobile":
        return {
          bg: "bg-amber-50 text-amber-700 border-amber-200",
          icon: Smartphone,
          label: "MOBILE",
        };
      default:
        return {
          bg: "bg-slate-50 text-slate-700 border-slate-200",
          icon: Terminal,
          label: type.toUpperCase(),
        };
    }
  };

  const getStatusBadge = (status: string, code?: number) => {
    if (status === "SUCCESS") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
          <span>{code || 200} SUCCESS</span>
        </span>
      );
    }
    if (status === "WARNING") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
          <AlertTriangle className="w-3 h-3 text-amber-600" />
          <span>{code || 300} WARN</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
        <XCircle className="w-3 h-3 text-rose-600" />
        <span>{code || 400} FAILED</span>
      </span>
    );
  };

  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleString("id-ID", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
            <ScrollText className="w-6 h-6 text-emerald-600" />
            <span>Log Sistem & Trace</span>
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fetchLogs(false)}
            disabled={isRefreshing || isLoading}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 shadow-sm transition-all cursor-pointer disabled:opacity-50"
            title="Refresh log"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-slate-500 ${isRefreshing ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </button>

          <button
            type="button"
            onClick={() => handleCreateTestLog(activeTab === "all" ? "user" : activeTab)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200/80 shadow-sm transition-all cursor-pointer"
            title="Buat trace uji coba ke MongoDB"
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>Test Trace</span>
          </button>
        </div>
      </div>

      {/* 7-Day Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-xs">
          <div className="text-[11px] font-semibold text-slate-500">Total Log (7 Hari)</div>
          <div className="text-xl font-extrabold text-slate-900 mt-0.5">{stats.total.toLocaleString()}</div>
          <div className="text-[10px] text-emerald-600 font-medium mt-1">Rotasi otomatis 7 hari</div>
        </div>

        <div className="bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-xs">
          <div className="text-[11px] font-semibold text-blue-600 flex items-center gap-1">
            <Users className="w-3 h-3" />
            <span>User Activity</span>
          </div>
          <div className="text-xl font-extrabold text-slate-900 mt-0.5">{stats.userCount.toLocaleString()}</div>
          <div className="text-[10px] text-slate-400 mt-1">Auth & aktivitas</div>
        </div>

        <div className="bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-xs">
          <div className="text-[11px] font-semibold text-purple-600 flex items-center gap-1">
            <Server className="w-3 h-3" />
            <span>SMM API</span>
          </div>
          <div className="text-xl font-extrabold text-slate-900 mt-0.5">{stats.smmCount.toLocaleString()}</div>
          <div className="text-[10px] text-slate-400 mt-1">/api/v1 calls</div>
        </div>

        <div className="bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-xs">
          <div className="text-[11px] font-semibold text-emerald-600 flex items-center gap-1">
            <Store className="w-3 h-3" />
            <span>Merchant API</span>
          </div>
          <div className="text-xl font-extrabold text-slate-900 mt-0.5">{stats.merchantCount.toLocaleString()}</div>
          <div className="text-[10px] text-slate-400 mt-1">Gateway invoices</div>
        </div>

        <div className="bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-xs">
          <div className="text-[11px] font-semibold text-amber-600 flex items-center gap-1">
            <Smartphone className="w-3 h-3" />
            <span>Mobile API</span>
          </div>
          <div className="text-xl font-extrabold text-slate-900 mt-0.5">{stats.mobileCount.toLocaleString()}</div>
          <div className="text-[10px] text-slate-400 mt-1">Mobile client</div>
        </div>

        <div className="bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-xs">
          <div className="text-[11px] font-semibold text-rose-600 flex items-center gap-1">
            <XCircle className="w-3 h-3" />
            <span>Gagal / Error</span>
          </div>
          <div className="text-xl font-extrabold text-rose-700 mt-0.5">{stats.failedCount.toLocaleString()}</div>
          <div className="text-[10px] text-slate-400 mt-1">Status non-2xx</div>
        </div>
      </div>

      {/* Main Content Card */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        {/* Navigation Tabs */}
        <div className="flex items-center overflow-x-auto border-b border-slate-100 px-4 pt-3 gap-2">
          {[
            { id: "all", label: "Semua Log", icon: ScrollText },
            { id: "user", label: "Pengguna (User)", icon: Users },
            { id: "smm", label: "SMM API", icon: Server },
            { id: "merchant", label: "Merchant Gateway", icon: Store },
            { id: "mobile", label: "Mobile API", icon: Smartphone },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setActiveTab(tab.id as any);
                  setCurrentPage(1);
                }}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-t-xl text-xs font-bold transition-all cursor-pointer border-b-2 whitespace-nowrap ${
                  isActive
                    ? "border-emerald-600 text-emerald-700 bg-emerald-50/40"
                    : "border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Filters Bar */}
        <div className="p-4 bg-slate-50/50 border-b border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="Cari username, IP, aksi, endpoint..."
              className="w-full pl-9 pr-3.5 py-2 rounded-xl text-xs bg-white border border-slate-200 text-slate-800 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none shadow-xs"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="flex items-center gap-1.5 bg-white px-3 py-1.5 rounded-xl border border-slate-200 text-xs shadow-xs">
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="bg-transparent text-xs font-semibold text-slate-700 focus:outline-none cursor-pointer"
              >
                <option value="ALL">Semua Status</option>
                <option value="SUCCESS">Success (2xx)</option>
                <option value="FAILED">Failed / Error</option>
              </select>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="py-20 text-center text-slate-400">
              <Loader2 className="w-7 h-7 animate-spin mx-auto text-emerald-600 mb-2" />
              <p className="text-xs font-medium">Memuat data trace dari MongoDB...</p>
            </div>
          ) : logs.length === 0 ? (
            <div className="py-20 text-center text-slate-400">
              <ScrollText className="w-10 h-10 mx-auto text-slate-300 mb-2" />
              <p className="font-semibold text-slate-700 text-sm">Belum ada riwayat log</p>
              <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                Log aktivitas User, SMM API, Merchant, dan Mobile API otomatis terekam di sini dan dirotasi per 7 hari.
              </p>
            </div>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50/70 border-b border-slate-200/70 text-slate-500 uppercase font-bold text-[11px] tracking-wider">
                <tr>
                  <th className="py-3.5 px-4">Waktu</th>
                  <th className="py-3.5 px-4">Tipe</th>
                  <th className="py-3.5 px-4">Aksi</th>
                  <th className="py-3.5 px-4">Endpoint</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4">Pengguna</th>
                  <th className="py-3.5 px-4">IP Client</th>
                  <th className="py-3.5 px-4">Latency</th>
                  <th className="py-3.5 px-4 text-right">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {logs.map((log) => {
                  const typeBadge = getTypeBadge(log.type);
                  const TypeIcon = typeBadge.icon;
                  return (
                    <tr key={log._id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-4 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                        {formatDate(log.create_at)}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${typeBadge.bg}`}
                        >
                          <TypeIcon className="w-2.5 h-2.5" />
                          <span>{typeBadge.label}</span>
                        </span>
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-900 whitespace-nowrap">
                        {log.action}
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px] text-slate-600 max-w-xs truncate">
                        <span className="font-bold text-slate-400 mr-1">{log.method}</span>
                        <span>{log.endpoint}</span>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        {getStatusBadge(log.status, log.status_code)}
                      </td>
                      <td className="py-3 px-4 font-medium text-slate-800 whitespace-nowrap">
                        {log.username || (log.user_id ? `ID #${log.user_id}` : "-")}
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                        {log.ip || "-"}
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                        {log.latency_ms !== undefined ? `${log.latency_ms} ms` : "-"}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setSelectedLog(log)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200/80 transition-colors cursor-pointer"
                        >
                          <Eye className="w-3 h-3" />
                          <span>Detail</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination Footer */}
        <TablePagination
          currentPage={currentPage}
          totalPages={totalPages}
          totalItems={totalItems}
          itemsPerPage={itemsPerPage}
          onPageChange={setCurrentPage}
          onItemsPerPageChange={setItemsPerPage}
        />
      </div>

      {/* Detail Modal */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-xl border border-slate-100 animate-in zoom-in-95 duration-150 max-h-[90vh] flex flex-col">
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-100">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-slate-900">{selectedLog.action}</h3>
                  {getStatusBadge(selectedLog.status, selectedLog.status_code)}
                </div>
                <p className="text-xs text-slate-500 font-mono mt-0.5">
                  {selectedLog.method} {selectedLog.endpoint}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 text-xs cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto my-4 space-y-4 pr-1 text-xs">
              {/* Key metadata grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3 bg-slate-50 rounded-xl border border-slate-200/70">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Tipe</span>
                  <span className="font-semibold text-slate-800">{selectedLog.type.toUpperCase()}</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Pengguna</span>
                  <span className="font-semibold text-slate-800">{selectedLog.username || "-"}</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">IP Client</span>
                  <span className="font-mono text-slate-800">{selectedLog.ip || "-"}</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Latency</span>
                  <span className="font-mono text-slate-800">{selectedLog.latency_ms || 0} ms</span>
                </div>
                <div className="col-span-2">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Timestamp</span>
                  <span className="font-mono text-slate-700">{formatDate(selectedLog.create_at)}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">TTL Rotasi</span>
                  <span className="text-emerald-700 font-semibold">Aktif (Hapus otomatis per 7 hari)</span>
                </div>
              </div>

              {/* User Agent */}
              {selectedLog.user_agent && (
                <div>
                  <div className="text-[11px] font-bold text-slate-700 mb-1">User Agent:</div>
                  <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200 text-slate-600 font-mono text-[11px] break-all">
                    {selectedLog.user_agent}
                  </div>
                </div>
              )}

              {/* Error Message if any */}
              {selectedLog.error_message && (
                <div>
                  <div className="text-[11px] font-bold text-rose-700 mb-1">Error Message:</div>
                  <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 font-mono text-[11px] whitespace-pre-wrap">
                    {selectedLog.error_message}
                  </div>
                </div>
              )}

              {/* Request Payload */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-bold text-slate-700">Request Payload (Sanitized):</span>
                  <button
                    type="button"
                    onClick={() =>
                      handleCopy(JSON.stringify(selectedLog.request_payload, null, 2), "req")
                    }
                    className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-500 hover:text-slate-800 cursor-pointer"
                  >
                    {copiedSection === "req" ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-600" />
                        <span className="text-emerald-600">Disalin!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Salin JSON</span>
                      </>
                    )}
                  </button>
                </div>
                <pre className="p-3 bg-slate-900 text-emerald-400 rounded-xl font-mono text-[11px] overflow-x-auto max-h-48 leading-relaxed">
                  {selectedLog.request_payload
                    ? JSON.stringify(selectedLog.request_payload, null, 2)
                    : "// Tidak ada request body"}
                </pre>
              </div>

              {/* Response Payload */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-bold text-slate-700">Response Payload:</span>
                  <button
                    type="button"
                    onClick={() =>
                      handleCopy(JSON.stringify(selectedLog.response_payload, null, 2), "res")
                    }
                    className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-500 hover:text-slate-800 cursor-pointer"
                  >
                    {copiedSection === "res" ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-600" />
                        <span className="text-emerald-600">Disalin!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Salin JSON</span>
                      </>
                    )}
                  </button>
                </div>
                <pre className="p-3 bg-slate-900 text-slate-200 rounded-xl font-mono text-[11px] overflow-x-auto max-h-48 leading-relaxed">
                  {selectedLog.response_payload
                    ? JSON.stringify(selectedLog.response_payload, null, 2)
                    : "// Tidak ada response body"}
                </pre>
              </div>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-slate-100">
              <span className="text-[11px] text-slate-400">
                Log ID: {selectedLog._id}
              </span>
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors cursor-pointer"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

