import { NextResponse } from "next/server";
import { authenticateMobileUser } from "@/lib/mobile-auth";
import { createTicket, getTicketsByUser, TicketCategory, TicketPriority, TicketStatus } from "@/lib/ticket-db";
import { pusherServer } from "@/lib/pusher";

/**
 * GET /api/mobile/v1/ticket
 * Mengambil daftar seluruh tiket bantuan milik pengguna yang sedang login.
 * Query Parameters:
 * - status: filter status ('open', 'in_progress', 'resolved', 'closed', atau 'all')
 * - category: filter kategori ('general', 'billing', 'technical', 'order')
 * - search: pencarian berdasarkan ticket_id atau subject
 * - limit: jumlah maksimal tiket yang diambil (default: 50, max: 100)
 */
export async function GET(request: Request) {
  try {
    const auth = await authenticateMobileUser(request);
    if (!auth.valid) {
      return auth.errorResponse!;
    }

    const { user } = auth;
    if (!user) {
      return NextResponse.json({ success: false, message: "Pengguna tidak ditemukan" }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const statusParam = searchParams.get("status") || "all";
    const categoryParam = searchParams.get("category") || "all";
    const searchParam = searchParams.get("search")?.trim().toLowerCase() || "";
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50", 10)));

    const rawTickets = await getTicketsByUser(user.uuid, user.server_area || "SG_1", 200);

    // Hitung statistik tiket pengguna
    const stats = {
      total: rawTickets.length,
      open: rawTickets.filter((t) => t.status === "open").length,
      in_progress: rawTickets.filter((t) => t.status === "in_progress").length,
      resolved: rawTickets.filter((t) => t.status === "resolved").length,
      closed: rawTickets.filter((t) => t.status === "closed").length,
    };

    // Filter berdasarkan status, kategori, atau pencarian
    let filtered = rawTickets;

    if (statusParam && statusParam !== "all") {
      filtered = filtered.filter((t) => t.status === statusParam);
    }

    if (categoryParam && categoryParam !== "all") {
      filtered = filtered.filter((t) => t.category === categoryParam);
    }

    if (searchParam) {
      filtered = filtered.filter(
        (t) =>
          t.ticket_id.toLowerCase().includes(searchParam) ||
          t.subject.toLowerCase().includes(searchParam)
      );
    }

    // Ambil sesuai limit
    const paginated = filtered.slice(0, limit);

    // Format data yang dikirim ke aplikasi mobile
    const formatted = paginated.map((t) => {
      const lastMsg = t.messages && t.messages.length > 0 ? t.messages[t.messages.length - 1] : null;
      return {
        ticket_id: t.ticket_id,
        subject: t.subject,
        category: t.category,
        status: t.status,
        priority: t.priority,
        messages_count: t.messages ? t.messages.length : 0,
        last_message: lastMsg
          ? {
              sender: lastMsg.sender,
              sender_name: lastMsg.sender_name,
              content: lastMsg.content,
              created_at: lastMsg.created_at,
            }
          : null,
        created_at: t.created_at,
        updated_at: t.updated_at,
        resolved_at: t.resolved_at || null,
      };
    });

    return NextResponse.json({
      success: true,
      data: formatted,
      stats,
      total: formatted.length,
    });
  } catch (error) {
    console.error("GET /api/mobile/v1/ticket error:", error);
    return NextResponse.json(
      { success: false, message: "Gagal mengambil daftar tiket bantuan" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/mobile/v1/ticket
 * Membuat tiket bantuan baru dari aplikasi mobile.
 * Request Body:
 * - subject: judul/topik tiket (string, wajib, min 3 karakter)
 * - category: kategori ('general', 'billing', 'technical', 'order') (wajib)
 * - priority: tingkat prioritas ('low', 'normal', 'high', 'urgent') (opsional, default: 'normal')
 * - message: isi pesan pertama (string, wajib)
 */
export async function POST(request: Request) {
  try {
    const auth = await authenticateMobileUser(request);
    if (!auth.valid) {
      return auth.errorResponse!;
    }

    const { user } = auth;
    if (!user) {
      return NextResponse.json({ success: false, message: "Pengguna tidak ditemukan" }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const { subject, category, priority = "normal", message } = body;

    // Validasi input
    if (!subject || typeof subject !== "string" || subject.trim().length < 3) {
      return NextResponse.json(
        { success: false, message: "Subjek tiket wajib diisi (minimal 3 karakter)" },
        { status: 400 }
      );
    }

    const validCategories: TicketCategory[] = ["general", "billing", "technical", "order"];
    if (!category || !validCategories.includes(category as TicketCategory)) {
      return NextResponse.json(
        {
          success: false,
          message: `Kategori tidak valid. Pilihan: ${validCategories.join(", ")}`,
        },
        { status: 400 }
      );
    }

    const validPriorities: TicketPriority[] = ["low", "normal", "high", "urgent"];
    const finalPriority: TicketPriority = validPriorities.includes(priority as TicketPriority)
      ? (priority as TicketPriority)
      : "normal";

    const contentText = typeof message === "string" ? message.trim() : "";
    if (!contentText) {
      return NextResponse.json(
        { success: false, message: "Isi pesan tiket bantuan wajib diisi" },
        { status: 400 }
      );
    }

    // Buat tiket di database cluster MongoDB pengguna
    const ticket = await createTicket({
      user_uuid: user.uuid,
      username: user.username,
      email: user.email || "",
      server_area: user.server_area || "SG_1",
      subject: subject.trim(),
      category: category as TicketCategory,
      priority: finalPriority,
      first_message: contentText,
    });

    // Kirim notifikasi realtime via Pusher ke Admin Panel (non-blocking)
    try {
      await Promise.allSettled([
        pusherServer.trigger("admin-tickets", "new-ticket", {
          ticket_id: ticket.ticket_id,
          subject: ticket.subject,
          username: ticket.username,
          category: ticket.category,
          priority: ticket.priority,
          created_at: ticket.created_at,
        }),
        pusherServer.trigger("admin-notifications", "new-ticket", {
          ticket_id: ticket.ticket_id,
          subject: ticket.subject,
          username: ticket.username,
          category: ticket.category,
          priority: ticket.priority,
          created_at: ticket.created_at,
        }),
      ]);
    } catch (pusherErr) {
      console.warn("Pusher notification trigger error (ignored):", pusherErr);
    }

    return NextResponse.json(
      {
        success: true,
        message: "Tiket bantuan berhasil dibuat!",
        data: {
          ticket_id: ticket.ticket_id,
          subject: ticket.subject,
          category: ticket.category,
          status: ticket.status,
          priority: ticket.priority,
          messages: ticket.messages,
          created_at: ticket.created_at,
          updated_at: ticket.updated_at,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST /api/mobile/v1/ticket error:", error);
    return NextResponse.json(
      { success: false, message: "Gagal membuat tiket bantuan baru" },
      { status: 500 }
    );
  }
}
