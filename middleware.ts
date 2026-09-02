import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"
import { safeNextPath } from "@/lib/workflow-recovery"

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Public surfaces reachable without a session: the product landing and login.
  const publicPaths = ["/", "/login"]
  if (!user && !publicPaths.includes(request.nextUrl.pathname)) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    url.search = ""
    url.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`)
    return NextResponse.redirect(url)
  }
  if (user && request.nextUrl.pathname === "/login") {
    const url = request.nextUrl.clone()
    const destination = new URL(safeNextPath(request.nextUrl.searchParams.get("next")), request.url)
    url.pathname = destination.pathname
    url.search = destination.search
    return NextResponse.redirect(url)
  }

  return response
}

export const config = {
  // everything except static assets, the fal webhook (verified by signature, not
  // session), the reconcile cron (verified by CRON_SECRET bearer), the public
  // tour share page (unlisted slug, admin-client reads) and the public terms page
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/webhook|api/cron|tour|terms).*)"],
}
