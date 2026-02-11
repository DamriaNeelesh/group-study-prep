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

type State = {
  flow?: "menu" | "new_user_course_select";
  resolved_user_id?: string | null;
};

function l1Menu(extra: BotQuickReply[] = []): BotQuickReply[] {
  return [
    ...extra,
    { id: "new_batches", label: "New Batches (2026-27)" },
    { id: "enrolled_support", label: "My Enrolled Course" },
    { id: "fees_offers", label: "Fee Structure & Offers" },
    { id: "timetable", label: "Timetable & Schedule" },
    { id: "callback", label: "Request Call Back" },
    { id: "not_satisfied", label: "Not satisfied" },
  ];
}

const CLASS_OPTS: BotQuickReply[] = [
  { id: "class_9", label: "Class 9 (Aarambh)" },
  { id: "class_10", label: "Class 10 (Abhay)" },
  { id: "class_11_12", label: "Class 11/12 (Prarambh)" },
  { id: "need_support", label: "I need support" },
  { id: "back_menu", label: "Back to Menu" },
];

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
      email?: string | null;
    };

    if (!visitor_id) {
      return new Response(JSON.stringify({ error: "visitor_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    const supabase = getSupabaseAdmin();

    let resolvedUserId: string | null = nt_user.id ?? null;
    const resolvedEmail = nt_user.email ?? null;

    if (!resolvedUserId && resolvedEmail) {
      const { data: customer } = await supabase
        .from("nt_customer_profiles")
        .select("nt_user_id")
        .eq("email", resolvedEmail)
        .maybeSingle();
      resolvedUserId = customer?.nt_user_id ?? null;
    }

    let enrollments: Array<{ batch_name?: string | null }> = [];
    if (resolvedUserId) {
      const { data } = await supabase
        .from("nt_user_enrollments")
        .select("batch_key, nt_course_catalog(batch_name)")
        .eq("nt_user_id", resolvedUserId);
      enrollments = (data ?? []) as Array<{ batch_name?: string | null }>;
    }

    const isExistingCustomer = enrollments.length > 0;
    const isNewUser = !resolvedUserId && !resolvedEmail && !nt_user.name && !nt_user.mobile;

    const initialState: State = {
      flow: isExistingCustomer ? "menu" : "new_user_course_select",
      resolved_user_id: resolvedUserId,
    };

    const { data: session, error: sessionErr } = await supabase
      .from("nt_chat_sessions")
      .insert({
        visitor_id,
        nt_user_id: nt_user.id ?? null,
        nt_user_name: nt_user.name ?? null,
        nt_user_mobile: nt_user.mobile ?? null,
        nt_user_email: resolvedEmail,
        persona: null,
        state: initialState,
      })
      .select("id")
      .single();

    if (sessionErr) throw sessionErr;

    let greeting = "Hi! I am your Next Toppers Smart Counselor. How can I help you today?";

    if (nt_user?.name) {
      // Try greeting with enrollment
      let enrolledBatch: string | null = null;
      if (nt_user.id) {
        const { data: enr } = await supabase
          .from("nt_user_enrollments")
          .select("batch_key, nt_course_catalog(batch_name)")
          .eq("nt_user_id", nt_user.id)
          .maybeSingle();
        // @ts-ignore: supabase nested select typing
        enrolledBatch = enr?.nt_course_catalog?.batch_name ?? null;
      }

      greeting = enrolledBatch
        ? `Hi ${nt_user.name}, welcome back to the ${enrolledBatch}!`
        : `Hi ${nt_user.name}, welcome back!`;
    }

    const messages: BotMessage[] = [{ role: "bot", text: greeting }];
    let quickReplies: BotQuickReply[] = [];

    if (isExistingCustomer) {
      messages.push({
        role: "bot",
        text: "I can help with your purchased courses. You can view your courses or choose any option below.",
      });
      quickReplies = l1Menu([{ id: "my_courses", label: "My Courses" }]);
    } else if (isNewUser) {
      messages.push({
        role: "bot",
        text: "Are you looking to purchase a course? Which class are you moving to?",
      });
      quickReplies = CLASS_OPTS;
    } else {
      messages.push({
        role: "bot",
        text: "Which class are you moving to? I can share the best course options for you.",
      });
      quickReplies = CLASS_OPTS;
    }

    // Log bot messages
    await supabase.from("nt_chat_messages").insert(
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
        quick_replies: quickReplies,
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
