import * as os from "os"
import { ConfigManager } from "./core/config"
import { HistoryManager } from "./core/history"
import { ProxyManager } from "./core/proxymanager"
import {
  getFullDiff,
  getRepositoryInfo,
  getLocalBranches,
  isGitRepository,
  type ReviewType,
  type GitCommit,
} from "./core/git"
import { reviewCode, reviewCodebase, type Bug } from "./backend/ai-reviewer"
import { computeHistorySummary } from "./core/review-history"

export type CliFormat = "text" | "json"

type ReviewMode = "uncommitted" | "branch" | "commit" | "codebase"

interface ReviewCliOptions {
  mode: ReviewMode
  baseBranch?: string
  commitHash?: string
  format: CliFormat
  model?: string
  showHelp: boolean
  errors: string[]
}

interface ReviewOutput {
  reviewType: ReviewType
  mode: ReviewMode
  model: string
  baseBranch?: string
  commit?: GitCommit
  summary: {
    critical: number
    major: number
    minor: number
    info: number
  }
  filesScanned: number
  linesAnalyzed: number
  timeMs: number
  bugs: Bug[]
}

const REVIEW_MODE_LABEL: Record<ReviewMode, string> = {
  uncommitted: "Uncommitted Changes",
  branch: "Branch Review",
  commit: "Commit Review",
  codebase: "Codebase Review",
}

function getHelpText(): string {
  return [
    "KittyDiff - AI Code Review",
    "",
    "Usage:",
    "  kittydiff                Launch interactive TUI",
    "  kittydiff tui            Launch interactive TUI",
    "  kittydiff review [mode] [options]",
    "",
    "Review modes:",
    "  (default) uncommitted    Review uncommitted changes",
    "  branch [base]            Review current branch against base (default: main)",
    "  commit <hash>            Review a specific commit",
    "  codebase | all           Review the full codebase",
    "",
    "Options:",
    "  -b, --base <branch>      Base branch for branch review",
    "  -c, --commit <hash>      Commit hash to review",
    "  -m, --model <id>         Override model (otherwise uses config)",
    "  -f, --format <text|json> Output format (default: text)",
    "  --json                   Shortcut for --format json",
    "  -h, --help               Show help",
  ].join("\n")
}

function getReviewHelpText(): string {
  return [
    "KittyDiff Review (headless)",
    "",
    "Usage:",
    "  kittydiff review",
    "  kittydiff review branch [base]",
    "  kittydiff review commit <hash>",
    "  kittydiff review codebase",
    "",
    "Options:",
    "  -b, --base <branch>      Base branch for branch review",
    "  -c, --commit <hash>      Commit hash to review",
    "  -m, --model <id>         Override model (otherwise uses config)",
    "  -f, --format <text|json> Output format (default: text)",
    "  --json                   Shortcut for --format json",
    "  -h, --help               Show help",
  ].join("\n")
}

function parseReviewArgs(args: string[]): ReviewCliOptions {
  let mode: ReviewMode = "uncommitted"
  let modeSource: string | null = null
  let baseBranch: string | undefined
  let commitHash: string | undefined
  let format: CliFormat = "text"
  let model: string | undefined
  let showHelp = false
  const errors: string[] = []

  const setMode = (next: ReviewMode, source: string) => {
    if (modeSource && mode !== next) {
      errors.push(`Conflicting review modes: ${modeSource} and ${source}`)
      return
    }
    mode = next
    modeSource = source
  }

  const readValue = (flag: string, index: number): [string | undefined, number] => {
    const value = args[index + 1]
    if (!value || value.startsWith("-")) {
      errors.push(`Missing value for ${flag}`)
      return [undefined, index]
    }
    return [value, index + 1]
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === "-h" || arg === "--help") {
      showHelp = true
      continue
    }

    if (arg === "branch") {
      setMode("branch", "branch")
      const next = args[i + 1]
      if (next && !next.startsWith("-")) {
        baseBranch = next
        i++
      }
      continue
    }

    if (arg === "commit") {
      setMode("commit", "commit")
      const [value, nextIndex] = readValue("commit", i)
      if (value) commitHash = value
      i = nextIndex
      continue
    }

    if (arg === "codebase" || arg === "all") {
      setMode("codebase", arg)
      continue
    }

    if (arg === "changes" || arg === "uncommitted") {
      setMode("uncommitted", arg)
      continue
    }

    if (arg === "-b" || arg === "--base" || arg === "--branch") {
      setMode("branch", "--base")
      const [value, nextIndex] = readValue(arg, i)
      if (value) baseBranch = value
      i = nextIndex
      continue
    }

    if (arg === "-c" || arg === "--commit") {
      setMode("commit", "--commit")
      const [value, nextIndex] = readValue(arg, i)
      if (value) commitHash = value
      i = nextIndex
      continue
    }

    if (arg === "--codebase" || arg === "--all") {
      setMode("codebase", arg)
      continue
    }

    if (arg === "--uncommitted" || arg === "--changes") {
      setMode("uncommitted", arg)
      continue
    }

    if (arg === "-m" || arg === "--model") {
      const [value, nextIndex] = readValue(arg, i)
      if (value) model = value
      i = nextIndex
      continue
    }

    if (arg === "-f" || arg === "--format") {
      const [value, nextIndex] = readValue(arg, i)
      if (value) {
        if (value !== "text" && value !== "json") {
          errors.push(`Invalid format: ${value}`)
        } else {
          format = value
        }
      }
      i = nextIndex
      continue
    }

    if (arg === "--json") {
      format = "json"
      continue
    }

    if (arg.startsWith("-")) {
      errors.push(`Unknown option: ${arg}`)
      continue
    }

    errors.push(`Unexpected argument: ${arg}`)
  }

  return { mode, baseBranch, commitHash, format, model, showHelp, errors }
}

