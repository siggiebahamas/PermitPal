// Delivers queued reminders from public.message_outbox.
//
// Called by the database (pg_net) every 5 minutes and right after new messages are queued.
// The caller must present the shared x-cron-secret; the database checks it.
//
// Channels switch on when their secrets are set (Supabase dashboard > Edge Functions > Secrets):
//   Email     GMAIL_USER + GMAIL_APP_PASSWORD (a Gmail app password; sends from that Gmail), or
//             RESEND_API_KEY + EMAIL_FROM (e.g. "Pinoy Permit <reminders@yourdomain.ph>"), which wins when both are set
//   Never spammy: the database already sends each person at most one reminder email per workspace per day (plus the
//   optional Monday summary). On top of that, this function sends any one address at most 3 emails a day, and through
//   Gmail at most 400 a day in all (Gmail's own limit is 500); anything over waits for the next morning.
//   SMS       SEMAPHORE_API_KEY, SEMAPHORE_SENDER (optional approved sender name)
//   WhatsApp  WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_TEMPLATE_LANG (optional, default "en")
// A message for a channel that is not set up is marked "skipped" (the in-app notification
// still exists), so turning a channel on later never floods people with old reminders.

type Msg = {
  id: number;
  channel: "email" | "sms" | "whatsapp";
  to_address: string;
  subject: string | null;
  body_text: string;
  body_html: string | null;
  template: string | null;
  template_params: string[] | null;
  from_name?: string | null; // White-label: the accounting firm's name
  reply_to?: string | null; // ...and where replies go
};
type Result = { result: "sent" | "error" | "skipped"; providerId?: string; error?: string };

const D = (globalThis as { Deno?: { env: { get: (k: string) => string | undefined }; serve: (h: (r: Request) => Promise<Response>) => void;
  connectTls: (o: { hostname: string; port: number }) => Promise<Conn> } }).Deno;
type Conn = { read: (b: Uint8Array) => Promise<number | null>; write: (b: Uint8Array) => Promise<number>; close: () => void };
const env = (k: string) => D?.env.get(k) ?? "";
const viaResend = () => !!env("RESEND_API_KEY") && !!env("EMAIL_FROM");
const viaGmail = () => !viaResend() && !!env("GMAIL_USER") && !!env("GMAIL_APP_PASSWORD");
export const PER_ADDRESS_DAY = 3; // emails to any one address per Manila day
export const GMAIL_DAY = 400; // all emails per day through Gmail (its limit is 500)
const configured = {
  email: viaResend() || viaGmail(),
  sms: !!env("SEMAPHORE_API_KEY"),
  whatsapp: !!env("WHATSAPP_TOKEN") && !!env("WHATSAPP_PHONE_ID"),
};

