// The document vault: every customer file is encrypted before it is stored, and decrypted only for someone the
// database lets read it. Storage holds ciphertext only, so a leaked bucket or backup is unreadable without the key.
//
// How: each file gets its own random 256-bit key (AES-256-GCM). That key is itself encrypted ("wrapped") with the
// vault key, a secret that lives only in this function's settings (DOC_VAULT_KEY), never in the database or the app.
// Both are bound to the file's storage path, which starts with the workspace id, so a sealed file copied anywhere
// else can't be opened, and any change to a byte is detected.
//
//   POST ?op=put&path=<org>/<...>   body: the file          stores it sealed (storage's own rules decide who may)
//   GET  ?op=get&path=<...>[&name=] returns the file         storage's rules decide; Pinoy Permit staff go through
//                                                            staff_open_file, which checks for an open request and
//                                                            logs the open for the customer to see; every other
//                                                            open is recorded too (log_file_open)
//   GET  ?ping=1                    {"ok":true,"vault":true} when the key is set
//
// Files stored before the vault was switched on are returned as they are. Deploy with JWT verification OFF: the
// public permit page and workers' upload links have no login, and storage checks every request itself.

const MAGIC = new TextEncoder().encode("PPV1");
const HEAD = 4 + 1 + 12 + 48 + 12; // magic, key id, wrap iv, wrapped key (32 + 16 tag), data iv
const MAX = 10 * 1024 * 1024;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-file-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Expose-Headers": "content-type, content-disposition",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const enc = (s: string) => new TextEncoder().encode(s);
const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function vaultKey(secret: string, id = 1): Promise<{ id: number; key: CryptoKey }> {
  const raw = b64(secret.trim());
  if (raw.length !== 32) throw new Error("DOC_VAULT_KEY must be 32 random bytes, base64-encoded.");
  return { id, key: await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]) };
}
export const isSealed = (b: Uint8Array) => b.length >= HEAD + 16 && MAGIC.every((x, i) => b[i] === x);

export async function seal(plain: Uint8Array, path: string, vk: { id: number; key: CryptoKey }): Promise<Uint8Array> {
  const dekRaw = crypto.getRandomValues(new Uint8Array(32));
  const dek = await crypto.subtle.importKey("raw", dekRaw, "AES-GCM", false, ["encrypt"]);
  const wrapIv = crypto.getRandomValues(new Uint8Array(12));
  const dataIv = crypto.getRandomValues(new Uint8Array(12));
  const aad = enc(path);
  const wrapped = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: wrapIv, additionalData: aad }, vk.key, dekRaw));
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: dataIv, additionalData: aad }, dek, plain));
  dekRaw.fill(0);
  const out = new Uint8Array(HEAD + body.length);
  out.set(MAGIC, 0); out[4] = vk.id; out.set(wrapIv, 5); out.set(wrapped, 17); out.set(dataIv, 65); out.set(body, HEAD);
  return out;
}

// keys: every vault key still in use, by id (the current one, plus older ones after a key change).
export async function unseal(sealed: Uint8Array, path: string, keys: Map<number, CryptoKey>): Promise<Uint8Array> {
  if (!isSealed(sealed)) return sealed; // stored before the vault was on
  const key = keys.get(sealed[4]);
  if (!key) throw new Error("This file was sealed with a vault key that isn't set any more.");
  const aad = enc(path);
  const dekRaw = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: sealed.slice(5, 17), additionalData: aad }, key, sealed.slice(17, 65)));
  const dek = await crypto.subtle.importKey("raw", dekRaw, "AES-GCM", false, ["decrypt"]);
  dekRaw.fill(0);
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: sealed.slice(65, 77), additionalData: aad }, dek, sealed.slice(HEAD)));
}

type Env = { url: string; anon: string; service: string; key?: string; keyId?: string; oldKeys?: string };
const okPath = (p: string | null) => !!p && p.length <= 600 && !p.includes("..") && !p.startsWith("/") && /^[0-9a-f-]{36}\//.test(p);
const objectUrl = (env: Env, path: string, mode = "authenticated") =>
  `${env.url}/storage/v1/object/${mode === "upload" ? "" : mode + "/"}documents/${path.split("/").map(encodeURIComponent).join("/")}`;
