// Delivers queued reminders from public.message_outbox.
//
// Called by the database (pg_net) every 5 minutes and right after new messages are queued.
// The caller must present the shared x-cron-secret; the database checks it.
//
// Channels switch on when their secrets are set (Supabase dashboard > Edge Functions > Secrets):
//   Email     RESEND_API_KEY, EMAIL_FROM (e.g. "PermitPal <reminders@yourdomain.ph>")
//   SMS       SEMAPHORE_API_KEY, SEMAPHORE_SENDER (optional approved sender name)
//   WhatsApp  WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_TEMPLATE_LANG (optional, default "en")
// A message for a channel that is not set up is marked "skipped" (the in-app notification
// still exists), so turning a channel on later never floods people with old reminders.
import { createClient } from "npm:@supabase/supabase-js@2";

type Msg = {
  id: number;
  channel: "email" | "sms" | "whatsapp";
  to_address: string;
  subject: string | null;
  body_text: string;
  body_html: string | null;
  template: string | null;
  template_params: string[] | null;
};
type Result = { result: "sent" | "error" | "skipped"; providerId?: string; error?: string };

const env = (k: string) => Deno.env.get(k) ?? "";
const configured = {
  email: !!env("RESEND_API_KEY") && !!env("EMAIL_FROM"),
  sms: !!env("SEMAPHORE_API_KEY"),
  whatsapp: !!env("WHATSAPP_TOKEN") && !!env("WHATSAPP_PHONE_ID"),
};

async function sendEmail(m: Msg): Promise<Result> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env("EMAIL_FROM"),
      to: [m.to_address],
      subject: m.subject ?? "PermitPal",
      text: m.body_text,
      html: m.body_html ?? undefined,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.ok) return { result: "sent", providerId: body.id };
  return { result: "error", error: `Resend ${res.status}: ${JSON.stringify(body).slice(0, 300)}` };
}

// Semaphore expects local PH numbers (09XXXXXXXXX) or 639XXXXXXXXX.
function phNumber(e164: string) {
  const digits = e164.replace(/\D/g, "");
  return digits.startsWith("63") ? digits : digits.replace(/^0/, "63");
}

async function sendSms(m: Msg): Promise<Result> {
  const form = new URLSearchParams({ apikey: env("SEMAPHORE_API_KEY"), number: phNumber(m.to_address), message: m.body_text });
  if (env("SEMAPHORE_SENDER")) form.set("sendername", env("SEMAPHORE_SENDER"));
  const res = await fetch("https://api.semaphore.co/api/v4/messages", { method: "POST", body: form });
  const body = await res.json().catch(() => null);
  if (res.ok && Array.isArray(body) && body[0]?.message_id) return { result: "sent", providerId: String(body[0].message_id) };
  return { result: "error", error: `Semaphore ${res.status}: ${JSON.stringify(body).slice(0, 300)}` };
}

async function sendWhatsApp(m: Msg): Promise<Result> {
  // Business-initiated WhatsApp messages must use a template Meta has approved.
  const params = (m.template_params ?? []).map((text) => ({ type: "text", text: String(text).slice(0, 1000) }));
  const res = await fetch(`https://graph.facebook.com/v21.0/${env("WHATSAPP_PHONE_ID")}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env("WHATSAPP_TOKEN")}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: m.to_address.replace(/\D/g, ""),
      type: "template",
      template: {
        name: m.template ?? "permit_reminder",
        language: { code: env("WHATSAPP_TEMPLATE_LANG") || "en" },
        components: params.length ? [{ type: "body", parameters: params }] : [],
      },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.ok) return { result: "sent", providerId: body.messages?.[0]?.id };
  return { result: "error", error: `WhatsApp ${res.status}: ${JSON.stringify(body).slice(0, 300)}` };
}

async function deliver(m: Msg): Promise<Result> {
  if (!configured[m.channel]) return { result: "skipped", error: `${m.channel} is not connected yet` };
  try {
    if (m.channel === "email") return await sendEmail(m);
    if (m.channel === "sms") return await sendSms(m);
    return await sendWhatsApp(m);
  } catch (e) {
    return { result: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  const secret = req.headers.get("x-cron-secret") ?? "";
  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

  let sent = 0, failed = 0, skipped = 0;
  // Up to 4 batches per call keeps each run well inside the function time limit.
  for (let batch = 0; batch < 4; batch++) {
    const { data, error } = await db.rpc("outbox_claim", { p_secret: secret, p_limit: 50, p_channels: configured });
    if (error) {
      const status = error.message.includes("unauthorized") ? 401 : 500;
      return Response.json({ error: error.message }, { status });
    }
    const msgs = (data ?? []) as Msg[];
    if (!msgs.length) break;
    for (const m of msgs) {
      const r = await deliver(m);
      if (r.result === "sent") sent++; else if (r.result === "skipped") skipped++; else failed++;
      const { error: finishErr } = await db.rpc("outbox_finish", {
        p_secret: secret, p_id: m.id, p_result: r.result, p_provider_id: r.providerId ?? null, p_error: r.error ?? null,
      });
      if (finishErr) console.error("outbox_finish failed", m.id, finishErr.message);
    }
    if (msgs.length < 50) break;
  }
  return Response.json({ sent, failed, skipped, configured });
});
