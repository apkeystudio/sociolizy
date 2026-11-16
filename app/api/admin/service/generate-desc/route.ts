import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { invalidateCacheTag } from "@/lib/server-cache";
import { generateServiceDescription } from "@/lib/service-desc-generator";

// Helper chunk processor for controlled concurrency
async function processInChunks<T, R>(
  items: T[],
  chunkSize: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const chunkResults = await Promise.all(chunk.map((item) => fn(item)));
    results.push(...chunkResults);
  }
  return results;
}

// GET: Ambil statistik layanan untuk modal Generate Otomatis Semua Layanan
export async function GET() {
  try {
    const [totalServices, emptyDescServices] = await Promise.all([
      prisma.service.count(),
      prisma.service.count({
        where: {
          OR: [{ desc: null }, { desc: "" }],
        },
      }),
    ]);

    const filledDescServices = Math.max(0, totalServices - emptyDescServices);

    // Ambil daftar kategori beserta statistik layanan kosong per kategori
    const categories = await prisma.category.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        _count: {
          select: {
            services: true,
          },
        },
      },
    });

    // Hitung layanan kosong per kategori
    const emptyCountsPerCategory = await prisma.service.groupBy({
      by: ["id_category"],
      where: {
        OR: [{ desc: null }, { desc: "" }],
      },
      _count: {
        id: true,
      },
    });

    const emptyCountMap = new Map<number, number>();
    emptyCountsPerCategory.forEach((g) => {
      emptyCountMap.set(g.id_category, g._count.id);
    });

    const categoryStats = categories.map((c) => ({
      id: c.id,
      name: c.name,
      total: c._count.services,
      empty: emptyCountMap.get(c.id) || 0,
    }));

    // Cek API Key Gemini
    const setting = await prisma.setting.findFirst({
      select: { gemini_api: true },
    });
    const hasApiKey = Boolean(setting?.gemini_api && setting.gemini_api.trim().length > 0);

    return NextResponse.json({
      success: true,
      totalServices,
      emptyDescServices,
      filledDescServices,
      hasApiKey,
      categories: categoryStats,
    });
  } catch (error: any) {
    console.error("GET /api/admin/service/generate-desc error:", error);
    return NextResponse.json(
      {
        success: false,
        message: error?.message || "Gagal mengambil statistik generate layanan",
      },
      { status: 500 }
    );
  }
}

