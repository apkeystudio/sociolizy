import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { createSessionToken } from "@/lib/auth";
import { validateMobileApp } from "@/lib/mobile-auth";
import { traceMobileApi, extractClientIp } from "@/lib/trace-logger";

/**
 * POST /api/mobile/v1/auth/login
 * Mobile login endpoint authenticated with api_app
 */
export async function POST(request: Request) {
  const startTime = Date.now();
  const ip = extractClientIp(request);
  const userAgent = request.headers.get("user-agent");

  try {
    // 1. Validate Mobile App Key (api_app)
    const appCheck = await validateMobileApp(request);
    if (!appCheck.valid) {
      traceMobileApi({
        action: "MOBILE_AUTH",
        status: "FAILED",
        status_code: 401,
        ip,
        user_agent: userAgent,
        endpoint: "/api/mobile/v1/auth/login",
        method: "POST",
        error_message: "Invalid api_app key",
        latency_ms: Date.now() - startTime,
      });
      return appCheck.errorResponse!;
    }

    const body = await request.json().catch(() => ({}));
    const { identifier, password } = body;

    if (!identifier || !password) {
      traceMobileApi({
        action: "MOBILE_LOGIN",
        status: "FAILED",
        status_code: 400,
        username: identifier || null,
        ip,
        user_agent: userAgent,
        endpoint: "/api/mobile/v1/auth/login",
        method: "POST",
        error_message: "Missing identifier or password",
        latency_ms: Date.now() - startTime,
      });

      return NextResponse.json(
        { success: false, message: "Username/Email dan Password wajib diisi" },
        { status: 400 }
      );
    }

    const trimmedIdentifier = identifier.trim();

    // 2. Find user by username or email
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { username: { equals: trimmedIdentifier, mode: "insensitive" } },
          { email: { equals: trimmedIdentifier, mode: "insensitive" } },
        ],
      },
    });

    if (!user) {
      traceMobileApi({
        action: "MOBILE_LOGIN",
        status: "FAILED",
        status_code: 401,
        username: trimmedIdentifier,
        ip,
        user_agent: userAgent,
        endpoint: "/api/mobile/v1/auth/login",
        method: "POST",
        error_message: "User not found",
        latency_ms: Date.now() - startTime,
      });

      return NextResponse.json(
        { success: false, message: "Username atau Password salah" },
        { status: 401 }
      );
    }

    // 3. Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      traceMobileApi({
        action: "MOBILE_LOGIN",
        status: "FAILED",
        status_code: 401,
        user_id: user.id,
        username: user.username,
        ip,
        user_agent: userAgent,
        endpoint: "/api/mobile/v1/auth/login",
        method: "POST",
        error_message: "Invalid password",
        latency_ms: Date.now() - startTime,
      });

      return NextResponse.json(
        { success: false, message: "Username atau Password salah" },
        { status: 401 }
      );
    }

    // 4. Generate signed session token for Mobile Bearer Auth
    const token = await createSessionToken({
      id: user.id,
      uuid: user.uuid,
      username: user.username,
      email: user.email,
      level: user.level as "Admin" | "Member",
      server_area: user.server_area || "SG",
      mobile_session_version: user.mobile_session_version,
    });

    traceMobileApi({
      action: "MOBILE_LOGIN",
      status: "SUCCESS",
      status_code: 200,
      user_id: user.id,
      username: user.username,
      ip,
      user_agent: userAgent,
      endpoint: "/api/mobile/v1/auth/login",
      method: "POST",
      response_payload: { username: user.username, level: user.level },
      latency_ms: Date.now() - startTime,
    });

    return NextResponse.json({
      success: true,
      message: `Selamat datang kembali, ${user.name || user.username}!`,
      token,
      data: {
        id: user.id,
        uuid: user.uuid,
        username: user.username,
        email: user.email,
        name: user.name,
        balance: Number(user.balance),
        level: user.level,
        server_area: user.server_area,
        api_key: user.api_key,
        create_at: user.create_at,
      },
    });
  } catch (error: any) {
    console.error("POST /api/mobile/v1/auth/login error:", error);
    traceMobileApi({
      action: "MOBILE_LOGIN",
      status: "FAILED",
      status_code: 500,
      ip,
      user_agent: userAgent,
      endpoint: "/api/mobile/v1/auth/login",
      method: "POST",
      error_message: error?.message || "Internal server error",
      latency_ms: Date.now() - startTime,
    });

    return NextResponse.json(
      { success: false, message: "Terjadi kesalahan internal pada server" },
      { status: 500 }
    );
  }
}
