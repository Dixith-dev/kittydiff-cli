# kittydiff

A CLI tool that reviews your code changes using AI and shows potential bugs right in your terminal.

## Tech Stack

| Part | What we use |
|------|-------------|
| **Terminal UI** | [OpenTUI](https://github.com/sst/opentui) - a modern TUI framework |
| **Backend** | LiteLLM proxy - talks to any AI (OpenAI, Claude, Gemini, etc.) |
| **Runtime** | [Bun](https://bun.sh) |

## Features

- Review uncommitted changes
- Review entire codebase (hierarchical map-reduce summaries + agentic grounding for large repos)
- Review specific commits
- Pick your AI model (Gemini 3, opus 4.5, gpt-5.2)
- Copy bug reports to clipboard
- Review history saved locally
- Keyboard-driven, minimal interface

## Install

```bash
bun install -g kittydiff
```

## Usage

```bash
cd your-repo
kittydiff
```

This launches the interactive TUI where you can:
- **Review uncommitted changes** — Review your current working directory changes
- **Review branch** — Compare current branch against main (or specify a base branch)
- **Review commit** — Review a specific commit by hash
- **Review codebase** — Full hierarchical review of your entire codebase
- **History** — View past reviews
- **Settings** — Configure AI model and other options

### Headless review (CLI)

Run reviews directly from the command line without the TUI:

```bash
# Review uncommitted changes
kittydiff review

# Review current branch against main
kittydiff review branch

# Review current branch against a specific base branch
kittydiff review branch develop

# Review a specific commit
kittydiff review commit <hash>

# Full codebase review
kittydiff review codebase
```

### Commands Reference

| Command | Description |
|---------|-------------|
| `kittydiff` | Launch interactive TUI |
| `kittydiff review` | Review uncommitted changes (headless) |
| `kittydiff review branch [base]` | Review branch against main or specified base |
| `kittydiff review commit <hash>` | Review a specific commit |
| `kittydiff review codebase` | Review entire codebase hierarchically |
| `kittydiff --help` | Show help information |

## Config

Config is stored at `~/.kittydiff/config.json`.

Useful knobs for codebase review:
- `codebase_review.maxFilesToSummarize` (default: 250, max: 1000)
- `codebase_review.folderDepth` (default: 2)

Proxy configuration:
- `litellm_proxy_port` (default: 4000). You can also set `KITTYDIFF_PROXY_PORT`.

## License

MIT
