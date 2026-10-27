// A workspace's permit deadlines and to-dos as a calendar feed (iCalendar), for Google Calendar, Apple Calendar and
// Outlook. The private token in the link is the only key: no login, read-only, dates only. "?ping=1" answers "ok" so
// the app can tell the feed is switched on. Deploy with JWT verification OFF (calendar apps can't sign in).
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const esc = (s: string) => String(s ?? "").replace(/[\\,;]/g, (m) => "\\" + m).replace(/\r?\n/g, "\\n");
const day = (iso: string) => iso.replace(/-/g, "");
const next = (iso: string) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10).replace(/-/g, ""); };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const params = new URL(req.url).searchParams;
  if (params.get("ping")) return new Response("ok", { headers: { ...cors, "Content-Type": "text/plain" } });
  const token = params.get("t") ?? "";
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(token)) return new Response("Not found", { status: 404, headers: cors });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data, error } = await admin.rpc("calendar_feed_events", { p_token: token });
  if (error) return new Response("Calendar unavailable", { status: 500, headers: cors });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Pinoy Permit//Deadlines//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:Pinoy Permit", "X-WR-TIMEZONE:Asia/Manila", "X-PUBLISHED-TTL:PT6H", "REFRESH-INTERVAL;VALUE=DURATION:PT6H"];
  for (const e of (data ?? []) as { uid: string; day: string; title: string; detail: string }[]) {
    lines.push("BEGIN:VEVENT", `UID:${e.uid}`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${day(e.day)}`, `DTEND;VALUE=DATE:${next(e.day)}`,
      `SUMMARY:${esc(e.title)}`, `DESCRIPTION:${esc(e.detail)}`);
    if (e.title.startsWith("Expires:")) {
      lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(e.title + " in 30 days")}`, "TRIGGER:-P30D", "END:VALARM",
        "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(e.title + " in 7 days")}`, "TRIGGER:-P7D", "END:VALARM");
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return new Response(lines.join("\r\n"), { headers: { ...cors, "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "max-age=900" } });
});
