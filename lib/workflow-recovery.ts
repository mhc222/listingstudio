export type WorkflowFailureInput = {
  status?: number
  serverMessage?: string | null
  fallback: string
  preserved: string
}

export function workflowFailureMessage({
  status,
  serverMessage,
  fallback,
  preserved,
}: WorkflowFailureInput) {
  if (status === 401 || status === 403 || /unauthorized|invalid compact jws|jwt/i.test(serverMessage ?? "")) {
    return `Your sign-in expired. ${preserved} Sign in again, return here, and retry.`
  }
  if (status === 409 && serverMessage) return `${serverMessage} ${preserved}`
  if (status && status >= 500) return `${serverMessage || fallback} ${preserved} Try again.`
  return serverMessage || `${fallback} ${preserved} Try again.`
}

export function connectionFailureMessage(preserved: string) {
  return `The connection was interrupted. ${preserved} Reconnect, then try again.`
}

export function workflowCatchMessage(cause: unknown, fallback: string, preserved: string) {
  if (cause instanceof Error && cause.message && !/failed to fetch|networkerror|load failed/i.test(cause.message)) {
    return cause.message
  }
  return connectionFailureMessage(preserved || fallback)
}

export function safeNextPath(value: string | null | undefined, fallback = "/dashboard") {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback
  try {
    const parsed = new URL(value, "http://listing-studio.local")
    if (parsed.origin !== "http://listing-studio.local" || parsed.pathname === "/login") return fallback
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return fallback
  }
}
