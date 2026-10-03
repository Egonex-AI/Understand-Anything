# Understand-Anything for Hermes

[Hermes Agent](https://github.com/hermes-agent/hermes-agent) plugin support for Understand-Anything.

## Installation

### One-line install (macOS / Linux)
```bash
curl -fsSL https://raw.githubusercontent.com/Lum1104/Understand-Anything/main/install.sh | bash -s hermes
```

### What the installer does
1. Clones this repo to `~/.understand-anything/repo`
2. Symlinks `understand-anything-plugin/skills/` into `~/.hermes/skills/understand-anything/`
3. All 8 sub-skills are auto-discovered by Hermes on next startup or `/reload-skills`

### Manual install
```bash
git clone https://github.com/Lum1104/Understand-Anything.git ~/.understand-anything/repo
ln -sfn ~/.understand-anything/repo/understand-anything-plugin/skills ~/.hermes/skills/understand-anything
```

### Update
```bash
~/.understand-anything/repo/install.sh --update
```

## Available Skills

After installation, these skills are available in Hermes:

| Skill | Purpose |
|---|---|
| `understand` | Analyze codebase and generate knowledge graph |
| `understand-chat` | Ask natural-language questions about code |
| `understand-dashboard` | Open interactive web dashboard |
| `understand-diff` | Analyze impact of uncommitted changes |
| `understand-explain` | Deep-dive a specific file or function |
| `understand-onboard` | Generate onboarding guide |
| `understand-domain` | Extract business domain knowledge |
| `understand-knowledge` | Analyze a Karpathy-pattern LLM wiki |

## Quick Start

```bash
# In any project directory
/understand                    # Generate knowledge graph
/understand-dashboard          # Open dashboard
/understand-chat "How does auth work?"
```

## Links

- Homepage: https://understand-anything.com/
- Demo: https://understand-anything.com/demo/
- Discord: https://discord.gg/pydat66RY
