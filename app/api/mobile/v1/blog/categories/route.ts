import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateMobileApp } from "@/lib/mobile-auth";

/**
 * GET /api/mobile/v1/blog/categories
 * Menampilkan daftar seluruh kategori blog beserta jumlah artikel yang terbit.
 */
export async function GET(request: Request) {
  try {
    const appCheck = await validateMobileApp(request);
    if (!appCheck.valid) {
      return appCheck.errorResponse!;
    }

    const categories = await prisma.blogCategory.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        uuid: true,
        name: true,
        slug: true,
        description: true,
        color: true,
        create_at: true,
        _count: {
          select: {
            articles: {
              where: { status: "PUBLISHED" },
            },
          },
        },
      },
    });

    const formatted = categories.map((c) => ({
      id: c.id,
      uuid: c.uuid,
      name: c.name,
      slug: c.slug,
      description: c.description,
      color: c.color || "emerald",
      article_count: c._count.articles,
      create_at: c.create_at,
    }));

    return NextResponse.json({
      success: true,
      data: formatted,
      total: formatted.length,
    });
  } catch (error) {
    console.error("GET /api/mobile/v1/blog/categories error:", error);
    return NextResponse.json(
      { success: false, message: "Gagal memuat kategori blog" },
      { status: 500 }
    );
  }
}
