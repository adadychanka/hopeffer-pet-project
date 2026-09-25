#!/usr/bin/env bash
# PreToolUse hook for Bash: stop agents from running dangerous commands on their own.
#
# DENY rules block commands that are never legitimate for an agent here
# (wiping the disk or home dir, skipping git hooks, force-pushing main, ...).
# ASK rules make Claude Code ask the user first for commands that destroy data
# or loosen safety settings but are sometimes needed.
#
# Patterns are bash ERE matched against the whole command, so they also catch
# the command inside `&&`, `;`, `|` chains and subshells. They are heuristics,
# not a sandbox: they can be bypassed on purpose, and they err on the side of asking.
# `git push` approval lives in ask-before-git-push.sh.

command=$(jq -r '.tool_input.command // ""')
# Treat newlines as command separators so multi-line scripts match like one-liners.
command=${command//$'\n'/ ; }
lower=${command,,}

# Start of a command word: string start or a character that cannot be part of a name.
S='(^|[^[:alnum:]_./-])'
# Rest of the current simple command (stops at ; & |).
R='[^;&|]*'
# `git`, any global options (`-C dir`, `-c k=v`), then the subcommand.
GIT="${S}git([[:space:]]+[^[:space:];&|]+)*[[:space:]]+"
# A recursive `rm` (-r, -R, -rf, -fr, --recursive, ...).
RM_RECURSIVE="${S}rm[[:space:]]+(${R}[[:space:]])?(-[[:alnum:]]*[rR][[:alnum:]]*|--recursive)([[:space:]]|$)"

deny_rules=(
  # Filesystem wipes.
  "${S}rm[[:space:]]+(${R}[[:space:]])?(-[[:alnum:]]*[rR][[:alnum:]]*|--recursive)${R}[[:space:]][\"']?(/|/\*|~|~/|~/\*|\\\$HOME|\\\$HOME/|\\\$HOME/\*|\\\$\{HOME\}|\\\$\{HOME\}/|\*|\.|\./|\./\*|\.\.|\.\./)[\"']?([[:space:]]|$|[;&|])"
  "rm -r on /, ~, \$HOME, ., .. or * would wipe the system, the home dir or the whole repo"
  "--no-preserve-root"
  "--no-preserve-root disables the rm safety guard for /"
  "${S}mkfs(\.[[:alnum:]]+)?[[:space:]]"
  "mkfs formats a disk"
  "${S}dd[[:space:]]${R}of=/dev/"
  "dd to a device overwrites the disk"
  ">[[:space:]]*/dev/(sd|nvme|disk|hd|vd|xvd)"
  "redirecting output to a block device overwrites the disk"
  ":\(\)[[:space:]]*\{[[:space:]]*:[[:space:]]*\|[[:space:]]*:[[:space:]]*&"
  "fork bomb"
  "${S}ch(mod|own)[[:space:]]+(${R}[[:space:]])?-[[:alnum:]]*R${R}[[:space:]][\"']?(/|~|\\\$HOME)[\"']?([[:space:]]|$|[;&|])"
  "recursive chmod/chown on / or the home dir"

  # Running code straight from the internet.
  "${S}(curl|wget)[[:space:]][^;&]*\|[[:space:]]*(sudo[[:space:]]+)?(ba|z|da|k)?sh([[:space:]]|$)"
  "piping a download into a shell runs unreviewed remote code"
  "${S}(ba|z)?sh[[:space:]]+(-c[[:space:]]+[\"']?)?(<\(|\\\$\()[[:space:]]*(curl|wget)"
  "running a downloaded script runs unreviewed remote code"

  # Skipping the repo's git hooks (commitlint, lint-staged, TruffleHog secret scan).
  "${GIT}(commit|push|merge|rebase|cherry-pick|am)[[:space:]]${R}--no-verify"
  "--no-verify skips the commitlint, lint-staged and TruffleHog git hooks"
  "${GIT}commit[[:space:]]+([^;&|\"']*[[:space:]])?-[[:alnum:]]*n[[:alnum:]]*([[:space:]]|$)"
  "git commit -n skips the commitlint and lint-staged git hooks"
  "${S}HUSKY=0"
  "HUSKY=0 disables the repo's git hooks"
  "core\.hookspath"
  "changing core.hooksPath disables the repo's git hooks"

  # History rewrites on the shared branch.
  "${GIT}push${R}[[:space:]](--force|--force-with-lease|-[[:alnum:]]*f)${R}[[:space:]](origin[[:space:]]+)?\+?(main|master)([[:space:]]|$|[;&|:])"
  "force-pushing main rewrites shared history"
  "${GIT}push[[:space:]]${R}[[:space:]]\+(main|master)([[:space:]]|$|[;&|])"
  "force-pushing main rewrites shared history"

  # Irreversible remote actions.
  "${S}gh[[:space:]]+repo[[:space:]]+delete"
  "gh repo delete removes the GitHub repository"

  # Sandbox setup (see /Users/artsiom/Work/CLAUDE.md).
  "completion${R}sandbox-persistent\.sh|sandbox-persistent\.sh${R}completion"
  "shell completion scripts in /etc/sandbox-persistent.sh break the Bash tool"
)

ask_rules=(
  # Local data loss.
  "$RM_RECURSIVE"
  "recursive rm deletes files that cannot be recovered"
  "${S}(shred|wipefs)[[:space:]]"
  "shred/wipefs destroy data"
  "${S}(sudo|doas)[[:space:]]"
  "command runs as root"
  "${S}(shutdown|reboot|halt|poweroff)([[:space:]]|$)"
  "command stops the machine"
  "${S}kill(all)?[[:space:]]${R}[[:space:]]-1([[:space:]]|$)"
  "kill -1 signals every process"

  # Git: discarding work or rewriting history.
  "${GIT}reset[[:space:]]${R}--(hard|merge|keep)"
  "git reset --hard discards uncommitted work"
  "${GIT}clean[[:space:]]${R}(-[[:alnum:]]*f|--force)"
  "git clean -f deletes untracked files"
  "${GIT}checkout${R}([[:space:]]--[[:space:]]|[[:space:]]\.([[:space:]]|$)|[[:space:]]-f([[:space:]]|$)|--force)"
  "git checkout -- <path> / -f discards uncommitted changes"
  "${GIT}restore[[:space:]]"
  "git restore discards uncommitted changes"
  "${GIT}stash[[:space:]]+(drop|clear)"
  "git stash drop/clear deletes stashed work"
  "${GIT}branch[[:space:]]${R}(-D|--delete[[:space:]]${R}--force|--force[[:space:]]${R}--delete)"
  "git branch -D deletes a branch with unmerged commits"
  "${GIT}(filter-branch|filter-repo|replace)([[:space:]]|$)"
  "command rewrites git history"
  "${GIT}(reflog[[:space:]]+(expire|delete)|update-ref[[:space:]]+-d|gc[[:space:]]${R}--prune)"
  "command removes the git objects needed to recover lost work"
  "${GIT}push${R}[[:space:]](--force|--force-with-lease|--mirror|--delete|-[[:alnum:]]*[fd][[:alnum:]]*([[:space:]]|$)|:[^[:space:]])"
  "git push rewrites or deletes a remote branch"

  # Backing services (Postgres, Redis, MinIO, OpenSearch, Docker volumes).
  "${S}docker([[:space:]]+|-)compose[[:space:]]${R}down${R}([[:space:]]-v([[:space:]]|$)|--volumes|--rmi)"
  "docker compose down -v deletes the database, cache and storage volumes"
  "docker:down${R}([[:space:]]-v([[:space:]]|$)|--volumes)"
  "docker compose down -v deletes the database, cache and storage volumes"
  "${S}docker[[:space:]]+((system|volume|image|container|network|builder|buildx)[[:space:]]+prune|volume[[:space:]]+rm|rm[[:space:]]${R}(-[[:alnum:]]*v|--volumes))"
  "command deletes Docker volumes, images or containers"
  "(migration:revert|schema:drop|schema:sync|schema:log)"
  "command reverts migrations or changes the schema outside migrations"
  "${S}(dropdb|pg_resetwal)[[:space:]]"
  "command deletes a Postgres database"
  "${S}mc[[:space:]]+(rb|rm)[[:space:]]"
  "mc rb/rm deletes MinIO buckets or objects"
  "${S}curl[[:space:]]${R}(-[xX][[:space:]]*|--request[[:space:]]+)[\"']?delete"
  "HTTP DELETE (for example an OpenSearch index or MinIO object)"

  # Weakening supply chain policy (pnpm-workspace.yaml).
  "minimum-?release-?age|trust-?policy|dangerously-allow-all-builds"
  "command overrides the pnpm supply chain policy"

  # Publishing and remote side effects.
  "${S}(npm|pnpm|yarn)[[:space:]]+(${R}[[:space:]])?(publish|unpublish|deprecate)([[:space:]]|$)"
  "command publishes a package to the registry"
  "${S}gh[[:space:]]+(pr[[:space:]]+merge|release[[:space:]]+delete|repo[[:space:]]+(edit|archive|rename)|secret[[:space:]]+(set|delete)|api${R}(-[xX]|--method)[[:space:]]*[\"']?(delete|put|patch))"
  "command changes the GitHub repository"
  "${S}sbx[[:space:]]+(policy[[:space:]]+(allow|rm|approval[[:space:]]+respond)|secret)"
  "command loosens the sandbox network policy or changes its secrets"

  # Secrets.
  "${S}(cat|less|more|head|tail|bat|strings|xxd|base64)([[:space:]]${R})?[[:space:]/\"']\.env([[:space:]\"']|$|[;&|])"
  "command prints .env secrets into the transcript"
  "${S}gh[[:space:]]+auth[[:space:]]+token"
  "command prints the GitHub token into the transcript"
)

# SQL is only a risk when the command talks to a database.
if [[ $lower =~ ${S}(psql|pgcli|typeorm|redis-cli) ]]; then
  ask_rules+=(
    "(drop[[:space:]]+(table|database|schema|index|role|user)|truncate[[:space:]]|delete[[:space:]]+from|alter[[:space:]]+table${R}drop|flushall|flushdb)"
    "command deletes database or cache data"
  )
fi

emit() {
  jq -n --arg decision "$1" --arg reason "$2" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: $decision,
      permissionDecisionReason: $reason
    }
  }'
  exit 0
}

