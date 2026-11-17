"use client";

import React, { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import {
  RotateCcw,
  Search,
  RefreshCw,
  Loader2,
  PlusCircle,
  X,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import MemberTablePagination from "@/app/member/components/table-pagination";

interface RefillHistoryItem {
  id: number;
  refill_id: string;
  invoice: string;
  order_id: string;
  service_id: string;
  service_name?: string;
  target: string;
  amount: number;
  status: string;
  server_area?: string;
  create_at: string;
  update_at?: string;
}

export default function MemberRefillHistoryPage() {
  const [refills, setRefills] = useState<RefillHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [checkingId, setCheckingId] = useState<string | null>(null);

  // Status feedback toast
  const [toastMessage, setToastMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const fetchRefills = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/member/refill?limit=100");
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setRefills(json.data);
      }
    } catch (err) {
      console.error("Failed to load refill history:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRefills();
  }, []);

  const handleCheckStatus = async (refillId: string) => {
    try {
      setCheckingId(refillId);
      const res = await fetch("/api/member/refill/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refill_id: refillId }),
      });
      const json = await res.json();

      if (json.success && json.status) {
        setRefills((prev) =>
          prev.map((r) =>
            r.refill_id === refillId ? { ...r, status: json.status } : r
          )
        );
        setToastMessage({
          type: "success",
          text: `Refill #${refillId} status is currently: ${json.status}`,
        });
      } else {
        setToastMessage({
          type: "error",
          text: json.message || "Failed to check refill status from provider.",
        });
      }
    } catch (err) {
      setToastMessage({
        type: "error",
        text: "Network error while checking refill status.",
      });
    } finally {
      setCheckingId(null);
      setTimeout(() => setToastMessage(null), 4000);
    }
  };

  const filteredRefills = useMemo(() => {
    return refills.filter((ref) => {
      const s = searchTerm.toLowerCase();
      const matchesSearch =
        ref.refill_id.toLowerCase().includes(s) ||
        ref.invoice.toLowerCase().includes(s) ||
        ref.order_id.toLowerCase().includes(s) ||
        ref.target.toLowerCase().includes(s) ||
        (ref.service_name && ref.service_name.toLowerCase().includes(s));

      const matchesStatus =
        statusFilter === "all" ||
        ref.status.toLowerCase() === statusFilter.toLowerCase();

      return matchesSearch && matchesStatus;
    });
  }, [refills, searchTerm, statusFilter]);

  const totalPages = Math.ceil(filteredRefills.length / itemsPerPage) || 1;

  const paginatedRefills = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredRefills.slice(start, start + itemsPerPage);
  }, [filteredRefills, currentPage, itemsPerPage]);

  const handleSearchChange = (val: string) => {
    setSearchTerm(val);
    setCurrentPage(1);
  };

  const handleStatusChange = (val: string) => {
    setStatusFilter(val);
    setCurrentPage(1);
  };

  const handleClearFilters = () => {
    setSearchTerm("");
    setStatusFilter("all");
    setCurrentPage(1);
  };

  const isFiltered = searchTerm.trim() !== "" || statusFilter !== "all";

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 w-full space-y-6">
      {/* Toast Notification */}
      {toastMessage && (
        <div
          className={`fixed bottom-6 right-6 z-50 p-4 rounded-2xl shadow-lg border text-xs sm:text-sm flex items-center gap-2.5 animate-in fade-in duration-200 ${
            toastMessage.type === "success"
              ? "bg-slate-900 text-white border-slate-700"
              : "bg-rose-900 text-white border-rose-700"
          }`}
        >
          {toastMessage.type === "success" ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
          )}
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* Page Title & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
            <RotateCcw className="w-5 h-5 text-emerald-600" />
            <span>Refill History</span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 mt-1">
            Track and check real-time progress for all your submitted refill requests.
          </p>
        </div>

        <div className="flex items-center gap-2.5 self-start sm:self-auto">
          <Link
            href="/member/refill"
            className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 font-bold text-xs sm:text-sm text-white flex items-center gap-1.5 shadow-xs transition-all cursor-pointer"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>New Refill</span>
          </Link>
        </div>
      </div>

      <div className="space-y-4">
        {/* Filters and Search Bar */}
        <div className="bg-white border border-slate-200 rounded-xl p-3 sm:p-3.5 flex flex-col sm:flex-row items-center gap-3 justify-between shadow-xs">
          <div className="relative w-full sm:w-80">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search Refill ID, Invoice, or Target..."
              value={searchTerm}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="w-full pl-9 pr-9 py-2 bg-slate-50/60 border border-slate-200 rounded-xl text-xs sm:text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => handleSearchChange("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 rounded cursor-pointer"
                title="Clear Search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end">
            <select
              value={statusFilter}
              onChange={(e) => handleStatusChange(e.target.value)}
              className="bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs sm:text-sm text-slate-900 focus:outline-none focus:border-emerald-500 font-medium cursor-pointer"
            >
              <option value="all">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="in progress">In Progress</option>
              <option value="completed">Completed</option>
              <option value="rejected">Rejected</option>
              <option value="error">Error</option>
            </select>

            {isFiltered && (
              <button
                type="button"
                onClick={handleClearFilters}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 hover:text-rose-600 text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer"
                title="Reset Filters"
              >
                <X className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Reset</span>
              </button>
            )}

            <button
              onClick={fetchRefills}
              disabled={loading}
              className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-700 hover:bg-slate-100 text-xs sm:text-sm font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
              title="Refresh List"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin text-emerald-600" : ""}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Datatable Card */}
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-slate-700 font-bold bg-slate-50 uppercase tracking-wider text-[11px]">
                  <th className="py-3 px-3.5">Refill ID</th>
                  <th className="py-3 px-3.5">Invoice</th>
                  <th className="py-3 px-3.5">Order ID</th>
                  <th className="py-3 px-3.5">Service</th>
                  <th className="py-3 px-3.5">Target</th>
                  <th className="py-3 px-3.5 text-right">Quantity</th>
                  <th className="py-3 px-3.5 text-center">Status</th>
                  <th className="py-3 px-3.5 text-right">Date Requested</th>
                  <th className="py-3 px-3.5 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={9} className="py-16 text-center text-slate-400">
                      <Loader2 className="w-5 h-5 animate-spin mx-auto text-emerald-600 mb-2" />
                      <span className="text-xs">Loading refill history...</span>
                    </td>
                  </tr>
                ) : filteredRefills.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-14 text-center text-slate-400 text-xs sm:text-sm">
                      <p className="font-semibold text-slate-700 mb-1">
                        {isFiltered ? "No Matching Refill Records Found" : "No Refills Requested Yet"}
                      </p>
                      <p className="text-xs text-slate-500 max-w-sm mx-auto mb-3">
                        {isFiltered
                          ? "Try adjusting your search criteria or status filter."
                          : "You have not submitted any refill requests. Request a refill if an order experiences follower/like drop."}
                      </p>
                      {isFiltered ? (
                        <button
                          type="button"
                          onClick={handleClearFilters}
                          className="px-3.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs transition-colors cursor-pointer"
                        >
                          Clear Filters
                        </button>
                      ) : (
                        <Link
                          href="/member/refill"
                          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs transition-colors cursor-pointer shadow-xs"
                        >
                          <PlusCircle className="w-3.5 h-3.5" />
                          <span>Request Refill Now</span>
                        </Link>
                      )}
                    </td>
                  </tr>
                ) : (
                  paginatedRefills.map((ref) => (
                    <tr key={ref.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-2.5 px-3.5 font-mono font-bold text-emerald-700">
                        #{ref.refill_id}
                      </td>
                      <td className="py-2.5 px-3.5 font-mono font-semibold text-slate-800">
                        {ref.invoice}
                      </td>
                      <td className="py-2.5 px-3.5 font-mono text-slate-600 text-xs">
                        {ref.order_id}
                      </td>
                      <td className="py-2.5 px-3.5 max-w-[200px] truncate text-slate-800" title={ref.service_name || ref.service_id}>
                        {ref.service_name || `Service #${ref.service_id}`}
                      </td>
                      <td className="py-2.5 px-3.5 max-w-[200px] truncate text-slate-800" title={ref.target}>
                        {ref.target}
                      </td>
                      <td className="py-2.5 px-3.5 text-right font-mono text-slate-900 font-semibold">
                        {ref.amount.toLocaleString()}
                      </td>
                      <td className="py-2.5 px-3.5 text-center">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold border ${
                            ref.status === "Completed"
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : ref.status === "In progress" || ref.status === "Processing"
                              ? "bg-sky-50 text-sky-700 border-sky-200"
                              : ref.status === "Rejected" || ref.status === "Error"
                              ? "bg-rose-50 text-rose-700 border-rose-200"
                              : "bg-amber-50 text-amber-700 border-amber-200"
                          }`}
                        >
                          {ref.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3.5 text-right text-slate-500 whitespace-nowrap text-[11px]">
                        {new Date(ref.create_at).toLocaleDateString("en-US", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="py-2.5 px-3.5 text-center">
                        <button
                          type="button"
                          onClick={() => handleCheckStatus(ref.refill_id)}
                          disabled={checkingId === ref.refill_id}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 transition-colors disabled:opacity-50 cursor-pointer shadow-2xs"
                          title="Check live status from provider"
                        >
                          <RefreshCw
                            className={`w-3 h-3 ${checkingId === ref.refill_id ? "animate-spin text-emerald-600" : ""}`}
                          />
                          <span>Check</span>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          <MemberTablePagination
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={filteredRefills.length}
            itemsPerPage={itemsPerPage}
            onPageChange={(p) => setCurrentPage(p)}
            onItemsPerPageChange={(l) => setItemsPerPage(l)}
            pageSizeOptions={[10, 20, 50]}
          />
        </div>
      </div>
    </div>
  );
}
