import { readFileSync } from "node:fs"
const lines = readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
const env = Object.fromEntries(lines.map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]))
for (const [k, v] of Object.entries(env)) console.log(k, "len=" + (v?.length ?? 0), v?.startsWith('"') ? "QUOTED" : "")
