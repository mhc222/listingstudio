import { readFileSync, writeFileSync } from "node:fs"
const env = Object.fromEntries(readFileSync(".env.local","utf8").split("\n").filter(l=>l.includes("=")&&!l.startsWith("#")).map(l=>[l.slice(0,l.indexOf("=")).trim(),l.slice(l.indexOf("=")+1).trim()]))
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" }
const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/photos?select=id,storage_path,width,height`, { headers: H })
const photos = await r.json()
const OUT = process.argv[2]
for (const p of photos) {
  const s = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/sign/originals/${p.storage_path}`, {
    method: "POST", headers: H, body: JSON.stringify({ expiresIn: 3600 }),
  })
  const { signedURL, signedUrl } = await s.json()
  const url = env.NEXT_PUBLIC_SUPABASE_URL + "/storage/v1" + (signedURL ?? signedUrl)
  const img = await fetch(url)
  const buf = Buffer.from(await img.arrayBuffer())
  const ext = p.storage_path.split(".").pop()
  writeFileSync(`${OUT}/${p.id.slice(0,8)}.${ext}`, buf)
  console.log(p.id.slice(0,8), p.width + "x" + p.height, buf.length + "B")
}
process.exit(0)
