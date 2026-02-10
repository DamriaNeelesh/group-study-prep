/// <reference lib="deno.ns" />

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

function getSupabaseAdmin() {
  const projectRef = Deno.env.get("PROJECT_REF");
  const url =
    Deno.env.get("SUPABASE_URL") ??
    (projectRef ? `https://${projectRef}.supabase.co` : undefined);
  const key = Deno.env.get("SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Missing PROJECT_REF/SERVICE_ROLE_KEY secrets.");
  return createClient(url, key, { auth: { persistSession: false } });
}

function normalizePhoneToE164(
  input: string,
): { ok: true; e164: string } | { ok: false; error: string } {
  const raw = (input ?? "").trim();
  if (!raw) return { ok: false, error: "Phone number is required." };
  const plus = raw.startsWith("+") ? "+" : "";
  const digits = raw.replace(/[^\d]/g, "");
  const candidate = plus ? `+${digits}` : digits;
  if (candidate.startsWith("+")) {
    const d = candidate.slice(1);
    if (d.length < 8 || d.length > 15) return { ok: false, error: "Invalid phone length." };
    return { ok: true, e164: `+${d}` };
  }
  if (digits.length === 10) return { ok: true, e164: `+91${digits}` };
  if (digits.length === 11 && digits.startsWith("0")) return { ok: true, e164: `+91${digits.slice(1)}` };
  if (digits.length === 12 && digits.startsWith("91")) return { ok: true, e164: `+${digits}` };
  return { ok: false, error: "Please enter a valid 10-digit mobile number." };
}

async function sendResendEmail(to: string, subject: string, text: string) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return;
  const from = Deno.env.get("RESEND_FROM") ?? "onboarding@resend.dev";
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, text }),
  }).catch(() => {});
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const sb = getSupabaseAdmin();
    const body = await req.json();

    const persona = (body?.persona ?? "lead") as "student" | "parent" | "lead";
    const name = (body?.name ?? null) as string | null;
    const phone = String(body?.phone ?? "").trim();
    const class_moving_to = (body?.class_moving_to ?? null) as string | null;
    const target_exam = (body?.target_exam ?? "unknown") as string | null;
    const query_text = (body?.query_text ?? null) as string | null;
    const source = (body?.source ?? "web_widget") as string;
    const page_url = (body?.page_url ?? null) as string | null;
    const utm = (body?.utm ?? {}) as Record<string, unknown>;
    const priority = (body?.priority ?? "normal") as "normal" | "high";

    const p = normalizePhoneToE164(phone);
    if (!p.ok) return json({ error: p.error }, 400);

    const payload = {
      persona,
      name,
      phone_e164: p.e164,
      class_moving_to,
      target_exam,
      query_text,
      source,
      page_url,
      utm,
      priority,
      status: "new",
    };

    const { error } = await sb.from("leads").insert(payload);
    if (error) throw error;

    const salesTo = Deno.env.get("SALES_ALERT_EMAIL");
    if (salesTo) {
      await sendResendEmail(
        salesTo,
        `Next Toppers Lead (${priority})`,
        `Phone: ${p.e164}\nName: ${name ?? "-"}\nPersona: ${persona}\nClass: ${class_moving_to ?? "-"}\nExam: ${target_exam ?? "-"}\nQuery: ${query_text ?? "-"}\nPage: ${page_url ?? "-"}`,
      );
    }

    return json({
      messages: [
        { role: "bot", text: "Thanks! Our counselor will call you within 24 hours." },
      ],
      quick_replies: L1,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: msg }, 500);
  }
});

const L1 = [
  { id: "new_batches", label: "New Batches (2026-27)" },
  { id: "enrolled_support", label: "My Enrolled Course" },
  { id: "fees_offers", label: "Fee Structure & Offers" },
  { id: "timetable", label: "Timetable & Schedule" },
  { id: "callback", label: "Request Call Back" },
];

