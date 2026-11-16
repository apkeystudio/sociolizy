import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateMobileApp } from "@/lib/mobile-auth";

/**
 * GET /api/mobile/v1/blog/[slug]
 * Menampilkan detail lengkap artikel blog berdasarkan slug atau ID.
 * Otomatis menambahkan view counter artikel.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> }
) {
  try {
    const appCheck = await validateMobileApp(request);
    if (!appCheck.valid) {
      return appCheck.errorResponse!;
    }

    const { slug } = await context.params;

    if (!slug || !slug.trim()) {
      return NextResponse.json(
        { success: false, message: "Slug atau ID artikel wajib diisi" },
        { status: 400 }
      );
    }

    const cleanSlug = slug.trim();
    const numId = Number(cleanSlug);

    // Cari berdasarkan slug atau id
    const where: any = {
      status: "PUBLISHED",
      ...(isNaN(numId) ? { slug: cleanSlug } : { OR: [{ slug: cleanSlug }, { id: numId }] }),
    };

    const article = await prisma.blogArticle.findFirst({
      where,
      include: {
        category: {
          select: {
            id: true,
            name: true,
            slug: true,
            color: true,
            description: true,
          },
        },
        author: {
          select: {
            id: true,
            username: true,
            name: true,
          },
        },
      },
    });

    if (!article) {
      return NextResponse.json(
        { success: false, message: "Artikel tidak ditemukan atau belum dipublikasikan" },
        { status: 404 }
      );
    }

    // Naikkan view count artikel secara asinkron di latar belakang
    prisma.blogArticle
      .update({
        where: { id: article.id },
        data: { views: { increment: 1 } },
      })
      .catch((err) => console.error("Error incrementing mobile article views:", err));

    // Ambil 3 artikel terkait (dalam kategori yang sama jika ada)
    const relatedArticles = await prisma.blogArticle.findMany({
      where: {
        status: "PUBLISHED",
        id: { not: article.id },
        ...(article.category_id ? { category_id: article.category_id } : {}),
      },
      select: {
        id: true,
        title: true,
        slug: true,
        excerpt: true,
        cover_image: true,
        reading_time: true,
        published_at: true,
        category: {
          select: {
            name: true,
            slug: true,
            color: true,
          },
        },
      },
      take: 3,
      orderBy: { published_at: "desc" },
    });

    return NextResponse.json({
      success: true,
      data: {
        id: article.id,
        uuid: article.uuid,
        title: article.title,
        slug: article.slug,
        excerpt: article.excerpt,
        content: article.content,
        cover_image: article.cover_image,
        author_name: article.author_name || article.author?.name || "Sociolizy Team",
        views: article.views + 1,
        reading_time: article.reading_time,
        tags: article.tags,
        is_featured: article.is_featured,
        meta_title: article.meta_title,
        meta_description: article.meta_description,
        published_at: article.published_at,
        create_at: article.create_at,
        category: article.category,
      },
      related: relatedArticles,
    });
  } catch (error) {
    console.error("GET /api/mobile/v1/blog/[slug] error:", error);
    return NextResponse.json(
      { success: false, message: "Gagal memuat artikel blog" },
      { status: 500 }
    );
  }
}
