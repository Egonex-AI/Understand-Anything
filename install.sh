#!/usr/bin/env bash
# Understand-Anything installer (macOS / Linux)
#
# Usage:
#   ./install.sh                       Prompt for platform
#   ./install.sh <platform>            Install for <platform>
#   ./install.sh --update              Pull latest changes
#   ./install.sh --uninstall <plat>    Remove links for <plat>
#   ./install.sh --help
#
# Curl-pipe usage:
#   curl -fsSL https://raw.githubusercontent.com/Lum1104/Understand-Anything/main/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/Lum1104/Understand-Anything/main/install.sh | bash -s codex
#   curl -fsSL https://raw.githubusercontent.com/Lum1104/Understand-Anything/main/install.sh | bash -s forgecode
#
# Environment:
#   UA_REPO_URL  Override clone URL (default: official GitHub repo)
#   UA_REPO_REF  Optional git ref to checkout after clone/update (branch/tag/commit)
#   UA_DIR       Override clone destination (default: $HOME/.understand-anything/repo)

set -euo pipefail

REPO_URL="${UA_REPO_URL:-https://github.com/Lum1104/Understand-Anything.git}"
REPO_REF="${UA_REPO_REF:-}"
REPO_DIR="${UA_DIR:-$HOME/.understand-anything/repo}"
PLUGIN_LINK="$HOME/.understand-anything-plugin"

# Platform table — id|skills-target-dir|style
# style "per-skill":       one symlink per skill into the target dir
# style "copy-per-skill":  one physical copy per skill into the target dir (used when symlinked directories are not discoverable)
# style "folder":          one symlink for the whole skills/ dir into the target,
#                          named "understand-anything"
platforms_table() {
  cat <<EOF
gemini|$HOME/.agents/skills|per-skill
codex|$HOME/.agents/skills|per-skill
opencode|$HOME/.agents/skills|per-skill
pi|$HOME/.agents/skills|per-skill
openclaw|$HOME/.openclaw/skills|folder
antigravity|$HOME/.gemini/antigravity/skills|folder
vibe|$HOME/.vibe/skills|per-skill
vscode|$HOME/.copilot/skills|per-skill
hermes|$HOME/.hermes/skills|folder
cline|$HOME/.cline/skills|folder
kimi|$HOME/.kimi/skills|folder
trae|$HOME/.trae/skills|per-skill
forgecode|AUTO|copy-per-skill
EOF
}

platform_ids() { platforms_table | cut -d'|' -f1; }

resolve_platform() {
  local id="$1"
  local row
  row="$(platforms_table | awk -F'|' -v id="$id" '$1==id {print; exit}')"
  if [[ -z "$row" ]]; then
    printf 'Unknown platform: %s\n' "$id" >&2
    printf 'Supported: %s\n' "$(platform_ids | tr '\n' ' ')" >&2
    exit 1
  fi
  printf '%s\n' "$row"
}

forgecode_base_dir() {
  # ForgeCode base-path resolution:
  # 1) $FORGE_CONFIG when set
  # 2) ~/forge (default on macOS/Linux)
  # 3) ~/.forge (fallback for older installs)
  if [[ -n "${FORGE_CONFIG:-}" ]]; then
    printf '%s\n' "$FORGE_CONFIG"
  elif [[ -d "$HOME/forge" ]]; then
    printf '%s\n' "$HOME/forge"
  elif [[ -d "$HOME/.forge" ]]; then
    printf '%s\n' "$HOME/.forge"
  else
    # Prefer ForgeCode's documented default.
    printf '%s\n' "$HOME/forge"
  fi
}

resolve_target_dir() {
  local id="$1" target="$2"

  case "$id" in
    forgecode)
      local base
      base="$(forgecode_base_dir)"
      printf '%s\n' "$base/skills"
      ;;
    *)
      printf '%s\n' "$target"
      ;;
  esac
}