// "Firm name via Pinoy Permit <reminders@...>": the firm's name, Pinoy Permit's own sending address.
function fromHeader(name?: string | null) {
  const base = env("EMAIL_FROM");
  const clean = (name ?? "").replace(/["<>\\\r\n]/g, "").trim().slice(0, 60);
  if (!clean) return base;
  const addr = base.match(/<([^>]+)>/)?.[1] ?? base.trim();
  return `"${clean} via Pinoy Permit" <${addr}>`;
}
const replyTo = (r?: string | null) => (r && /^[^@\s<>",]+@[^@\s<>",]+\.[a-z]{2,}$/i.test(r) ? [r] : undefined);

// ---------------------------------------------------------------- Gmail (SMTP over TLS, port 465)
const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const wrap = (s: string) => s.replace(/.{1,76}/g, "$&\r\n");
const word = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`); // subjects and names with ₱ or ñ

// The whole message, ready for DATA: plain text and HTML, both base64 so no line is ever too long.
export function mimeMessage(o: { from: string; fromName: string; to: string; subject: string; text: string; html?: string | null; replyTo?: string; date?: Date; id?: string }) {
  const boundary = "pp-" + (o.id ?? crypto.randomUUID()).replace(/[^a-z0-9]/gi, "");
  const name = o.fromName.replace(/["\\\r\n]/g, "");
  const head = [
    `From: "${word(name)}" <${o.from}>`, `To: <${o.to}>`, `Subject: ${word(o.subject.replace(/[\r\n]+/g, " "))}`,
    `Date: ${(o.date ?? new Date()).toUTCString().replace("GMT", "+0000")}`, `Message-ID: <${o.id ?? crypto.randomUUID()}@pinoypermit>`,
    ...(o.replyTo ? [`Reply-To: <${o.replyTo}>`] : []), "MIME-Version: 1.0",
  ];
  const part = (type: string, body: string) => `--${boundary}\r\nContent-Type: ${type}; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap(b64(body))}`;
  return o.html
    ? [...head, `Content-Type: multipart/alternative; boundary="${boundary}"`, "", part("text/plain", o.text), part("text/html", o.html), `--${boundary}--`, ""].join("\r\n")
    : [...head, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", wrap(b64(o.text))].join("\r\n");
}

// A plain SMTP conversation. `conn` is a TLS connection (or a stand-in in tests). Throws with the server's words on any refusal.
export async function smtpSend(conn: Conn, o: { user: string; pass: string; to: string; data: string }) {
  const dec = new TextDecoder(), enc = new TextEncoder();
  let buf = "";
  const reply = async (want: number) => {
    for (;;) {
      const lines = buf.split("\r\n");
      const done = lines.slice(0, -1).findIndex((l) => /^\d{3} /.test(l));
      if (done >= 0) {
        const text = lines.slice(0, done + 1).join(" | ");
        buf = lines.slice(done + 1).join("\r\n");
        if (Number(lines[done].slice(0, 3)) !== want) throw new Error(`Gmail said: ${text.slice(0, 300)}`);
        return text;
      }
      const chunk = new Uint8Array(4096), n = await conn.read(chunk);
      if (n === null) throw new Error("Gmail closed the connection");
      buf += dec.decode(chunk.subarray(0, n));
    }
  };
  const say = async (line: string, want: number) => { await conn.write(enc.encode(line + "\r\n")); return reply(want); };
  try {
    await reply(220);
    await say("EHLO pinoypermit", 250);
    await say("AUTH LOGIN", 334);
    await say(b64(o.user), 334);
    await say(b64(o.pass), 235);
    await say(`MAIL FROM:<${o.user}>`, 250);
    await say(`RCPT TO:<${o.to}>`, 250);
    await say("DATA", 354);
    await say(o.data.replace(/\r\n\./g, "\r\n..") + "\r\n.", 250);
    await say("QUIT", 221).catch(() => null);
  } finally { try { conn.close(); } catch { /* already closed */ } }
}

async function sendGmail(m: Msg): Promise<Result> {
  const user = env("GMAIL_USER").trim(), firm = (m.from_name ?? "").replace(/["<>\\\r\n]/g, "").trim().slice(0, 60);
  const data = mimeMessage({ from: user, fromName: firm ? `${firm} via Pinoy Permit` : "Pinoy Permit", to: m.to_address, subject: m.subject ?? "Pinoy Permit",
    text: m.body_text, html: m.body_html, replyTo: replyTo(m.reply_to)?.[0] });
  await smtpSend(await D!.connectTls({ hostname: "smtp.gmail.com", port: 465 }), { user, pass: env("GMAIL_APP_PASSWORD").replace(/\s+/g, ""), to: m.to_address, data });
  return { result: "sent", providerId: "gmail" };
}

async function sendEmail(m: Msg): Promise<Result> {
  if (viaGmail()) return sendGmail(m);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: fromHeader(m.from_name),
      to: [m.to_address],
      reply_to: replyTo(m.reply_to),
      subject: m.subject ?? "Pinoy Permit",
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

// Where the Manila day started, and the next 7 a.m. Manila (when held-back emails go out).
export function manilaDay(now = new Date()) {
  const ph = new Date(now.getTime() + 8 * 3600e3);
  const start = new Date(Date.UTC(ph.getUTCFullYear(), ph.getUTCMonth(), ph.getUTCDate()) - 8 * 3600e3);
  return { start, nextMorning: new Date(start.getTime() + (24 + 7) * 3600e3) };
}
// Should this email wait until tomorrow? `sentTo` = emails already sent today to that address, `sentAll` = all emails today.
export const holdEmail = (sentTo: number, sentAll: number, gmail: boolean) => sentTo >= PER_ADDRESS_DAY || (gmail && sentAll >= GMAIL_DAY);

// deno-lint-ignore no-explicit-any
export async function handle(req: Request, db: any): Promise<Response> {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  const secret = req.headers.get("x-cron-secret") ?? "";
  const { start, nextMorning } = manilaDay();
  const today = new Map<string, number>(); // address -> emails sent today
  let todayAll = 0, loaded = false;
  const loadToday = async () => {
    if (loaded) return; loaded = true;
    const { data } = await db.from("message_outbox").select("to_address").eq("channel", "email").eq("status", "sent").gte("sent_at", start.toISOString()).limit(5000);
    for (const r of data ?? []) { const a = String(r.to_address).toLowerCase(); today.set(a, (today.get(a) ?? 0) + 1); todayAll++; }
  };

  let sent = 0, failed = 0, skipped = 0, held = 0;
  // Up to 4 batches per call keeps each run well inside the function time limit.
  for (let batch = 0; batch < 4; batch++) {
    const { data, error } = await db.rpc("outbox_claim", { p_secret: secret, p_limit: 50, p_channels: configured });
    if (error) {
      const status = error.message.includes("unauthorized") ? 401 : 500;
      return Response.json({ error: error.message }, { status });
    }
    const msgs = (data ?? []) as (Msg & { attempts?: number })[];
    if (!msgs.length) break;
    for (const m of msgs) {
      if (m.channel === "email" && configured.email) {
        await loadToday();
        const a = m.to_address.toLowerCase();
        if (holdEmail(today.get(a) ?? 0, todayAll, viaGmail())) {
          // Not a failure: back in the queue for tomorrow morning, without using up a retry.
          await db.from("message_outbox").update({ status: "queued", claimed_at: null, attempts: Math.max(0, (m.attempts ?? 1) - 1), next_attempt_at: nextMorning.toISOString() }).eq("id", m.id);
          held++;
          continue;
        }
      }
      const r = await deliver(m);
      if (r.result === "sent") {
        sent++;
        if (m.channel === "email") { const a = m.to_address.toLowerCase(); today.set(a, (today.get(a) ?? 0) + 1); todayAll++; }
      } else if (r.result === "skipped") skipped++; else failed++;
      const { error: finishErr } = await db.rpc("outbox_finish", {
        p_secret: secret, p_id: m.id, p_result: r.result, p_provider_id: r.providerId ?? null, p_error: r.error ?? null,
      });
      if (finishErr) console.error("outbox_finish failed", m.id, finishErr.message);
    }
    if (msgs.length < 50) break;
  }
  return Response.json({ sent, failed, skipped, held, configured, email_via: viaResend() ? "resend" : viaGmail() ? "gmail" : "off" });
}

if (D) {
  const { createClient } = await import("npm:@supabase/supabase-js@2");
  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  D.serve((req) => handle(req, db));
}
