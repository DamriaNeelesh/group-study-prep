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

    const issue_type = (body?.issue_type ?? "other") as
      | "video_not_playing"
      | "pdf_not_opening"
      | "payment_failed"
      | "other";
    const issue_details = (body?.issue_details ?? null) as string | null;
    const page_url = (body?.page_url ?? null) as string | null;

    const nt_user = (body?.nt_user ?? {}) as {
      id?: string | null;
      name?: string | null;
      mobile?: string | null;
    };

    const rawPhone = (body?.phone ?? nt_user?.mobile ?? "") as string;
    const phone = rawPhone ? normalizePhoneToE164(String(rawPhone)) : null;

    const ticketPayload = {
      issue_type,
      issue_details,
      nt_user_id: nt_user?.id ?? null,
      nt_user_name: nt_user?.name ?? null,
      nt_user_mobile: nt_user?.mobile ?? null,
      phone_e164: phone && phone.ok ? phone.e164 : null,
      page_url,
      status: "open",
    };

    const { data: inserted, error } = await sb
      .from("support_tickets")
      .insert(ticketPayload)
      .select("id")
      .single();
    if (error) throw error;

    const supportTo = Deno.env.get("SUPPORT_INBOX_EMAIL") ?? "support@nexttoppers.com";
    await sendResendEmail(
      supportTo,
      `Next Toppers Support Ticket (${issue_type})`,
      `Ticket ID: ${inserted.id}\nIssue: ${issue_type}\nDetails: ${issue_details ?? "-"}\nUser: ${ticketPayload.nt_user_name ?? "-"} (${ticketPayload.nt_user_id ?? "-"})\nMobile: ${ticketPayload.nt_user_mobile ?? ticketPayload.phone_e164 ?? "-"}\nPage: ${page_url ?? "-"}`,
    );

    return json({
      ticket_id: inserted.id,
      messages: [{ role: "bot", text: `Ticket raised! ID: ${inserted.id}` }],
      quick_replies: [
        { id: "back_menu", label: "Back to Menu" },
      ],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: msg }, 500);
  }
});

