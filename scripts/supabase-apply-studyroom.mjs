import path from "node:path";
import process from "node:process";

function argHas(flag) {
  return process.argv.includes(flag);
}

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  return process.argv[idx + 1] ?? null;
}

function usage() {
  console.log(
    [
      "Apply StudyRoom SQL to a Supabase project using the Supabase Management API.",
      "",
      "Usage:",
      "  SUPABASE_ACCESS_TOKEN=... node scripts/supabase-apply-studyroom.mjs --ref <project_ref> [--init] [--v2] [--tracking]",
      "",
      "Default behavior:",
      "  Applies --v2 and --tracking (does NOT re-apply init).",
      "",
      "Notes:",
      "  - This requires a Supabase PAT that has access to the project ref.",
      "  - If you see 403, your token does not have privileges for that project.",
    ].join("\n"),
  );
}

async function runFile({ token, ref, relPath }) {
  const abs = path.join(process.cwd(), relPath);
  const query = await import("node:fs").then((m) => m.readFileSync(abs, "utf8"));

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
    throw new Error(`${relPath}: ${res.status} ${text.slice(0, 400)}`);
  }
}

async function main() {
  const token =
    process.env.SUPABASE_ACCESS_TOKEN ||
    process.env.SUPABASE_PAT ||
    process.env.SUPABASE_MANAGEMENT_API_TOKEN ||
    "";
  const ref = argValue("--ref") || process.env.SUPABASE_PROJECT_REF || "";
  if (!token || !ref) {
    usage();
    process.exit(2);
  }

  const wantInit = argHas("--init");
  const wantV2 = argHas("--v2") || (!argHas("--init") && !argHas("--tracking"));
  const wantTracking = argHas("--tracking") || (!argHas("--init") && !argHas("--v2"));

  const steps = [];
  if (wantInit) steps.push("supabase/studyroom_init.sql");
  if (wantV2) steps.push("supabase/studyroom_v2.sql");
  if (wantTracking) steps.push("supabase/studyroom_tracking.sql");

  for (const relPath of steps) {
    console.log(`APPLY ${relPath}`);
    await runFile({ token, ref, relPath });
    console.log(`OK    ${relPath}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});

