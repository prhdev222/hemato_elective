# HSOS Worker — Cloudflare Worker + Turso

## เปรียบเทียบ Apps Script vs Cloudflare Worker

| | Apps Script + Sheets | Cloudflare Worker + Turso |
|---|---|---|
| **Cold start** | 2–5 วินาที | < 5ms |
| **Read latency** | 500ms–2s | < 10ms |
| **LINE webhook** | doPost() | fetch handler |
| **Database** | Google Sheets API | Turso SQL (libSQL) |
| **Auth** | PIN ทุก request | JWT (12h) |
| **Signature verify** | Utilities.computeHmacSha256 | Web Crypto (built-in) |
| **HTTP calls** | UrlFetchApp.fetch (sync) | fetch() (async) |
| **Cost** | ฟรี | ฟรี (quota สูงมาก) |
| **Admin UI** | Google Sheets | ต้องสร้างเอง (form มีแล้ว) |

## โครงสร้างไฟล์

```
hsos-worker/
├── src/
│   ├── index.js        ← entry point  (เทียบ: Code.gs)
│   ├── botHandler.js   ← LINE bot     (เทียบ: handleEvent + TemplateService.gs)
│   ├── lineService.js  ← LINE API     (เทียบ: LineService.gs)
│   ├── fuzzyMatch.js   ← fuzzy search (เทียบ: FuzzyMatch.gs — logic เหมือนกัน)
│   ├── apiRouter.js    ← REST API     (เทียบ: doGet/doPost switch)
│   └── auth.js         ← JWT auth     (เทียบ: UserService.gs verifyUser)
├── schema.sql          ← Turso tables (เทียบ: Google Sheets tabs)
├── wrangler.toml
└── package.json
```

## Setup — ทำครั้งเดียว (15 นาที)

### 1. สร้าง Turso DB

```bash
# ติดตั้ง Turso CLI
curl -sSfL https://get.tur.so/install.sh | bash

# Login
turso auth login

# สร้าง DB (เลือก region ใกล้ไทย: sin = Singapore)
turso db create hsos-db --location sin

# ดู URL + Token
turso db show hsos-db
turso db tokens create hsos-db
```

### 2. สร้าง Tables

```bash
turso db shell hsos-db < schema.sql
```

### 3. Deploy Worker

```bash
cd hsos-worker
npm install

# ใส่ secrets (ทำทีละตัว)
wrangler secret put LINE_CHANNEL_TOKEN    # จาก LINE Developers Console
wrangler secret put LINE_CHANNEL_SECRET   # จาก LINE Developers Console
wrangler secret put TURSO_URL             # libsql://hsos-db-xxx.turso.io
wrangler secret put TURSO_TOKEN           # token จาก step 2
wrangler secret put JWT_SECRET            # สุ่มขึ้นมาเอง เช่น openssl rand -hex 32

# Deploy
wrangler deploy
```

### 4. ตั้ง LINE Webhook

ไป LINE Developers Console → Messaging API → Webhook URL:
```
https://hsos-worker.YOUR_SUBDOMAIN.workers.dev/webhook
```

เปิด "Use webhook" ✓ แล้วกด Verify

### 5. ทดสอบ

```bash
# Health check
curl https://hsos-worker.YOUR_SUBDOMAIN.workers.dev/

# Login
curl -X POST https://hsos-worker.YOUR_SUBDOMAIN.workers.dev/api \
  -H "Content-Type: application/json" \
  -d '{"action":"verify_login","name":"Admin","pin":"1234"}'

# เพิ่มแพทย์ (ใช้ token จาก login)
curl -X POST https://hsos-worker.YOUR_SUBDOMAIN.workers.dev/api \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN_HERE" \
  -d '{
    "action":"save_doctor",
    "data":{
      "name":"สมชาย รักดี",
      "type":"นศพ.",
      "period1_dates":"1-14 พ.ค. 2569",
      "ward1":"วอร์ดชาย",
      "chief1_name":"นพ.บี",
      "chief1_link":"https://line.me/ti/p/xxx"
    }
  }'
```

## สิ่งที่เหมือนกัน Apps Script ทุกอย่าง

- Fuzzy match algorithm (Levenshtein) — copy ตรงๆ แปลงแค่ syntax
- Silent Mode — bot เงียบเมื่อหาชื่อไม่เจอ
- Reply Token (ฟรีไม่จำกัด) ไม่กิน quota
- Template system {{placeholder}} — เหมือนกันทุก key
- Role-based auth: admin / editor / viewer
- Daily status update (ใช้ Cloudflare Cron Trigger แทน Apps Script Triggers)

## Cron Trigger (แทน Triggers.gs)

เพิ่มใน wrangler.toml:
```toml
[triggers]
crons = ["0 23 * * *"]  # ทุกวัน 06:00 AM Bangkok (UTC+7 = 23:00 UTC)
```

แล้วใน index.js เพิ่ม:
```js
export default {
  async scheduled(event, env) {
    const db = createClient({ url: env.TURSO_URL, authToken: env.TURSO_TOKEN });
    // update status: upcoming → active → completed ตามวันที่
    await db.execute(`
      UPDATE doctors SET status='active'
      WHERE status='upcoming'
      AND date(substr(period1_dates,1,10)) <= date('now','localtime')
    `);
  }
}
```
