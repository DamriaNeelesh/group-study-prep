import fs from "node:fs";
import path from "node:path";
import process from "node:process";

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  return process.argv[idx + 1] ?? null;
}

function usage() {
  console.log(
    [
      "Usage:",
      "  SUPABASE_ACCESS_TOKEN=... node scripts/supabase-run-query.mjs --ref <project_ref> --query \"select 1\"",
      "  SUPABASE_ACCESS_TOKEN=... node scripts/supabase-run-query.mjs --ref <project_ref> --file supabase/studyroom_v2.sql",
      "",
      "Env:",
      "  SUPABASE_ACCESS_TOKEN  Supabase personal access token (PAT) with access to the project.",
      "",
      "Args:",
      "  --ref   Supabase project ref (e.g. avtmohfcixlzriichofq)",
      "  --query SQL string to run",
      "  --file  Path to a .sql file to run",
    ].join("\n"),
  );
}

async function main() {
  const token =
    process.env.SUPABASE_ACCESS_TOKEN ||
    process.env.SUPABASE_PAT ||
    process.env.SUPABASE_MANAGEMENT_API_TOKEN ||
    "";
  const ref = argValue("--ref") || process.env.SUPABASE_PROJECT_REF || "";
  const file = argValue("--file");
  const queryArg = argValue("--query");

  if (!token || !ref || (!file && !queryArg)) {
    usage();
    process.exit(2);
  }

  let query = queryArg || "";
  if (file) {
    const abs = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
    query = fs.readFileSync(abs, "utf8");
  }

  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query }),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error(`ERROR ${res.status}: ${text.slice(0, 800)}`);
    process.exit(1);
  }

  // Avoid dumping huge result sets; callers can pipe/modify if needed.
  const preview = text.length > 5000 ? `${text.slice(0, 5000)}\n...` : text;
  console.log(preview);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});

