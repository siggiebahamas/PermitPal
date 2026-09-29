// Starts a PayMongo checkout (GCash, Maya, cards, GrabPay) for a plan upgrade.
// Called from the app by a signed-in workspace owner. Needs PAYMONGO_SECRET_KEY and APP_URL.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const key = Deno.env.get("PAYMONGO_SECRET_KEY");
  const appUrl = (Deno.env.get("APP_URL") ?? "").replace(/#.*$/, "");
  if (!key || !appUrl) return json({ error: "Online payment is not switched on yet. Contact PermitPal to upgrade." }, 503);

  const { org_id, plan_id, months } = await req.json().catch(() => ({}));
  const url = Deno.env.get("SUPABASE_URL")!;
  // Act as the signed-in customer so the database checks they own the workspace.
  const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  });
  const { data: start, error } = await asUser.rpc("billing_start", { p_org: org_id, p_plan: plan_id, p_months: months ?? 1 });
  if (error) return json({ error: error.message }, 400);

  const amount = Math.round(Number(start.amount_php) * 100); // centavos
  const res = await fetch("https://api.paymongo.com/v1/checkout_sessions", {
    method: "POST",
    headers: { Authorization: `Basic ${btoa(key + ":")}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      data: {
        attributes: {
          line_items: [{
            currency: "PHP", amount, quantity: 1,
            name: `PermitPal ${start.plan_name} - ${start.months} month${start.months > 1 ? "s" : ""}`,
            description: start.org_name,
          }],
          payment_method_types: ["gcash", "paymaya", "card", "grab_pay"],
          reference_number: start.payment_id,
          billing: start.email ? { email: start.email } : undefined,
          send_email_receipt: true,
          show_description: true,
          description: `PermitPal ${start.plan_name} for ${start.org_name}`,
          success_url: `${appUrl}#/settings/billing?paid=1`,
          cancel_url: `${appUrl}#/settings/billing`,
          metadata: { payment_id: start.payment_id, org_id },
        },
      },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return json({ error: "PayMongo could not start the checkout. Please try again." }, 502);

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  await admin.rpc("billing_attach_checkout", {
    p_payment: start.payment_id, p_checkout_id: body.data.id, p_url: body.data.attributes.checkout_url,
  });
  return json({ checkout_url: body.data.attributes.checkout_url });
});