function formatDuration(timeMs: number): string {
  if (!Number.isFinite(timeMs)) return "0ms"
  if (timeMs < 1000) return `${Math.round(timeMs)}ms`
  const seconds = timeMs / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  return `${minutes}m ${rest}s`
}

function printTextResult(output: ReviewOutput): void {
  console.log(`KittyDiff - ${REVIEW_MODE_LABEL[output.mode]}`)
  console.log(`Model: ${output.model}`)
  if (output.mode === "branch" && output.baseBranch) {
    console.log(`Base branch: ${output.baseBranch}`)
  }
  if (output.commit) {
    console.log(`Commit: ${output.commit.shortHash} ${output.commit.message}`)
    console.log(`Author: ${output.commit.author}`)
    console.log(`Date: ${output.commit.date}`)
  }

  console.log(
    `Files scanned: ${output.filesScanned} | Lines analyzed: ${output.linesAnalyzed} | Time: ${formatDuration(output.timeMs)}`
  )
  console.log(
    `Summary: critical ${output.summary.critical}, major ${output.summary.major}, minor ${output.summary.minor}, info ${output.summary.info}`
  )

  if (output.bugs.length === 0) {
    console.log("\nNo issues found.")
    return
  }

  console.log("")
  output.bugs.forEach((bug, index) => {
    const header = `${index + 1}. [${bug.severity.toUpperCase()}] ${bug.title}`
    console.log(header)
    console.log(`   File: ${bug.file}:${bug.startLine}-${bug.endLine}`)
    console.log(`   Description: ${bug.description}`)
    console.log(`   Suggestion: ${bug.suggestion}`)
    if (bug.fixDiff) {
      console.log("   Fix diff:")
      const diffLines = bug.fixDiff.split("\n").map((line) => `     ${line}`)
      console.log(diffLines.join("\n"))
    }
    console.log("")
  })
}

function printJsonResult(output: ReviewOutput): void {
  console.log(JSON.stringify(output, null, 2))
}

async function ensureProxyReady(proxyManager: ProxyManager): Promise<boolean> {
  try {
    await proxyManager.initialize()
  } catch (error) {
    console.error((error as Error).message)
    // Retry once - initialization failure may be transient
    try {
      await proxyManager.initialize()
    } catch (retryError) {
      console.error(`Retry also failed: ${(retryError as Error).message}`)
      return false
    }
  }
  if (proxyManager.isHealthy) return true
  return proxyManager.waitForHealth(20000)
}

function toReviewType(mode: ReviewMode): ReviewType {
  switch (mode) {
    case "branch":
      return "review-branch"
    case "commit":
      return "review-commit"
    case "codebase":
      return "review-all"
    case "uncommitted":
    default:
      return "review-uncommitted"
  }
}

async function validateBranch(baseBranch: string | undefined): Promise<string | null> {
  const base = baseBranch || "main"
  if (base.includes("/")) return base
  const branches = await getLocalBranches()
  if (branches.length === 0) return base
  const exists = branches.some((b) => b.name === base)
  if (!exists) return null
  return base
}

