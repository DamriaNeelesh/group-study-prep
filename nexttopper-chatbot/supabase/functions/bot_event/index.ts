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
  flow?: "menu" | "new_batches" | "fees_offers" | "timetable" | "support" | "callback" | "lead_capture";
  class_group?: "9" | "10" | "11_12";
  batch_key?: string;
  issue_type?: "video_not_playing" | "pdf_not_opening" | "payment_failed" | "other";
  awaiting?: "lead_phone" | "support_details" | "callback_name_or_phone" | "callback_phone" | "callback_exam";
  callback_name?: string | null;
  callback_phone_e164?: string | null;
  lead_priority?: "normal" | "high";
  lead_query_text?: string | null;
};

const L1: BotQuickReply[] = [
  { id: "new_batches", label: "New Batches (2026-27)" },
  { id: "enrolled_support", label: "My Enrolled Course" },
  { id: "fees_offers", label: "Fee Structure & Offers" },
  { id: "timetable", label: "Timetable & Schedule" },
  { id: "callback", label: "Request Call Back" },
];

const CLASS_OPTS: BotQuickReply[] = [
  { id: "class_9", label: "Class 9 (Aarambh)" },
  { id: "class_10", label: "Class 10 (Abhay)" },
  { id: "class_11_12", label: "Class 11/12 (Prarambh)" },
  { id: "back_menu", label: "Back to Menu" },
];

const ISSUE_OPTS: BotQuickReply[] = [
  { id: "video_not_playing", label: "Video not playing" },
  { id: "pdf_not_opening", label: "PDF not opening" },
  { id: "payment_failed", label: "Payment failed" },
  { id: "back_menu", label: "Back to Menu" },
];

const CTA_OPTS: BotQuickReply[] = [
  { id: "check_fees", label: "Check Fees" },
  { id: "view_syllabus", label: "View Syllabus" },
  { id: "talk_counselor", label: "Talk to Counselor" },
  { id: "back_menu", label: "Back to Menu" },
];

const EXAM_OPTS: BotQuickReply[] = [
  { id: "exam_board", label: "Board" },
  { id: "exam_jee", label: "JEE" },
  { id: "exam_neet", label: "NEET" },
  { id: "exam_unknown", label: "Not sure" },
];

const TIMETABLE_OPTS: BotQuickReply[] = [
  { id: "next_7_days", label: "Next 7 Days" },
  { id: "back_menu", label: "Back to Menu" },
];

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

function isHandoverTrigger(text: string): boolean {
  const t = (text ?? "").toLowerCase();
  return (
    /\binstallment(s)?\b/.test(t) ||
    /\bemi\b/.test(t) ||
    /\bpartial\b/.test(t) ||
    /\bdiscount\b/.test(t) ||
    /\bspecial offer\b/.test(t) ||
    /\b3 installments?\b/.test(t)
  );
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

function istDateString(now = new Date()): string {
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000;
  const istMs = utcMs + 330 * 60_000;
  return new Date(istMs).toISOString().slice(0, 10);
}

function addDaysIsoDate(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatDateHuman(isoDate: string | null): string {
  if (!isoDate) return "March/April (exact date admin will update)";
  try {
    const d = new Date(`${isoDate}T00:00:00.000Z`);
    return d.toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "2-digit" });
  } catch {
    return isoDate;
  }
}

