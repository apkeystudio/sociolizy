import { NextResponse } from "next/server";
import { authenticateMobileUser } from "@/lib/mobile-auth";
import { getTicketById, addTicketMessage, updateTicketStatus } from "@/lib/ticket-db";
import { pusherServer } from "@/lib/pusher";

/**
 * GET /api/mobile/v1/ticket/[id]
 * Menampilkan detail lengkap tiket bantuan beserta seluruh riwayat pesan/chat.
 * Param:
 * - id: ticket_id (misal: "TKT-20261116-ABCDE")
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticateMobileUser(request);
    if (!auth.valid) {
      return auth.errorResponse!;
    }

    const { user } = auth;
    if (!user) {
      return NextResponse.json({ success: false, message: "Pengguna tidak ditemukan" }, { status: 404 });
    }

    const { id } = await context.params;

    if (!id || !id.trim()) {
      return NextResponse.json(
        { success: false, message: "ID tiket wajib disertakan" },
        { status: 400 }
      );
    }

    const cleanId = id.trim();
    const ticket = await getTicketById(cleanId, user.server_area, user.uuid);

    if (!ticket) {
      return NextResponse.json(
        { success: false, message: "Tiket bantuan tidak ditemukan" },
        { status: 404 }
      );
    }

    // Keamanan: pastikan tiket milik pengguna yang sedang login
    if (ticket.user_uuid !== user.uuid) {
      return NextResponse.json(
        { success: false, message: "Akses ditolak: Tiket ini bukan milik Anda" },
        { status: 403 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        ticket_id: ticket.ticket_id,
        subject: ticket.subject,
        category: ticket.category,
        status: ticket.status,
        priority: ticket.priority,
        username: ticket.username,
        email: ticket.email,
        server_area: ticket.server_area,
        messages: ticket.messages || [],
        created_at: ticket.created_at,
        updated_at: ticket.updated_at,
        resolved_at: ticket.resolved_at || null,
      },
    });
  } catch (error) {
    console.error("GET /api/mobile/v1/ticket/[id] error:", error);
    return NextResponse.json(
      { success: false, message: "Gagal memuat detail tiket bantuan" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/mobile/v1/ticket/[id]
 * Mengirim pesan balasan ke dalam tiket bantuan.
 * Request Body:
 * - message / content: teks balasan (wajib)
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticateMobileUser(request);
    if (!auth.valid) {
      return auth.errorResponse!;
    }

    const { user } = auth;
    if (!user) {
      return NextResponse.json({ success: false, message: "Pengguna tidak ditemukan" }, { status: 404 });
    }

    const { id } = await context.params;

    if (!id || !id.trim()) {
      return NextResponse.json(
        { success: false, message: "ID tiket wajib disertakan" },
        { status: 400 }
      );
    }

    const cleanId = id.trim();
    const ticket = await getTicketById(cleanId, user.server_area, user.uuid);

    if (!ticket) {
      return NextResponse.json(
        { success: false, message: "Tiket bantuan tidak ditemukan" },
        { status: 404 }
      );
    }

    if (ticket.user_uuid !== user.uuid) {
      return NextResponse.json(
        { success: false, message: "Akses ditolak: Tiket ini bukan milik Anda" },
        { status: 403 }
      );
    }

    if (ticket.status === "closed") {
      return NextResponse.json(
        {
          success: false,
          message: "Tiket ini telah ditutup. Silakan buat tiket baru jika membutuhkan bantuan lain.",
        },
        { status: 400 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const text = body.message || body.content;

    if (!text || typeof text !== "string" || !text.trim()) {
      return NextResponse.json(
        { success: false, message: "Isi pesan balasan tidak boleh kosong" },
        { status: 400 }
      );
    }

    const newMsg = await addTicketMessage(
      cleanId,
      {
        sender: "user",
        sender_name: user.username,
        content: text.trim(),
      },
      user.server_area,
      user.uuid
    );

    if (!newMsg) {
      return NextResponse.json(
        { success: false, message: "Gagal menyimpan pesan balasan" },
        { status: 500 }
      );
    }

    // Jika tiket sebelumnya "resolved", buka kembali ("open") karena ada balasan baru dari user
    if (ticket.status === "resolved") {
      await updateTicketStatus(cleanId, "open", user.server_area, user.uuid).catch(() => {});
    }

    // Picu Pusher realtime events (non-blocking)
    try {
      await Promise.allSettled([
        pusherServer.trigger(`ticket-${cleanId}`, "new-message", newMsg),
        pusherServer.trigger("admin-tickets", "ticket-updated", {
          ticket_id: cleanId,
          sender: "user",
          username: user.username,
        }),
        pusherServer.trigger("admin-notifications", "ticket-replied", {
          ticket_id: cleanId,
          username: user.username,
          content: newMsg.content.slice(0, 80),
        }),
      ]);
    } catch (pusherErr) {
      console.warn("Pusher notification trigger error (ignored):", pusherErr);
    }

    return NextResponse.json({
      success: true,
      message: "Pesan balasan berhasil dikirim!",
      data: newMsg,
    });
  } catch (error) {
    console.error("POST /api/mobile/v1/ticket/[id] error:", error);
    return NextResponse.json(
      { success: false, message: "Gagal mengirim balasan tiket bantuan" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/mobile/v1/ticket/[id]
 * Memperbarui status tiket (misal: user menutup tiket sendiri).
 * Request Body:
 * - status: 'closed'
 */
export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticateMobileUser(request);
    if (!auth.valid) {
      return auth.errorResponse!;
    }

    const { user } = auth;
    if (!user) {
      return NextResponse.json({ success: false, message: "Pengguna tidak ditemukan" }, { status: 404 });
    }

    const { id } = await context.params;
    const cleanId = id?.trim();

    const ticket = await getTicketById(cleanId, user.server_area, user.uuid);
    if (!ticket) {
      return NextResponse.json(
        { success: false, message: "Tiket bantuan tidak ditemukan" },
        { status: 404 }
      );
    }

    if (ticket.user_uuid !== user.uuid) {
      return NextResponse.json(
        { success: false, message: "Akses ditolak" },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { status } = body;

    if (status !== "closed") {
      return NextResponse.json(
        { success: false, message: "Hanya status 'closed' yang diizinkan untuk diubah oleh pengguna" },
        { status: 400 }
      );
    }

    const updated = await updateTicketStatus(cleanId, "closed", user.server_area, user.uuid);

    if (!updated) {
      return NextResponse.json(
        { success: false, message: "Gagal memperbarui status tiket" },
        { status: 500 }
      );
    }

    // Trigger Pusher notification
    try {
      await pusherServer.trigger("admin-tickets", "ticket-updated", {
        ticket_id: cleanId,
        status: "closed",
        sender: "user",
        username: user.username,
      });
    } catch {}

    return NextResponse.json({
      success: true,
      message: "Tiket berhasil ditutup.",
      data: {
        ticket_id: cleanId,
        status: "closed",
      },
    });
  } catch (error) {
    console.error("PUT /api/mobile/v1/ticket/[id] error:", error);
    return NextResponse.json(
      { success: false, message: "Gagal memperbarui status tiket" },
      { status: 500 }
    );
  }
}
