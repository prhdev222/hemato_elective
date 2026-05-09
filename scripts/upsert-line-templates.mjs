import fs from "node:fs";

function parseDevVars(fileText) {
  const env = {};
  for (const raw of fileText.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(\w+)=(?:"([^"]*)"|'([^']*)')\s*$/);
    if (!m) continue;
    env[m[1]] = m[2] ?? m[3] ?? "";
  }
  return env;
}

const devVarsPath = new URL("../.dev.vars", import.meta.url);
const env = parseDevVars(fs.readFileSync(devVarsPath, "utf8"));
if (!env.TURSO_URL || !env.TURSO_TOKEN) {
  throw new Error("missing TURSO_URL/TURSO_TOKEN in .dev.vars");
}

const host = env.TURSO_URL.replace(/^libsql:\/\//, "");
const endpoint = `https://${host}/v2/pipeline`;

const tpl = {
  bot_elective_reply:
    "🧑‍⚕️ {{name}} ({{level}})\n\n{{period1_block}}{{period2_block}}\n\n{{opd_block}}\n\n📚 คู่มือ: {{pdf_manual_url}}\n",
  bot_elective_period1_block:
    "🟦 ช่วงที่ 1 ({{period1_dates}})\n🏥 วอร์ด: {{ward1}}\n👑 Chief (ติดต่อเพื่อราวด์วอร์ดช่วงที่ 1): {{chief1_name}} {{chief1_line}}\n👨‍⚕️ อาจารย์ที่ต้องราวด์ด้วย: {{supervise1_list}}\n",
  bot_elective_period2_block:
    "\n\n🟧 ช่วงที่ 2 ({{period2_dates}})\n🏥 วอร์ด: {{ward2}}\n👑 Chief: {{chief2_name}} {{chief2_line}}\n👨‍⚕️ อาจารย์ที่ต้องราวด์ด้วย: {{supervise2_list}}\n",
  bot_opd_calendar_block: "🏥 ตาราง OPD\n{{opd_lines}}\n",
};

const upsertSql =
  "INSERT INTO templates(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value";

const textArg = (value) => ({ type: "text", value: String(value ?? "") });

const requests = Object.entries(tpl).map(([key, value]) => ({
  type: "execute",
  stmt: { sql: upsertSql, args: [textArg(key), textArg(value)] },
}));
requests.push({ type: "close" });

const res = await fetch(endpoint, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${env.TURSO_TOKEN}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ requests }),
});

const text = await res.text();
if (!res.ok) {
  throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
}
let json;
try {
  json = JSON.parse(text);
} catch {
  throw new Error(`non-JSON response: ${text.slice(0, 300)}`);
}
const bad = (json.results || []).find((x) => x.type !== "ok");
if (bad) throw new Error(`turso error: ${JSON.stringify(bad).slice(0, 400)}`);

console.log("ok");