function parseUtm(pageUrl: string | null): Record<string, string> {
  if (!pageUrl) return {};
  try {
    const u = new URL(pageUrl);
    const out: Record<string, string> = {};
    for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) {
      const v = u.searchParams.get(k);
      if (v) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
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

async function getCourseForClassGroup(sb: ReturnType<typeof getSupabaseAdmin>, classGroup: "9" | "10" | "11_12") {
  const baseSelect = "batch_key, batch_name, class_group, price_inr, start_date, status, syllabus_url, purchase_url, highlights, updated_at";
  const { data: open } = await sb
    .from("nt_course_catalog")
    .select(baseSelect)
    .eq("class_group", classGroup)
    .eq("status", "open")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (open) return open as any;
  const { data: anyRow } = await sb
    .from("nt_course_catalog")
    .select(baseSelect)
    .eq("class_group", classGroup)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return anyRow as any;
}

function subjectsForClassGroup(cg: "9" | "10" | "11_12") {
  return cg === "11_12" ? "Physics, Chemistry, Maths/Biology" : "Science, Maths, SST";
}

function classFromSelection(sel: string): "9" | "10" | "11_12" | null {
  if (sel === "class_9") return "9";
  if (sel === "class_10") return "10";
  if (sel === "class_11_12") return "11_12";
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const sb = getSupabaseAdmin();
    const body = await req.json();

    const session_id = body?.session_id as string | undefined;
    const type = body?.type as "text" | "select" | undefined;
    const page_url = (body?.page_url ?? null) as string | null;

    if (!session_id || !type) return json({ error: "session_id and type are required" }, 400);

    const userText = type === "text" ? String(body?.text ?? "").trim() : String(body?.selection_id ?? "").trim();
    const selection_id = type === "select" ? String(body?.selection_id ?? "").trim() : "";

    await sb.from("nt_chat_messages").insert({ session_id, role: "user", content: userText, meta: { type, page_url } });

    const { data: sessionRow } = await sb
      .from("nt_chat_sessions")
      .select("id, state, nt_user_id, nt_user_name, nt_user_mobile")
      .eq("id", session_id)
      .maybeSingle();
    if (!sessionRow) return json({ error: "session not found" }, 404);

    const state: State = (sessionRow.state ?? { flow: "menu" }) as State;

    const messages: BotMessage[] = [];
    let quick_replies: BotQuickReply[] = [];
    let nextState: State = { ...state };
    let personaToSet: string | null = null;

    const respond = async () => {
      await sb
        .from("nt_chat_sessions")
        .update({
          state: nextState,
          ...(personaToSet ? { persona: personaToSet } : {}),
        })
        .eq("id", session_id);

      if (messages.length) {
        await sb.from("nt_chat_messages").insert(
          messages.map((m) => ({ session_id, role: "bot", content: m.text, meta: { page_url } })),
        );
      }

      return json({ messages, quick_replies });
    };

    if (type === "select" && selection_id === "back_menu") {
      nextState = { flow: "menu" };
      messages.push({ role: "bot", text: "I have opened the main menu. What would you like to do?" });
      quick_replies = L1;
      return await respond();
    }

    // Awaiting: lead phone
    if (state.awaiting === "lead_phone") {
      if (type !== "text") {
        messages.push({ role: "bot", text: "Please type your phone number." });
        quick_replies = [{ id: "back_menu", label: "Back to Menu" }];
        return await respond();
      }

      const savedMobile = (sessionRow.nt_user_mobile ?? "").trim();
      const candidate = userText.toLowerCase() === "yes" && savedMobile ? savedMobile : userText;
      const phone = normalizePhoneToE164(candidate);
      if (!phone.ok) {
        messages.push({ role: "bot", text: `${phone.error} Example: 9999999999` });
        quick_replies = [{ id: "back_menu", label: "Back to Menu" }];
        return await respond();
      }

      const leadPayload = {
        persona: "lead",
        name: sessionRow.nt_user_name ?? null,
        phone_e164: phone.e164,
        class_moving_to: nextState.class_group ?? null,
        target_exam: "unknown",
        query_text: nextState.lead_query_text ?? "Talk to counselor",
        source: "web_widget",
        page_url,
        utm: parseUtm(page_url),
        priority: nextState.lead_priority ?? "normal",
        status: "new",
      };

      const { error: leadErr } = await sb.from("nt_leads").insert(leadPayload);
      if (leadErr) throw leadErr;

      const salesTo = Deno.env.get("SALES_ALERT_EMAIL");
      if (salesTo) {
        await sendResendEmail(
          salesTo,
          `Next Toppers Lead (${leadPayload.priority})`,
          `Phone: ${leadPayload.phone_e164}\nName: ${leadPayload.name ?? "-"}\nClass: ${leadPayload.class_moving_to ?? "-"}\nQuery: ${leadPayload.query_text ?? "-"}\nPage: ${leadPayload.page_url ?? "-"}`,
        );
      }

      const senior = leadPayload.priority === "high" ? "senior " : "";
      messages.push({ role: "bot", text: `Done! Our ${senior}counselor will call you at ${phone.e164} within 24 hours.` });
      quick_replies = L1;
      nextState = { flow: "menu" };
      return await respond();
    }

    // Awaiting: support details
    if (state.awaiting === "support_details") {
      if (type !== "text") {
        messages.push({ role: "bot", text: "Please type the issue details." });
        quick_replies = [{ id: "back_menu", label: "Back to Menu" }];
        return await respond();
      }

      const phoneCand = (userText.match(/\+?\d[\d\s-]{7,}/)?.[0] ?? sessionRow.nt_user_mobile ?? "").trim();
      const phone = phoneCand ? normalizePhoneToE164(phoneCand) : null;

      const ticketPayload = {
        issue_type: state.issue_type ?? "other",
        issue_details: userText || null,
        nt_user_id: sessionRow.nt_user_id ?? null,
        nt_user_name: sessionRow.nt_user_name ?? null,
        nt_user_mobile: sessionRow.nt_user_mobile ?? null,
        phone_e164: phone && phone.ok ? phone.e164 : null,
        page_url,
        status: "open",
      };

      const { data: inserted, error: tErr } = await sb
        .from("nt_support_tickets")
        .insert(ticketPayload)
        .select("id")
        .single();
      if (tErr) throw tErr;

      const supportTo = Deno.env.get("SUPPORT_INBOX_EMAIL") ?? "support@nexttoppers.com";
      await sendResendEmail(
        supportTo,
        `Next Toppers Support Ticket (${ticketPayload.issue_type})`,
        `Ticket ID: ${inserted.id}\nIssue: ${ticketPayload.issue_type}\nDetails: ${ticketPayload.issue_details ?? "-"}\nUser: ${ticketPayload.nt_user_name ?? "-"} (${ticketPayload.nt_user_id ?? "-"})\nMobile: ${ticketPayload.nt_user_mobile ?? ticketPayload.phone_e164 ?? "-"}\nPage: ${ticketPayload.page_url ?? "-"}`,
      );

      messages.push({ role: "bot", text: `Ticket raised! ID: ${inserted.id}. Our team will help you soon.` });
      quick_replies = L1;
      nextState = { flow: "menu" };
      return await respond();
    }

    // Awaiting: callback
    if (state.awaiting === "callback_name_or_phone" && type === "text") {
      const p = normalizePhoneToE164(userText);
      if (p.ok) {
        nextState = { ...state, awaiting: "callback_exam", callback_phone_e164: p.e164 };
        messages.push({ role: "bot", text: "Thanks! What is your target exam?" });
        quick_replies = EXAM_OPTS;
        return await respond();
      }
      nextState = { ...state, awaiting: "callback_phone", callback_name: userText || null };
      messages.push({ role: "bot", text: `Thanks${userText ? ` ${userText}` : ""}! Please share your mobile number (10 digits).` });
      quick_replies = [{ id: "back_menu", label: "Back to Menu" }];
      return await respond();
    }

    if (state.awaiting === "callback_phone" && type === "text") {
      const p = normalizePhoneToE164(userText);
      if (!p.ok) {
        messages.push({ role: "bot", text: `${p.error} Example: 9999999999` });
        quick_replies = [{ id: "back_menu", label: "Back to Menu" }];
        return await respond();
      }
      nextState = { ...state, awaiting: "callback_exam", callback_phone_e164: p.e164 };
      messages.push({ role: "bot", text: "Great. What is your target exam?" });
      quick_replies = EXAM_OPTS;
      return await respond();
    }

    if (state.awaiting === "callback_exam" && type === "select") {
      const exam =
        selection_id === "exam_board" ? "board" :
        selection_id === "exam_jee" ? "jee" :
        selection_id === "exam_neet" ? "neet" :
        "unknown";

      const phone_e164 = state.callback_phone_e164 ?? null;
      if (!phone_e164) {
        nextState = { ...state, awaiting: "callback_phone" };
        messages.push({ role: "bot", text: "Please share your phone number." });
        quick_replies = [{ id: "back_menu", label: "Back to Menu" }];
        return await respond();
      }

      const leadPayload = {
        persona: "lead",
        name: state.callback_name ?? null,
        phone_e164,
        class_moving_to: state.class_group ?? null,
        target_exam: exam,
        query_text: "Request Call Back",
        source: "web_widget",
        page_url,
        utm: parseUtm(page_url),
        priority: "normal",
        status: "new",
      };

      const { error: leadErr } = await sb.from("nt_leads").insert(leadPayload);
      if (leadErr) throw leadErr;

      const salesTo = Deno.env.get("SALES_ALERT_EMAIL");
      if (salesTo) {
        await sendResendEmail(
          salesTo,
          "Next Toppers Callback Request",
          `Phone: ${leadPayload.phone_e164}\nName: ${leadPayload.name ?? "-"}\nExam: ${leadPayload.target_exam ?? "-"}\nPage: ${leadPayload.page_url ?? "-"}`,
        );
      }

      messages.push({ role: "bot", text: `Noted! Our team will call you at ${phone_e164} within 24 hours.` });
      quick_replies = L1;
      nextState = { flow: "menu" };
      return await respond();
    }

    // Free-text: global handover
    if (type === "text" && isHandoverTrigger(userText)) {
      nextState = { flow: "lead_capture", awaiting: "lead_phone", lead_priority: "high", lead_query_text: userText };
      messages.push({ role: "bot", text: "This is a specific request about fees/discount/installments. Please share your phone number and a senior counselor will call you within 24 hours." });
      if (sessionRow.nt_user_mobile) {
        messages.push({ role: "bot", text: `If ${sessionRow.nt_user_mobile} is your number, reply \"yes\"; otherwise enter a new number.` });
      }
      quick_replies = [{ id: "back_menu", label: "Back to Menu" }];
      return await respond();
    }

    // Main select routing
    if (type === "select") {
      switch (selection_id) {
        case "new_batches": {
          personaToSet = "lead";
          nextState = { flow: "new_batches" };
          messages.push({ role: "bot", text: "Which class are you moving to?" });
          quick_replies = CLASS_OPTS;
          return await respond();
        }
        case "fees_offers": {
          personaToSet = "lead";
          nextState = { flow: "fees_offers" };
          messages.push({ role: "bot", text: "Which class would you like fee details for?" });
          quick_replies = CLASS_OPTS;
          return await respond();
        }
        case "timetable": {
          personaToSet = "student";
          nextState = { flow: "timetable" };
          messages.push({ role: "bot", text: "Which class timetable do you need?" });
          quick_replies = CLASS_OPTS;
          return await respond();
        }
        case "enrolled_support": {
          personaToSet = "student";
          nextState = { flow: "support" };
          messages.push({ role: "bot", text: "What issue are you facing?" });
          quick_replies = ISSUE_OPTS;
          return await respond();
        }
        case "callback": {
          personaToSet = "lead";
          nextState = { flow: "callback", awaiting: "callback_name_or_phone" };
          messages.push({ role: "bot", text: "Sure! What is your name? (Optional) You can also directly share your phone number." });
          quick_replies = [{ id: "back_menu", label: "Back to Menu" }];
          return await respond();
        }
      }

      // Class selection based on flow
      const cg = classFromSelection(selection_id);
      if (cg) {
        const course = await getCourseForClassGroup(sb, cg);
        nextState = { ...state, class_group: cg, batch_key: course?.batch_key ?? undefined };

        if (state.flow === "new_batches") {
          personaToSet = "lead";
          const highlights = Array.isArray(course?.highlights) && course.highlights.length ? course.highlights.join(" + ") : "Live Classes + Notes";
          messages.push({ role: "bot", text: `Great choice! ${course?.batch_name ?? "This batch"} for Class ${cg.replace("_", "/")} covers ${subjectsForClassGroup(cg)} with ${highlights}.` });
          messages.push({ role: "bot", text: `New session starts: ${formatDateHuman(course?.start_date ?? null)}.` });
          quick_replies = CTA_OPTS;
          return await respond();
        }

        if (state.flow === "fees_offers") {
          personaToSet = "lead";
          const today = istDateString();
          const { data: offers } = await sb.from("nt_offers").select("title, description, active, valid_from, valid_to").eq("active", true);
          const activeOffers = (offers ?? []).filter((o: any) => (!o.valid_from || o.valid_from <= today) && (!o.valid_to || o.valid_to >= today));
          const offerText = activeOffers.length ? `Offers:\n${activeOffers.map((o: any) => `- ${o.title}: ${o.description}`).join("\n")}` : "Currently no active offers are listed.";
          messages.push({ role: "bot", text: `Fees for ${course?.batch_name ?? cg}: INR ${course?.price_inr ?? "-"}\n\n${offerText}` });
          quick_replies = [
            { id: "talk_counselor", label: "Talk to Counselor" },
            { id: "back_menu", label: "Back to Menu" },
          ];
          return await respond();
        }

        if (state.flow === "timetable") {
          personaToSet = "student";
          const today = istDateString();
          const { data: entries } = await sb.from("nt_timetable_entries").select("date, start_time, end_time, subject, teacher").eq("batch_key", course?.batch_key ?? "").eq("date", today).order("start_time");
          if (!entries?.length) {
            messages.push({ role: "bot", text: `Today's timetable (${today}) is not available. Would you like to see the next 7 days?` });
            quick_replies = TIMETABLE_OPTS;
            return await respond();
          }
          const lines = entries.map((e: any) => `- ${e.start_time}-${e.end_time} ${e.subject}${e.teacher ? ` (${e.teacher})` : ""}`);
          messages.push({ role: "bot", text: `Today's schedule (${today}):\n${lines.join("\n")}` });
          quick_replies = TIMETABLE_OPTS;
          return await respond();
        }

        // default
        messages.push({ role: "bot", text: "Thanks! Please select an option from the main menu." });
        quick_replies = L1;
        nextState = { flow: "menu" };
        return await respond();
      }

      if (selection_id === "check_fees") {
        const batch_key = state.batch_key;
        if (!batch_key) {
          messages.push({ role: "bot", text: "Please select a class first." });
          quick_replies = CLASS_OPTS;
          nextState = { flow: "new_batches" };
          return await respond();
        }

        const { data: course } = await sb.from("nt_course_catalog").select("batch_name, price_inr, purchase_url").eq("batch_key", batch_key).maybeSingle();
        const today = istDateString();
        const { data: offers } = await sb.from("nt_offers").select("title, description, active, valid_from, valid_to").eq("active", true);
        const activeOffers = (offers ?? []).filter((o: any) => (!o.valid_from || o.valid_from <= today) && (!o.valid_to || o.valid_to >= today));
        const offerText = activeOffers.length ? `Offers:\n${activeOffers.map((o: any) => `- ${o.title}: ${o.description}`).join("\n")}` : "Currently no active offers are listed.";

        messages.push({ role: "bot", text: `Fees for ${course?.batch_name ?? batch_key}: INR ${course?.price_inr ?? "-"}\n\n${offerText}` });
        if (course?.purchase_url) messages.push({ role: "bot", text: `Enroll: ${course.purchase_url}` });
        quick_replies = [
          { id: "talk_counselor", label: "Talk to Counselor" },
          { id: "back_menu", label: "Back to Menu" },
        ];
        return await respond();
      }

      if (selection_id === "view_syllabus") {
        const batch_key = state.batch_key;
        if (!batch_key) {
          messages.push({ role: "bot", text: "Please select a class first." });
          quick_replies = CLASS_OPTS;
          nextState = { flow: "new_batches" };
          return await respond();
        }

        const { data: course } = await sb.from("nt_course_catalog").select("batch_name, syllabus_url").eq("batch_key", batch_key).maybeSingle();
        if (course?.syllabus_url) {
          messages.push({ role: "bot", text: `Syllabus for ${course.batch_name}:\n${course.syllabus_url}` });
          quick_replies = [{ id: "back_menu", label: "Back to Menu" }];
          return await respond();
        }

        messages.push({ role: "bot", text: "The syllabus link is not updated yet. You can click 'Talk to Counselor' to request a callback." });
        quick_replies = [
          { id: "talk_counselor", label: "Talk to Counselor" },
          { id: "back_menu", label: "Back to Menu" },
        ];
        return await respond();
      }

      if (selection_id === "talk_counselor") {
        personaToSet = "lead";
        nextState = { ...state, flow: "lead_capture", awaiting: "lead_phone", lead_priority: state.flow === "fees_offers" ? "high" : "normal", lead_query_text: state.flow === "fees_offers" ? "Fee/Offer inquiry" : "Talk to counselor" };
        messages.push({ role: "bot", text: "Sure! Please share your phone number (10 digits). We will call you within 24 hours." });
        if (sessionRow.nt_user_mobile) messages.push({ role: "bot", text: `If ${sessionRow.nt_user_mobile} is your number, reply \"yes\"; otherwise enter a new number.` });
        quick_replies = [{ id: "back_menu", label: "Back to Menu" }];
        return await respond();
      }

      if (selection_id === "video_not_playing" || selection_id === "pdf_not_opening" || selection_id === "payment_failed") {
        personaToSet = "student";
        const issue = selection_id as State["issue_type"];
        const steps =
          issue === "video_not_playing"
            ? "Please try: 1) Clear App Cache 2) Update the Next Toppers App 3) Switch network (WiFi/Mobile Data)."
            : issue === "pdf_not_opening"
            ? "Please try: 1) Update the app 2) Re-download the PDF 3) Try a different PDF viewer."
            : "Please try: 1) Check internet 2) Wait 5 minutes and retry 3) Ensure bank OTP/limits are ok.";
        nextState = { ...state, flow: "support", issue_type: issue };
        messages.push({ role: "bot", text: steps });
        messages.push({ role: "bot", text: "If the issue still persists, click Raise Ticket." });
        quick_replies = [
          { id: "raise_ticket", label: "Raise Ticket" },
          { id: "back_menu", label: "Back to Menu" },
        ];
        return await respond();
      }

      if (selection_id === "raise_ticket") {
        personaToSet = "student";
        nextState = { ...state, flow: "support", awaiting: "support_details" };
        messages.push({ role: "bot", text: "Briefly describe the issue (1-2 lines). You may also include your phone number (optional)." });
        quick_replies = [{ id: "back_menu", label: "Back to Menu" }];
        return await respond();
      }

      if (selection_id === "next_7_days") {
        const batch_key = state.batch_key;
        if (!batch_key) {
          messages.push({ role: "bot", text: "Please select a class first." });
          quick_replies = CLASS_OPTS;
          nextState = { flow: "timetable" };
          return await respond();
        }
        const start = istDateString();
        const end = addDaysIsoDate(start, 6);
        const { data: entries } = await sb.from("nt_timetable_entries").select("date, start_time, end_time, subject, teacher").eq("batch_key", batch_key).gte("date", start).lte("date", end).order("date").order("start_time");
        if (!entries?.length) {
          messages.push({ role: "bot", text: `No timetable found for next 7 days (${start} to ${end}).` });
          quick_replies = [{ id: "back_menu", label: "Back to Menu" }];
          return await respond();
        }
        const byDate = new Map<string, any[]>();
        for (const e of entries as any[]) {
          const arr = byDate.get(e.date) ?? [];
          arr.push(e);
          byDate.set(e.date, arr);
        }
        const blocks: string[] = [];
        for (const [d, arr] of byDate.entries()) {
          blocks.push(`${d}:`);
          for (const e of arr) blocks.push(`- ${e.start_time}-${e.end_time} ${e.subject}${e.teacher ? ` (${e.teacher})` : ""}`);
          blocks.push("");
        }
        messages.push({ role: "bot", text: `Next 7 days timetable:\n\n${blocks.join("\n").trim()}` });
        quick_replies = [{ id: "back_menu", label: "Back to Menu" }];
        return await respond();
      }
    }

    // Text fallback: KB -> LLM -> menu
    if (type === "text") {
      const { data: kb } = await sb
        .from("nt_kb_articles")
        .select("content")
        .textSearch("search", userText, { type: "plain", config: "simple" })
        .limit(1);
      const best = (kb ?? [])[0] as any;
      if (best?.content) {
        messages.push({ role: "bot", text: best.content });
        quick_replies = L1;
        nextState = { flow: "menu" };
        return await respond();
      }

      const openaiKey = Deno.env.get("OPENAI_API_KEY");
      if (openaiKey) {
        try {
          const model = Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini";
          const resp = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: { authorization: `Bearer ${openaiKey}`, "content-type": "application/json" },
            body: JSON.stringify({
              model,
              messages: [
                { role: "system", content: "You are Next Toppers Smart Counselor. Reply in friendly, encouraging English with an academic tone. If unsure, ask the user to choose a menu option or request a callback. Keep answers concise." },
                { role: "user", content: userText },
              ],
              temperature: 0.4,
              max_tokens: 200,
            }),
          });
          if (resp.ok) {
            const j = await resp.json();
            const ans = j?.choices?.[0]?.message?.content;
            if (ans) {
              messages.push({ role: "bot", text: String(ans).trim() });
              quick_replies = L1;
              nextState = { flow: "menu" };
              return await respond();
            }
          }
        } catch {
          // ignore
        }
      }

      messages.push({ role: "bot", text: "I cannot confirm the exact answer right now. Please choose an option from the menu or select Request Call Back." });
      quick_replies = L1;
      nextState = { flow: "menu" };
      return await respond();
    }

    messages.push({ role: "bot", text: "Invalid request." });
    quick_replies = L1;
    nextState = { flow: "menu" };
    return await respond();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ error: msg }, 500);
  }
});
