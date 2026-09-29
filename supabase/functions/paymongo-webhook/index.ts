// Receives PayMongo webhooks. Register this function's URL in the PayMongo dashboard for
// the "checkout_session.payment.paid" event and set PAYMONGO_WEBHOOK_SECRET.
// The signature is verified before anything is trusted.
import { createClient } from "npm:@supabase/supabase-js@2";

async function hmacHex(secret: string, message: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  const secret = Deno.env.get("PAYMONGO_WEBHOOK_SECRET");
  if (!secret) return new Response("not configured", { status: 503 });

  const raw = await req.text();
  // Header format: t=<timestamp>,te=<test signature>,li=<live signature>
  const parts = Object.fromEntries((req.headers.get("paymongo-signature") ?? "").split(",").map((p) => p.split("=") as [string, string]));
  if (!parts.t) return new Response("bad signature", { status: 401 });
  const expected = await hmacHex(secret, `${parts.t}.${raw}`);
  const given = parts.li || parts.te || "";
  if (!safeEqual(expected, given)) return new Response("bad signature", { status: 401 });
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 60 * 60) return new Response("stale", { status: 401 });

  const event = JSON.parse(raw);
  const type = event?.data?.attributes?.type;
  if (type === "checkout_session.payment.paid") {
    const checkoutId = event.data.attributes.data?.id;
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { error } = await db.rpc("billing_mark_paid", { p_checkout_id: checkoutId, p_raw: event });
    if (error) return new Response(error.message, { status: 500 }); // PayMongo retries on non-2xx
  }
  return new Response("ok");
});
