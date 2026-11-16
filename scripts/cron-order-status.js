#!/usr/bin/env node

/**
 * Standalone Order Status Cron Runner
 *
 * Can be executed via crontab:
 *   * /5 * * * * cd /path/to/master-smm && node scripts/cron-order-status.js
 *
 * Or triggered directly via cURL / external cron services (e.g. cron-job.org):
 *   GET /api/cron/order-status?key=YOUR_CRON_SECRET
 */

const dotenv = require("dotenv");
const path = require("path");

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const APP_URL = process.env.NEXTAUTH_URL || process.env.APP_URL || "http://localhost:3000";
const CRON_SECRET = process.env.CRON_SECRET || "";

async function run() {
  const url = `${APP_URL.replace(/\/$/, "")}/api/cron/order-status${
    CRON_SECRET ? `?key=${encodeURIComponent(CRON_SECRET)}` : ""
  }`;

  console.log(`[${new Date().toISOString()}] Menjalankan cron update status pesanan...`);
  console.log(`Target: ${url.replace(CRON_SECRET, "***")}`);

  try {
    const headers = {
      "User-Agent": "Master-SMM-Cron-Runner/1.0",
    };
    if (CRON_SECRET) {
      headers["Authorization"] = `Bearer ${CRON_SECRET}`;
    }

    const res = await fetch(url, { method: "GET", headers });
    const json = await res.json();

    if (json.success) {
      const summary = json.summary || {};
      console.log(`[${new Date().toISOString()}] Selesai! Ringkasan:`);
      console.log(`- Diproses: ${summary.processed || 0}`);
      console.log(`- Diperbarui: ${summary.updated || 0}`);
      console.log(`- Selesai (Completed): ${summary.completed || 0}`);
      console.log(`- Dibatalkan (Canceled): ${summary.canceled || 0}`);
      console.log(`- Sebagian (Partial): ${summary.partial || 0}`);
      console.log(`- Refund: $${summary.refunded_usd || 0}`);
      console.log(`- Durasi: ${summary.duration_ms || 0} ms`);

      if (json.errors && json.errors.length > 0) {
        console.warn(`[Peringatan] Ada ${json.errors.length} error provider:`);
        json.errors.forEach((e) => console.warn(`  #${e.invoice}: ${e.error}`));
      }
    } else {
      console.error(`[${new Date().toISOString()}] Gagal:`, json.message || json);
      process.exitCode = 1;
    }
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Error koneksi:`, err.message || err);
    process.exitCode = 1;
  }
}

run();

