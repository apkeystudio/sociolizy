import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateMobileApp } from "@/lib/mobile-auth";

/**
 * GET /api/mobile/v1/blog
 * Menampilkan daftar artikel blog yang telah dipublikasikan untuk aplikasi mobile.
 * Query Parameters:
 * - page: nomor halaman (default: 1)
 * - limit: jumlah per halaman (default: 10, max: 50)
 * - category: slug atau ID kategori blog
 * - search: kata kunci pencarian judul, excerpt, atau tags
 * - tag: filter berdasarkan tag tertentu
 * - featured: jika "true", hanya artikel unggulan (is_featured = true)
 */
export async function GET(request: Request) {
  try {
    const appCheck = await validateMobileApp(request);
    if (!appCheck.valid) {
      return appCheck.errorResponse!;
    }

    const { searchParams } = new URL(request.url);
    const categoryParam = searchParams.get("category") || "";
    const search = searchParams.get("search")?.trim() || "";
    const tag = searchParams.get("tag")?.trim() || "";
    const featured = searchParams.get("featured") === "true";
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "10", 10)));
    const skip = (page - 1) * limit;

    // Filter dasar: hanya artikel yang PUBLISHED
    const where: any = {
      status: "PUBLISHED",
    };

    if (featured) {
      where.is_featured = true;
    }

    if (categoryParam && categoryParam !== "all") {
      const numCategoryId = Number(categoryParam);
      if (!isNaN(numCategoryId)) {
        where.category_id = numCategoryId;
      } else {
        where.category = {
          slug: categoryParam,
        };
      }
    }

    if (tag) {
      where.tags = {
        contains: tag,
        mode: "insensitive",
      };
    }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { excerpt: { contains: search, mode: "insensitive" } },
        { tags: { contains: search, mode: "insensitive" } },
      ];
    }

    const [articles, total, categories, featuredArticle] = await Promise.all([
      prisma.blogArticle.findMany({
        where,
        select: {
          id: true,
          uuid: true,
          title: true,
          slug: true,
          excerpt: true,
          cover_image: true,
          author_name: true,
          views: true,
          reading_time: true,
          tags: true,
          is_featured: true,
          published_at: true,
          create_at: true,
          category: {
            select: {
              id: true,
              name: true,
              slug: true,
              color: true,
            },
          },
        },
        orderBy: [{ is_featured: "desc" }, { published_at: "desc" }, { id: "desc" }],
        skip,
        take: limit,
      }),

      prisma.blogArticle.count({ where }),

      prisma.blogCategory.findMany({
        select: {
          id: true,
          name: true,
          slug: true,
          color: true,
          _count: {
            select: {
              articles: {
                where: { status: "PUBLISHED" },
              },
            },
          },
        },
        orderBy: { name: "asc" },
      }),

      // Jika di halaman 1 dan tidak ada filter spesifik, ambil 1 artikel featured utama
      page === 1 && !search && !categoryParam && !tag
        ? prisma.blogArticle.findFirst({
            where: { status: "PUBLISHED", is_featured: true },
            select: {
              id: true,
              uuid: true,
              title: true,
              slug: true,
              excerpt: true,
              cover_image: true,
              author_name: true,
              views: true,
              reading_time: true,
              tags: true,
              is_featured: true,
              published_at: true,
              create_at: true,
              category: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                  color: true,
                },
              },
            },
            orderBy: { published_at: "desc" },
          })
        : null,
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    return NextResponse.json({
      success: true,
      data: articles,
      featured: featuredArticle,
      categories: categories.map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        color: c.color || "emerald",
        article_count: c._count.articles,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    });
  } catch (error) {
    console.error("GET /api/mobile/v1/blog error:", error);
    return NextResponse.json(
      { success: false, message: "Gagal memuat artikel blog" },
      { status: 500 }
    );
  }
}
