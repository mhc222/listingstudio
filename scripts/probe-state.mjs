import { readFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
)
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const { data: listings } = await db.from("listings").select("id,address").limit(10)
console.log("LISTINGS:", listings)
const { data: photos } = await db.from("photos").select("id,listing_id,storage_path,width,height,is_floor_plan").limit(30)
console.log("PHOTOS:", photos?.map((p) => `${p.id.slice(0,8)} ${p.width}x${p.height} ${p.storage_path.split("/").pop()} fp=${p.is_floor_plan}`))
const { data: samples, error: se } = await db.from("sample_images").select("*").limit(20)
console.log("SAMPLES:", samples ?? se?.message)
const { data: users } = await db.auth.admin.listUsers()
console.log("USERS:", users.users.map((u) => u.email))
