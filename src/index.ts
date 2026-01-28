#!/usr/bin/env bun
/**
 * KittyDiff - Modern Code Reviewer
 * A minimalist terminal interface for code review
 */

import { spawnSync } from "child_process"
import {
  createCliRenderer,
  ConsolePosition,
  BoxRenderable,
  TextRenderable,
  TextareaRenderable,
  ASCIIFontRenderable,
  t,
  bold,
  fg,
  StyledText,
  type KeyEvent,
} from "@opentui/core"
import {
  KITTY_IDLE,
  KITTY_DONE,
  type ReviewPhase,
  getRandomPhaseMessage,
  getKittyFramesForPhase,
} from "./animations"
import { HelpContainer } from "./components/HelpContainer"
import { UpdateContainer } from "./components/UpdateContainer"
import { ModelSelector } from "./components/ModelSelector"
import { HistoryContainer } from "./components/HistoryContainer"
import { getRepositoryInfo, getFullDiff, getCommit, getRecentCommits, type ReviewType, type GitCommit } from "./core/git"
import { ConfigManager } from "./core/config"
import { HistoryManager } from "./core/history"
import { ProxyManager } from "./core/proxymanager"
import { reviewCode, reviewCodebase, generateFixDiff, type Bug, type AIReviewRequest, type CodebaseReviewProgress } from "./backend/ai-reviewer"

// Premium color palette
const COLORS = {
  // Base colors
  bg: "#0D1117",
  bgElevated: "#161B22",
  bgHover: "#1F2428",

  // Text hierarchy
  text: "#F0F6FC",
  textSecondary: "#8B949E",
  textMuted: "#6E7681",
  textDim: "#484F58",

  // Primary accent - saffron orange
  primary: "#FF9500",
  primaryHover: "#FFB347",
  primaryDim: "#CC7700",

  // Status colors
  success: "#3FB950",
  error: "#F85149",
  warning: "#D29922",
  info: "#58A6FF",

  // Border
  border: "#30363D",
  borderHover: "#3D444D",

  // Gradient for logo
  gradientStart: "#FF6B00",
  gradientMid: "#FF9500",
  gradientEnd: "#FFCC00",
}

const RESULTS_PANEL_WIDTH = 70


// Review result interface
interface ReviewResult {
  critical: number
  major: number
  minor: number
  info: number
  filesScanned: number
  linesAnalyzed: number
  timeMs: number
  bugs: Bug[]
}

// Severity display config (no emojis, minimalist symbols)
const SEVERITY_CONFIG = {
  critical: { symbol: '✘', color: '#F85149', label: 'CRITICAL' },
  major: { symbol: '▲', color: '#FF9500', label: 'MAJOR' },
  minor: { symbol: '●', color: '#D29922', label: 'MINOR' },
  info: { symbol: '◆', color: '#58A6FF', label: 'INFO' },
}

type ResultsView = 'summary' | 'bugList' | 'bugDetail' | 'bugFixDiff'

interface Command {
  id: string
  name: string
  description: string
  icon: string
}

const commands: Command[] = [
  { id: "review-uncommitted", name: "Review Changes", description: "Review all uncommitted changes", icon: "◎" },
  { id: "review-branch", name: "Review Branch", description: "Review entire branch against main", icon: "◉" },
  { id: "review-commit", name: "Review Commit", description: "Review a specific commit by ID", icon: "◈" },
  { id: "review-all", name: "Review Codebase", description: "Review the entire codebase", icon: "◇" },
  { id: "status", name: "Git Status", description: "Show repository status", icon: "●" },
  { id: "setup", name: "Setup", description: "Configure AI provider and models", icon: "⚙" },
  { id: "history", name: "History", description: "Browse past code reviews", icon: "↺" },
  { id: "update", name: "Update", description: "Check for updates", icon: "↻" },
  { id: "help", name: "Help", description: "Show all commands and shortcuts", icon: "?" },
]

