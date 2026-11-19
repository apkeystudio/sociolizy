"use client";

import React, { useEffect, useRef } from "react";
import { getPusherClient } from "@/lib/pusher-client";
import { useToast } from "./toast-context";

export default function AdminRealtimeNotifier() {
  const { toast } = useToast();
  const processedEventsRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    let channels: any[] = [];

    // Helper to prevent duplicate event processing across channels within 2 seconds
    const shouldProcessEvent = (key: string): boolean => {
      const now = Date.now();
      const last = processedEventsRef.current.get(key);
      if (last && now - last < 2000) {
        return false;
      }
      processedEventsRef.current.set(key, now);
      if (processedEventsRef.current.size > 200) {
        processedEventsRef.current.clear();
      }
      return true;
    };

    try {
      const pusher = getPusherClient();

      // 1. Channel: admin-notifications
      const notifChannel = pusher.subscribe("admin-notifications");
      channels.push(notifChannel);

      notifChannel.bind("user-registered", (data: any) => {
        const key = `user_registered:${data.username || ""}`;
        if (!shouldProcessEvent(key)) return;

        toast.info(
          "User Baru Terdaftar",
          `@${data.username} (${data.server_area || "SG"}) baru saja bergabung!`
        );
        window.dispatchEvent(new CustomEvent("master_smm:user_registered", { detail: data }));
      });

      notifChannel.bind("new-ticket", (data: any) => {
        const key = `new_ticket:${data.ticket_id || ""}`;
        if (!shouldProcessEvent(key)) return;

        toast.info(
          "Tiket Baru Masuk",
          `Tiket ${data.ticket_id} dari @${data.username}: "${data.subject}"`
        );
        window.dispatchEvent(new CustomEvent("master_smm:admin_ticket_updated", { detail: data }));
      });

      notifChannel.bind("ticket-replied", (data: any) => {
        const key = `ticket_replied:${data.ticket_id || ""}`;
        if (!shouldProcessEvent(key)) return;

        toast.info(
          "Balasan Tiket",
          `@${data.username} membalas tiket ${data.ticket_id}`
        );
        window.dispatchEvent(new CustomEvent("master_smm:admin_ticket_updated", { detail: data }));
      });

      notifChannel.bind("order-created", (data: any) => {
        const key = `order_created:${data.invoice || ""}`;
        if (!shouldProcessEvent(key)) return;

        toast.info(
          "Pesanan Baru Masuk",
          `@${data.username} memesan ${data.service_name || "Layanan"} ($${Number(data.price_sale || 0).toFixed(2)}) - ${data.invoice}`
        );
        window.dispatchEvent(new CustomEvent("master_smm:admin_order_created", { detail: data }));
      });

      notifChannel.bind("deposit-created", (data: any) => {
        const key = `deposit_created:${data.order_id || ""}`;
        if (!shouldProcessEvent(key)) return;

        toast.info(
          "Deposit Baru Dibuat",
          `@${data.username} membuat invoice deposit Cryptomus sebesar $${Number(data.amount || 0).toFixed(2)} (${data.status})`
        );
        window.dispatchEvent(new CustomEvent("master_smm:admin_deposit_created", { detail: data }));
      });

      notifChannel.bind("order-status-updated", (data: any) => {
        const key = `order_status_updated:${data.invoice}:${data.status}`;
        if (!shouldProcessEvent(key)) return;

        // If the admin manually updated this in the current tab, suppress duplicate toast
        const isSelfUpdated = typeof window !== "undefined" && sessionStorage.getItem("last_admin_manual_invoice") === data.invoice;
        if (!isSelfUpdated) {
          toast.success(
            "Status Pesanan Diperbarui",
            `Invoice ${data.invoice} sekarang berstatus: ${data.status}`
          );
        }
        window.dispatchEvent(new CustomEvent("master_smm:admin_order_updated", { detail: data }));
      });

      notifChannel.bind("deposit-status-updated", (data: any) => {
        const key = `deposit_status_updated:${data.order_id}:${data.status}`;
        if (!shouldProcessEvent(key)) return;

        const isPaid = data.status === "paid" || data.status === "paid_over";
        if (isPaid) {
          toast.success(
            "Deposit Berhasil Diterima",
            `Pembayaran deposit ${data.order_id} sebesar $${Number(data.amount || 0).toFixed(2)} telah lunas (Paid)!`
          );
        } else {
          toast.info(
            "Status Deposit Diperbarui",
            `Invoice deposit ${data.order_id} statusnya berubah menjadi ${data.status}`
          );
        }
        window.dispatchEvent(new CustomEvent("master_smm:admin_deposit_updated", { detail: data }));
      });

      // 2. Channel: admin-orders
      const ordersChannel = pusher.subscribe("admin-orders");
      channels.push(ordersChannel);

      ordersChannel.bind("order-status-updated", (data: any) => {
        const key = `order_status_updated:${data.invoice}:${data.status}`;
        if (!shouldProcessEvent(key)) return;
        window.dispatchEvent(new CustomEvent("master_smm:admin_order_updated", { detail: data }));
      });

      ordersChannel.bind("new-order", (data: any) => {
        const key = `order_created:${data.invoice || ""}`;
        if (!shouldProcessEvent(key)) return;
        window.dispatchEvent(new CustomEvent("master_smm:admin_order_created", { detail: data }));
      });

      // 3. Channel: admin-deposits
      const depositsChannel = pusher.subscribe("admin-deposits");
      channels.push(depositsChannel);

      depositsChannel.bind("deposit-status-updated", (data: any) => {
        const key = `deposit_status_updated:${data.order_id}:${data.status}`;
        if (!shouldProcessEvent(key)) return;
        window.dispatchEvent(new CustomEvent("master_smm:admin_deposit_updated", { detail: data }));
      });
    } catch (err) {
      console.warn("[Pusher] AdminRealtimeNotifier initialization warning:", err);
    }

    return () => {
      channels.forEach((ch) => ch.unbind_all());
    };
  }, [toast]);

  return null;
}