# Print the part of the command that matched, so the dangerous operation is easy
# to find in a long command. Uses the original text even when the match came from
# $lower (lowercasing keeps the length, so the offset is the same).
matched_text() {
  local match=${BASH_REMATCH[0]} source=$1
  local prefix=${source%%"$match"*}
  local text=${command:${#prefix}:${#match}}
  # Extend to the end of the simple command, so `rm -rf` also shows its target.
  local rest=${command:${#prefix}+${#match}}
  text+=${rest%%[;&|]*}
  # Drop the boundary character that ${S} consumes and surrounding whitespace.
  text=${text#[^[:alnum:]_./-]}
  text=${text#"${text%%[![:space:]]*}"}
  text=${text%"${text##*[![:space:]]}"}
  ((${#text} > 200)) && text="${text:0:200}..."
  printf '%s' "$text"
}

check() {
  local decision=$1
  shift
  local rules=("$@")
  for ((i = 0; i < ${#rules[@]}; i += 2)); do
    if [[ $command =~ ${rules[i]} ]]; then
      emit "$decision" "Blocked by .claude/hooks/guard-dangerous-commands.sh: ${rules[i + 1]}. Matched: $(matched_text "$command")"
    elif [[ $lower =~ ${rules[i]} ]]; then
      emit "$decision" "Blocked by .claude/hooks/guard-dangerous-commands.sh: ${rules[i + 1]}. Matched: $(matched_text "$lower")"
    fi
  done
}

check deny "${deny_rules[@]}"
check ask "${ask_rules[@]}"
