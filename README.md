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

### Headless review (CLI)

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

## Config

Config is stored at `~/.kittydiff/config.json`.

Useful knobs for codebase review:
- `codebase_review.maxFilesToSummarize` (default: 250, max: 1000)
- `codebase_review.folderDepth` (default: 2)

Proxy configuration:
- `litellm_proxy_port` (default: 4000). You can also set `KITTYDIFF_PROXY_PORT`.

## License

MIT
