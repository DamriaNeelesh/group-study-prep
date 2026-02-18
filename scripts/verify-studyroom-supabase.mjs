import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

function loadEnv(file) {
  const text = fs.readFileSync(file, "utf8");
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

async function checkTable(supabase, table) {
  const { error } = await supabase.from(table).select("*").limit(1);
  return { table, ok: !error, error: error?.message ?? null };
}

async function main() {
  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) {
    console.error("Missing .env in repo root");
    process.exit(2);
  }
  const env = loadEnv(envPath);
  const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || "";
  const serviceRole = env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !serviceRole) {
    console.error("Missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY in .env");
    process.exit(2);
  }

  const supabase = createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const tables = [
    "rooms",
    "profiles",
    "room_stage_roles",
    "room_stage_streams",
    "api_keys",
    "telemetry_events",
  ];

  const results = [];
  for (const t of tables) results.push(await checkTable(supabase, t));

  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});

