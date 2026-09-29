// Downloads every object in the "documents" and "avatars" buckets into a folder, keeping
// the same paths so a restore can re-upload them 1:1. Used by the nightly backup workflow.
import fs from 'node:fs';
import path from 'node:path';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const out = process.argv[2] || 'files';
const headers = { apikey: key, Authorization: `Bearer ${key}` };

async function list(bucket, prefix) {
  const found = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(`${url}/storage/v1/object/list/${bucket}`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    if (!res.ok) throw new Error(`list ${bucket}/${prefix}: ${res.status} ${await res.text()}`);
    const items = await res.json();
    for (const it of items) {
      const p = prefix ? `${prefix}/${it.name}` : it.name;
      if (it.id === null) found.push(...(await list(bucket, p)));
      else found.push(p);
    }
    if (items.length < 1000) break;
  }
  return found;
}

let total = 0, bytes = 0;
for (const bucket of ['documents', 'avatars']) {
  const paths = await list(bucket, '');
  for (const p of paths) {
    const res = await fetch(`${url}/storage/v1/object/${bucket}/${p.split('/').map(encodeURIComponent).join('/')}`, { headers });
    if (!res.ok) throw new Error(`download ${bucket}/${p}: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const dest = path.join(out, bucket, p);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    total++; bytes += buf.length;
  }
  console.log(`${bucket}: ${paths.length} files`);
}
console.log(`Backed up ${total} files, ${(bytes / 1048576).toFixed(1)} MB`);
