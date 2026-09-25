#!/usr/bin/env bash
# PreToolUse hook for Bash: make Claude Code ask for approval before any git push.
# Matches `git push`, `git -C dir push` and push inside compound commands.
command=$(jq -r '.tool_input.command // ""')

if grep -Eq '(^|[^[:alnum:]_-])git([[:space:]]+[^[:space:]]+)*[[:space:]]+push([[:space:]]|$)' <<<"$command"; then
  jq -n '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: "git push requires manual approval"
    }
  }'
fi