// POST: Eksekusi generate deskripsi (Single, Bulk Terpilih, atau Otomatis Semua)
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const {
      service_id,
      service_name,
      id_category,
      category_name,
      idea,
      min,
      max,
      save_to_db = false,
      ids, // array id untuk bulk dari checkbox
      generate_all = false, // flag untuk generate semua layanan
      only_empty = true, // default hanya isi yang deskripsinya kosong
      limit = 20, // batch limit
      preview_only = false, // jika true, hanya generate 1 contoh tanpa simpan ke DB
    } = body;

    // 1. Ambil Gemini API key
    const setting = await prisma.setting.findFirst({
      select: { gemini_api: true },
    });

    const apiKey = setting?.gemini_api?.trim() || process.env.GEMINI_API_KEY?.trim();

    if (!apiKey) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Gemini API Key belum diatur di Pengaturan. Silakan tambahkan API key di Pengaturan > API Gemini.",
        },
        { status: 400 }
      );
    }

    // 2. Mode GENERATE SEMUA LAYANAN (atau difilter per kategori)
    if (generate_all) {
      const where: any = {};
      if (id_category && !isNaN(Number(id_category))) {
        where.id_category = Number(id_category);
      }
      if (only_empty) {
        where.OR = [{ desc: null }, { desc: "" }];
      }

      const batchLimit = Math.max(1, Math.min(100, Number(limit) || 20));
      const services = await prisma.service.findMany({
        where,
        take: preview_only ? 1 : batchLimit,
        include: {
          category: {
            select: { name: true, id: true },
          },
        },
        orderBy: { id: "asc" },
      });

      if (services.length === 0) {
        return NextResponse.json({
          success: true,
          count: 0,
          updated: [],
          message: "Tidak ada layanan yang perlu dibuat deskripsinya.",
        });
      }

      // Pre-fetch data_detail context per kategori
      const categoryIds = Array.from(new Set(services.map((s) => s.id_category).filter(Boolean)));
      const dataDetails = await prisma.dataDetail.findMany({
        where: { id_category: { in: categoryIds } },
      });
      const dataDetailMap = new Map<number, string>();
      dataDetails.forEach((dd) => {
        if (!dataDetailMap.has(dd.id_category)) {
          dataDetailMap.set(dd.id_category, dd.conteks);
        }
      });

      const updatedResults: Array<{ id: number; service_name: string; desc: string }> = [];
      const errors: string[] = [];

      // Proses paralel terkontrol (3 layanan concurrent)
      await processInChunks(services, 3, async (service) => {
        const catName = service.category?.name || "General";
        const templateContext = service.id_category ? dataDetailMap.get(service.id_category) || "" : "";

        try {
          const cleaned = await generateServiceDescription(apiKey, {
            service_name: service.service_name,
            category_name: catName,
            min: service.min,
            max: service.max,
            context_reference: templateContext,
          });

          if (!preview_only) {
            await prisma.service.update({
              where: { id: service.id },
              data: { desc: cleaned },
            });
          }

          updatedResults.push({
            id: service.id,
            service_name: service.service_name,
            desc: cleaned,
          });
        } catch (err: any) {
          const errMsg = err?.message || String(err);
          errors.push(`Service #${service.id} (${service.service_name}): ${errMsg}`);
        }
      });

      if (!preview_only) {
        invalidateCacheTag("services");
      }

      return NextResponse.json({
        success: true,
        preview_only,
        count: updatedResults.length,
        updated: updatedResults,
        errors: errors.length > 0 ? errors : undefined,
        message: preview_only
          ? "Pratinjau deskripsi AI berhasil dibuat."
          : `Berhasil menghasilkan deskripsi untuk ${updatedResults.length} layanan.`,
      });
    }

    // 3. Mode BULK DARI CHECKBOX TABEL
    if (Array.isArray(ids) && ids.length > 0) {
      const numericIds = ids.map((id) => Number(id)).filter((id) => !isNaN(id));
      if (numericIds.length === 0) {
        return NextResponse.json(
          { success: false, message: "ID layanan tidak valid" },
          { status: 400 }
        );
      }

      const services = await prisma.service.findMany({
        where: { id: { in: numericIds } },
        include: {
          category: {
            select: { name: true, id: true },
          },
        },
      });

      if (services.length === 0) {
        return NextResponse.json(
          { success: false, message: "Layanan tidak ditemukan" },
          { status: 404 }
        );
      }

      const categoryIds = Array.from(new Set(services.map((s) => s.id_category).filter(Boolean)));
      const dataDetails = await prisma.dataDetail.findMany({
        where: { id_category: { in: categoryIds } },
      });
      const dataDetailMap = new Map<number, string>();
      dataDetails.forEach((dd) => {
        if (!dataDetailMap.has(dd.id_category)) {
          dataDetailMap.set(dd.id_category, dd.conteks);
        }
      });

      const updatedResults: Array<{ id: number; service_name: string; desc: string }> = [];
      const errors: string[] = [];

      await processInChunks(services, 3, async (service) => {
        const catName = service.category?.name || "General";
        const templateContext = service.id_category ? dataDetailMap.get(service.id_category) || "" : "";

        try {
          const cleaned = await generateServiceDescription(apiKey, {
            service_name: service.service_name,
            category_name: catName,
            min: service.min,
            max: service.max,
            context_reference: templateContext,
          });

          await prisma.service.update({
            where: { id: service.id },
            data: { desc: cleaned },
          });

          updatedResults.push({
            id: service.id,
            service_name: service.service_name,
            desc: cleaned,
          });
        } catch (err: any) {
          errors.push(`Service #${service.id} (${service.service_name}): ${err?.message || err}`);
        }
      });

      invalidateCacheTag("services");

      return NextResponse.json({
        success: true,
        count: updatedResults.length,
        updated: updatedResults,
        errors: errors.length > 0 ? errors : undefined,
        message: `Berhasil menghasilkan deskripsi untuk ${updatedResults.length} layanan.`,
      });
    }

    // 4. Mode SINGLE (dari form Create, Edit, atau tombol baris tabel)
    if (!service_name || !String(service_name).trim()) {
      return NextResponse.json(
        { success: false, message: "Nama layanan wajib diisi untuk referensi AI." },
        { status: 400 }
      );
    }

    const cleanTitle = String(service_name).trim();

    let catName = category_name || "";
    let templateContext = "";

    if (id_category) {
      const category = await prisma.category.findUnique({
        where: { id: Number(id_category) },
        select: { name: true },
      });
      if (category?.name) catName = category.name;

      const dataDetail = await prisma.dataDetail.findFirst({
        where: { id_category: Number(id_category) },
        select: { conteks: true },
      });
      if (dataDetail?.conteks) {
        templateContext = dataDetail.conteks;
      }
    }

    const cleaned = await generateServiceDescription(apiKey, {
      service_name: cleanTitle,
      category_name: catName,
      min: min ? Number(min) : undefined,
      max: max ? Number(max) : undefined,
      idea: idea ? String(idea).trim() : undefined,
      context_reference: templateContext,
    });

    if (save_to_db && service_id) {
      await prisma.service.update({
        where: { id: Number(service_id) },
        data: { desc: cleaned },
      });
      invalidateCacheTag("services");
    }

    return NextResponse.json({
      success: true,
      description: cleaned,
      service_id: service_id ? Number(service_id) : undefined,
      message: "Deskripsi berhasil dibuat dengan AI.",
    });
  } catch (error: any) {
    console.error("POST /api/admin/service/generate-desc error:", error);
    return NextResponse.json(
      {
        success: false,
        message: error?.message || "Terjadi kesalahan saat menghasilkan deskripsi AI.",
      },
      { status: 500 }
    );
  }
}
