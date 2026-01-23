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

## License

MIT
