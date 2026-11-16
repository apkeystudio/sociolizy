import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { invalidateCacheTag } from "@/lib/server-cache";
import { generateServiceDescription } from "@/lib/service-desc-generator";

// GET: Cek informasi statistik layanan yang deskripsinya kosong untuk kategori/data-detail
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const dataDetailId = searchParams.get("data_detail_id");
    const categoryId = searchParams.get("id_category");

    if (!dataDetailId && !categoryId) {
      return NextResponse.json(
        { success: false, message: "ID data detail atau ID kategori diperlukan" },
        { status: 400 }
      );
    }

    let targetCategoryId: number | null = null;
    let dataDetail = null;

    if (dataDetailId) {
      dataDetail = await prisma.dataDetail.findUnique({
        where: { id: Number(dataDetailId) },
        include: {
          category: {
            select: { id: true, name: true, slug: true },
          },
        },
      });
      if (dataDetail) {
        targetCategoryId = dataDetail.id_category;
      }
    } else if (categoryId) {
      targetCategoryId = Number(categoryId);
      dataDetail = await prisma.dataDetail.findFirst({
        where: { id_category: targetCategoryId },
        include: {
          category: {
            select: { id: true, name: true, slug: true },
          },
        },
      });
    }

    if (!targetCategoryId) {
      return NextResponse.json(
        { success: false, message: "Data detail tidak ditemukan" },
        { status: 404 }
      );
    }

    // Hitung total layanan dan layanan yang deskripsinya kosong
    const [totalServices, emptyDescServices] = await Promise.all([
      prisma.service.count({
        where: { id_category: targetCategoryId },
      }),
      prisma.service.count({
        where: {
          id_category: targetCategoryId,
          OR: [{ desc: null }, { desc: "" }],
        },
      }),
    ]);

    // Cek apakah Gemini API key sudah diset di setting
    const setting = await prisma.setting.findFirst({
      orderBy: { id: "asc" },
      select: { gemini_api: true },
    });
    const hasApiKey = Boolean(setting?.gemini_api && setting.gemini_api.trim().length > 0);

    return NextResponse.json({
      success: true,
      categoryId: targetCategoryId,
      categoryName: dataDetail?.category?.name || "Kategori",
      conteks: dataDetail?.conteks || "",
      hasTitleTag: dataDetail ? /\{title\}|\{TITLE\}|\{judul\}/.test(dataDetail.conteks) : false,
      totalServices,
      emptyDescServices,
      hasApiKey,
    });
  } catch (error) {
    console.error("GET /api/admin/data-detail/generate error:", error);
    const message = error instanceof Error ? error.message : "Gagal mengambil statistik generate";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}

// POST: Jalankan generate deskripsi menggunakan Gemini
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      data_detail_id,
      id_category,
      overwrite = false,
      limit = 10,
      preview_only = false,
    } = body;

    // 1. Ambil Gemini API Key
    const setting = await prisma.setting.findFirst({
      orderBy: { id: "asc" },
      select: { gemini_api: true },
    });
    const apiKey = setting?.gemini_api?.trim() || process.env.GEMINI_API_KEY?.trim();

    if (!apiKey) {
      return NextResponse.json(
        {
          success: false,
          message:
            "API Key Google Gemini belum diatur. Silakan atur Gemini API Key di menu Admin > Pengaturan Sistem.",
        },
        { status: 400 }
      );
    }

    // 2. Tentukan DataDetail acuan
    let dataDetail = null;
    if (data_detail_id) {
      dataDetail = await prisma.dataDetail.findUnique({
        where: { id: Number(data_detail_id) },
        include: {
          category: {
            select: { id: true, name: true },
          },
        },
      });
    } else if (id_category) {
      dataDetail = await prisma.dataDetail.findFirst({
        where: { id_category: Number(id_category) },
        include: {
          category: {
            select: { id: true, name: true },
          },
        },
      });
    }

    if (!dataDetail) {
      return NextResponse.json(
        {
          success: false,
          message: "Data detail acuan konteks tidak ditemukan untuk kategori yang dipilih.",
        },
        { status: 404 }
      );
    }

    const templateConteks = dataDetail.conteks;
    const categoryName = dataDetail.category.name;

    // 3. Cari layanan yang akan di-generate
    const where: any = { id_category: dataDetail.id_category };
    if (!overwrite) {
      where.OR = [{ desc: null }, { desc: "" }];
    }

    const batchLimit = Math.max(1, Math.min(50, Number(limit) || 10));
    const services = await prisma.service.findMany({
      where,
      orderBy: { id: "asc" },
      take: preview_only ? 1 : batchLimit,
      select: {
        id: true,
        service_name: true,
        desc: true,
        min: true,
        max: true,
      },
    });

    if (services.length === 0) {
      return NextResponse.json({
        success: true,
        count: 0,
        message: "Tidak ada layanan yang perlu diisi deskripsinya.",
        updatedServices: [],
      });
    }

    // 4. Proses generate tiap layanan dengan Gemini
    const results: Array<{
      id: number;
      service_name: string;
      desc: string;
    }> = [];
    const errors: string[] = [];

    for (const service of services) {
      try {
        const cleanDesc = await generateServiceDescription(apiKey, {
          service_name: service.service_name,
          category_name: categoryName,
          min: service.min,
          max: service.max,
          context_reference: templateConteks,
        });

        // Save to database if not preview
        if (!preview_only) {
          await prisma.service.update({
            where: { id: service.id },
            data: { desc: cleanDesc },
          });
        }

        results.push({
          id: service.id,
          service_name: service.service_name,
          desc: cleanDesc,
        });
      } catch (genError) {
        const errMsg = genError instanceof Error ? genError.message : String(genError);
        console.error(`Error generating for service #${service.id}:`, errMsg);
        errors.push(errMsg);
      }
    }

    if (results.length === 0 && errors.length > 0) {
      return NextResponse.json(
        {
          success: false,
          message: `Gagal men-generate deskripsi: ${errors[0]}`,
        },
        { status: 500 }
      );
    }

    if (!preview_only) {
      invalidateCacheTag("services");
    }

    return NextResponse.json({
      success: true,
      preview_only,
      count: results.length,
      message: preview_only
        ? "Pratinjau deskripsi AI berhasil dibuat"
        : `Berhasil men-generate deskripsi untuk ${results.length} layanan`,
      updatedServices: results,
    });
  } catch (error) {
    console.error("POST /api/admin/data-detail/generate error:", error);
    const message = error instanceof Error ? error.message : "Gagal memproses generate deskripsi";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
