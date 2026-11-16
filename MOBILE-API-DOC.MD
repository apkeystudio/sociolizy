# 📱 Dokumentasi Mobile API (v1)

> **Base URL**: `https://sociolizy.com/api/mobile/v1`  
> **Keamanan Aplikasi**: Header `x-api-app`   
> **Autentikasi Pengguna**: Header `Authorization: Bearer <token>`  
> **Content-Type**: `application/json`

---

## 📑 Daftar Isi

- [Arsitektur Keamanan & Header](#-arsitektur-keamanan--header)
- [1. Modul Autentikasi (Auth)](#1-modul-autentikasi-auth)
  - [1.1 Login](#11-login)
  - [1.2 Register](#12-register)
  - [1.3 Daftar Area Server](#13-daftar-area-server)
  - [1.4 Lupa Password](#14-lupa-password)
  - [1.5 Cek Sesi (Session)](#15-cek-sesi-session)
  - [1.6 Logout](#16-logout)
- [2. Modul Dashboard](#2-modul-dashboard)
  - [2.1 Data Dashboard](#21-data-dashboard)
- [3. Modul History (Riwayat)](#3-modul-history-riwayat)
  - [3.1 Riwayat Order](#31-riwayat-order)
  - [3.2 Riwayat Deposit](#32-riwayat-deposit)
- [4. Modul Akun (Account)](#4-modul-akun-account)
  - [4.1 Detail Akun](#41-detail-akun)
  - [4.2 Update Nama](#42-update-nama)
  - [4.3 Update Password](#43-update-password)
  - [4.4 Hapus Akun (Delete Account)](#44-hapus-akun-delete-account)
- [5. Modul Order](#5-modul-order)
  - [5.1 Daftar Layanan Berdasarkan Platform](#51-daftar-layanan-berdasarkan-platform)
  - [5.2 Buat Pesanan Baru](#52-buat-pesanan-baru)
  - [5.3 Cek Pesanan Pengguna](#53-cek-pesanan-pengguna)
- [6. Modul Blog](#6-modul-blog)
  - [6.1 Daftar Artikel Blog](#61-daftar-artikel-blog)
  - [6.2 Daftar Kategori Blog](#62-daftar-kategori-blog)
  - [6.3 Detail Artikel Blog](#63-detail-artikel-blog)
- [7. Modul Tiket Bantuan (Ticket)](#7-modul-tiket-bantuan-ticket)
  - [7.1 Daftar Tiket Pengguna](#71-daftar-tiket-pengguna)
  - [7.2 Buat Tiket Baru](#72-buat-tiket-baru)
  - [7.3 Detail Tiket & Riwayat Chat](#73-detail-tiket--riwayat-chat)
  - [7.4 Kirim Balasan Pesan](#74-kirim-balasan-pesan)
  - [7.5 Tutup Tiket Mandiri](#75-tutup-tiket-mandiri)
- [Ringkasan Response Code](#-ringkasan-response-code)

---

## 🔐 Arsitektur Keamanan & Header

Untuk melindungi API backend dari akses tidak sah, seluruh endpoint di bawah `/api/mobile/v1` menerapkan 2 lapis keamanan:

### 1. Keamanan Aplikasi (`api_app`)
Aplikasi mobile wajib menyertakan kunci aplikasi pada setiap request HTTP:
* **Header**: `x-api-app: <nilai_api_app>` (atau `x-app-key`)
* **Sumber Data**: Diambil dari kolom `api_app` pada tabel PostgreSQL `setting`.

Jika header ini tidak dikirimkan atau nilainya salah, server mengembalikan status `401 Unauthorized`.

Kunci aplikasi hanya diterima melalui header, bukan query string. Jika kunci belum dikonfigurasi, API menolak request dengan `503 Service Unavailable`.

### 2. Keamanan Pengguna (`Bearer Token`)
Untuk endpoint yang membutuhkan login pengguna (Dashboard, Akun, Order, History), sertakan token sesi yang didapatkan setelah login atau registrasi:
* **Header**: `Authorization: Bearer <token>` (atau `x-user-token`)

---

Token sesi bertanda tangan dan berlaku selama 7 hari. Token kedaluwarsa harus diperbarui dengan login kembali; endpoint logout dan perubahan/reset kata sandi mencabut seluruh sesi mobile aktif pada akun tersebut. Backend membutuhkan `SESSION_SECRET` acak minimal 32 byte (contoh pembangkitan: `openssl rand -base64 48`). Simpan hanya di environment server, jangan di aplikasi mobile. Mengganti secret membatalkan semua token yang sudah diterbitkan.

Setelah menambahkan `mobile_session_version` pada model `User`, sinkronkan skema database dengan `npx prisma db push` sebelum menjalankan versi backend ini.

## 1. Modul Autentikasi (Auth)

### 1.1 Login
Digunakan untuk mengautentikasi akun member ke aplikasi mobile.

* **Method**: `POST`
* **URL**: `/api/mobile/v1/auth/login`
* **Header**:
  * `x-api-app: <api_app>`
  * `Content-Type: application/json`

#### Request Body
```json
{
  "identifier": "johndoe",
  "password": "mypassword123"
}
```

| Parameter | Tipe | Wajib | Keterangan |
|---|---|---|---|
| `identifier` | string | Ya | Username atau alamat email |
| `password` | string | Ya | Kata sandi akun |

#### Response Berhasil (200 OK)
```json
{
  "success": true,
  "message": "Selamat datang kembali, John Doe!",
  "token": "eyJhbGciOiJIUzI1Ni...signature",
  "data": {
    "id": 1,
    "uuid": "7a3b3791-3837-4f65-9856-3c3e21509311",
    "username": "johndoe",
    "email": "john@example.com",
    "name": "John Doe",
    "balance": 150.25,
    "level": "Member",
    "server_area": "SG",
    "api_key": "smm_981a28cb7381fa",
    "create_at": "2026-10-15T08:30:00.000Z"
  }
}
```

---

### 1.2 Register
Mendaftarkan akun member baru beserta pilihan **area server cluster** (misal: `SG`, `US`, `EU`).

* **Method**: `POST`
* **URL**: `/api/mobile/v1/auth/register`
* **Header**:
  * `x-api-app: <api_app>`
  * `Content-Type: application/json`

#### Request Body
```json
{
  "username": "johndoe",
  "email": "john@example.com",
  "password": "mypassword123",
  "confirmPassword": "mypassword123",
  "server_area": "AUTO",
  "name": "John Doe"
}
```

| Parameter | Tipe | Wajib | Keterangan |
|---|---|---|---|
| `username` | string | Ya | Minimal 3 karakter, unik |
| `email` | string | Ya | Format email valid, unik |
| `password` | string | Ya | Minimal 6 karakter |
| `confirmPassword` | string | Tidak | Harus cocok dengan `password` |
| `server_area` | string | Tidak | Target rotasi server. Default: `"AUTO"` (Rotasi otomatis ke node server paling optimal/least-loaded). Nilai lain: kode cluster region (misal: `"SG"`, `"DC"`) atau ID node server langsung (misal: `"SG_1"`, `"SG_2"`, `"DC_1"`) |
| `name` | string | Tidak | Nama lengkap pengguna |

#### Response Berhasil (200 OK)
```json
{
  "success": true,
  "message": "Akun berhasil dibuat! Selamat datang di aplikasi.",
  "token": "eyJhbGciOiJIUzI1Ni...signature",
  "data": {
    "id": 42,
    "uuid": "e81d43f0-466d-4952-b5e1-0b5c165a6c0d",
    "username": "johndoe",
    "email": "john@example.com",
    "name": "John Doe",
    "level": "Member",
    "balance": 0,
    "server_area": "SG_2",
    "api_key": "smm_8f93e18a93bc71d0",
    "create_at": "2026-11-03T16:00:00.000Z"
  }
}
```

> **Catatan Rotasi Otomatis**: Kolom `server_area` pada response `data` berisi ID node server MongoDB yang dialokasikan secara bergantian (*least-loaded round-robin*, misal `SG_1`, `SG_2`, `DC_1`). Transaksi dan data order pengguna tersebut akan secara otomatis diarahkan ke server node tersebut.

---

### 1.3 Daftar Area Server
Mengambil daftar pilihan server cluster dan node yang aktif di server untuk dropdown pada form registrasi mobile.

* **Method**: `GET`
* **URL**: `/api/mobile/v1/auth/register`
* **Header**:
  * `x-api-app: <api_app>`

#### Response Berhasil (200 OK)
```json
{
  "success": true,
  "data": {
    "defaultRegion": "AUTO",
    "regions": [
      { "code": "AUTO", "name": "⚡ Otomatis (Rotasi Beban Server Terbaik)", "flag": "🌐", "serversCount": 3 },
      { "code": "SG", "name": "Singapore Cluster", "flag": "🇸🇬", "serversCount": 2 },
      { "code": "DC", "name": "United States Cluster", "flag": "🇺🇸", "serversCount": 1 }
    ],
    "servers": [
      { "id": "SG_1", "group": "SG", "serverIndex": 1, "name": "Singapore (Node 1)", "flag": "🇸🇬" },
      { "id": "SG_2", "group": "SG", "serverIndex": 2, "name": "Singapore (Node 2)", "flag": "🇸🇬" },
      { "id": "DC_1", "group": "DC", "serverIndex": 1, "name": "Washington DC, USA (Node 1)", "flag": "🇺🇸" }
    ]
  }
}
```

---

### 1.4 Lupa Password
Mengirimkan tautan reset kata sandi ke email pengguna.

* **Method**: `POST`
* **URL**: `/api/mobile/v1/auth/forgot-password`
* **Header**:
  * `x-api-app: <api_app>`
  * `Content-Type: application/json`

#### Request Body
```json
{
  "identifier": "john@example.com"
}
```

#### Response Berhasil (200 OK)
```json
{
  "success": true,
  "message": "Jika akun dengan username atau email tersebut terdaftar, tautan reset password telah dikirim ke email Anda."
}
```

---

### 1.5 Cek Sesi (Session)
Mengecek keabsahan token yang tersimpan di perangkat mobile.

* **Method**: `GET`
* **URL**: `/api/mobile/v1/auth/session`
* **Header**:
  * `x-api-app: <api_app>`
  * `Authorization: Bearer <token>`

#### Response Berhasil (200 OK)
```json
{
  "success": true,
  "authenticated": true,
  "user": {
    "id": 1,
    "uuid": "7a3b3791-3837-4f65-9856-3c3e21509311",
    "username": "johndoe",
    "email": "john@example.com",
    "name": "John Doe",
    "balance": 150.25,
    "level": "Member",
    "server_area": "SG"
  }
}
```

---

### 1.6 Logout
Keluar dari akun aplikasi.

* **Method**: `POST`
* **URL**: `/api/mobile/v1/auth/logout`
* **Header**:
  * `x-api-app: <api_app>`
  * `Authorization: Bearer <token>`

Logout membutuhkan token sesi yang masih berlaku; token mobile akun tersebut tidak dapat digunakan lagi setelah logout.

#### Response Berhasil (200 OK)
```json
{
  "success": true,
  "message": "Berhasil keluar dari aplikasi."
}
```

---

## 2. Modul Dashboard

### 2.1 Data Dashboard
Menampilkan seluruh data rangkuman beranda aplikasi: saldo akun, daftar platform, riwayat order terbaru, riwayat deposit terbaru, dan info akun.

* **Method**: `GET`
* **URL**: `/api/mobile/v1/dashboard`
* **Header**:
  * `x-api-app: <api_app>`
  * `Authorization: Bearer <token>`

#### Response Berhasil (200 OK)
```json
{
  "success": true,
  "data": {
    "balance": 150.25,
    "account": {
      "id": 1,
      "uuid": "7a3b3791-3837-4f65-9856-3c3e21509311",
      "username": "johndoe",
      "email": "john@example.com",
      "name": "John Doe",
      "level": "Member",
      "server_area": "SG",
      "api_key": "smm_981a28cb7381fa",
      "created_at": "2026-10-15T08:30:00.000Z"
    },
    "platform": [
      {
        "id": 1,
        "uuid": "plat-001",
        "name": "Instagram",
        "slug": "instagram",
        "icon": "instagram",
        "categories_count": 5,
        "services_count": 48
      },
      {
        "id": 2,
        "uuid": "plat-002",
        "name": "TikTok",
        "slug": "tiktok",
        "icon": "tiktok",
        "categories_count": 3,
        "services_count": 25
      }
    ],
    "history": {
      "orders": [
        {
          "id": 1284,
          "invoice": "INV-20261103-84729",
          "order_id": "184920",
          "service_id": "1001",
          "target": "https://instagram.com/username",
          "qty": 1000,
          "remain": 250,
          "start": 1200,
          "status": "Processing",
          "price_sale": 0.50,
          "created_at": "2026-11-03T15:20:00.000Z"
        }
      ],
      "deposits": [
        {
          "id": 35,
          "invoice": "DEP-20261103-12847",
          "status": "paid",
          "jumlah": 50.00,
          "crypto_amount": 49.85,
          "crypto_currency": "USDT",
          "currency": "USD",
          "waktu": "2026-11-03T14:10:00.000Z",
          "detail": {
            "txid": "0x384fa...91",
            "invoice_url": "https://pay.cryptomus.com/pay/xxx"
          }
        }
      ]
    }
  }
}
```

---

## 3. Modul History (Riwayat)

### 3.1 Riwayat Order
Menampilkan riwayat transaksi pemesanan lengkap langsung dari database cluster MongoDB pengguna.

* **Method**: `GET`
* **URL**: `/api/mobile/v1/history/order`
* **Query Parameters**:
  * `limit` (opsional, default: `50`, max: `100`)
* **Header**:
  * `x-api-app: <api_app>`
  * `Authorization: Bearer <token>`

#### Detail Field yang Dikembalikan:
* `target`: URL atau username target
* `qty`: Jumlah / kuantitas pesanan
* `remain`: Sisa pesanan yang belum terkirim
* `start`: Jumlah awal sebelum order diproses
* `status`: Status terkini (`Pending`, `Processing`, `Completed`, `Partial`, `Canceled`)
* `price_sale`: Total harga yang dipotong dari saldo
* `invoice`: Nomor faktur unik (`INV-YYYYMMDD-XXXXX`)

#### Response Berhasil (200 OK)
```json
{
  "success": true,
  "data": [
    {
      "id": 1284,
      "invoice": "INV-20261103-84729",
      "order_id": "184920",
      "service_id": "1001",
      "target": "https://instagram.com/johndoe",
      "qty": 1000,
      "remain": 0,
      "start": 1250,
      "status": "Completed",
      "price_sale": 0.50,
      "refill": true,
      "server_area": "SG",
      "created_at": "2026-11-03T15:20:00.000Z"
    }
  ],
  "total": 1
}
```

---

### 3.2 Riwayat Deposit
Menampilkan riwayat transaksi top-up deposit dari gateway Cryptomus.

* **Method**: `GET`
* **URL**: `/api/mobile/v1/history/deposit`
* **Query Parameters**:
  * `page` (opsional, default: `1`)
  * `limit` (opsional, default: `20`, max: `100`)
  * `status` (opsional: `"all"`, `"paid"`, `"pending"`, `"failed"`)
* **Header**:
  * `x-api-app: <api_app>`
  * `Authorization: Bearer <token>`

#### Detail Field yang Dikembalikan:
* `status`: Status pembayaran (`paid`, `pending`, `check`, `fail`, `expired`)
* `jumlah`: Nominal dana (USD)
* `waktu`: Timestamp tanggal & waktu deposit
* `invoice`: Nomor order invoice (`DEP-YYYYMMDD-XXXXX`)
* `detail`: Objek info transaksi crypto (`txid`, `invoice_url`, `updated_at`)

#### Response Berhasil (200 OK)
```json
{
  "success": true,
  "data": [
    {
      "id": 35,
      "invoice": "DEP-20261103-12847",
      "status": "paid",
      "jumlah": 50.00,
      "currency": "USD",
      "crypto_amount": 49.85,
      "crypto_currency": "USDT",
      "waktu": "2026-11-03T14:10:00.000Z",
      "detail": {
        "txid": "0x384fa...91",
        "invoice_url": "https://pay.cryptomus.com/pay/xxx",
        "updated_at": "2026-11-03T14:15:22.000Z"
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 5,
    "totalPages": 1
  },
  "current_balance": 150.25
}
```

---

## 4. Modul Akun (Account)

### 4.1 Detail Akun
Mengambil profil akun dan saldo terbaru.

* **Method**: `GET`
* **URL**: `/api/mobile/v1/account`
* **Header**:
  * `x-api-app: <api_app>`
  * `Authorization: Bearer <token>`

#### Response Berhasil (200 OK)
```json
{
  "success": true,
  "data": {
    "id": 1,
    "uuid": "7a3b3791-3837-4f65-9856-3c3e21509311",
    "username": "johndoe",
    "email": "john@example.com",
    "name": "John Doe",
    "balance": 150.25,
    "level": "Member",
    "server_area": "SG",
    "api_key": "smm_981a28cb7381fa",
    "create_at": "2026-10-15T08:30:00.000Z"
  }
}
```

---

### 4.2 Update Nama
Memperbarui nama pengguna di akun.

* **Method**: `PATCH`
* **URL**: `/api/mobile/v1/account`
* **Header**:
  * `x-api-app: <api_app>`
  * `Authorization: Bearer <token>`
  * `Content-Type: application/json`

#### Request Body
```json
{
  "action": "update_name",
  "name": "Johnatan Doe"
}
```

#### Response Berhasil (200 OK)
```json
{
  "success": true,
  "message": "Nama berhasil diperbarui",
  "data": {
    "id": 1,
    "username": "johndoe",
    "email": "john@example.com",
    "name": "Johnatan Doe",
    "balance": 150.25
  }
}
```

---

### 4.3 Update Password
Memperbarui kata sandi akun dengan verifikasi kata sandi lama.

* **Method**: `PATCH`
* **URL**: `/api/mobile/v1/account`
* **Header**:
  * `x-api-app: <api_app>`
  * `Authorization: Bearer <token>`
  * `Content-Type: application/json`

#### Request Body
```json
{
  "action": "update_password",
  "current_password": "mypassword123",
  "new_password": "myNewPassword456",
  "confirm_password": "myNewPassword456"
}
```

#### Response Berhasil (200 OK)
```json
{
  "success": true,
  "message": "Password berhasil diperbarui"
}
```

---

### 4.4 Hapus Akun (Delete Account)
Menghapus akun pengguna secara permanen sesuai dengan ketentuan privasi store aplikasi mobile. Memerlukan konfirmasi password untuk keamanan.

* **Method**: `DELETE`
* **URL**: `/api/mobile/v1/account`
* **Header**:
  * `x-api-app: <api_app>`
  * `Authorization: Bearer <token>`
  * `Content-Type: application/json`

#### Request Body
```json
{
  "password": "mypassword123"
}
```

#### Response Berhasil (200 OK)
```json
{
  "success": true,
  "message": "Akun Anda telah berhasil dihapus secara permanen."
}
```

---

## 5. Modul Order

### 5.1 Daftar Layanan Berdasarkan Platform
Menampilkan seluruh layanan yang dikelompokkan berdasarkan **Platform** (Instagram, TikTok, YouTube, dll) dan **Kategori**. Memuat detail harga sale, min, max, dan deskripsi.

* **Method**: `GET`
* **URL**: `/api/mobile/v1/order/services`
* **Query Parameters (opsional)**:
  * `platform_id`: ID platform
  * `platform_slug`: Slug platform (misal: `instagram`, `tiktok`)
  * `category_id`: ID kategori
  * `search`: Pencarian nama layanan
* **Header**:
  * `x-api-app: <api_app>`

#### Response Berhasil (200 OK)
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "Instagram",
      "slug": "instagram",
      "icon": "instagram",
      "categories": [
        {
          "id": 10,
          "name": "Instagram Followers",
          "slug": "instagram-followers",
          "icon": "user-plus",
          "services": [
            {
              "id": 101,
              "service_id": "1001",
              "name": "Instagram Followers [HQ] [Real] [Instant]",
              "slug": "instagram-followers-hq-real",
              "min": 100,
              "max": 50000,
              "desc": "High quality followers with instant start. 30 days refill guarantee.",
              "rate_sale": 0.50,
              "category_id": 10,
              "category_name": "Instagram Followers",
              "platform_name": "Instagram"
            }
          ]
        }
      ]
    }
  ]
}
```

---

### 5.2 Buat Pesanan Baru
Membuat order layanan SMM. Sistem akan:
1. Menghitung total biaya transaksi: `(amount / 1000) * rate_sale`
2. Memvalidasi dan langsung **mengurangi saldo user**
3. Meneruskan ke provider API upstream jika terhubung
4. **Menyimpan otomatis ke server database MongoDB** sesuai cluster region yang dimiliki pengguna (`SG`, `US`, `EU`)
5. Mengirimkan notifikasi real-time via Pusher dan notifikasi email via Resend

* **Method**: `POST`
* **URL**: `/api/mobile/v1/order`
* **Header**:
  * `x-api-app: <api_app>`
  * `Authorization: Bearer <token>`
  * `Content-Type: application/json`

#### Request Body
```json
{
  "service_id": 101,
  "target": "https://instagram.com/myaccount",
  "amount": 1000,
  "refill": true,
  "custom_comments": null
}
```

| Parameter | Tipe | Wajib | Keterangan |
|---|---|---|---|
| `service_id` | number \| string | Ya | ID internal atau service_id layanan |
| `target` | string | Ya | Link/URL atau username target pesanan |
| `amount` | number | Ya | Jumlah pesanan (harus antara `min` dan `max`) |
| `refill` | boolean | Tidak | Opsi garansi refill (Default: `false`) |
| `custom_comments` | string | Tidak | Teks komentar custom jika tipe layanan custom comments |

#### Rumus Perhitungan Biaya:
$$\text{Total Transaksi} = \left(\frac{\text{amount}}{1000}\right) \times \text{rate\_sale}$$
*Contoh:* 1000 kuantitas dengan rate \$0.50/1K = **\$0.5000** dipotong dari saldo.

#### Response Berhasil (200 OK)
```json
{
  "success": true,
  "message": "Pesanan berhasil dibuat di server cluster SG!",
  "data": {
    "id": 1285,
    "invoice": "INV-20261103-91823",
    "order_id": "184931",
    "service": {
      "id": 101,
      "service_id": "1001",
      "name": "Instagram Followers [HQ] [Real] [Instant]",
      "platform": "Instagram",
      "category": "Instagram Followers",
      "rate_sale": 0.50
    },
    "target": "https://instagram.com/myaccount",
    "amount": 1000,
    "price_sale": 0.50,
    "status": "Processing",
    "remaining_balance": 149.75,
    "server_area": "SG",
    "created_at": "2026-11-03T16:05:00.000Z"
  }
}
```

#### Response Saldo Kurang (400 Bad Request)
```json
{
  "success": false,
  "message": "Saldo tidak mencukupi. Total biaya $0.5000, saldo saat ini $0.10.",
  "needed": 0.50,
  "currentBalance": 0.10
}
```

---

### 5.3 Cek Pesanan Pengguna
Mengambil daftar pesanan pengguna dari database MongoDB.

* **Method**: `GET`
* **URL**: `/api/mobile/v1/order`
* **Query Parameters**:
  * `limit` (opsional, default: `50`)
* **Header**:
  * `x-api-app: <api_app>`
  * `Authorization: Bearer <token>`

---

## 6. Modul Blog

Modul Blog memungkinkan aplikasi mobile untuk menampilkan artikel edukasi, panduan SMM, berita, dan tips pemasaran digital yang telah dipublikasikan.

> **Catatan Autentikasi**: Endpoint blog bersifat **publik untuk aplikasi mobile**, hanya membutuhkan header `x-api-app` (tidak memerlukan login pengguna).

---

### 6.1 Daftar Artikel Blog
Mengambil daftar artikel blog yang telah terbit (`status = "PUBLISHED"`), dilengkapi dengan pagination, pencarian, dan filter kategori/tag.

* **Method**: `GET`
* **URL**: `/api/mobile/v1/blog`
* **Header**:
  * `x-api-app: <api_app>`

#### Query Parameters
| Parameter | Tipe | Wajib | Keterangan |
|---|---|---|---|
| `page` | integer | Tidak | Nomor halaman (Default: `1`) |
| `limit` | integer | Tidak | Jumlah item per halaman (Default: `10`, Max: `50`) |
| `category` | string | Tidak | Slug atau ID kategori blog (misal: `"instagram-tips"` atau `"2"`) |
| `search` | string | Tidak | Kata kunci pencarian pada judul, excerpt, atau tags |
| `tag` | string | Tidak | Filter artikel berdasarkan tag spesifik |
| `featured` | boolean | Tidak | Jika `"true"`, hanya mengambil artikel unggulan (`is_featured = true`) |

#### Response Berhasil (200 OK)
```json
{
  "success": true,
  "data": [
    {
      "id": 12,
      "uuid": "5d2b7811-9124-4f65-8712-4c2e11508210",
      "title": "Cara Meningkatkan Followers Instagram Organik di Tahun 2026",
      "slug": "cara-meningkatkan-followers-instagram-organik-2026",
      "excerpt": "Pelajari strategi terbaru untuk mengembangkan akun Instagram Anda secara organik dan aman.",
      "cover_image": "https://images.unsplash.com/photo-1611162617474-5b21e879e113",
      "author_name": "Sociolizy Team",
      "views": 1540,
      "reading_time": 4,
      "tags": "instagram, followers, smm, marketing",
      "is_featured": true,
      "published_at": "2026-11-10T10:00:00.000Z",
      "create_at": "2026-11-09T14:20:00.000Z",
      "category": {
        "id": 2,
        "name": "Instagram Marketing",
        "slug": "instagram-marketing",
        "color": "pink"
      }
    }
  ],
  "featured": {
    "id": 12,
    "title": "Cara Meningkatkan Followers Instagram Organik di Tahun 2026",
    "slug": "cara-meningkatkan-followers-instagram-organik-2026",
    "excerpt": "Pelajari strategi terbaru untuk mengembangkan akun Instagram Anda secara organik dan aman.",
    "cover_image": "https://images.unsplash.com/photo-1611162617474-5b21e879e113",
    "author_name": "Sociolizy Team",
    "reading_time": 4,
    "category": {
      "name": "Instagram Marketing",
      "slug": "instagram-marketing",
      "color": "pink"
    }
  },
  "categories": [
    {
      "id": 2,
      "name": "Instagram Marketing",
      "slug": "instagram-marketing",
      "color": "pink",
      "article_count": 8
    },
    {
      "id": 3,
      "name": "TikTok Strategies",
      "slug": "tiktok-strategies",
      "color": "purple",
      "article_count": 5
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 24,
    "totalPages": 3,
    "hasNext": true,
    "hasPrev": false
  }
}
```

---

### 6.2 Daftar Kategori Blog
Mengambil seluruh kategori blog yang tersedia beserta jumlah artikel terbit untuk tampilan tab/chip filter pada aplikasi.

* **Method**: `GET`
* **URL**: `/api/mobile/v1/blog/categories`
* **Header**:
  * `x-api-app: <api_app>`

#### Response Berhasil (200 OK)
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "uuid": "8a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d",
      "name": "General Tips",
      "slug": "general-tips",
      "description": "Tips umum seputar sosial media marketing",
      "color": "emerald",
      "article_count": 11,
      "create_at": "2026-10-01T04:00:00.000Z"
    },
    {
      "id": 2,
      "name": "Instagram Marketing",
      "slug": "instagram-marketing",
      "description": "Panduan optimasi akun dan pertumbuhan Instagram",
      "color": "pink",
      "article_count": 8,
      "create_at": "2026-10-05T06:30:00.000Z"
    }
  ],
  "total": 2
}
```

---

### 6.3 Detail Artikel Blog
Mengambil isi lengkap artikel blog berdasarkan `slug` (atau ID numerik). Endpoint ini secara otomatis menambahkan jumlah tayangan (`views`) artikel.

* **Method**: `GET`
* **URL**: `/api/mobile/v1/blog/{slug}`
* **Header**:
  * `x-api-app: <api_app>`

#### Parameter Path
| Parameter | Tipe | Wajib | Keterangan |
|---|---|---|---|
| `slug` | string | Ya | Slug artikel (misal: `"cara-meningkatkan-followers-instagram-organik-2026"`) atau ID numerik |

#### Response Berhasil (200 OK)
```json
{
  "success": true,
  "data": {
    "id": 12,
    "uuid": "5d2b7811-9124-4f65-8712-4c2e11508210",
    "title": "Cara Meningkatkan Followers Instagram Organik di Tahun 2026",
    "slug": "cara-meningkatkan-followers-instagram-organik-2026",
    "excerpt": "Pelajari strategi terbaru untuk mengembangkan akun Instagram Anda secara organik dan aman.",
    "content": "<p>Instagram terus berkembang dengan algoritma baru...</p><h2>1. Konsistensi Konten Reels</h2><p>Reels menjadi format utama...</p>",
    "cover_image": "https://images.unsplash.com/photo-1611162617474-5b21e879e113",
    "author_name": "Sociolizy Team",
    "views": 1541,
    "reading_time": 4,
    "tags": "instagram, followers, smm, marketing",
    "is_featured": true,
    "meta_title": "Cara Meningkatkan Followers Instagram 2026",
    "meta_description": "Panduan lengkap meningkatkan followers Instagram organik tahun 2026.",
    "published_at": "2026-11-10T10:00:00.000Z",
    "create_at": "2026-11-09T14:20:00.000Z",
    "category": {
      "id": 2,
      "name": "Instagram Marketing",
      "slug": "instagram-marketing",
      "color": "pink",
      "description": "Panduan optimasi akun dan pertumbuhan Instagram"
    }
  },
  "related": [
    {
      "id": 8,
      "title": "5 Trik Optimasi Bio Instagram untuk Bisnis",
      "slug": "5-trik-optimasi-bio-instagram-untuk-bisnis",
      "excerpt": "Buat bio Instagram yang menarik dan meningkatkan konversi penjualan.",
      "cover_image": "https://images.unsplash.com/photo-1611262588024-d12430b98920",
      "reading_time": 3,
      "published_at": "2026-11-01T08:00:00.000Z",
      "category": {
        "name": "Instagram Marketing",
        "slug": "instagram-marketing",
        "color": "pink"
      }
    }
  ]
}
```

#### Response Tidak Ditemukan (404 Not Found)
```json
{
  "success": false,
  "message": "Artikel tidak ditemukan atau belum dipublikasikan"
}
```

---

## 7. Modul Tiket Bantuan (Ticket)

Modul Tiket Bantuan memungkinkan member untuk berkomunikasi langsung dengan tim dukungan pelanggan melalui sistem pesan thread (customer support chat). Seluruh tiket tersinkronisasi secara realtime dengan panel admin Sociolizy.

> **Catatan Autentikasi**: Seluruh endpoint tiket **wajib menyertakan kedua header**:  
> 1. `x-api-app: <api_app>`  
> 2. `Authorization: Bearer <token>`

---

### 7.1 Daftar Tiket Pengguna
Mengambil daftar tiket bantuan milik member yang sedang login beserta statistik statusnya.

* **Method**: `GET`
* **URL**: `/api/mobile/v1/ticket`
* **Header**:
  * `x-api-app: <api_app>`
  * `Authorization: Bearer <token>`

#### Query Parameters
| Parameter | Tipe | Wajib | Keterangan |
|---|---|---|---|
| `status` | string | Tidak | Filter status: `"open"`, `"in_progress"`, `"resolved"`, `"closed"`, atau `"all"` (Default: `"all"`) |
| `category` | string | Tidak | Filter kategori: `"general"`, `"billing"`, `"technical"`, `"order"` |
| `search` | string | Tidak | Cari berdasarkan nomor `ticket_id` atau subjek tiket |
| `limit` | integer | Tidak | Batas jumlah tiket yang dimuat (Default: `50`, Max: `100`) |

#### Response Berhasil (200 OK)
```json
{
  "success": true,
  "data": [
    {
      "ticket_id": "TKT-20261116-K8L9P",
      "subject": "Pesanan Followers Instagram Belum Masuk",
      "category": "order",
      "status": "in_progress",
      "priority": "high",
      "messages_count": 3,
      "last_message": {
        "sender": "admin",
        "sender_name": "Support Staff",
        "content": "Halo, pesanan Anda sedang kami cek ke server provider. Mohon tunggu sebentar ya.",
        "created_at": "2026-11-16T14:15:00.000Z"
      },
      "created_at": "2026-11-16T12:00:00.000Z",
      "updated_at": "2026-11-16T14:15:00.000Z",
      "resolved_at": null
    }
  ],
  "stats": {
    "total": 4,
    "open": 1,
    "in_progress": 1,
    "resolved": 1,
    "closed": 1
  },
  "total": 1
}
```

---

### 7.2 Buat Tiket Baru
Membuat tiket bantuan baru ke tim customer support.

* **Method**: `POST`
* **URL**: `/api/mobile/v1/ticket`
* **Header**:
  * `x-api-app: <api_app>`
  * `Authorization: Bearer <token>`
  * `Content-Type: application/json`

#### Request Body
```json
{
  "subject": "Deposit Saldo Belum Masuk",
  "category": "billing",
  "priority": "high",
  "message": "Halo admin, saya sudah transfer deposit via QRIS sebesar Rp 100.000 dengan invoice INV-20261116-12345 namun saldo belum bertambah. Mohon bantuannya."
}
```

| Parameter | Tipe | Wajib | Keterangan |
|---|---|---|---|
| `subject` | string | Ya | Subjek / judul permasalahan (minimal 3 karakter) |
| `category` | string | Ya | Pilihan: `"general"`, `"billing"`, `"technical"`, `"order"` |
| `priority` | string | Tidak | Pilihan: `"low"`, `"normal"`, `"high"`, `"urgent"` (Default: `"normal"`) |
| `message` | string | Ya | Pesan detail permasalahan yang dihadapi |

#### Response Berhasil (201 Created)
```json
{
  "success": true,
  "message": "Tiket bantuan berhasil dibuat!",
  "data": {
    "ticket_id": "TKT-20261116-X9Y2Z",
    "subject": "Deposit Saldo Belum Masuk",
    "category": "billing",
    "status": "open",
    "priority": "high",
    "messages": [
      {
        "id": "c1f7b0a8-2041-4712-98ba-d52f821b0114",
        "sender": "user",
        "sender_name": "johndoe",
        "content": "Halo admin, saya sudah transfer deposit via QRIS sebesar Rp 100.000...",
        "created_at": "2026-11-16T15:30:00.000Z"
      }
    ],
    "created_at": "2026-11-16T15:30:00.000Z",
    "updated_at": "2026-11-16T15:30:00.000Z"
  }
}
```

---

### 7.3 Detail Tiket & Riwayat Chat
Mengambil detail lengkap tiket beserta seluruh riwayat pesan/percakapan (`messages`).

* **Method**: `GET`
* **URL**: `/api/mobile/v1/ticket/{ticket_id}`
* **Header**:
  * `x-api-app: <api_app>`
  * `Authorization: Bearer <token>`

#### Parameter Path
| Parameter | Tipe | Wajib | Keterangan |
|---|---|---|---|
| `ticket_id` | string | Ya | ID unik tiket (misal: `"TKT-20261116-X9Y2Z"`) |

#### Response Berhasil (200 OK)
```json
{
  "success": true,
  "data": {
    "ticket_id": "TKT-20261116-X9Y2Z",
    "subject": "Deposit Saldo Belum Masuk",
    "category": "billing",
    "status": "open",
    "priority": "high",
    "username": "johndoe",
    "email": "john@example.com",
    "server_area": "SG",
    "messages": [
      {
        "id": "c1f7b0a8-2041-4712-98ba-d52f821b0114",
        "sender": "user",
        "sender_name": "johndoe",
        "content": "Halo admin, saya sudah transfer deposit...",
        "created_at": "2026-11-16T15:30:00.000Z"
      },
      {
        "id": "8b9e021a-9f41-419b-a01b-c72e903a4511",
        "sender": "admin",
        "sender_name": "Sociolizy Support",
        "content": "Terima kasih infonya kak. Saldo sudah berhasil disinkronkan ke akun Anda ya. Silakan dicek kembali.",
        "created_at": "2026-11-16T15:35:00.000Z"
      }
    ],
    "created_at": "2026-11-16T15:30:00.000Z",
    "updated_at": "2026-11-16T15:35:00.000Z",
    "resolved_at": null
  }
}
```

---

### 7.4 Kirim Balasan Pesan
Mengirimkan pesan balasan dari member ke dalam tiket yang sedang berjalan.

* **Method**: `POST`
* **URL**: `/api/mobile/v1/ticket/{ticket_id}`
* **Header**:
  * `x-api-app: <api_app>`
  * `Authorization: Bearer <token>`
  * `Content-Type: application/json`

#### Request Body
```json
{
  "message": "Terima kasih admin, saldo sudah masuk!"
}
```

| Parameter | Tipe | Wajib | Keterangan |
|---|---|---|---|
| `message` | string | Ya | Teks isi balasan (bisa juga menggunakan key `content`) |

#### Response Berhasil (200 OK)
```json
{
  "success": true,
  "message": "Pesan balasan berhasil dikirim!",
  "data": {
    "id": "4e1a90c2-9812-4215-8912-b51c89012351",
    "sender": "user",
    "sender_name": "johndoe",
    "content": "Terima kasih admin, saldo sudah masuk!",
    "created_at": "2026-11-16T15:40:00.000Z"
  }
}
```

#### Response Tiket Sudah Ditutup (400 Bad Request)
```json
{
  "success": false,
  "message": "Tiket ini telah ditutup. Silakan buat tiket baru jika membutuhkan bantuan lain."
}
```

---

### 7.5 Tutup Tiket Mandiri
Member dapat menutup tiket secara mandiri ketika permasalahan telah selesai diselesaikan.

* **Method**: `PUT`
* **URL**: `/api/mobile/v1/ticket/{ticket_id}`
* **Header**:
  * `x-api-app: <api_app>`
  * `Authorization: Bearer <token>`
  * `Content-Type: application/json`

#### Request Body
```json
{
  "status": "closed"
}
```

#### Response Berhasil (200 OK)
```json
{
  "success": true,
  "message": "Tiket berhasil ditutup.",
  "data": {
    "ticket_id": "TKT-20261116-X9Y2Z",
    "status": "closed"
  }
}
```

---

## 📊 Ringkasan Response Code

| Kode HTTP | Status | Penjelasan |
|:---:|---|---|
| `200` | OK | Request berhasil dieksekusi |
| `400` | Bad Request | Parameter tidak lengkap, format salah, jumlah di luar batas, saldo tidak cukup |
| `401` | Unauthorized | Header `x-api-app` salah/hilang, atau token user tidak valid/kadaluarsa |
| `404` | Not Found | Layanan, kategori, atau pengguna tidak ditemukan |
| `409` | Conflict | Username atau email sudah terdaftar saat registrasi |
| `500` | Internal Server Error | Kesalahan internal pada server backend |