async function main() {
  const renderer = await createCliRenderer({
    targetFps: 60,
    consoleOptions: {
      position: ConsolePosition.BOTTOM,
      sizePercent: 30,
      colorInfo: COLORS.primary,
      colorWarn: COLORS.warning,
      colorError: COLORS.error,
      colorDebug: COLORS.textDim,
      colorDefault: COLORS.textSecondary,
      backgroundColor: COLORS.bgElevated,
      title: "KittyDiff Console",
      titleBarColor: COLORS.border,
      titleBarTextColor: COLORS.text,
      cursorColor: COLORS.primary,
      startInDebugMode: false,
    },
  })

  // Enable mouse mode for scroll wheel support (SGR extended mouse mode)
  process.stdout.write('\x1b[?1000h') // Enable mouse tracking
  process.stdout.write('\x1b[?1006h') // Enable SGR extended mouse mode

  let isRendererActive = true
  let showPalette = true
  let selectedIndex = 0
  let filteredCommands = [...commands]
  let isReviewing = false
  let reviewAnimationInterval: ReturnType<typeof setInterval> | null = null

  const shutdown = (exitCode = 0) => {
    try { proxyManager.stop() } catch { }
    isRendererActive = false
    try { clearInterval(animationInterval) } catch { }
    try {
      process.stdout.write('\x1b[?1006l')
      process.stdout.write('\x1b[?1000l')
    } catch { }
    try { renderer.destroy() } catch { }
    process.exit(exitCode)
  }

  process.once("SIGINT", () => shutdown(0))
  process.once("SIGTERM", () => shutdown(0))
  process.once("uncaughtException", (err) => {
    try { console.error(err) } catch { }
    shutdown(1)
  })
  process.once("unhandledRejection", (err) => {
    try { console.error(err) } catch { }
    shutdown(1)
  })

  // Config, History & Proxy Manager
  const configManager = new ConfigManager()
  const historyManager = new HistoryManager()
  const proxyManager = new ProxyManager()

  // Start proxy initialization immediately in background (cached promise)
  // This runs while UI loads, so proxy is likely ready when user starts a review
  proxyManager.initialize().catch(() => {
    // Background init error - will be handled when review starts
  })

  // Model selector state
  const modelSelector = new ModelSelector(renderer, COLORS, configManager)
  let showModelSelector = false

  // History container state
  const historyContainer = new HistoryContainer(renderer, COLORS, historyManager)
  let showHistory = false

  // Git status overlay state
  let showStatus = false
  let statusScrollOffset = 0
  interface GitStatusData {
    branch: string
    ahead: number
    behind: number
    staged: { status: string; file: string }[]
    modified: { status: string; file: string }[]
    untracked: string[]
    clean: boolean
  }
  let statusData: GitStatusData | null = null

  // Commit selector state
  let showCommitSelector = false
  let allCommits: GitCommit[] = []
  let filteredCommits: GitCommit[] = []
  let selectedCommitIndex = 0
  let commitScrollOffset = 0
  let commitSearchQuery = ""
  let isLoadingCommits = false
  const COMMITS_PER_PAGE = 10
  const TOTAL_COMMITS_TO_FETCH = 50

  const gitInfo = await getRepositoryInfo()

  // Get local folder path
  const localPath = process.cwd()
  const homeDir = process.env.HOME || process.env.USERPROFILE || ""
  const displayPath = homeDir && localPath.startsWith(homeDir)
    ? "~" + localPath.slice(homeDir.length)
    : localPath


  // Results navigation state
  let resultsView: ResultsView = 'summary'
  let selectedSeverityIndex = 0
  let selectedBugIndex = 0
  let currentResults: ReviewResult | null = null
  let filteredBugs: Bug[] = []
  let selectedBug: Bug | null = null
  let detailScrollOffset = 0
  let copyToastTimeout: ReturnType<typeof setTimeout> | null = null
  let lastReviewRequest: AIReviewRequest | null = null
  const fixDiffRequests = new Map<string, { status: 'idle' | 'loading' | 'done' | 'error'; error?: string }>()
  const severityOrder: Bug['severity'][] = ['critical', 'major', 'minor', 'info']

  // ═══ ROOT CONTAINER ═══
  const rootContainer = new BoxRenderable(renderer, {
    id: "root-container",
    width: "100%",
    height: "100%",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
  })

  // ═══ CENTER CONTENT ═══
  const centerContent = new BoxRenderable(renderer, {
    id: "center-content",
    flexDirection: "column",
    alignItems: "center",
    width: "100%",
  })

  // ═══ LOGO SECTION ═══
  const logoSection = new BoxRenderable(renderer, {
    id: "logo-section",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  })

  // Animated Kitty
  const kittyContainer = new BoxRenderable(renderer, {
    id: "kitty-container",
    flexDirection: "column",
    marginRight: 3,
  })

  const kittyArt = new TextRenderable(renderer, {
    id: "kitty-art",
    content: t`${fg(COLORS.primary)(KITTY_IDLE[0].join("\n"))}`,
  })
  kittyContainer.add(kittyArt)
  logoSection.add(kittyContainer)

  // Help overlay state
  const helpContainer = new HelpContainer(renderer, COLORS, commands, configManager)
  let showHelp = false

  // Update overlay state
  const updateContainer = new UpdateContainer(renderer, COLORS, kittyArt)
  let isUpdating = false

  // Logo with gradient
  const logoText = new ASCIIFontRenderable(renderer, {
    id: "logo-text",
    text: "KITTYDIFF",
    font: "slick",
    color: [
      COLORS.gradientStart,
      COLORS.gradientStart,
      COLORS.gradientMid,
      COLORS.gradientMid,
      COLORS.gradientMid,
      COLORS.gradientEnd,
      COLORS.gradientEnd,
      COLORS.gradientEnd,
      COLORS.gradientEnd,
    ],
    selectable: false,
  })
  logoSection.add(logoText)

  centerContent.add(logoSection)

  // ═══ REPO INFO ═══
  const repoSection = new BoxRenderable(renderer, {
    id: "repo-section",
    flexDirection: "column",
    alignItems: "center",
    marginBottom: 2,
  })

  // Local path (always shown)
  const pathLine = new TextRenderable(renderer, {
    id: "path-line",
    content: t`${fg(COLORS.textMuted)("Path")} ${fg(COLORS.textDim)("·")} ${fg(COLORS.text)(displayPath)}`,
    selectable: true,
  })
  repoSection.add(pathLine)

  // Config file path (always shown)
  const configPath = configManager.getConfigPath()
  const displayConfigPath = homeDir && configPath.startsWith(homeDir)
    ? "~" + configPath.slice(homeDir.length)
    : configPath
  const configLine = new TextRenderable(renderer, {
    id: "config-line",
    content: t`${fg(COLORS.textMuted)("Config")} ${fg(COLORS.textDim)("·")} ${fg(COLORS.text)(displayConfigPath)}`,
    selectable: true,
  })
  repoSection.add(configLine)

  if (gitInfo.repoUrl) {
    const branchLine = new TextRenderable(renderer, {
      id: "branch-line",
      content: t`${fg(COLORS.textMuted)("branch")} ${fg(COLORS.textDim)("·")} ${fg(COLORS.primary)(gitInfo.branch)}`,
      selectable: true,
    })
    repoSection.add(branchLine)
  }

  centerContent.add(repoSection)

  // ═══ STATS ═══
  if (gitInfo.filesChanged > 0) {
    const statsSection = new BoxRenderable(renderer, {
      id: "stats-section",
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 2,
    })

    const statsText = new TextRenderable(renderer, {
      id: "stats-text",
      content: t`${fg(COLORS.textMuted)(gitInfo.filesChanged.toString())} ${fg(COLORS.textDim)("files")} ${fg(COLORS.textDim)("·")} ${fg(COLORS.success)("+" + gitInfo.insertions)} ${fg(COLORS.textDim)("·")} ${fg(COLORS.error)("-" + gitInfo.deletions)}`,
    })
    statsSection.add(statsText)
    centerContent.add(statsSection)
  }

  // ═══ DIVIDER ═══
  const divider = new TextRenderable(renderer, {
    id: "divider",
    content: t`${fg(COLORS.border)("─".repeat(50))}`,
  })
  centerContent.add(divider)

  // ═══ REVIEW OVERLAY ═══
  const reviewOverlay = new BoxRenderable(renderer, {
    id: "review-overlay",
    width: RESULTS_PANEL_WIDTH + 8,
    flexDirection: "column",
    alignItems: "center",
    visible: false,
    border: true,
    borderStyle: "rounded",
    borderColor: COLORS.border,
    paddingTop: 1,
    paddingBottom: 1,
    paddingLeft: 2,
    paddingRight: 2,
  })

  const reviewMessage = new TextRenderable(renderer, {
    id: "review-message",
    content: t`${fg(COLORS.text)("Initializing...")}`,
  })
  reviewOverlay.add(reviewMessage)

  const reviewSpacer2 = new BoxRenderable(renderer, {
    id: "review-spacer-2",
    height: 1,
  })
  reviewOverlay.add(reviewSpacer2)

  const progressBarContainer = new BoxRenderable(renderer, {
    id: "progress-bar-container",
    width: 50,
    flexDirection: "row",
  })

  const progressBar = new TextRenderable(renderer, {
    id: "progress-bar",
    content: t`${fg(COLORS.textDim)("[" + "░".repeat(40) + "]")}  ${fg(COLORS.textMuted)("0%")}`,
  })
  progressBarContainer.add(progressBar)
  reviewOverlay.add(progressBarContainer)

  // Results section (initially hidden)
  const resultsSection = new BoxRenderable(renderer, {
    id: "results-section",
    flexDirection: "column",
    alignItems: "center",
    visible: false,
    marginTop: 1,
    width: RESULTS_PANEL_WIDTH,
  })

  // Removed the title entirely per user request

  const resultsGrid = new BoxRenderable(renderer, {
    id: "results-grid",
    flexDirection: "column",
    alignItems: "flex-start",
    width: "100%",
  })
  resultsSection.add(resultsGrid)

  const resultsStats = new TextRenderable(renderer, {
    id: "results-stats",
    content: t``,
    selectable: true,
  })
  resultsSection.add(resultsStats)

  const resultsHint = new TextRenderable(renderer, {
    id: "results-hint",
    content: t`${fg(COLORS.primary)("↑↓")} ${fg(COLORS.textDim)("navigate")}  ${fg(COLORS.primary)("↵")} ${fg(COLORS.textDim)("select")}  ${fg(COLORS.primary)("esc")} ${fg(COLORS.textDim)("back")}`,
  })
  resultsSection.add(resultsHint)

  reviewOverlay.add(resultsSection)
  centerContent.add(reviewOverlay)

  // ═══ STATUS OVERLAY ═══
  const statusOverlay = new BoxRenderable(renderer, {
    id: "status-overlay",
    width: 60,
    flexDirection: "column",
    alignItems: "flex-start",
    visible: false,
    border: true,
    borderStyle: "rounded",
    borderColor: COLORS.border,
    paddingTop: 1,
    paddingBottom: 1,
    paddingLeft: 2,
    paddingRight: 2,
  })

  const statusBody = new BoxRenderable(renderer, {
    id: "status-body",
    flexDirection: "column",
    alignItems: "flex-start",
    width: "100%",
  })
  statusOverlay.add(statusBody)

  const statusHint = new TextRenderable(renderer, {
    id: "status-hint",
    content: t`${fg(COLORS.primary)("esc")} ${fg(COLORS.textMuted)("back")}`,
    marginTop: 1,
  })
  statusOverlay.add(statusHint)

  centerContent.add(statusOverlay)

  // ═══ COMMIT SELECTOR OVERLAY ═══
  const commitSelectorOverlay = new BoxRenderable(renderer, {
    id: "commit-selector-overlay",
    width: 70,
    flexDirection: "column",
    alignItems: "center",
    visible: false,
    border: true,
    borderStyle: "rounded",
    borderColor: COLORS.border,
    paddingTop: 1,
    paddingBottom: 1,
    paddingLeft: 2,
    paddingRight: 2,
  })

  const commitSelectorTitle = new TextRenderable(renderer, {
    id: "commit-selector-title",
    content: t`${fg(COLORS.primary)(bold("◈ Review Commit"))}  ${fg(COLORS.textMuted)("Select a commit to review")}`,
  })
  commitSelectorOverlay.add(commitSelectorTitle)

  // Search container
  const commitSearchContainer = new BoxRenderable(renderer, {
    id: "commit-search-container",
    width: "100%",
    height: 3,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 0,
    marginTop: 1,
    border: true,
    borderStyle: "rounded",
    borderColor: COLORS.border,
    paddingLeft: 1,
  })

  const commitSearchIcon = new TextRenderable(renderer, {
    id: "commit-search-icon",
    content: t`${fg(COLORS.primary)("🔍")} `,
  })
  commitSearchContainer.add(commitSearchIcon)

  const commitSearchInput = new TextareaRenderable(renderer, {
    id: "commit-search-input",
    flexGrow: 1,
    height: 1,
    placeholder: "Filter by message or hash...",
    backgroundColor: "transparent",
    focusedBackgroundColor: "transparent",
    textColor: COLORS.text,
    onContentChange: () => {
      commitSearchQuery = commitSearchInput.plainText.toLowerCase().split("\n")[0]
      selectedCommitIndex = 0
      commitScrollOffset = 0
      filteredCommits = allCommits.filter(c =>
        c.message.toLowerCase().includes(commitSearchQuery) ||
        c.shortHash.toLowerCase().includes(commitSearchQuery) ||
        c.hash.toLowerCase().includes(commitSearchQuery)
      )
      renderCommitList()
    }
  })
  commitSearchContainer.add(commitSearchInput)
  commitSelectorOverlay.add(commitSearchContainer)

  const commitSelectorSpacer = new BoxRenderable(renderer, { id: "commit-selector-spacer", height: 1 })
  commitSelectorOverlay.add(commitSelectorSpacer)

  const commitList = new BoxRenderable(renderer, {
    id: "commit-list",
    flexDirection: "column",
    alignItems: "flex-start",
    width: "100%",
  })
  commitSelectorOverlay.add(commitList)

  const commitPaginationInfo = new TextRenderable(renderer, {
    id: "commit-pagination-info",
    content: "",
    marginTop: 1,
  })
  commitSelectorOverlay.add(commitPaginationInfo)

  const commitSelectorHint = new TextRenderable(renderer, {
    id: "commit-selector-hint",
    content: t`${fg(COLORS.primary)("↑↓")} ${fg(COLORS.textMuted)("navigate")}  ${fg(COLORS.primary)("↵")} ${fg(COLORS.textMuted)("review")}  ${fg(COLORS.primary)("esc")} ${fg(COLORS.textMuted)("cancel")}`,
    marginTop: 1,
  })
  commitSelectorOverlay.add(commitSelectorHint)

  centerContent.add(commitSelectorOverlay)

  // Render commit list with pagination
  function renderCommitList() {
    const children = commitList.getChildren()
    children.forEach((c) => commitList.remove(c.id))

    if (isLoadingCommits) {
      const loadingText = new TextRenderable(renderer, {
        id: "commit-loading",
        content: t`  ${fg(COLORS.textMuted)("Loading commits...")}`,
      })
      commitList.add(loadingText)
      commitPaginationInfo.content = ""
      return
    }

    if (filteredCommits.length === 0) {
      const noCommits = new TextRenderable(renderer, {
        id: "no-commits",
        content: t`  ${fg(COLORS.textMuted)(commitSearchQuery ? "No matching commits found" : "No commits found in repository")}`,
      })
      commitList.add(noCommits)
      commitPaginationInfo.content = ""
      return
    }

    // Get visible commits based on scroll offset
    const visibleCommits = filteredCommits.slice(commitScrollOffset, commitScrollOffset + COMMITS_PER_PAGE)
    const totalPages = Math.ceil(filteredCommits.length / COMMITS_PER_PAGE)
    const currentPage = Math.floor(commitScrollOffset / COMMITS_PER_PAGE) + 1

    visibleCommits.forEach((commit, i) => {
      const actualIndex = commitScrollOffset + i
      const isSelected = actualIndex === selectedCommitIndex

      const row = new BoxRenderable(renderer, {
        id: `commit-row-${actualIndex}`,
        width: "100%",
        flexDirection: "row",
        paddingLeft: 1,
        paddingRight: 1,
        backgroundColor: isSelected ? COLORS.bgHover : "transparent",
      })

      // Format: hash - message (truncated) | relative time
      const messageMaxLen = 38
      const truncatedMsg = commit.message.length > messageMaxLen
        ? commit.message.slice(0, messageMaxLen - 1) + "…"
        : commit.message.padEnd(messageMaxLen)

      // Parse date for relative time
      const commitDate = new Date(commit.date)
      const now = new Date()
      const diffMs = now.getTime() - commitDate.getTime()
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
      const diffMins = Math.floor(diffMs / (1000 * 60))

      let relativeTime = ""
      if (diffDays > 0) {
        relativeTime = `${diffDays}d ago`
      } else if (diffHours > 0) {
        relativeTime = `${diffHours}h ago`
      } else {
        relativeTime = `${diffMins}m ago`
      }

      const commitContent = new TextRenderable(renderer, {
        id: `commit-content-${actualIndex}`,
        content: t`${fg(isSelected ? COLORS.primary : COLORS.textDim)("›")} ${fg(isSelected ? COLORS.warning : COLORS.textMuted)(commit.shortHash)} ${fg(isSelected ? COLORS.text : COLORS.textSecondary)(truncatedMsg)} ${fg(COLORS.textDim)(relativeTime.padStart(8))}`,
      })
      row.add(commitContent)
      commitList.add(row)
    })

    // Show pagination info
    if (totalPages > 1) {
      commitPaginationInfo.content = t`  ${fg(COLORS.textDim)("Page")} ${fg(COLORS.primary)(currentPage.toString())} ${fg(COLORS.textDim)("of")} ${fg(COLORS.textDim)(totalPages.toString())}  ${fg(COLORS.textMuted)(`(${filteredCommits.length} commits)`)}`
    } else {
      commitPaginationInfo.content = t`  ${fg(COLORS.textMuted)(`${filteredCommits.length} commit${filteredCommits.length === 1 ? "" : "s"}`)}`
    }
  }

  // Functions for commit selector
  async function showCommitSelectorUI() {
    showCommitSelector = true
    selectedCommitIndex = 0
    commitScrollOffset = 0
    commitSearchQuery = ""
    isLoadingCommits = true
    paletteContainer.visible = false
    hintContainer.visible = false
    commitSelectorOverlay.visible = true
    commitSearchInput.setText("")
    commitSearchInput.focus()
    renderCommitList()

    // Fetch recent commits
    try {
      allCommits = await getRecentCommits(TOTAL_COMMITS_TO_FETCH)
      filteredCommits = [...allCommits]
    } catch (error) {
      allCommits = []
      filteredCommits = []
    }
    isLoadingCommits = false
    renderCommitList()
  }

  function hideCommitSelectorUI() {
    showCommitSelector = false
    commitSelectorOverlay.visible = false
    commitSearchInput.blur()
    paletteContainer.visible = true
    hintContainer.visible = true
  }

  function navigateCommitUp() {
    if (filteredCommits.length === 0) return

    if (selectedCommitIndex <= 0) {
      // Wrap to end
      selectedCommitIndex = filteredCommits.length - 1
      commitScrollOffset = Math.max(0, filteredCommits.length - COMMITS_PER_PAGE)
    } else {
      selectedCommitIndex--
      // Scroll up if selection is above visible area
      if (selectedCommitIndex < commitScrollOffset) {
        commitScrollOffset = selectedCommitIndex
      }
    }
    renderCommitList()
  }

  function navigateCommitDown() {
    if (filteredCommits.length === 0) return

    if (selectedCommitIndex >= filteredCommits.length - 1) {
      // Wrap to start
      selectedCommitIndex = 0
      commitScrollOffset = 0
    } else {
      selectedCommitIndex++
      // Scroll down if selection is below visible area
      if (selectedCommitIndex >= commitScrollOffset + COMMITS_PER_PAGE) {
        commitScrollOffset = selectedCommitIndex - COMMITS_PER_PAGE + 1
      }
    }
    renderCommitList()
  }

  function scrollCommitList(direction: 'up' | 'down') {
    if (filteredCommits.length <= COMMITS_PER_PAGE) return

    if (direction === 'up') {
      commitScrollOffset = Math.max(0, commitScrollOffset - 1)
      // Keep selection in view
      if (selectedCommitIndex >= commitScrollOffset + COMMITS_PER_PAGE) {
        selectedCommitIndex = commitScrollOffset + COMMITS_PER_PAGE - 1
      }
    } else {
      const maxOffset = filteredCommits.length - COMMITS_PER_PAGE
      commitScrollOffset = Math.min(maxOffset, commitScrollOffset + 1)
      // Keep selection in view
      if (selectedCommitIndex < commitScrollOffset) {
        selectedCommitIndex = commitScrollOffset
      }
    }
    renderCommitList()
  }

  function selectCommitForReview() {
    if (filteredCommits.length === 0 || selectedCommitIndex >= filteredCommits.length) return
    const selectedCommit = filteredCommits[selectedCommitIndex]
    hideCommitSelectorUI()
    startReviewAnimation("review-commit", selectedCommit.hash)
  }


  // ═══ MODEL SELECTOR OVERLAY - removed as moved to class

  centerContent.add(helpContainer.overlay)

  // Show help overlay
  function showHelpUI() {
    showHelp = true
    paletteContainer.visible = false
    hintContainer.visible = false
    helpContainer.show()
  }

  // Hide help overlay
  function hideHelpUI() {
    showHelp = false
    helpContainer.hide()
    paletteContainer.visible = true
    hintContainer.visible = true
  }

  // Update functions
  async function startUpdateUI() {
    isUpdating = true
    paletteContainer.visible = false
    hintContainer.visible = false
    await updateContainer.show()
  }

  function hideUpdateUI() {
    isUpdating = false
    updateContainer.hide()
    paletteContainer.visible = true
    hintContainer.visible = true
  }

  // Render provider list - removed as moved to class

  // Render model list for selected provider - removed as moved to class

  // Show model selector
  function showModelSelectorUI() {
    showModelSelector = true
    paletteContainer.visible = false
    hintContainer.visible = false
    modelSelector.show()
  }

  // Hide model selector
  function hideModelSelectorUI() {
    showModelSelector = false
    modelSelector.hide()
    paletteContainer.visible = true
    hintContainer.visible = true
  }

  // Show history UI
  function showHistoryUI() {
    showHistory = true
    paletteContainer.visible = false
    hintContainer.visible = false
    historyContainer.show()
  }

  // Hide history UI
  function hideHistoryUI() {
    showHistory = false
    historyContainer.hide()
    paletteContainer.visible = true
    hintContainer.visible = true
  }

  // Navigate model selector - removed as moved to class

  // Progress bar renderer
  function updateProgressBar(progress: number) {
    const filled = Math.floor(progress * 40)
    const empty = 40 - filled
    const percent = Math.floor(progress * 100)
    const bar = "█".repeat(filled) + "░".repeat(empty)
    progressBar.content = t`${fg(COLORS.primary)("[")}${fg(COLORS.gradientMid)(bar)}${fg(COLORS.primary)("]")}  ${fg(COLORS.text)(percent.toString() + "%")}`
  }

  function clearContainer(container: { getChildren: () => Array<{ id: string }>; remove: (id: string) => void }) {
    const children = container.getChildren()
    for (let i = children.length - 1; i >= 0; i--) {
      container.remove(children[i].id)
    }
  }

  function parseGitStatus(): GitStatusData {
    const data: GitStatusData = {
      branch: "unknown",
      ahead: 0,
      behind: 0,
      staged: [],
      modified: [],
      untracked: [],
      clean: true,
    }

    try {
      // Get branch info
      const branchRes = spawnSync("git", ["branch", "--show-current"], { encoding: "utf8", timeout: 2000 })
      data.branch = (branchRes.stdout || "").trim() || "HEAD (detached)"

      // Get ahead/behind
      const trackRes = spawnSync("git", ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"], { encoding: "utf8", timeout: 2000 })
      if (trackRes.stdout) {
        const [behind, ahead] = trackRes.stdout.trim().split(/\s+/).map(Number)
        data.behind = behind || 0
        data.ahead = ahead || 0
      }

      // Get status
      const statusRes = spawnSync("git", ["status", "--porcelain=v1"], { encoding: "utf8", timeout: 2000 })
      const lines = (statusRes.stdout || "").trim().split("\n").filter(Boolean)

      for (const line of lines) {
        const index = line[0]
        const worktree = line[1]
        const file = line.slice(3)

        // Staged changes (index has changes)
        if (index !== " " && index !== "?") {
          data.staged.push({ status: index, file })
          data.clean = false
        }

        // Unstaged changes (worktree has changes)
        if (worktree !== " " && worktree !== "?") {
          data.modified.push({ status: worktree, file })
          data.clean = false
        }

        // Untracked files
        if (index === "?" && worktree === "?") {
          data.untracked.push(file)
          data.clean = false
        }
      }
    } catch {
      // Failed to parse
    }

    return data
  }

  function renderStatus() {
    clearContainer(statusBody)

    if (!statusData) return

    const maxFileWidth = 45
    const truncateFile = (file: string) =>
      file.length > maxFileWidth ? "…" + file.slice(-(maxFileWidth - 1)) : file

    const statusSymbols: Record<string, { symbol: string; label: string }> = {
      M: { symbol: "~", label: "modified" },
      A: { symbol: "+", label: "added" },
      D: { symbol: "-", label: "deleted" },
      R: { symbol: "→", label: "renamed" },
      C: { symbol: "©", label: "copied" },
      U: { symbol: "!", label: "conflict" },
    }

    // Branch header
    let branchLine = t`${fg(COLORS.primary)(bold("⎇"))} ${fg(COLORS.text)(bold(statusData.branch))}`
    if (statusData.ahead > 0 || statusData.behind > 0) {
      const parts: string[] = []
      if (statusData.ahead > 0) parts.push(`↑${statusData.ahead}`)
      if (statusData.behind > 0) parts.push(`↓${statusData.behind}`)
      branchLine = t`${fg(COLORS.primary)(bold("⎇"))} ${fg(COLORS.text)(bold(statusData.branch))}  ${fg(COLORS.textMuted)(parts.join(" "))}`
    }
    statusBody.add(new TextRenderable(renderer, { id: "status-branch", content: branchLine }))

    // Divider
    statusBody.add(new TextRenderable(renderer, {
      id: "status-divider",
      content: t`${fg(COLORS.border)("─".repeat(54))}`,
      marginTop: 1,
      marginBottom: 1,
    }))

    // Clean status
    if (statusData.clean) {
      statusBody.add(new TextRenderable(renderer, {
        id: "status-clean",
        content: t`${fg(COLORS.success)("✓")} ${fg(COLORS.textSecondary)("Working tree clean")}`,
      }))
      return
    }

    // Staged changes
    if (statusData.staged.length > 0) {
      statusBody.add(new TextRenderable(renderer, {
        id: "status-staged-header",
        content: t`${fg(COLORS.success)("Staged")} ${fg(COLORS.textDim)(`(${statusData.staged.length})`)}`,
      }))
      for (let i = 0; i < Math.min(statusData.staged.length, 8); i++) {
        const item = statusData.staged[i]
        const info = statusSymbols[item.status] || { symbol: item.status, label: "" }
        statusBody.add(new TextRenderable(renderer, {
          id: `status-staged-${i}`,
          content: t`  ${fg(COLORS.success)(info.symbol)} ${fg(COLORS.textSecondary)(truncateFile(item.file))}`,
        }))
      }
      if (statusData.staged.length > 8) {
        statusBody.add(new TextRenderable(renderer, {
          id: "status-staged-more",
          content: t`  ${fg(COLORS.textDim)(`… and ${statusData.staged.length - 8} more`)}`,
        }))
      }
      statusBody.add(new BoxRenderable(renderer, { id: "status-staged-spacer", height: 1 }))
    }

    // Modified (unstaged) changes
    if (statusData.modified.length > 0) {
      statusBody.add(new TextRenderable(renderer, {
        id: "status-modified-header",
        content: t`${fg(COLORS.error)("Modified")} ${fg(COLORS.textDim)(`(${statusData.modified.length})`)}`,
      }))
      for (let i = 0; i < Math.min(statusData.modified.length, 8); i++) {
        const item = statusData.modified[i]
        const info = statusSymbols[item.status] || { symbol: item.status, label: "" }
        statusBody.add(new TextRenderable(renderer, {
          id: `status-modified-${i}`,
          content: t`  ${fg(COLORS.error)(info.symbol)} ${fg(COLORS.textSecondary)(truncateFile(item.file))}`,
        }))
      }
      if (statusData.modified.length > 8) {
        statusBody.add(new TextRenderable(renderer, {
          id: "status-modified-more",
          content: t`  ${fg(COLORS.textDim)(`… and ${statusData.modified.length - 8} more`)}`,
        }))
      }
      statusBody.add(new BoxRenderable(renderer, { id: "status-modified-spacer", height: 1 }))
    }

    // Untracked files
    if (statusData.untracked.length > 0) {
      statusBody.add(new TextRenderable(renderer, {
        id: "status-untracked-header",
        content: t`${fg(COLORS.textMuted)("Untracked")} ${fg(COLORS.textDim)(`(${statusData.untracked.length})`)}`,
      }))
      for (let i = 0; i < Math.min(statusData.untracked.length, 5); i++) {
        statusBody.add(new TextRenderable(renderer, {
          id: `status-untracked-${i}`,
          content: t`  ${fg(COLORS.textDim)("?")} ${fg(COLORS.textMuted)(truncateFile(statusData.untracked[i]))}`,
        }))
      }
      if (statusData.untracked.length > 5) {
        statusBody.add(new TextRenderable(renderer, {
          id: "status-untracked-more",
          content: t`  ${fg(COLORS.textDim)(`… and ${statusData.untracked.length - 5} more`)}`,
        }))
      }
    }
  }

  function showStatusUI() {
    showStatus = true
    statusScrollOffset = 0
    statusData = parseGitStatus()

    paletteContainer.visible = false
    hintContainer.visible = false
    statusOverlay.visible = true

    renderStatus()
  }

  function hideStatusUI() {
    showStatus = false
    statusOverlay.visible = false
    paletteContainer.visible = true
    hintContainer.visible = true
  }

  function copyToClipboard(text: string): boolean {
    const MAX_CLIPBOARD_CHARS = 200_000
    const clipped = text.length > MAX_CLIPBOARD_CHARS
      ? `${text.slice(0, MAX_CLIPBOARD_CHARS)}\n\n[truncated: ${text.length - MAX_CLIPBOARD_CHARS} chars]`
      : text

    const tryCommand = (command: string, args: string[]) => {
      try {
        const res = spawnSync(command, args, { input: clipped, encoding: "utf8", timeout: 2000 })
        return res.status === 0
      } catch {
        return false
      }
    }

    // macOS
    if (tryCommand("pbcopy", [])) return true
    // Wayland
    if (tryCommand("wl-copy", [])) return true
    // X11
    if (tryCommand("xclip", ["-selection", "clipboard"])) return true

    return false
  }

  function formatBugForClipboard(bug: Bug): string {
    const config = SEVERITY_CONFIG[bug.severity]
    return [
      `${config.label}: ${bug.title}`,
      `File: ${bug.file}`,
      `Lines: ${bug.startLine} → ${bug.endLine}`,
      ``,
      `Description:`,
      bug.description,
      ``,
      `Suggestion:`,
      bug.suggestion,
      ``,
      `Proposed fix (diff):`,
      bug.fixDiff?.trim() ? bug.fixDiff.trimEnd() : "(not available)",
    ].join("\n")
  }

  function formatBugsForClipboard(bugs: Bug[]): string {
    if (bugs.length === 0) return "No issues found."
    return bugs.map((b, i) => [`#${i + 1}`, formatBugForClipboard(b)].join("\n")).join("\n\n---\n\n")
  }

  function showCopyToast(success: boolean) {
    if (copyToastTimeout) {
      clearTimeout(copyToastTimeout)
      copyToastTimeout = null
    }

    resultsHint.content = success
      ? t`${fg(COLORS.success)("⧉ Copied to clipboard")}`
      : t`${fg(COLORS.error)("⧉ Copy failed (no clipboard tool found)")}`

    copyToastTimeout = setTimeout(() => {
      copyToastTimeout = null
      if (resultsView === 'summary') renderSeveritySummary()
      else if (resultsView === 'bugList') renderBugList()
      else if (resultsView === 'bugDetail') renderBugDetail()
      else if (resultsView === 'bugFixDiff') renderBugFixDiff()
    }, 1200)
  }

  // Render severity summary (main results view)
  function renderSeveritySummary() {
    if (!currentResults) return

    clearContainer(resultsGrid)

    // Add spacer at top
    const topSpacer = new BoxRenderable(renderer, {
      id: "top-spacer",
      height: 1,
    })
    resultsGrid.add(topSpacer)

    severityOrder.forEach((severity, i) => {
      const config = SEVERITY_CONFIG[severity]
      const count = currentResults![severity]
      const isSelected = i === selectedSeverityIndex

      const row = new BoxRenderable(renderer, {
        id: `severity-row-${i}`,
        width: "100%",
        flexDirection: "row",
        paddingLeft: 2,
        paddingRight: 2,
        backgroundColor: isSelected ? COLORS.bgHover : "transparent",
      })

      const descriptions: Record<Bug['severity'], string> = {
        critical: 'Security vulnerabilities',
        major: 'Logic issues, bugs',
        minor: 'Style, refactoring',
        info: 'Tips, optimizations',
      }

      // More symmetrical layout with fixed columns
      const symbolPart = isSelected ? config.symbol : config.symbol
      const labelPart = config.label.padEnd(10)
      const countPart = count.toString().padStart(4)
      const descPart = descriptions[severity].padEnd(24)

      const content = new TextRenderable(renderer, {
        id: `severity-content-${i}`,
        content: t`  ${fg(isSelected ? config.color : COLORS.textDim)(symbolPart)}   ${fg(isSelected ? config.color : COLORS.text)(labelPart)}${fg(COLORS.text)(countPart)}    ${fg(COLORS.textMuted)(descPart)}`,
      })
      row.add(content)
      resultsGrid.add(row)
    })

    // Spacer before stats
    const midSpacer = new BoxRenderable(renderer, {
      id: "mid-spacer",
      height: 1,
    })
    resultsGrid.add(midSpacer)

    const total = currentResults.critical + currentResults.major + currentResults.minor + currentResults.info
    const timeSeconds = (currentResults.timeMs / 1000).toFixed(1)

    // Cleaner stats layout
    const statsRuleWidth = Math.max(20, RESULTS_PANEL_WIDTH - 8)
    resultsStats.content = t`
${fg(COLORS.border)("  " + "─".repeat(statsRuleWidth) + "  ")}

    ${fg(COLORS.textMuted)("Total")} ${fg(COLORS.text)(total.toString().padStart(3))}   ${fg(COLORS.textDim)("│")}   ${fg(COLORS.textMuted)("Files")} ${fg(COLORS.text)(currentResults.filesScanned.toString().padStart(3))}   ${fg(COLORS.textDim)("│")}   ${fg(COLORS.textMuted)("Time")} ${fg(COLORS.text)(timeSeconds + "s")}`

    resultsHint.content = t`
  ${fg(COLORS.primary)("↑↓")} ${fg(COLORS.textMuted)("navigate")}     ${fg(COLORS.primary)("↵")} ${fg(COLORS.textMuted)("view bugs")}     ${fg(COLORS.primary)("c")} ${fg(COLORS.textMuted)("copy all")}     ${fg(COLORS.primary)("esc")} ${fg(COLORS.textMuted)("exit")}`
  }

  // Render bug list for selected severity
  function renderBugList() {
    if (!currentResults) return

    clearContainer(resultsGrid)

    const severity = severityOrder[selectedSeverityIndex]
    const config = SEVERITY_CONFIG[severity]
    filteredBugs = currentResults.bugs.filter(b => b.severity === severity)

    // Header
    const header = new TextRenderable(renderer, {
      id: "bug-list-header",
      content: t`${fg(config.color)(config.symbol)} ${fg(config.color)(bold(config.label))} ${fg(COLORS.textMuted)("issues")} ${fg(COLORS.textDim)("(" + filteredBugs.length + ")")}`,
    })
    resultsGrid.add(header)

    const headerSpacer = new BoxRenderable(renderer, {
      id: "bug-list-spacer",
      height: 1,
    })
    resultsGrid.add(headerSpacer)

    if (filteredBugs.length === 0) {
      const noIssues = new TextRenderable(renderer, {
        id: "no-issues",
        content: t`  ${fg(COLORS.textMuted)("No issues found")}`,
      })
      resultsGrid.add(noIssues)
    } else {
      filteredBugs.slice(0, 8).forEach((bug, i) => {
        const isSelected = i === selectedBugIndex

        const row = new BoxRenderable(renderer, {
          id: `bug-row-${i}`,
          width: "100%",
          flexDirection: "row",
          paddingLeft: 1,
          paddingRight: 1,
          backgroundColor: isSelected ? COLORS.bgHover : "transparent",
        })

        const lineRange = `L${bug.startLine}-${bug.endLine}`
        const bugContent = new TextRenderable(renderer, {
          id: `bug-content-${i}`,
          content: t`${fg(isSelected ? COLORS.primary : COLORS.textDim)("›")} ${fg(isSelected ? COLORS.text : COLORS.textSecondary)(bug.title.slice(0, 28).padEnd(28))} ${fg(COLORS.textMuted)(lineRange.padStart(10))}`,
          selectable: true,
        })
        row.add(bugContent)
        resultsGrid.add(row)
      })
    }

    resultsStats.content = t``
    resultsHint.content = t`  ${fg(COLORS.primary)("↑↓")} ${fg(COLORS.textDim)("navigate")}    ${fg(COLORS.primary)("↵")} ${fg(COLORS.textDim)("details")}    ${fg(COLORS.primary)("c")} ${fg(COLORS.textDim)("copy list+diffs")}    ${fg(COLORS.primary)("esc")} ${fg(COLORS.textDim)("back")}`
  }

  // Render bug detail view
  function renderBugDetail() {
    if (!selectedBug) return

    const wrapText = (text: string, width: number): string[] => {
      const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
      const paragraphs = normalized.split("\n")
      const lines: string[] = []

      for (const paragraph of paragraphs) {
        const trimmedRight = paragraph.replace(/\s+$/g, "")
        if (!trimmedRight) {
          lines.push("")
          continue
        }

        const indentMatch = trimmedRight.match(/^\s+/)
        const indent = indentMatch ? indentMatch[0] : ""
        const content = trimmedRight.slice(indent.length)
        const tokens = content.match(/(\s+|\S+)/g) || [content]
        let line = ""
        for (const token of tokens) {
          const next = line ? `${line}${token}` : `${indent}${token.trimStart()}`
          if (next.length <= width) {
            line = next
            continue
          }

          if (line) lines.push(line)
          const effectiveToken = token.trimStart()
          const tokenWithIndent = `${indent}${effectiveToken}`
          if (tokenWithIndent.length > width) {
            for (let i = 0; i < tokenWithIndent.length; i += width) {
              lines.push(tokenWithIndent.slice(i, i + width))
            }
            line = ""
          } else {
            line = tokenWithIndent
          }
        }
        if (line) lines.push(line)
      }

      return lines
    }

    const buildStyledMultiline = (lines: Array<{ text: string; color: string }>): StyledText => {
      const chunks = []
      for (let i = 0; i < lines.length; i++) {
        const { text, color } = lines[i]
        chunks.push(fg(color)(text))
        if (i !== lines.length - 1) chunks.push(fg(color)("\n"))
      }
      return new StyledText(chunks as any)
    }

    const viewportLines = (() => {
      const rows = process.stdout.rows || 24
      return Math.max(8, Math.min(26, rows - 14))
    })()

    const contentWidth = 64

    clearContainer(resultsGrid)

    const config = SEVERITY_CONFIG[selectedBug.severity]

    const allLines: Array<{ text: string; color: string }> = []
    allLines.push({ text: `${config.symbol} ${config.label}: ${selectedBug.title}`, color: config.color })
    allLines.push({ text: "", color: COLORS.textSecondary })
    allLines.push({ text: `File:  ${selectedBug.file}`, color: COLORS.textSecondary })
    allLines.push({ text: `Lines: ${selectedBug.startLine} → ${selectedBug.endLine}`, color: COLORS.textSecondary })
    allLines.push({ text: "", color: COLORS.textSecondary })
    allLines.push({ text: "Description", color: COLORS.text })
    allLines.push(...wrapText(selectedBug.description, contentWidth).map(text => ({ text, color: COLORS.textSecondary })))
    allLines.push({ text: "", color: COLORS.textSecondary })
    allLines.push({ text: "Suggestion", color: COLORS.text })
    allLines.push(...wrapText(selectedBug.suggestion, contentWidth).map(text => ({ text, color: COLORS.textSecondary })))

    const maxOffset = Math.max(0, allLines.length - viewportLines)
    if (detailScrollOffset > maxOffset) detailScrollOffset = maxOffset
    if (detailScrollOffset < 0) detailScrollOffset = 0
    const visibleLines = allLines.slice(detailScrollOffset, detailScrollOffset + viewportLines)

    // Title with severity
    const detailText = new TextRenderable(renderer, {
      id: "detail-text",
      content: buildStyledMultiline(visibleLines),
      selectable: true,
    })
    resultsGrid.add(detailText)

    resultsStats.content = t``
    resultsHint.content = t`${fg(COLORS.primary)("↑↓")} ${fg(COLORS.textDim)("scroll")}    ${fg(COLORS.primary)("↵")} ${fg(COLORS.textDim)("view diff")}    ${fg(COLORS.primary)("c")} ${fg(COLORS.textDim)("copy issue+diff")}    ${fg(COLORS.primary)("esc")} ${fg(COLORS.textDim)("back")}`
  }

  function renderBugFixDiff() {
    if (!selectedBug) return

    const normalizeLines = (text: string): string[] =>
      text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")

    const truncateLine = (line: string, width: number): string => {
      if (line.length <= width) return line
      if (width <= 1) return line.slice(0, width)
      return line.slice(0, width - 1) + "…"
    }

    const buildStyledMultiline = (lines: Array<{ text: string; color: string }>): StyledText => {
      const chunks = []
      for (let i = 0; i < lines.length; i++) {
        const { text, color } = lines[i]
        chunks.push(fg(color)(text))
        if (i !== lines.length - 1) chunks.push(fg(color)("\n"))
      }
      return new StyledText(chunks as any)
    }

    const viewportLines = (() => {
      const rows = process.stdout.rows || 24
      return Math.max(8, Math.min(26, rows - 14))
    })()

    const contentWidth = 64

    clearContainer(resultsGrid)

    const config = SEVERITY_CONFIG[selectedBug.severity]
    const allLines: Array<{ text: string; color: string }> = []

    allLines.push({ text: `${config.symbol} ${config.label}: Proposed fix (diff)`, color: config.color })
    allLines.push({ text: "", color: COLORS.textSecondary })
    allLines.push({ text: `File:  ${selectedBug.file}`, color: COLORS.textSecondary })
    allLines.push({ text: `Lines: ${selectedBug.startLine} → ${selectedBug.endLine}`, color: COLORS.textSecondary })
    allLines.push({ text: "", color: COLORS.textSecondary })

    const rawFix = selectedBug.fixDiff?.trim() ? selectedBug.fixDiff.trimEnd() : ""
    if (!rawFix) {
      const state = fixDiffRequests.get(selectedBug.id)?.status ?? 'idle'
      if (state === 'idle' && lastReviewRequest) {
        fixDiffRequests.set(selectedBug.id, { status: 'loading' })
        allLines.push({ text: "Generating proposed fix…", color: COLORS.textMuted })
        const bugId = selectedBug.id
          ; (async () => {
            try {
              const diff = await generateFixDiff(
                {
                  review: lastReviewRequest!,
                  bug: {
                    severity: selectedBug!.severity,
                    title: selectedBug!.title,
                    file: selectedBug!.file,
                    startLine: selectedBug!.startLine,
                    endLine: selectedBug!.endLine,
                    description: selectedBug!.description,
                    suggestion: selectedBug!.suggestion,
                  },
                },
                configManager.getProxyUrl(),
                configManager.getProxyKey()
              )
              if (selectedBug && selectedBug.id === bugId) {
                selectedBug.fixDiff = diff
              }
              fixDiffRequests.set(bugId, { status: 'done' })
            } catch (e) {
              fixDiffRequests.set(bugId, { status: 'error', error: (e as Error)?.message || 'Failed to generate diff' })
            } finally {
              if (resultsView === 'bugFixDiff' && selectedBug && selectedBug.id === bugId) {
                renderBugFixDiff()
              }
            }
          })()
      } else if (state === 'loading') {
        allLines.push({ text: "Generating proposed fix…", color: COLORS.textMuted })
      } else if (state === 'error') {
        allLines.push({ text: "(diff generation failed)", color: COLORS.textMuted })
        const error = fixDiffRequests.get(selectedBug.id)?.error
        if (error) allLines.push({ text: truncateLine(error, contentWidth), color: COLORS.textDim })
      } else {
        allLines.push({ text: "(not available)", color: COLORS.textMuted })
      }
    } else {
      for (const rawLine of normalizeLines(rawFix)) {
        const line = truncateLine(rawLine, contentWidth)
        let color = COLORS.textSecondary
        if (line.startsWith("+") && !line.startsWith("+++")) color = COLORS.success
        else if (line.startsWith("-") && !line.startsWith("---")) color = COLORS.error
        else if (line.startsWith("@@")) color = COLORS.warning
        else if (line.startsWith("diff --git") || line.startsWith("index ") || line.startsWith("---") || line.startsWith("+++")) color = COLORS.textDim
        allLines.push({ text: line, color })
      }
    }

    const maxOffset = Math.max(0, allLines.length - viewportLines)
    if (detailScrollOffset > maxOffset) detailScrollOffset = maxOffset
    if (detailScrollOffset < 0) detailScrollOffset = 0
    const visibleLines = allLines.slice(detailScrollOffset, detailScrollOffset + viewportLines)

    const diffText = new TextRenderable(renderer, {
      id: "diff-text",
      content: buildStyledMultiline(visibleLines),
      selectable: true,
    })
    resultsGrid.add(diffText)

    resultsStats.content = t``
    resultsHint.content = t`${fg(COLORS.primary)("↑↓")} ${fg(COLORS.textDim)("scroll")}    ${fg(COLORS.primary)("c")} ${fg(COLORS.textDim)("copy issue+diff")}    ${fg(COLORS.primary)("esc")} ${fg(COLORS.textDim)("back")}`
  }

  // Show results - entry point
  function showResults(results: ReviewResult) {
    progressBarContainer.visible = false
    resultsSection.visible = true
    currentResults = results
    resultsView = 'summary'
    selectedSeverityIndex = 0
    selectedBugIndex = 0
    detailScrollOffset = 0
    fixDiffRequests.clear()
    renderSeveritySummary()
  }

  // Navigate results
  function navigateResultsUp() {
    if (resultsView === 'summary') {
      const maxIndex = 3 // severityOrder.length - 1
      selectedSeverityIndex = selectedSeverityIndex <= 0
        ? maxIndex
        : selectedSeverityIndex - 1
      renderSeveritySummary()
    } else if (resultsView === 'bugList') {
      if (filteredBugs.length === 0) return
      selectedBugIndex = selectedBugIndex <= 0
        ? filteredBugs.length - 1
        : selectedBugIndex - 1
      renderBugList()
    } else if (resultsView === 'bugDetail') {
      detailScrollOffset = Math.max(0, detailScrollOffset - 1)
      renderBugDetail()
    } else if (resultsView === 'bugFixDiff') {
      detailScrollOffset = Math.max(0, detailScrollOffset - 1)
      renderBugFixDiff()
    }
  }

  function navigateResultsDown() {
    if (resultsView === 'summary') {
      const maxIndex = 3 // severityOrder.length - 1
      selectedSeverityIndex = selectedSeverityIndex >= maxIndex
        ? 0
        : selectedSeverityIndex + 1
      renderSeveritySummary()
    } else if (resultsView === 'bugList') {
      if (filteredBugs.length === 0) return
      selectedBugIndex = selectedBugIndex >= filteredBugs.length - 1
        ? 0
        : selectedBugIndex + 1
      renderBugList()
    } else if (resultsView === 'bugDetail') {
      detailScrollOffset = detailScrollOffset + 1
      renderBugDetail()
    } else if (resultsView === 'bugFixDiff') {
      detailScrollOffset = detailScrollOffset + 1
      renderBugFixDiff()
    }
  }

  function selectResultsItem() {
    if (resultsView === 'summary') {
      resultsView = 'bugList'
      selectedBugIndex = 0
      detailScrollOffset = 0
      renderBugList()
    } else if (resultsView === 'bugList' && filteredBugs[selectedBugIndex]) {
      resultsView = 'bugDetail'
      selectedBug = filteredBugs[selectedBugIndex]
      detailScrollOffset = 0
      renderBugDetail()
    } else if (resultsView === 'bugDetail') {
      resultsView = 'bugFixDiff'
      detailScrollOffset = 0
      renderBugFixDiff()
    }
  }

  function goBackResults(): boolean {
    if (resultsView === 'bugFixDiff') {
      resultsView = 'bugDetail'
      renderBugDetail()
      return true
    } else if (resultsView === 'bugDetail') {
      resultsView = 'bugList'
      renderBugList()
      return true
    } else if (resultsView === 'bugList') {
      resultsView = 'summary'
      renderSeveritySummary()
      return true
    }
    return false
  }


  // ═══ COMMAND PALETTE ═══
  const paletteContainer = new BoxRenderable(renderer, {
    id: "palette-container",
    width: RESULTS_PANEL_WIDTH,
    flexDirection: "column",
    visible: true,
    marginTop: 1,
    marginLeft: "15%",
  })

  function renderCmds() {
    const children = paletteContainer.getChildren()
    children.forEach((c) => paletteContainer.remove(c.id))

    if (filteredCommands.length === 0) {
      const noResults = new TextRenderable(renderer, {
        id: "no-results",
        content: t`  ${fg(COLORS.textMuted)("No matching commands")}`,
      })
      paletteContainer.add(noResults)
      return
    }

    // Calculate max name length for column alignment
    const maxNameLength = Math.max(...filteredCommands.map(cmd => cmd.name.length))
    // Calculate max row width: icon(1) + space(1) + name + spaces(2) + description + padding(2)
    const maxRowWidth = Math.max(...filteredCommands.map(cmd =>
      1 + 1 + maxNameLength + 2 + cmd.description.length
    )) + 2 // +2 for padding

    filteredCommands.forEach((cmd, i) => {
      const isSelected = i === selectedIndex

      const row = new BoxRenderable(renderer, {
        id: `cmd-row-${i}`,
        width: maxRowWidth,
        flexDirection: "row",
        paddingLeft: 1,
        paddingRight: 1,
        backgroundColor: isSelected ? COLORS.bgHover : "transparent",
      })

      // Pad name to align descriptions at the same column
      const paddedName = cmd.name.padEnd(maxNameLength)

      const cmdContent = new TextRenderable(renderer, {
        id: `cmd-${i}`,
        content: t`${fg(isSelected ? COLORS.primary : COLORS.textDim)(cmd.icon)} ${fg(isSelected ? COLORS.primary : COLORS.text)(paddedName)}  ${fg(COLORS.textMuted)(cmd.description)}`,
      })
      row.add(cmdContent)

      paletteContainer.add(row)
    })
  }

  renderCmds()
  centerContent.add(paletteContainer)

  // Keyboard hints
  const keyHints = new TextRenderable(renderer, {
    id: "key-hints",
    content: t`${fg(COLORS.primary)("↑↓")} ${fg(COLORS.textMuted)("navigate")}  ${fg(COLORS.primary)("↵")} ${fg(COLORS.textMuted)("select")}  ${fg(COLORS.primary)("esc")} ${fg(COLORS.textMuted)("exit")}`,
  })

  const hintContainer = new BoxRenderable(renderer, {
    id: "hint-container",
    marginTop: 2,
  })
  hintContainer.add(keyHints)
  centerContent.add(hintContainer)

  centerContent.add(helpContainer.overlay)
  centerContent.add(updateContainer.overlay)
  centerContent.add(modelSelector.overlay)
  centerContent.add(historyContainer.overlay)
  rootContainer.add(centerContent)
  renderer.root.add(rootContainer)

  // ═══ REVIEW ANIMATION FUNCTIONS ═══
  async function startReviewAnimation(commandId: string, commitHash?: string) {
    if (isReviewing) return

    isReviewing = true
    paletteContainer.visible = false
    hintContainer.visible = false
    reviewOverlay.visible = true
    progressBarContainer.visible = true
    resultsSection.visible = false

    // Show initial connection message
    reviewMessage.content = t`${fg(COLORS.text)("Connecting to AI proxy...")}`
    updateProgressBar(0)

    // Wait for background initialization to complete (usually already done)
    // Then check if healthy - if init succeeded, this is instant
    try {
      await proxyManager.initialize() // Returns cached promise if already started
    } catch {
      // Init failed, but we'll check health anyway
    }

    // If already healthy from init, this returns immediately
    // Otherwise polls for up to 10 seconds
    const isHealthy = proxyManager.isHealthy || await proxyManager.waitForHealth()
    if (!isHealthy) {
      reviewMessage.content = t`${fg(COLORS.error)("Failed to connect to AI proxy. Please check your setup.")}`
      setTimeout(() => cancelReview(), 3000)
      return
    }

    // Check if a model is selected
    const selectedModel = configManager.getSelectedModel()
    if (!selectedModel) {
      reviewMessage.content = t`${fg(COLORS.error)("No model selected. Please run Setup first.")}`
      setTimeout(() => cancelReview(), 3000)
      return
    }

    // Full codebase review (hierarchical map-reduce + agentic grounding)
    if (commandId === "review-all") {
      let currentPhase: Exclude<ReviewPhase, 'complete'> = 'scanning'
      let kittyFrame = 0
      const startTime = Date.now()

      reviewMessage.content = t`${fg(COLORS.text)("Indexing repository...")}`
      updateProgressBar(0.05)

      // Simple animation loop (progress is controlled by actual work via callbacks)
      reviewAnimationInterval = setInterval(() => {
        const frames = getKittyFramesForPhase(currentPhase)
        kittyFrame = (kittyFrame + 1) % frames.length
        kittyArt.content = t`${fg(COLORS.primary)(frames[kittyFrame].join("\n"))}`
      }, 200)

      const phaseForStage = (stage: CodebaseReviewProgress['stage']): Exclude<ReviewPhase, 'complete'> => {
        switch (stage) {
          case 'indexing':
            return 'scanning'
          case 'mapping':
            return 'hunting'
          case 'summarizing':
            return 'deepDive'
          case 'reviewing':
            return 'writing'
          default:
            return 'analyzing'
        }
      }

      const onProgress = (p: CodebaseReviewProgress) => {
        currentPhase = phaseForStage(p.stage)
        reviewMessage.content = t`${fg(COLORS.text)(p.message)}`
        const clamped = Math.max(0, Math.min(0.99, p.progress))
        updateProgressBar(clamped)
      }

      const codebaseCfg = configManager.getCodebaseReviewConfig()
      const runReview = () => reviewCodebase(
        {
          model: selectedModel,
          maxFilesToSummarize: codebaseCfg.maxFilesToSummarize,
          folderDepth: codebaseCfg.folderDepth,
        },
        configManager.getProxyUrl(),
        configManager.getProxyKey(),
        configManager.getToolsConfig(),
        onProgress
      )

      try {
        let aiResponse: Awaited<ReturnType<typeof reviewCodebase>>
        try {
          aiResponse = await runReview()
        } catch (e) {
          const message = (e as Error)?.message || ""
          const looksLikeAuthError =
            message.includes("401") ||
            message.toLowerCase().includes("authenticationerror") ||
            message.toLowerCase().includes("no cookie auth credentials")

          if (!looksLikeAuthError) throw e

          proxyManager.stop()
          await proxyManager.initialize()
          aiResponse = await runReview()
        }

        // Stop animation
        if (reviewAnimationInterval) {
          clearInterval(reviewAnimationInterval)
          reviewAnimationInterval = null
        }

        updateProgressBar(1)
        kittyArt.content = t`${fg(COLORS.primary)(KITTY_DONE[0].join("\n"))}`

        const totalBugs = aiResponse.summary.critical + aiResponse.summary.major + aiResponse.summary.minor + aiResponse.summary.info
        if (totalBugs === 0) {
          reviewMessage.content = t`${fg(COLORS.success)(bold("Purrfect! No issues found~"))}`
        } else {
          reviewMessage.content = t`${fg(COLORS.success)(bold("Meow~ Found " + totalBugs + " things to look at!"))}`
        }

        const reviewResult: ReviewResult = {
          critical: aiResponse.summary.critical,
          major: aiResponse.summary.major,
          minor: aiResponse.summary.minor,
          info: aiResponse.summary.info,
          filesScanned: aiResponse.filesScanned,
          linesAnalyzed: aiResponse.linesAnalyzed,
          timeMs: Date.now() - startTime,
          bugs: aiResponse.bugs
        }

        // Codebase reviews are not diff-based; disable fix diff generation
        lastReviewRequest = null

        // Generate a meaningful summary for history
        let historySummary: string
        if (totalBugs === 0) {
          historySummary = `Clean - ${reviewResult.filesScanned} files checked`
        } else {
          const topBug = aiResponse.bugs[0]
          if (topBug) {
            historySummary = topBug.title.slice(0, 50)
          } else {
            historySummary = `${totalBugs} issues in ${reviewResult.filesScanned} files`
          }
        }

        historyManager.addEntry({
          timestamp: Date.now(),
          reviewType: commandId as ReviewType,
          summary: historySummary,
          repository: {
            path: localPath,
            displayPath,
            repoUrl: gitInfo.repoUrl || null,
            branch: gitInfo.branch,
          },
          results: reviewResult,
          model: selectedModel,
        })

        setTimeout(() => showResults(reviewResult), 500)
        return

      } catch (error) {
        if (reviewAnimationInterval) {
          clearInterval(reviewAnimationInterval)
          reviewAnimationInterval = null
        }
        kittyArt.content = t`${fg(COLORS.error)(KITTY_IDLE[0].join("\n"))}`
        reviewMessage.content = t`${fg(COLORS.error)("AI review failed: " + (error as Error).message)}`
        setTimeout(() => cancelReview(), 5000)
        return
      }
    }

    // Diff-based reviews
    reviewMessage.content = t`${fg(COLORS.text)(getRandomPhaseMessage('scanning'))}`
    updateProgressBar(0.1)

    let diffResult
    try {
      diffResult = await getFullDiff(commandId as ReviewType, commitHash)
    } catch (error) {
      reviewMessage.content = t`${fg(COLORS.error)("Failed to get diff: " + (error as Error).message)}`
      setTimeout(() => cancelReview(), 3000)
      return
    }

    if (!diffResult.diff || diffResult.diff.trim().length === 0) {
      reviewMessage.content = t`${fg(COLORS.warning)("No changes to review.")}`
      setTimeout(() => cancelReview(), 2000)
      return
    }

    // Start animation while waiting for AI response
    const phases: { phase: Exclude<ReviewPhase, 'complete'>; duration: number }[] = [
      { phase: 'scanning', duration: 2000 },
      { phase: 'hunting', duration: 3000 },
      { phase: 'analyzing', duration: 4000 },
      { phase: 'deepDive', duration: 5000 },
      { phase: 'writing', duration: 6000 },
    ]

    let currentPhaseIndex = 0
    let phaseStartTime = Date.now()
    let kittyFrame = 0
    const startTime = Date.now()

    // Set initial message
    reviewMessage.content = t`${fg(COLORS.text)(getRandomPhaseMessage(phases[0].phase))}`

    // Start animation loop (runs independently of AI call)
    reviewAnimationInterval = setInterval(() => {
      const now = Date.now()
      const elapsed = now - startTime

      // Slow progress that never reaches 100% until AI responds
      const maxProgress = 0.9 // Cap at 90% until AI responds
      const progress = Math.min((elapsed / 30000) * maxProgress, maxProgress)

      updateProgressBar(progress)

      // Cycle through phases based on time
      if (currentPhaseIndex < phases.length) {
        const phaseElapsed = now - phaseStartTime
        const phaseDuration = phases[currentPhaseIndex].duration
        if (phaseElapsed >= phaseDuration) {
          currentPhaseIndex++
          phaseStartTime = now
          if (currentPhaseIndex < phases.length) {
            reviewMessage.content = t`${fg(COLORS.text)(getRandomPhaseMessage(phases[currentPhaseIndex].phase))}`
          }
        }

        // Animate kitty
        const currentPhase = currentPhaseIndex < phases.length ? phases[currentPhaseIndex].phase : 'writing'
        const frames = getKittyFramesForPhase(currentPhase)
        kittyFrame = (kittyFrame + 1) % frames.length
        kittyArt.content = t`${fg(COLORS.primary)(frames[kittyFrame].join("\n"))}`
      }
    }, 200)

    // Call AI review in parallel with animation
    try {
      reviewMessage.content = t`${fg(COLORS.text)(getRandomPhaseMessage('analyzing'))}`

      const runReview = () => reviewCode({
        diff: diffResult.diff,
        files: diffResult.files,
        commitInfo: diffResult.commitInfo,
        model: selectedModel
      }, configManager.getProxyUrl(), configManager.getProxyKey(), configManager.getToolsConfig())

      let aiResponse: Awaited<ReturnType<typeof reviewCode>>
      try {
        aiResponse = await runReview()
      } catch (e) {
        const message = (e as Error)?.message || ""
        const looksLikeAuthError =
          message.includes("401") ||
          message.toLowerCase().includes("authenticationerror") ||
          message.toLowerCase().includes("no cookie auth credentials")

        if (!looksLikeAuthError) throw e

        // Restart proxy with fresh config
        proxyManager.stop()
        await proxyManager.initialize()
        aiResponse = await runReview()
      }

      // AI responded - stop animation
      if (reviewAnimationInterval) {
        clearInterval(reviewAnimationInterval)
        reviewAnimationInterval = null
      }

      // Complete progress
      updateProgressBar(1)

      // Show done kitty
      kittyArt.content = t`${fg(COLORS.primary)(KITTY_DONE[0].join("\n"))}`

      const totalBugs = aiResponse.summary.critical + aiResponse.summary.major + aiResponse.summary.minor + aiResponse.summary.info

      if (totalBugs === 0) {
        reviewMessage.content = t`${fg(COLORS.success)(bold("Purrfect! No issues found~"))}`
      } else {
        reviewMessage.content = t`${fg(COLORS.success)(bold("Meow~ Found " + totalBugs + " things to look at!"))}`
      }

      // Build ReviewResult from AI response
      const reviewResult: ReviewResult = {
        critical: aiResponse.summary.critical,
        major: aiResponse.summary.major,
        minor: aiResponse.summary.minor,
        info: aiResponse.summary.info,
        filesScanned: aiResponse.filesScanned,
        linesAnalyzed: aiResponse.linesAnalyzed,
        timeMs: Date.now() - startTime,
        bugs: aiResponse.bugs
      }
      lastReviewRequest = {
        diff: diffResult.diff,
        files: diffResult.files,
        commitInfo: diffResult.commitInfo,
        model: selectedModel,
      }

      // Generate a meaningful summary for history
      let historySummary: string
      if (diffResult.commitInfo?.message) {
        // For commit reviews, use the commit message
        historySummary = diffResult.commitInfo.message.slice(0, 50)
      } else if (totalBugs === 0) {
        // Clean review
        historySummary = `Clean - ${reviewResult.filesScanned} files checked`
      } else {
        // Summarize findings
        const topBug = aiResponse.bugs[0]
        if (topBug) {
          historySummary = topBug.title.slice(0, 50)
        } else {
          historySummary = `${totalBugs} issues in ${reviewResult.filesScanned} files`
        }
      }

      // Save to history
      historyManager.addEntry({
        timestamp: Date.now(),
        reviewType: commandId as ReviewType,
        summary: historySummary,
        repository: {
          path: localPath,
          displayPath,
          repoUrl: gitInfo.repoUrl || null,
          branch: gitInfo.branch,
        },
        commitInfo: diffResult.commitInfo ? {
          hash: diffResult.commitInfo.hash,
          shortHash: diffResult.commitInfo.shortHash,
          author: diffResult.commitInfo.author,
          date: diffResult.commitInfo.date,
          message: diffResult.commitInfo.message,
        } : undefined,
        results: reviewResult,
        model: selectedModel,
      })

      setTimeout(() => showResults(reviewResult), 500)

    } catch (error) {
      // AI call failed
      if (reviewAnimationInterval) {
        clearInterval(reviewAnimationInterval)
        reviewAnimationInterval = null
      }

      kittyArt.content = t`${fg(COLORS.error)(KITTY_IDLE[0].join("\n"))}`
      reviewMessage.content = t`${fg(COLORS.error)("AI review failed: " + (error as Error).message)}`
      setTimeout(() => cancelReview(), 5000)
    }
  }

  function cancelReview() {
    if (reviewAnimationInterval) {
      clearInterval(reviewAnimationInterval)
      reviewAnimationInterval = null
    }
    isReviewing = false
    reviewOverlay.visible = false
    paletteContainer.visible = true
    hintContainer.visible = true
  }

  // ═══ ANIMATION ═══
  let currentFrame = 0
  const animationInterval = setInterval(() => {
    if (!isRendererActive || isReviewing || isUpdating) {
      // Don't animate idle loop if renderer inactive, reviewing, or updating
      return
    }
    try {
      currentFrame = (currentFrame + 1) % KITTY_IDLE.length
      kittyArt.content = t`${fg(COLORS.primary)(KITTY_IDLE[currentFrame].join("\n"))}`
    } catch {
      clearInterval(animationInterval)
    }
  }, 600)

    // ═══ INPUT HANDLERS ═══
    ; (renderer as any).addInputHandler((sequence: string) => {
      // Handle arrow keys in model selector
      if (showModelSelector) {
        if (sequence === "\x1b[A" || sequence === "\x1bOA") {
          modelSelector.navigateUp()
          return true
        }
        if (sequence === "\x1b[B" || sequence === "\x1bOB") {
          modelSelector.navigateDown()
          return true
        }
      }

      // Handle arrow keys in commit selector
      if (showCommitSelector) {
        if (sequence === "\x1b[A" || sequence === "\x1bOA") {
          navigateCommitUp()
          return true
        }
        if (sequence === "\x1b[B" || sequence === "\x1bOB") {
          navigateCommitDown()
          return true
        }
        // Mouse wheel scroll support (SGR extended mouse mode)
        // SGR format: \x1b[<button;x;yM or \x1b[<button;x;ym
        // Button 64 = scroll up, Button 65 = scroll down
        const sgrMatch = sequence.match(/\x1b\[<(\d+);/)
        if (sgrMatch) {
          const button = parseInt(sgrMatch[1], 10)
          if (button === 64) {
            scrollCommitList('up')
            return true
          }
          if (button === 65) {
            scrollCommitList('down')
            return true
          }
        }
        // Legacy X10/normal mouse mode fallback
        if (sequence.startsWith("\x1b[M") && sequence.length >= 4) {
          const btn = sequence.charCodeAt(3) - 32
          if (btn === 64) {
            scrollCommitList('up')
            return true
          }
          if (btn === 65) {
            scrollCommitList('down')
            return true
          }
        }
      }

      // Handle arrow keys in history overlay
      if (showHistory) {
        if (sequence === "\x1b[A" || sequence === "\x1bOA") {
          historyContainer.navigateUp()
          return true
        }
        if (sequence === "\x1b[B" || sequence === "\x1bOB") {
          historyContainer.navigateDown()
          return true
        }
      }

      // Handle arrow keys in results view
      if (resultsSection.visible) {
        if (sequence === "\x1b[A" || sequence === "\x1bOA") {
          navigateResultsUp()
          return true
        }
        if (sequence === "\x1b[B" || sequence === "\x1bOB") {
          navigateResultsDown()
          return true
        }
        const sgrMatch = sequence.match(/\x1b\[<(\d+);/)
        if (sgrMatch) {
          const button = parseInt(sgrMatch[1], 10)
          if (button === 64) {
            navigateResultsUp()
            return true
          }
          if (button === 65) {
            navigateResultsDown()
            return true
          }
        }
        if (sequence.startsWith("\x1b[M") && sequence.length >= 4) {
          const btn = sequence.charCodeAt(3) - 32
          if (btn === 64) {
            navigateResultsUp()
            return true
          }
          if (btn === 65) {
            navigateResultsDown()
            return true
          }
        }
      }

      if (showPalette && !isReviewing && !showModelSelector && !showHelp && !showHistory) {
        if (sequence === "\x1b[A" || sequence === "\x1bOA") {
          if (filteredCommands.length === 0) return true
          selectedIndex = selectedIndex <= 0
            ? filteredCommands.length - 1
            : selectedIndex - 1
          renderCmds()
          return true
        }
        if (sequence === "\x1b[B" || sequence === "\x1bOB") {
          if (filteredCommands.length === 0) return true
          selectedIndex = selectedIndex >= filteredCommands.length - 1
            ? 0
            : selectedIndex + 1
          renderCmds()
          return true
        }
      }
      return false
    })

    ; (renderer.keyInput as any).on("keypress", (key: KeyEvent) => {
      // Toggle OpenTUI built-in console (docs: backtick)
      if (key.sequence === "`" || key.name === "grave") {
        renderer.console.toggle()
        return
      }

      const maybeCopyFromKey = (): boolean => {
        if (!resultsSection.visible) return false
        if (!currentResults) return true
        if (resultsView === 'bugDetail' && selectedBug) {
          showCopyToast(copyToClipboard(formatBugForClipboard(selectedBug)))
          return true
        }
        if (resultsView === 'bugList') {
          showCopyToast(copyToClipboard(formatBugsForClipboard(filteredBugs)))
          return true
        }
        if (resultsView === 'summary') {
          showCopyToast(copyToClipboard(formatBugsForClipboard(currentResults.bugs)))
          return true
        }
        return true
      }

      if (key.name === "c" || key.sequence === "c" || key.sequence === "C") {
        // Handle copy in history detail view
        if (showHistory && historyContainer.getCurrentView() === 'detail') {
          const content = historyContainer.copyCurrentReview()
          if (content) {
            historyContainer.showCopyToast(copyToClipboard(content))
          }
          return
        }
        // Handle copy in results views
        if (resultsSection.visible) {
          if (maybeCopyFromKey()) return
        }
      }

      // Tab key for model selector pagination
      if (key.name === "tab") {
        if (showModelSelector) {
          modelSelector.nextPage()
          return
        }
      }

      if (key.name === "escape") {
        if (showStatus) {
          hideStatusUI()
          return
        }

        // Handle help overlay escape
        if (showHelp) {
          hideHelpUI()
          return
        }

        // Handle update overlay escape
        if (isUpdating) {
          hideUpdateUI()
          return
        }

        // Handle model selector escape
        if (showModelSelector) {
          if (!modelSelector.goBack()) {
            hideModelSelectorUI()
          }
          return
        }

        // Handle commit selector escape
        if (showCommitSelector) {
          hideCommitSelectorUI()
          return
        }

        // Handle history overlay escape
        if (showHistory) {
          if (!historyContainer.goBack()) {
            hideHistoryUI()
          }
          return
        }

        // If reviewing, try to go back in drill-down, or cancel if at summary
        if (isReviewing) {
          if (resultsSection.visible) {
            // If we can go back in drill-down, do that
            if (!goBackResults()) {
              // At summary level, cancel review
              cancelReview()
            }
          } else {
            // Animation still running, cancel it
            cancelReview()
          }
          return
        }

        shutdown(0)
      }

      if (key.name === "return" && !key.shift) {
        key.preventDefault()

        if (showStatus) {
          hideStatusUI()
          return
        }

        // Handle update overlay enter
        if (isUpdating) {
          if (updateContainer.isUpdateAvailable()) {
            updateContainer.startUpdate()
          }
          return
        }

        // Handle model selector enter
        if (showModelSelector) {
          if (modelSelector.select()) {
            hideModelSelectorUI()
          }
          return
        }

        // Handle commit selector enter
        if (showCommitSelector) {
          selectCommitForReview()
          return
        }

        // Handle history overlay enter
        if (showHistory) {
          historyContainer.select()
          return
        }

        // Handle results navigation - select item
        if (isReviewing && resultsSection.visible) {
          selectResultsItem()
          return
        }

        if (showPalette && filteredCommands[selectedIndex]) {
          const selectedCmd = filteredCommands[selectedIndex]
          switch (selectedCmd.id) {
            case "review-uncommitted":
            case "review-branch":
            case "review-all":
              startReviewAnimation(selectedCmd.id)
              break
            case "review-commit":
              showCommitSelectorUI()
              break
            case "history":
              showHistoryUI()
              break
            case "setup":
              showModelSelectorUI()
              break
            case "status":
              showStatusUI()
              break
            case "help":
              showHelpUI()
              break
            case "update":
              startUpdateUI()
              break
            default:
              break
          }

          filteredCommands = [...commands]
          selectedIndex = 0
          renderCmds()
        }
        return
      }

      // Handle arrow keys for navigation
      if (key.name === "up") {
        key.preventDefault()
        if (showHelp || showStatus) {
          // These overlays don't need navigation
          return
        }
        if (showModelSelector) {
          modelSelector.navigateUp()
        } else if (showCommitSelector) {
          navigateCommitUp()
        } else if (showHistory) {
          historyContainer.navigateUp()
        } else if (isReviewing && resultsSection.visible) {
          navigateResultsUp()
        } else if (showPalette) {
          if (filteredCommands.length === 0) return
          selectedIndex = selectedIndex <= 0
            ? filteredCommands.length - 1
            : selectedIndex - 1
          renderCmds()
        }
        return
      }

      if (key.name === "down") {
        key.preventDefault()
        if (showHelp || showStatus) {
          // These overlays don't need navigation
          return
        }
        if (showModelSelector) {
          modelSelector.navigateDown()
        } else if (showCommitSelector) {
          navigateCommitDown()
        } else if (showHistory) {
          historyContainer.navigateDown()
        } else if (isReviewing && resultsSection.visible) {
          navigateResultsDown()
        } else if (showPalette) {
          if (filteredCommands.length === 0) return
          selectedIndex = selectedIndex >= filteredCommands.length - 1
            ? 0
            : selectedIndex + 1
          renderCmds()
        }
        return
      }
    })

  renderer.start()
}

main().catch(console.error)