async function runReviewCli(args: string[]): Promise<boolean> {
  const options = parseReviewArgs(args)
  if (options.showHelp) {
    console.log(getReviewHelpText())
    return true
  }
  if (options.errors.length > 0) {
    console.error(options.errors.join("\n"))
    console.error("")
    console.error(getReviewHelpText())
    process.exitCode = 1
    return true
  }

  if (options.mode !== "codebase") {
    const inRepo = await isGitRepository()
    if (!inRepo) {
      console.error("Not inside a git repository. Run from a repo or use 'kittydiff review codebase'.")
      process.exitCode = 1
      return true
    }
  }

  if (options.mode === "commit" && !options.commitHash) {
    console.error("Commit hash is required for commit review.")
    process.exitCode = 1
    return true
  }

  if (options.mode === "branch") {
    const resolved = await validateBranch(options.baseBranch)
    if (!resolved) {
      const branches = await getLocalBranches()
      const list = branches.map((b) => b.name).join(", ") || "(none)"
      console.error(`Base branch not found: ${options.baseBranch || "main"}`)
      console.error(`Available branches: ${list}`)
      process.exitCode = 1
      return true
    }
    options.baseBranch = resolved
  }

  const configManager = new ConfigManager()
  const historyManager = new HistoryManager()
  const proxyManager = new ProxyManager(configManager.getProxyPort())

  const selectedModel = options.model || configManager.getSelectedModel()
  if (!selectedModel) {
    console.error("No model selected. Run the TUI setup first (kittydiff) or pass --model.")
    process.exitCode = 1
    return true
  }

  const proxyUrl = configManager.getProxyUrl()
  const proxyKey = configManager.getProxyKey()
  const toolsConfig = configManager.getToolsConfig()

  if (options.format === "text") {
    console.error("Starting AI proxy...")
  }
  const proxyReady = await ensureProxyReady(proxyManager)
  if (!proxyReady) {
    console.error("Failed to start or reach the AI proxy. Check your setup.")
    process.exitCode = 1
    return true
  }

  const startTime = Date.now()
  let commitInfo: GitCommit | undefined
  let reviewType = toReviewType(options.mode)
  let bugs: Bug[] = []
  let summary = { critical: 0, major: 0, minor: 0, info: 0 }
  let filesScanned = 0
  let linesAnalyzed = 0

  try {
    if (options.mode === "codebase") {
      const codebaseConfig = configManager.getCodebaseReviewConfig()
      const response = await reviewCodebase(
        {
          model: selectedModel,
          maxFilesToSummarize: codebaseConfig.maxFilesToSummarize,
          folderDepth: codebaseConfig.folderDepth,
        },
        proxyUrl,
        proxyKey,
        toolsConfig,
        (p) => {
          const msg = `${p.message}${p.total ? ` (${p.completed ?? 0}/${p.total})` : ""}`
          console.error(msg)
        }
      )
      bugs = response.bugs
      summary = response.summary
      filesScanned = response.filesScanned
      linesAnalyzed = response.linesAnalyzed
    } else {
      let diffResult: Awaited<ReturnType<typeof getFullDiff>>
      try {
        diffResult = await getFullDiff(reviewType, options.commitHash, options.baseBranch)
      } catch (error) {
        if (options.mode === "commit") {
          console.error(`Unable to resolve commit: ${options.commitHash}`)
        } else if (options.mode === "branch") {
          console.error(`Failed to get diff for base branch: ${options.baseBranch || "main"}`)
        } else {
          console.error(`Failed to get diff: ${(error as Error).message}`)
        }
        process.exitCode = 1
        return true
      }

      commitInfo = diffResult.commitInfo

      if (!diffResult.diff.trim() || diffResult.files.length === 0) {
        console.log("No changes to review.")
        return true
      }

      const response = await reviewCode(
        {
          diff: diffResult.diff,
          files: diffResult.files,
          commitInfo: commitInfo,
          model: selectedModel,
        },
        proxyUrl,
        proxyKey,
        toolsConfig
      )

      bugs = response.bugs
      summary = response.summary
      filesScanned = response.filesScanned
      linesAnalyzed = response.linesAnalyzed
    }
  } catch (error) {
    console.error(`AI review failed: ${(error as Error).message}`)
    process.exitCode = 1
    return true
  }

  const totalBugs = summary.critical + summary.major + summary.minor + summary.info
  const reviewOutput: ReviewOutput = {
    reviewType,
    mode: options.mode,
    model: selectedModel,
    baseBranch: options.baseBranch,
    commit: commitInfo,
    summary,
    filesScanned,
    linesAnalyzed,
    timeMs: Date.now() - startTime,
    bugs,
  }

  const localPath = process.cwd()
  const homeDir = os.homedir()
  const displayPath = homeDir && localPath.startsWith(homeDir)
    ? `~${localPath.slice(homeDir.length)}`
    : localPath
  const gitInfo = await getRepositoryInfo()

  const historySummary = computeHistorySummary(totalBugs, filesScanned, commitInfo, bugs)
  historyManager.addEntry({
    timestamp: Date.now(),
    reviewType,
    summary: historySummary,
    repository: {
      path: localPath,
      displayPath,
      repoUrl: gitInfo.repoUrl || null,
      branch: gitInfo.branch,
    },
    commitInfo: commitInfo ? {
      hash: commitInfo.hash,
      shortHash: commitInfo.shortHash,
      author: commitInfo.author,
      date: commitInfo.date,
      message: commitInfo.message,
    } : undefined,
    results: {
      critical: summary.critical,
      major: summary.major,
      minor: summary.minor,
      info: summary.info,
      filesScanned,
      linesAnalyzed,
      timeMs: reviewOutput.timeMs,
      bugs,
    },
    model: selectedModel,
  })

  if (options.format === "json") {
    printJsonResult(reviewOutput)
  } else {
    printTextResult(reviewOutput)
  }

  return true
}

export async function runCli(argv: string[]): Promise<boolean> {
  if (argv.length === 0) return false

  const command = argv[0]
  if (command === "tui") return false

  if (command === "help" || command === "--help" || command === "-h") {
    console.log(getHelpText())
    return true
  }

  if (command === "review") {
    return runReviewCli(argv.slice(1))
  }

  console.error(`Unknown command: ${command}`)
  console.error("")
  console.error(getHelpText())
  process.exitCode = 1
  return true
}
