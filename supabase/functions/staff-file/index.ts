// Opens a customer's file for PermitPal staff. Staff can't read customer files from storage
// directly: the database checks there's an open request for it and logs the open (customers
// see the log in Settings), then this returns a link that works for 2 minutes.
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
  const { path, download } = await req.json().catch(() => ({}));
  if (typeof path !== "string" || !path) return json({ error: "Missing file." }, 400);

  const url = Deno.env.get("SUPABASE_URL")!;
  const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  });
  const { data: name, error } = await asUser.rpc("staff_open_file", { p_path: path });
  if (error) return json({ error: error.message }, 403);

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data, error: e2 } = await admin.storage.from("documents")
    .createSignedUrl(path, 120, download ? { download: String(download || name) } : undefined);
  if (e2 || !data) return json({ error: "Could not open the file." }, 500);
  return json({ url: data.signedUrl });
});
