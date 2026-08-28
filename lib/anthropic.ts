// Single place to construct the Claude client (interpreter, QA, copywriting).
import Anthropic from "@anthropic-ai/sdk"

export function anthropicClient(): Anthropic {
  // identity-linked console keys require the workspace id on every request;
  // standard keys leave ANTHROPIC_WORKSPACE_ID unset
  return new Anthropic({
    defaultHeaders: process.env.ANTHROPIC_WORKSPACE_ID
      ? { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID }
      : undefined,
  })
}
