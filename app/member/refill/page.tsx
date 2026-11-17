"use client";

import React, { useState, useEffect, useMemo, Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import {
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Search,
  ExternalLink,
  ShieldCheck,
  Info,
  Clock,
  ArrowRight,
  History,
  Check,
} from "lucide-react";

interface OrderOption {
  id: number;
  invoice: string;
  order_id: string | null;
  service_id: string;
  amount: number;
  price_sale: string | number;
  target: string;
  status: string;
  server_area?: string;
  refill?: boolean;
  create_at: string;
}

interface RecentRefillItem {
  id: number;
  refill_id: string;
  invoice: string;
  order_id: string;
  service_id: string;
  service_name?: string;
  target: string;
  amount: number;
  status: string;
  create_at: string;
}

function RefillFormContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // URL query parameters
  const queryOrderId = searchParams.get("order_id") || "";
  const queryInvoice = searchParams.get("invoice") || "";
  const queryServiceId = searchParams.get("service_id") || "";
  const queryTarget = searchParams.get("target") || "";
  const queryAmount = searchParams.get("amount") || "";

  // Component state
  const [orders, setOrders] = useState<OrderOption[]>([]);
  const [recentRefills, setRecentRefills] = useState<RecentRefillItem[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [loadingRecent, setLoadingRecent] = useState(true);

  // Form input state
  const [selectedOrderId, setSelectedOrderId] = useState<string>(queryOrderId || queryInvoice || "");
  const [manualOrderId, setManualOrderId] = useState<string>(queryOrderId || "");
  const [isManualInput, setIsManualInput] = useState<boolean>(false);
  const [orderSearch, setOrderSearch] = useState<string>("");

  // Submission state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [alertInfo, setAlertInfo] = useState<{
    type: "success" | "error";
    message: string;
    refillId?: string;
  } | null>(null);

  // 1. Fetch user's orders
  useEffect(() => {
    async function loadOrders() {
      try {
        setLoadingOrders(true);
        const res = await fetch("/api/member/order?limit=100");
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          setOrders(json.data);

          // If query param matches an order, select it
          if (queryInvoice || queryOrderId) {
            const matched = json.data.find(
              (o: OrderOption) =>
                (queryInvoice && o.invoice.toLowerCase() === queryInvoice.toLowerCase()) ||
                (queryOrderId && o.order_id === queryOrderId) ||
                (queryOrderId && String(o.id) === queryOrderId)
            );
            if (matched) {
              setSelectedOrderId(matched.order_id || matched.invoice);
            }
          }
        }
      } catch (err) {
        console.error("Failed to load orders for refill:", err);
      } finally {
        setLoadingOrders(false);
      }
    }

    async function loadRecentRefills() {
      try {
        setLoadingRecent(true);
        const res = await fetch("/api/member/refill?limit=5");
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          setRecentRefills(json.data);
        }
      } catch (err) {
        console.error("Failed to load recent refills:", err);
      } finally {
        setLoadingRecent(false);
      }
    }

    loadOrders();
    loadRecentRefills();
  }, [queryInvoice, queryOrderId]);

  // Find currently selected order object
  const selectedOrder = useMemo(() => {
    if (!selectedOrderId) return null;
    return (
      orders.find(
        (o) =>
          o.order_id === selectedOrderId ||
          o.invoice.toLowerCase() === selectedOrderId.toLowerCase() ||
          String(o.id) === selectedOrderId
      ) || null
    );
  }, [orders, selectedOrderId]);

  // Filtered orders list for the selector
  const eligibleOrders = useMemo(() => {
    return orders.filter((o) => {
      if (!orderSearch.trim()) return true;
      const s = orderSearch.toLowerCase();
      return (
        o.invoice.toLowerCase().includes(s) ||
        (o.order_id && o.order_id.toLowerCase().includes(s)) ||
        o.target.toLowerCase().includes(s) ||
        o.service_id.toLowerCase().includes(s)
      );
    });
  }, [orders, orderSearch]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAlertInfo(null);

    const orderIdToSubmit = isManualInput ? manualOrderId.trim() : selectedOrderId;

    if (!orderIdToSubmit) {
      setAlertInfo({
        type: "error",
        message: "Please select or enter an Order ID or Invoice.",
      });
      return;
    }

    try {
      setIsSubmitting(true);
      const res = await fetch("/api/member/refill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_id: orderIdToSubmit,
          invoice: selectedOrder?.invoice,
        }),
      });

      const json = await res.json();

      if (json.success && json.data) {
        setAlertInfo({
          type: "success",
          message: json.message || "Refill request submitted successfully!",
          refillId: json.data.refill_id,
        });

        // Add to recent list
        setRecentRefills((prev) => [json.data, ...prev.slice(0, 4)]);
      } else {
        setAlertInfo({
          type: "error",
          message: json.message || "Failed to submit refill request. Please check your order.",
        });
      }
    } catch (err: any) {
      setAlertInfo({
        type: "error",
        message: "Network error occurred. Please try again in a few moments.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 w-full space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
            <RotateCcw className="w-5 h-5 text-emerald-600" />
            <span>Request Refill</span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 mt-1">
            Submit a refill request for dropped followers, likes, or views on your eligible orders.
          </p>
        </div>

        <div className="flex items-center gap-2.5 self-start sm:self-auto">
          <Link
            href="/member/history/refill"
            className="px-3.5 py-2 rounded-xl bg-white border border-slate-200 hover:border-emerald-300 hover:text-emerald-700 font-bold text-xs sm:text-sm text-slate-700 flex items-center gap-1.5 shadow-2xs transition-all cursor-pointer"
          >
            <History className="w-4 h-4 text-emerald-600" />
            <span>Refill History</span>
          </Link>
        </div>
      </div>

      {/* Alerts */}
      {alertInfo && (
        <div
          className={`p-4 rounded-2xl border text-xs sm:text-sm flex items-start gap-3 animate-in fade-in duration-200 ${
            alertInfo.type === "success"
              ? "bg-emerald-50/90 border-emerald-200 text-emerald-900"
              : "bg-rose-50/90 border-rose-200 text-rose-900"
          }`}
        >
          {alertInfo.type === "success" ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-5 h-5 text-rose-600 flex-shrink-0 mt-0.5" />
          )}
          <div className="flex-1">
            <p className="font-semibold">{alertInfo.message}</p>
            {alertInfo.refillId && (
              <div className="mt-2 flex items-center gap-3">
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                  Refill ID #{alertInfo.refillId}
                </span>
                <Link
                  href="/member/history/refill"
                  className="font-semibold text-emerald-700 hover:text-emerald-800 underline flex items-center gap-1 text-xs"
                >
                  <span>Track in Refill History</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Form (Span 2) */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 sm:p-6">
            <div className="flex items-center justify-between pb-4 mb-5 border-b border-slate-100">
              <h2 className="text-sm sm:text-base font-bold text-slate-900 flex items-center gap-2">
                <span>Select Order for Refill</span>
              </h2>

              <button
                type="button"
                onClick={() => {
                  setIsManualInput(!isManualInput);
                  setAlertInfo(null);
                }}
                className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 underline cursor-pointer"
              >
                {isManualInput ? "Choose from Order List" : "Enter Order ID Manually"}
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Order Selection Mode */}
              {!isManualInput ? (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    Choose Order <span className="text-rose-500">*</span>
                  </label>

                  {loadingOrders ? (
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-500 flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
                      <span>Loading your placed orders...</span>
                    </div>
                  ) : orders.length === 0 ? (
                    <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600">
                      No orders found in your account yet.{" "}
                      <Link href="/member/order" className="text-emerald-600 font-bold underline">
                        Place an order
                      </Link>{" "}
                      first.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {/* Search Filter for Dropdown */}
                      <div className="relative">
                        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          placeholder="Filter orders by Invoice, Order ID, or Target..."
                          value={orderSearch}
                          onChange={(e) => setOrderSearch(e.target.value)}
                          className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:border-emerald-500"
                        />
                      </div>

                      <select
                        value={selectedOrderId}
                        onChange={(e) => {
                          setSelectedOrderId(e.target.value);
                          setAlertInfo(null);
                        }}
                        className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs sm:text-sm text-slate-900 bg-white focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 font-medium cursor-pointer"
                        required
                      >
                        <option value="">-- Select an Order --</option>
                        {eligibleOrders.map((ord) => (
                          <option
                            key={ord.id}
                            value={ord.order_id || ord.invoice}
                          >
                            {ord.invoice} ({ord.status}) — Qty: {ord.amount.toLocaleString()} — {ord.target.slice(0, 35)}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              ) : (
                /* Manual Input Mode */
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    Order ID or Invoice Number <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. 102944 or INV-20261117-91024"
                    value={manualOrderId}
                    onChange={(e) => {
                      setManualOrderId(e.target.value);
                      setAlertInfo(null);
                    }}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs sm:text-sm text-slate-900 bg-white focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 font-mono"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    Enter the Provider Order ID (from provider) or your local Invoice number.
                  </p>
                </div>
              )}

              {/* Order Details Preview Card */}
              {selectedOrder && (
                <div className="p-4 rounded-xl bg-emerald-50/50 border border-emerald-200/80 space-y-3 animate-in fade-in duration-150">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-900 flex items-center gap-1.5">
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Order Details Found</span>
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-semibold border border-emerald-200">
                      {selectedOrder.status}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="text-slate-500 block text-[11px]">Invoice:</span>
                      <span className="font-mono font-bold text-slate-800">{selectedOrder.invoice}</span>
                    </div>

                    <div>
                      <span className="text-slate-500 block text-[11px]">Provider Order ID:</span>
                      <span className="font-mono font-bold text-slate-800">
                        {selectedOrder.order_id || "(Will be resolved via invoice)"}
                      </span>
                    </div>

                    <div className="sm:col-span-2">
                      <span className="text-slate-500 block text-[11px]">Target Link:</span>
                      <span className="font-mono text-slate-800 break-all select-all">
                        {selectedOrder.target}
                      </span>
                    </div>

                    <div>
                      <span className="text-slate-500 block text-[11px]">Ordered Quantity:</span>
                      <span className="font-semibold text-slate-800">
                        {selectedOrder.amount.toLocaleString()}
                      </span>
                    </div>

                    <div>
                      <span className="text-slate-500 block text-[11px]">Order Date:</span>
                      <span className="text-slate-700">
                        {new Date(selectedOrder.create_at).toLocaleDateString("en-US", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Guidance / Conditions Notice */}
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-600 text-xs space-y-1.5">
                <div className="flex items-center gap-1.5 font-bold text-slate-800">
                  <Info className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Before Submitting Refill:</span>
                </div>
                <ul className="list-disc list-inside space-y-0.5 text-[11px] text-slate-600 pl-1">
                  <li>Ensure the target account/post is <strong>Public</strong> and not deleted.</li>
                  <li>Do not change your username or URL while refill is in progress.</li>
                  <li>Provider APIs usually process refills within 1 to 24 hours.</li>
                </ul>
              </div>

              {/* Submit Button */}
              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isSubmitting || (!selectedOrderId && !manualOrderId.trim())}
                  className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] font-bold text-xs sm:text-sm text-white flex items-center justify-center gap-2 shadow-xs transition-all disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Submitting Refill to Provider...</span>
                    </>
                  ) : (
                    <>
                      <RotateCcw className="w-4 h-4" />
                      <span>Submit Refill Request</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Right Column: Refill Guidelines & Benefits */}
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 sm:p-6 space-y-4">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <h3 className="text-sm font-bold text-slate-900">Refill Guarantee Policy</h3>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Services marked with <strong>Refill Guarantee</strong> allow you to request automated replenishment free of charge whenever drops occur during the warranty period.
            </p>

            <div className="space-y-3 pt-2 text-xs">
              <div className="flex items-start gap-2.5">
                <div className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">
                  1
                </div>
                <div>
                  <h4 className="font-semibold text-slate-900">Check Your Count</h4>
                  <p className="text-slate-500 text-[11px]">
                    Confirm your current followers/likes are below the start count + ordered quantity.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <div className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">
                  2
                </div>
                <div>
                  <h4 className="font-semibold text-slate-900">1-Click Dispatch</h4>
                  <p className="text-slate-500 text-[11px]">
                    We forward the refill request directly to the API provider cluster in real-time.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <div className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">
                  3
                </div>
                <div>
                  <h4 className="font-semibold text-slate-900">Track Progress</h4>
                  <p className="text-slate-500 text-[11px]">
                    Monitor real-time status in your Refill History tab with live status checks.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Section: Recent Refills Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 sm:p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm sm:text-base font-bold text-slate-900 flex items-center gap-2">
            <Clock className="w-4 h-4 text-emerald-600" />
            <span>Recent Refill Requests</span>
          </h3>

          <Link
            href="/member/history/refill"
            className="text-xs font-bold text-emerald-600 hover:text-emerald-700 flex items-center gap-1"
          >
            <span>View All Records</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {loadingRecent ? (
          <div className="py-8 text-center text-slate-400 text-xs flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
            <span>Loading recent refill records...</span>
          </div>
        ) : recentRefills.length === 0 ? (
          <div className="py-8 text-center text-slate-400 text-xs">
            No refill requests submitted yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-100 text-slate-500 font-semibold uppercase text-[10px] tracking-wider">
                  <th className="py-2.5 px-3">Refill ID</th>
                  <th className="py-2.5 px-3">Invoice</th>
                  <th className="py-2.5 px-3">Order ID</th>
                  <th className="py-2.5 px-3">Target</th>
                  <th className="py-2.5 px-3 text-center">Status</th>
                  <th className="py-2.5 px-3 text-right">Requested At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recentRefills.map((ref) => (
                  <tr key={ref.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="py-2.5 px-3 font-mono font-bold text-emerald-700">
                      #{ref.refill_id}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-700 font-semibold">
                      {ref.invoice}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-600">
                      {ref.order_id}
                    </td>
                    <td className="py-2.5 px-3 max-w-[200px] truncate text-slate-800" title={ref.target}>
                      {ref.target}
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
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
                    <td className="py-2.5 px-3 text-right text-slate-500 whitespace-nowrap text-[11px]">
                      {new Date(ref.create_at).toLocaleDateString("en-US", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default function MemberRefillPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-7xl mx-auto px-4 py-16 text-center text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin mx-auto text-emerald-600 mb-2" />
          <p className="text-xs">Loading refill form...</p>
        </div>
      }
    >
      <RefillFormContent />
    </Suspense>
  );
}
