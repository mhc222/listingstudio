// Mint a browser session cookie for headless/preview testing (recipe in
// project memory). Prints the cookie value; expires in ~1h. Never commits secrets.
import { readFileSync, writeFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])
)
const url = env.NEXT_PUBLIC_SUPABASE_URL
const admin = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY)
const anon = createClient(url, env.NEXT_PUBLIC_SUPABASE_ANON_KEY)

const { data: link, error: e1 } = await admin.auth.admin.generateLink({
  type: "magiclink",
  email: "mhc222@gmail.com",
})
if (e1) throw e1
const { data: verified, error: e2 } = await anon.auth.verifyOtp({
  type: "magiclink",
  token_hash: link.properties.hashed_token,
})
if (e2) throw e2
const cookie =
  "base64-" +
  Buffer.from(JSON.stringify(verified.session)).toString("base64url")
const ref = new URL(url).hostname.split(".")[0]
writeFileSync(new URL("../.session-cookie.txt", import.meta.url), `sb-${ref}-auth-token=${cookie}\n`)
console.log(`cookie written for ref ${ref} (delete .session-cookie.txt when done)`)