prompt_platform() {
  local ids=()
  while IFS= read -r id; do ids+=("$id"); done < <(platform_ids)

  printf 'Which platform are you installing for?\n' >&2
  local i=1
  for id in "${ids[@]}"; do
    printf '  %d) %s\n' "$i" "$id" >&2
    i=$((i+1))
  done
  printf 'Choose [1-%d]: ' "${#ids[@]}" >&2

  local choice=""
  if { exec 3</dev/tty; } 2>/dev/null; then
    read -r choice <&3 || true
    exec 3<&-
  else
    read -r choice || true
  fi
  if [[ -z "$choice" ]]; then
    printf '\nNo input received. Pass the platform as an argument instead, e.g.:\n' >&2
    printf '  install.sh codex\n' >&2
    exit 1
  fi
  if ! [[ "$choice" =~ ^[0-9]+$ ]] || (( choice < 1 || choice > ${#ids[@]} )); then
    printf 'Invalid choice: %s\n' "$choice" >&2
    exit 1
  fi
  printf '%s\n' "${ids[$((choice-1))]}"
}

clone_or_update() {
  if [[ -d "$REPO_DIR/.git" ]]; then
    printf -- '→ Updating existing checkout at %s\n' "$REPO_DIR"
    git -C "$REPO_DIR" fetch --all --prune
  else
    printf -- '→ Cloning %s → %s\n' "$REPO_URL" "$REPO_DIR"
    mkdir -p "$(dirname "$REPO_DIR")"
    git clone "$REPO_URL" "$REPO_DIR"
  fi

  if [[ -n "${REPO_REF:-}" ]]; then
    printf -- '→ Checking out %s\n' "$REPO_REF"
    if ! git -C "$REPO_DIR" checkout -q "$REPO_REF"; then
      # Common case: remote branch name. Create a local branch tracking origin.
      git -C "$REPO_DIR" checkout -q -B "$REPO_REF" "origin/$REPO_REF"
    fi
  fi

  # If we're on a branch, keep it fast-forwarded.
  if git -C "$REPO_DIR" symbolic-ref -q HEAD >/dev/null; then
    git -C "$REPO_DIR" pull --ff-only
  fi
}

skills_root() { printf '%s\n' "$REPO_DIR/understand-anything-plugin/skills"; }
commands_root() { printf '%s\n' "$REPO_DIR/understand-anything-plugin/commands"; }
forgecode_agents_root() { printf '%s\n' "$REPO_DIR/understand-anything-plugin/forgecode/agents"; }

list_skills() {
  local root
  root="$(skills_root)"
  if [[ ! -d "$root" ]]; then
    printf 'Skills directory not found: %s\n' "$root" >&2
    exit 1
  fi
  local d
  for d in "$root"/*/; do
    [[ -d "$d" ]] || continue
    basename "$d"
  done
}

list_commands() {
  local root
  root="$(commands_root)"
  if [[ ! -d "$root" ]]; then
    printf 'Commands directory not found: %s\n' "$root" >&2
    exit 1
  fi

  local files=("$root"/*.md)
  if (( ${#files[@]} == 1 )) && [[ "${files[0]}" == "$root/*.md" ]]; then
    # When nullglob is off and there are no matches, bash keeps the literal.
    files=()
  fi

  local f
  for f in "${files[@]}"; do
    [[ -f "$f" ]] || continue
    basename "$f"
  done
}

list_forgecode_agents() {
  local root
  root="$(forgecode_agents_root)"
  if [[ ! -d "$root" ]]; then
    printf 'ForgeCode agents directory not found: %s\n' "$root" >&2
    exit 1
  fi

  local files=("$root"/*.md)
  if (( ${#files[@]} == 1 )) && [[ "${files[0]}" == "$root/*.md" ]]; then
    files=()
  fi

  local f
  for f in "${files[@]}"; do
    [[ -f "$f" ]] || continue
    basename "$f"
  done
}

link_skills() {
  local target="$1" style="$2"
  local root
  root="$(skills_root)"
  mkdir -p "$target"
  case "$style" in
    per-skill)
      local skill
      while IFS= read -r skill; do
        ln -sfn "$root/$skill" "$target/$skill"
        printf '  ✓ %s → %s\n' "$target/$skill" "$root/$skill"
      done < <(list_skills)
      ;;
    copy-per-skill)
      local skill
      while IFS= read -r skill; do
        rm -rf "$target/$skill"
        cp -R "$root/$skill" "$target/$skill"
        printf '  ✓ %s ← %s\n' "$target/$skill" "$root/$skill"
      done < <(list_skills)
      ;;
    folder)
      ln -sfn "$root" "$target/understand-anything"
      printf '  ✓ %s → %s\n' "$target/understand-anything" "$root"
      ;;
    *)
      printf 'Unknown style: %s\n' "$style" >&2
      exit 1
      ;;
  esac
}

unlink_skills() {
  local target="$1" style="$2"
  local root
  root="$(skills_root)"
  [[ -d "$target" ]] || return 0
  case "$style" in
    per-skill)
      if [[ -d "$(skills_root)" ]]; then
        local skill
        while IFS= read -r skill; do
          [[ -L "$target/$skill" ]] && rm -f "$target/$skill"
        done < <(list_skills)
      else
        # Checkout is gone — scan the target dir for stale links pointing into
        # our plugin tree so we can still clean up.
        local link resolved
        for link in "$target"/*; do
          [[ -L "$link" ]] || continue
          resolved="$(readlink "$link" 2>/dev/null || true)"
          [[ "$resolved" == *"/understand-anything-plugin/skills/"* ]] || continue
          rm -f "$link"
        done
      fi
      ;;
    copy-per-skill)
      if [[ -d "$(skills_root)" ]]; then
        local skill
        while IFS= read -r skill; do
          if [[ -d "$target/$skill" ]]; then
            if [[ -f "$target/$skill/SKILL.md" ]] && cmp -s "$target/$skill/SKILL.md" "$root/$skill/SKILL.md"; then
              rm -rf "$target/$skill"
            else
              printf '  • Refusing to remove %s (SKILL.md differs from current checkout)\n' "$target/$skill" >&2
            fi
          fi
        done < <(list_skills)
      else
        printf '  • Skills checkout not found; remove copied skill directories manually under: %s\n' "$target" >&2
      fi
      ;;
    folder)
      [[ -L "$target/understand-anything" ]] && rm -f "$target/understand-anything"
      ;;
  esac
}

link_plugin_root() {
  if [[ -L "$PLUGIN_LINK" || -e "$PLUGIN_LINK" ]]; then
    printf '  • %s already exists, leaving as-is\n' "$PLUGIN_LINK"
  else
    ln -s "$REPO_DIR/understand-anything-plugin" "$PLUGIN_LINK"
    printf '  ✓ %s → %s\n' "$PLUGIN_LINK" "$REPO_DIR/understand-anything-plugin"
  fi
}

install_forgecode_commands() {
  local base target root
  base="$(forgecode_base_dir)"
  target="$base/commands"
  root="$(commands_root)"

  if [[ ! -d "$root" ]]; then
    printf '  • ForgeCode commands not found in checkout: %s\n' "$root" >&2
    printf '    (If you are testing a fork/branch, set UA_REPO_URL and optionally UA_REPO_REF.)\n' >&2
    return 0
  fi

  mkdir -p "$target"

  local cmd
  while IFS= read -r cmd; do
    cp -f "$root/$cmd" "$target/$cmd"
    printf '  ✓ %s ← %s\n' "$target/$cmd" "$root/$cmd"
  done < <(list_commands)
}

uninstall_forgecode_commands() {
  local base target root
  base="$(forgecode_base_dir)"
  target="$base/commands"
  root="$(commands_root)"

  [[ -d "$target" ]] || return 0
  if [[ ! -d "$root" ]]; then
    printf '  • Commands checkout not found; remove copied command files manually under: %s\n' "$target" >&2
    return 0
  fi

  local cmd
  while IFS= read -r cmd; do
    if [[ -f "$target/$cmd" ]]; then
      if cmp -s "$target/$cmd" "$root/$cmd"; then
        rm -f "$target/$cmd"
      else
        printf '  • Refusing to remove %s (differs from current checkout)\n' "$target/$cmd" >&2
      fi
    fi
  done < <(list_commands)
}

install_forgecode_agents() {
  local base target root
  base="$(forgecode_base_dir)"
  target="$base/agents"
  root="$(forgecode_agents_root)"

  if [[ ! -d "$root" ]]; then
    printf '  • ForgeCode agents not found in checkout: %s\n' "$root" >&2
    printf '    (If you are testing a fork/branch, set UA_REPO_URL and optionally UA_REPO_REF.)\n' >&2
    return 0
  fi

  mkdir -p "$target"

  local agent
  while IFS= read -r agent; do
    cp -f "$root/$agent" "$target/$agent"
    printf '  ✓ %s ← %s\n' "$target/$agent" "$root/$agent"
  done < <(list_forgecode_agents)
}

uninstall_forgecode_agents() {
  local base target root
  base="$(forgecode_base_dir)"
  target="$base/agents"
  root="$(forgecode_agents_root)"

  [[ -d "$target" ]] || return 0
  if [[ ! -d "$root" ]]; then
    printf '  • Agents checkout not found; remove copied agent files manually under: %s\n' "$target" >&2
    return 0
  fi

  local agent
  while IFS= read -r agent; do
    if [[ -f "$target/$agent" ]]; then
      if cmp -s "$target/$agent" "$root/$agent"; then
        rm -f "$target/$agent"
      else
        printf '  • Refusing to remove %s (differs from current checkout)\n' "$target/$agent" >&2
      fi
    fi
  done < <(list_forgecode_agents)
}

cmd_install() {
  local id="$1"
  local row target style
  row="$(resolve_platform "$id")"
  target="$(printf '%s\n' "$row" | cut -d'|' -f2)"
  style="$(printf '%s\n' "$row" | cut -d'|' -f3)"
  target="$(resolve_target_dir "$id" "$target")"

  clone_or_update
  printf -- '→ Linking skills for %s (%s → %s)\n' "$id" "$style" "$target"
  link_skills "$target" "$style"

  if [[ "$id" == "forgecode" ]]; then
    printf -- '→ Installing ForgeCode commands\n'
    install_forgecode_commands
    printf -- '→ Installing ForgeCode agents\n'
    install_forgecode_agents
  fi

  printf -- '→ Linking universal plugin root\n'
  link_plugin_root

  printf '\n✓ Installed Understand-Anything for %s\n' "$id"
  printf '  Restart your CLI or IDE to pick up the skills.\n'
  if [[ "$id" == "vscode" ]]; then
    printf '\n  Tip: VS Code can also auto-discover the plugin by opening this repo\n'
    printf '       directly (it reads .copilot-plugin/plugin.json), no symlinks needed.\n'
  fi
}

cmd_uninstall() {
  local id="$1"
  local row target style
  row="$(resolve_platform "$id")"
  target="$(printf '%s\n' "$row" | cut -d'|' -f2)"
  style="$(printf '%s\n' "$row" | cut -d'|' -f3)"
  target="$(resolve_target_dir "$id" "$target")"

  printf -- '→ Removing skill links for %s\n' "$id"
  unlink_skills "$target" "$style"

  if [[ "$id" == "forgecode" ]]; then
    printf -- '→ Removing ForgeCode command files\n'
    uninstall_forgecode_commands
    printf -- '→ Removing ForgeCode agent files\n'
    uninstall_forgecode_agents
  fi
  if [[ -L "$PLUGIN_LINK" ]]; then
    rm -f "$PLUGIN_LINK"
    printf '  ✓ removed %s\n' "$PLUGIN_LINK"
  fi
  if [[ -d "$REPO_DIR" ]]; then
    printf '\nThe checkout at %s was kept (other platforms may still use it).\n' "$REPO_DIR"
    printf 'To remove it: rm -rf "%s"\n' "$REPO_DIR"
  fi
}

cmd_update() {
  if [[ ! -d "$REPO_DIR/.git" ]]; then
    printf 'No installation found at %s. Run install first.\n' "$REPO_DIR" >&2
    exit 1
  fi
  git -C "$REPO_DIR" pull --ff-only
  printf '✓ Updated.\n'
}

usage() {
  cat <<USAGE
Understand-Anything installer

Usage:
  install.sh [<platform>]            Install for <platform> (or prompt if omitted)
  install.sh --update                Pull latest changes (skills update through symlinks)
  install.sh --uninstall <platform>  Remove links for <platform>
  install.sh --help

Supported platforms:
$(platform_ids | sed 's/^/  - /')

Environment:
  UA_REPO_URL  Override clone URL (default: official repo)
  UA_REPO_REF  Optional git ref to checkout after clone/update
  UA_DIR       Override clone destination (default: \$HOME/.understand-anything/repo)
USAGE
}

main() {
  case "${1:-}" in
    -h|--help)
      usage
      ;;
    --update)
      cmd_update
      ;;
    --uninstall)
      shift
      if [[ -z "${1:-}" ]]; then
        printf '%s\n' '--uninstall requires a platform argument' >&2
        usage >&2
        exit 1
      fi
      cmd_uninstall "$1"
      ;;
    "")
      local id
      id="$(prompt_platform)"
      cmd_install "$id"
      ;;
    -*)
      printf 'Unknown option: %s\n' "$1" >&2
      usage >&2
      exit 1
      ;;
    *)
      cmd_install "$1"
      ;;
  esac
}

main "$@"
