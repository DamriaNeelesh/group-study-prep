/// <reference lib="deno.ns" />

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

type BotQuickReply = { id: string; label: string };
type BotMessage = { role: "bot"; text: string };

function l1Menu(): BotQuickReply[] {
  return [
    { id: "new_batches", label: "New Batches (2026-27)" },
    { id: "enrolled_support", label: "My Enrolled Course" },
    { id: "fees_offers", label: "Fee Structure & Offers" },
    { id: "timetable", label: "Timetable & Schedule" },
    { id: "callback", label: "Request Call Back" },
  ];
}

function getSupabaseAdmin() {
  const projectRef = Deno.env.get("PROJECT_REF");
  const url =
    Deno.env.get("SUPABASE_URL") ??
    (projectRef ? `https://${projectRef}.supabase.co` : undefined);
  const key = Deno.env.get("SERVICE_ROLE_KEY");

  if (!url || !key) {
    throw new Error(
      "Missing PROJECT_REF/SUPABASE_URL or SERVICE_ROLE_KEY in function secrets."
    );
  }

  return createClient(url, key, {
    auth: { persistSession: false },
    global: { headers: { "x-nt-bot": "edge" } },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const visitor_id = body?.visitor_id as string | undefined;
    const page_url = body?.page_url as string | undefined;
    const nt_user = (body?.nt_user ?? {}) as {
      id?: string | null;
      name?: string | null;
      mobile?: string | null;
    };

    if (!visitor_id) {
      return new Response(JSON.stringify({ error: "visitor_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    const supabase = getSupabaseAdmin();

    const { data: session, error: sessionErr } = await supabase
      .from("chat_sessions")
      .insert({
        visitor_id,
        nt_user_id: nt_user.id ?? null,
        nt_user_name: nt_user.name ?? null,
        nt_user_mobile: nt_user.mobile ?? null,
        persona: null,
        state: { flow: "menu" },
      })
      .select("id")
      .single();

    if (sessionErr) throw sessionErr;

    let greeting = "Hi! Main Next Toppers Smart Counselor hu. Kaise help karu?";

    if (nt_user?.name) {
      // Try greeting with enrollment
      let enrolledBatch: string | null = null;
      if (nt_user.id) {
        const { data: enr } = await supabase
          .from("user_enrollments")
          .select("batch_key, course_catalog(batch_name)")
          .eq("nt_user_id", nt_user.id)
          .maybeSingle();
        // @ts-ignore: supabase nested select typing
        enrolledBatch = enr?.course_catalog?.batch_name ?? null;
      }

      greeting = enrolledBatch
        ? `Hi ${nt_user.name}, welcome back to the ${enrolledBatch}!`
        : `Hi ${nt_user.name}, welcome back!`;
    }

    const messages: BotMessage[] = [
      { role: "bot", text: greeting },
      {
        role: "bot",
        text:
          "Aap kya jaan-na chahte ho? Neeche se option select kar lo:",
      },
    ];

    // Log bot messages
    await supabase.from("chat_messages").insert(
      messages.map((m) => ({
        session_id: session.id,
        role: "bot",
        content: m.text,
        meta: { page_url: page_url ?? null },
      }))
    );

    return new Response(
      JSON.stringify({
        session_id: session.id,
        messages,
        quick_replies: l1Menu(),
      }),
      {
        headers: { ...corsHeaders, "content-type": "application/json" },
      }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});

