import { readFileSync } from "node:fs"
const env = Object.fromEntries(readFileSync(".env.local","utf8").split("\n").filter(l=>l.includes("=")&&!l.startsWith("#")).map(l=>[l.slice(0,l.indexOf("=")).trim(),l.slice(l.indexOf("=")+1).trim()]))
const ac = new AbortController(); setTimeout(()=>ac.abort(), 12000)
try {
  const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/listings?select=id,address&limit=5`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
    signal: ac.signal,
  })
  console.log("status", r.status)
  console.log(await r.text())
} catch (e) { console.log("FETCH FAILED:", e.name, e.message) }
process.exit(0)