// The caller's own rights: their login if they have one, otherwise the public key (storage's anon rules apply).
const asCaller = (req: Request, env: Env) => {
  const auth = req.headers.get("Authorization") ?? "";
  return /^Bearer ey/.test(auth) ? { Authorization: auth, apikey: env.anon } : { apikey: env.anon };
};

async function keyring(env: Env) {
  const current = await vaultKey(env.key!, Number(env.keyId || 1));
  const keys = new Map([[current.id, current.key]]);
  for (const part of (env.oldKeys || "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const [id, secret] = part.split(":");
    keys.set(Number(id), (await vaultKey(secret, Number(id))).key);
  }
  return { current, keys };
}

export async function handle(req: Request, env: Env, http: typeof fetch = fetch): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const q = new URL(req.url).searchParams;
  if (q.get("ping")) return json({ ok: true, vault: !!env.key });
  if (!env.key) return json({ error: "Secure file storage isn't switched on yet." }, 503);
  const path = q.get("path");
  if (!okPath(path)) return json({ error: "Missing or invalid file." }, 400);
  const { current, keys } = await keyring(env);

  if (q.get("op") === "put" && req.method === "POST") {
    const plain = new Uint8Array(await req.arrayBuffer());
    if (!plain.length || plain.length > MAX) return json({ error: "Files can be up to 10 MB." }, 413);
    const sealed = await seal(plain, path!, current);
    const type = req.headers.get("x-file-type") || "application/octet-stream";
    const r = await http(objectUrl(env, path!, "upload"), { method: "POST", headers: { ...asCaller(req, env), "Content-Type": type, "x-upsert": "false" }, body: sealed });
    if (!r.ok) return json({ error: r.status === 400 || r.status === 403 ? "You can't add files here." : "Couldn't save the file. Please try again." }, r.status === 409 ? 409 : 403);
    return json({ path });
  }

  if (q.get("op") === "get") {
    let r = await http(objectUrl(env, path!), { headers: asCaller(req, env) });
    // Each file a teammate opens is recorded (database file 20); the owner sees who opened what, and when.
    if (r.ok && /^Bearer ey/.test(req.headers.get("Authorization") ?? "")) {
      await http(`${env.url}/rest/v1/rpc/log_file_open`, { method: "POST", headers: { ...asCaller(req, env), "Content-Type": "application/json" },
        body: JSON.stringify({ p_path: path }) }).catch(() => null);
    }
    if (!r.ok && /^Bearer ey/.test(req.headers.get("Authorization") ?? "")) {
      // Pinoy Permit staff: allowed only for an open request, and every open is logged for the customer.
      const check = await http(`${env.url}/rest/v1/rpc/staff_open_file`, { method: "POST",
        headers: { ...asCaller(req, env), "Content-Type": "application/json" }, body: JSON.stringify({ p_path: path }) });
      if (check.ok) r = await http(objectUrl(env, path!), { headers: { Authorization: `Bearer ${env.service}`, apikey: env.service } });
    }
    if (!r.ok) return json({ error: "That file isn't available." }, 404);
    let plain: Uint8Array;
    try { plain = await unseal(new Uint8Array(await r.arrayBuffer()), path!, keys); } catch { return json({ error: "That file couldn't be opened safely." }, 422); }
    const name = (q.get("name") || "").replace(/[\r\n"\\]/g, "").slice(0, 200);
    return new Response(plain, { headers: { ...cors, "Content-Type": r.headers.get("content-type") || "application/octet-stream", "Cache-Control": "private, no-store",
      ...(name ? { "Content-Disposition": `attachment; filename="${name}"` } : {}) } });
  }
  return json({ error: "Unknown request." }, 400);
}

const D = (globalThis as { Deno?: { serve: (h: (r: Request) => Promise<Response>) => void; env: { get: (k: string) => string | undefined } } }).Deno;
if (D) {
  D.serve((req) => handle(req, {
    url: D.env.get("SUPABASE_URL")!, anon: D.env.get("SUPABASE_ANON_KEY")!, service: D.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    key: D.env.get("DOC_VAULT_KEY"), keyId: D.env.get("DOC_VAULT_KEY_ID"), oldKeys: D.env.get("DOC_VAULT_OLD_KEYS"),
  }).catch(() => json({ error: "Something went wrong. Please try again." }, 500)));
}
