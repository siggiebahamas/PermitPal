// Nightly housekeeping, called by pg_cron with the shared x-cron-secret.
// Permanently erases workspaces whose owners asked for deletion more than 30 days ago:
// first their stored files, then their database rows.
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

// Storage has no "delete folder", so list every file under a prefix (recursively).
async function listAll(bucket: string, prefix: string): Promise<string[]> {
  const out: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.storage.from(bucket).list(prefix, { limit: 1000, offset });
    if (error) throw error;
    if (!data?.length) break;
    for (const item of data) {
      const path = `${prefix}/${item.name}`;
      if (item.id === null) out.push(...(await listAll(bucket, path))); // folder
      else out.push(path);
    }
    if (data.length < 1000) break;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  const secret = req.headers.get("x-cron-secret") ?? "";

  const { data: due, error } = await db.rpc("purge_due_orgs", { p_secret: secret });
  if (error) return Response.json({ error: error.message }, { status: error.message.includes("unauthorized") ? 401 : 500 });

  const report: Record<string, string> = {};
  for (const orgId of (due ?? []) as string[]) {
    try {
      const files = await listAll("documents", orgId);
      for (let i = 0; i < files.length; i += 100) {
        const { error: rmErr } = await db.storage.from("documents").remove(files.slice(i, i + 100));
        if (rmErr) throw rmErr;
      }
      const { error: purgeErr } = await db.rpc("purge_org", { p_secret: secret, p_org: orgId });
      if (purgeErr) throw purgeErr;
      report[orgId] = `purged (${files.length} files)`;
    } catch (e) {
      report[orgId] = `failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return Response.json({ purged: report });
});
