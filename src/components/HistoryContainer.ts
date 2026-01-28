/**
 * History Container Component
 * UI for browsing past code reviews
 */

import {
  BoxRenderable,
  TextRenderable,
  t,
  bold,
  fg,
} from "@opentui/core"
import { HistoryManager, type HistoryEntry } from "../core/history"
import type { Bug } from "../backend/ai-reviewer"

// Severity display config (matching index.ts)
const SEVERITY_CONFIG = {
  critical: { symbol: '✘', color: '#F85149', label: 'CRITICAL' },
  major: { symbol: '▲', color: '#FF9500', label: 'MAJOR' },
  minor: { symbol: '●', color: '#D29922', label: 'MINOR' },
  info: { symbol: '◆', color: '#58A6FF', label: 'INFO' },
}

// Review type icons
const REVIEW_TYPE_ICONS: Record<string, string> = {
  'review-uncommitted': '◎',
  'review-branch': '◉',
  'review-commit': '◈',
  'review-all': '◇',
}

type HistoryView = 'list' | 'detail' | 'bugList' | 'bugDetail'

export class HistoryContainer {
  public overlay: BoxRenderable
  private title: TextRenderable
  private list: BoxRenderable
  private hint: TextRenderable
  private copyToastTimeout: ReturnType<typeof setTimeout> | null = null

  private view: HistoryView = 'list'
  private entries: HistoryEntry[] = []
  private selectedEntryIndex = 0
  private selectedSeverityIndex = 0
  private selectedBugIndex = 0
  private currentEntry: HistoryEntry | null = null
  private filteredBugs: Bug[] = []
  private selectedBug: Bug | null = null

  private listPage = 0
  private readonly ENTRIES_PER_PAGE = 8
  private readonly severityOrder: Bug['severity'][] = ['critical', 'major', 'minor', 'info']

  constructor(
    private renderer: any,
    private colors: any,
    private historyManager: HistoryManager
  ) {
    this.overlay = new BoxRenderable(renderer, {
      id: "history-overlay",
      width: 70,
      flexDirection: "column",
      alignItems: "center",
      visible: false,
      border: true,
      borderStyle: "rounded",
      borderColor: colors.border,
      paddingTop: 1,
      paddingBottom: 1,
      paddingLeft: 2,
      paddingRight: 2,
    })

    this.title = new TextRenderable(renderer, {
      id: "history-title",
      content: t`${fg(colors.primary)(bold("↺ History"))}  ${fg(colors.textMuted)("Past code reviews")}`,
    })
    this.overlay.add(this.title)

    const spacer = new BoxRenderable(renderer, { id: "hist-sp1", height: 1 })
    this.overlay.add(spacer)

    this.list = new BoxRenderable(renderer, {
      id: "history-list",
      flexDirection: "column",
      alignItems: "flex-start",
      width: "100%",
    })
    this.overlay.add(this.list)

    this.hint = new TextRenderable(renderer, {
      id: "history-hint",
      content: t`${fg(colors.primary)("↑↓")} ${fg(colors.textMuted)("navigate")}  ${fg(colors.primary)("↵")} ${fg(colors.textMuted)("select")}  ${fg(colors.primary)("esc")} ${fg(colors.textMuted)("back")}`,
      marginTop: 1,
    })
    this.overlay.add(this.hint)
  }

  private addCenteredLine(id: string, content: any) {
    const row = new BoxRenderable(this.renderer, {
      id,
      width: "100%",
      flexDirection: "row",
      justifyContent: "center",
    })
    row.add(new TextRenderable(this.renderer, { id: `${id}-txt`, content }))
    this.list.add(row)
  }

  public show() {
    this.overlay.visible = true
    this.view = 'list'
    this.selectedEntryIndex = 0
    this.listPage = 0
    this.currentEntry = null
    this.entries = this.historyManager.getEntries()
    this.renderList()
  }

  public hide() {
    this.overlay.visible = false
  }

  public navigateUp() {
    if (this.view === 'list') {
      if (this.entries.length === 0) return
      this.selectedEntryIndex = this.selectedEntryIndex <= 0
        ? this.entries.length - 1
        : this.selectedEntryIndex - 1

      const newPage = Math.floor(this.selectedEntryIndex / this.ENTRIES_PER_PAGE)
      if (newPage !== this.listPage) {
        this.listPage = newPage
      }
      this.renderList()
    } else if (this.view === 'detail') {
      this.selectedSeverityIndex = this.selectedSeverityIndex <= 0
        ? 3
        : this.selectedSeverityIndex - 1
      this.renderDetail()
    } else if (this.view === 'bugList') {
      if (this.filteredBugs.length === 0) return
      this.selectedBugIndex = this.selectedBugIndex <= 0
        ? this.filteredBugs.length - 1
        : this.selectedBugIndex - 1
      this.renderBugList()
    }
  }

  public navigateDown() {
    if (this.view === 'list') {
      if (this.entries.length === 0) return
      this.selectedEntryIndex = this.selectedEntryIndex >= this.entries.length - 1
        ? 0
        : this.selectedEntryIndex + 1

      const newPage = Math.floor(this.selectedEntryIndex / this.ENTRIES_PER_PAGE)
      if (newPage !== this.listPage) {
        this.listPage = newPage
      }
      this.renderList()
    } else if (this.view === 'detail') {
      this.selectedSeverityIndex = this.selectedSeverityIndex >= 3
        ? 0
        : this.selectedSeverityIndex + 1
      this.renderDetail()
    } else if (this.view === 'bugList') {
      if (this.filteredBugs.length === 0) return
      this.selectedBugIndex = this.selectedBugIndex >= this.filteredBugs.length - 1
        ? 0
        : this.selectedBugIndex + 1
      this.renderBugList()
    }
  }

  public select(): boolean {
    if (this.view === 'list') {
      if (this.entries.length === 0) return false
      this.currentEntry = this.entries[this.selectedEntryIndex]
      this.view = 'detail'
      this.selectedSeverityIndex = 0
      this.renderDetail()
      return false
    } else if (this.view === 'detail' && this.currentEntry) {
      const severity = this.severityOrder[this.selectedSeverityIndex]
      this.filteredBugs = this.currentEntry.results.bugs.filter(b => b.severity === severity)
      this.view = 'bugList'
      this.selectedBugIndex = 0
      this.renderBugList()
      return false
    } else if (this.view === 'bugList' && this.filteredBugs[this.selectedBugIndex]) {
      this.selectedBug = this.filteredBugs[this.selectedBugIndex]
      this.view = 'bugDetail'
      this.renderBugDetail()
      return false
    }
    return false
  }

  public goBack(): boolean {
    if (this.view === 'bugDetail') {
      this.view = 'bugList'
      this.renderBugList()
      return true
    }
    if (this.view === 'bugList') {
      this.view = 'detail'
      this.renderDetail()
      return true
    }
    if (this.view === 'detail') {
      this.view = 'list'
      this.currentEntry = null
      this.renderList()
      return true
    }
    return false
  }

  private formatRelativeTime(timestamp: number): string {
    const now = Date.now()
    const diff = now - timestamp
    const minutes = Math.floor(diff / (1000 * 60))
    const hours = Math.floor(diff / (1000 * 60 * 60))
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))

    if (days > 0) return `${days}d ago`
    if (hours > 0) return `${hours}h ago`
    if (minutes > 0) return `${minutes}m ago`
    return 'just now'
  }

  private getReviewTypeLabel(reviewType: string): string {
    const labels: Record<string, string> = {
      'review-uncommitted': 'Changes',
      'review-branch': 'Branch',
      'review-commit': 'Commit',
      'review-all': 'Codebase',
    }
    return labels[reviewType] || reviewType
  }

  private getRepoName(entry: HistoryEntry): string {
    if (entry.repository.repoUrl) {
      const parts = entry.repository.repoUrl.split('/')
      return parts[parts.length - 1] || entry.repository.repoUrl
    }
    const pathParts = entry.repository.displayPath.split('/')
    return pathParts[pathParts.length - 1] || entry.repository.displayPath
  }

  private renderList() {
    const children = this.list.getChildren()
    children.forEach((c) => this.list.remove(c.id))

    this.title.content = t`${fg(this.colors.primary)(bold("↺ History"))}  ${fg(this.colors.textMuted)("Past code reviews")}`

    if (this.entries.length === 0) {
      const emptyMsg = new TextRenderable(this.renderer, {
        id: "hist-empty",
        content: t`  ${fg(this.colors.textMuted)("No reviews yet. Run a review to see it here.")}`
      })
      this.list.add(emptyMsg)
      this.hint.content = t`${fg(this.colors.primary)("esc")} ${fg(this.colors.textMuted)("close")}`
      return
    }

    const start = this.listPage * this.ENTRIES_PER_PAGE
    const end = Math.min(start + this.ENTRIES_PER_PAGE, this.entries.length)
    const pageEntries = this.entries.slice(start, end)
    const totalPages = Math.ceil(this.entries.length / this.ENTRIES_PER_PAGE)

    pageEntries.forEach((entry, i) => {
      const actualIndex = start + i
      const isSelected = actualIndex === this.selectedEntryIndex
      const icon = REVIEW_TYPE_ICONS[entry.reviewType] || '●'
      const total = entry.results.critical + entry.results.major + entry.results.minor + entry.results.info
      const relTime = this.formatRelativeTime(entry.timestamp)

      const row = new BoxRenderable(this.renderer, {
        id: `hist-row-${actualIndex}`,
        width: "100%",
        flexDirection: "row",
        paddingLeft: 1,
        paddingRight: 1,
        backgroundColor: isSelected ? this.colors.bgHover : "transparent",
      })

      // Use summary if available, otherwise fall back to repo name
      const summaryText = entry.summary || this.getRepoName(entry)
      const summaryDisplay = summaryText.slice(0, 35).padEnd(35)

      // Build count summary
      const c = entry.results.critical
      const m = entry.results.major
      const n = entry.results.minor
      const inf = entry.results.info

      let content: TextRenderable
      if (total === 0) {
        content = new TextRenderable(this.renderer, {
          id: `hist-content-${actualIndex}`,
          content: t`${fg(isSelected ? this.colors.primary : this.colors.textDim)(icon)} ${fg(isSelected ? this.colors.text : this.colors.textSecondary)(summaryDisplay)} ${fg(this.colors.success)("ok")}  ${fg(this.colors.textDim)(relTime.padStart(8))}`
        })
      } else {
        // Show counts inline
        const countParts: string[] = []
        if (c > 0) countParts.push(`${c}c`)
        if (m > 0) countParts.push(`${m}m`)
        if (n > 0) countParts.push(`${n}n`)
        if (inf > 0) countParts.push(`${inf}i`)
        const countStr = countParts.join(' ').padEnd(10)

        content = new TextRenderable(this.renderer, {
          id: `hist-content-${actualIndex}`,
          content: t`${fg(isSelected ? this.colors.primary : this.colors.textDim)(icon)} ${fg(isSelected ? this.colors.text : this.colors.textSecondary)(summaryDisplay)} ${fg(c > 0 ? SEVERITY_CONFIG.critical.color : this.colors.warning)(countStr)}  ${fg(this.colors.textDim)(relTime.padStart(8))}`
        })
      }
      row.add(content)
      this.list.add(row)
    })

    if (totalPages > 1) {
      const pageSpacer = new BoxRenderable(this.renderer, { id: "hist-page-sp", height: 1 })
      this.list.add(pageSpacer)
      const pagination = new TextRenderable(this.renderer, {
        id: "hist-pagination",
        content: t`  ${fg(this.colors.textDim)("Page")} ${fg(this.colors.primary)((this.listPage + 1).toString())} ${fg(this.colors.textDim)("of")} ${fg(this.colors.textDim)(totalPages.toString())}  ${fg(this.colors.textMuted)(`(${this.entries.length} reviews)`)}`
      })
      this.list.add(pagination)
    }

    this.hint.content = t`${fg(this.colors.primary)("↑↓")} ${fg(this.colors.textMuted)("navigate")}  ${fg(this.colors.primary)("↵")} ${fg(this.colors.textMuted)("view")}  ${fg(this.colors.primary)("esc")} ${fg(this.colors.textMuted)("close")}`
  }

  private renderDetail() {
    if (!this.currentEntry) return

    const children = this.list.getChildren()
    children.forEach((c) => this.list.remove(c.id))

    const icon = REVIEW_TYPE_ICONS[this.currentEntry.reviewType] || '●'
    const typeLabel = this.getReviewTypeLabel(this.currentEntry.reviewType)
    this.title.content = t`${fg(this.colors.primary)(bold(icon + " " + typeLabel + " Review"))}  ${fg(this.colors.textMuted)(this.getRepoName(this.currentEntry))}`

    // Repository info
    this.addCenteredLine(
      "detail-repo",
      t`${fg(this.colors.textDim)("Path:")} ${fg(this.colors.text)(this.currentEntry.repository.displayPath)}`
    )

    if (this.currentEntry.repository.branch) {
      this.addCenteredLine(
        "detail-branch",
        t`${fg(this.colors.textDim)("Branch:")} ${fg(this.colors.primary)(this.currentEntry.repository.branch)}`
      )
    }

    // Commit info if available
    if (this.currentEntry.commitInfo) {
      this.addCenteredLine(
        "detail-commit",
        t`${fg(this.colors.textDim)("Commit:")} ${fg(this.colors.warning)(this.currentEntry.commitInfo.shortHash)} ${fg(this.colors.text)(this.currentEntry.commitInfo.message.slice(0, 30))}`
      )
    }

    const spacer1 = new BoxRenderable(this.renderer, { id: "detail-sp1", height: 1 })
    this.list.add(spacer1)

    // Severity breakdown (like review results)
    this.severityOrder.forEach((severity, i) => {
      const config = SEVERITY_CONFIG[severity]
      const count = this.currentEntry!.results[severity]
      const isSelected = i === this.selectedSeverityIndex

      const row = new BoxRenderable(this.renderer, {
        id: `hist-sev-row-${i}`,
        width: "100%",
        flexDirection: "row",
        paddingLeft: 2,
        paddingRight: 2,
        backgroundColor: isSelected ? this.colors.bgHover : "transparent",
      })

      const descriptions: Record<Bug['severity'], string> = {
        critical: 'Security vulnerabilities',
        major: 'Logic issues, bugs',
        minor: 'Style, refactoring',
        info: 'Tips, optimizations',
      }

      const symbolPart = config.symbol
      const labelPart = config.label.padEnd(10)
      const countPart = count.toString().padStart(4)
      const descPart = descriptions[severity].padEnd(24)

      const content = new TextRenderable(this.renderer, {
        id: `hist-sev-content-${i}`,
        content: t`  ${fg(isSelected ? config.color : this.colors.textDim)(symbolPart)}   ${fg(isSelected ? config.color : this.colors.text)(labelPart)}${fg(this.colors.text)(countPart)}    ${fg(this.colors.textMuted)(descPart)}`
      })
      row.add(content)
      this.list.add(row)
    })

    const spacer2 = new BoxRenderable(this.renderer, { id: "detail-sp2", height: 1 })
    this.list.add(spacer2)

    // Stats
    const total = this.currentEntry.results.critical + this.currentEntry.results.major + this.currentEntry.results.minor + this.currentEntry.results.info
    const timeSeconds = (this.currentEntry.results.timeMs / 1000).toFixed(1)

    this.addCenteredLine("detail-stats-divider", t`${fg(this.colors.border)("─".repeat(60))}`)
    this.addCenteredLine(
      "detail-stats",
      t`${fg(this.colors.textMuted)("Total")} ${fg(this.colors.text)(total.toString().padStart(3))}   ${fg(this.colors.textDim)("│")}   ${fg(this.colors.textMuted)("Files")} ${fg(this.colors.text)(this.currentEntry.results.filesScanned.toString().padStart(3))}   ${fg(this.colors.textDim)("│")}   ${fg(this.colors.textMuted)("Time")} ${fg(this.colors.text)(timeSeconds + "s")}`
    )

    this.hint.content = t`${fg(this.colors.primary)("↑↓")} ${fg(this.colors.textMuted)("navigate")}  ${fg(this.colors.primary)("↵")} ${fg(this.colors.textMuted)("view bugs")}  ${fg(this.colors.primary)("c")} ${fg(this.colors.textMuted)("copy all")}  ${fg(this.colors.primary)("esc")} ${fg(this.colors.textMuted)("back")}`
  }

  public copyCurrentReview(): string | null {
    if (!this.currentEntry) return null

    const entry = this.currentEntry
    const total = entry.results.critical + entry.results.major + entry.results.minor + entry.results.info

    const lines: string[] = [
      `Code Review - ${this.getReviewTypeLabel(entry.reviewType)}`,
      `Repository: ${entry.repository.displayPath}`,
      `Branch: ${entry.repository.branch || 'unknown'}`,
      `Date: ${new Date(entry.timestamp).toLocaleString()}`,
      `Model: ${entry.model || 'unknown'}`,
      ``,
      `Summary:`,
      `  Critical: ${entry.results.critical}`,
      `  Major: ${entry.results.major}`,
      `  Minor: ${entry.results.minor}`,
      `  Info: ${entry.results.info}`,
      `  Total: ${total}`,
      `  Files Scanned: ${entry.results.filesScanned}`,
      ``,
    ]

    if (entry.commitInfo) {
      lines.push(
        `Commit: ${entry.commitInfo.shortHash}`,
        `Message: ${entry.commitInfo.message}`,
        `Author: ${entry.commitInfo.author}`,
        ``
      )
    }

    if (entry.results.bugs.length > 0) {
      lines.push(`Issues (${entry.results.bugs.length}):`, ``)
      entry.results.bugs.forEach((bug, i) => {
        const config = SEVERITY_CONFIG[bug.severity]
        lines.push(
          `#${i + 1} [${config.label}] ${bug.title}`,
          `  File: ${bug.file}`,
          `  Lines: ${bug.startLine} → ${bug.endLine}`,
          `  Description: ${bug.description}`,
          `  Suggestion: ${bug.suggestion}`,
          ``
        )
      })
    } else {
      lines.push(`No issues found.`)
    }

    return lines.join('\n')
  }

  public getCurrentView(): HistoryView {
    return this.view
  }

  public getCurrentEntry(): HistoryEntry | null {
    return this.currentEntry
  }

  public showCopyToast(success: boolean) {
    if (this.copyToastTimeout) {
      clearTimeout(this.copyToastTimeout)
      this.copyToastTimeout = null
    }

    this.hint.content = success
      ? t`${fg(this.colors.success)("⧉ Copied to clipboard")}`
      : t`${fg(this.colors.error)("⧉ Copy failed (no clipboard tool found)")}`

    this.copyToastTimeout = setTimeout(() => {
      this.copyToastTimeout = null
      // Restore original hint based on current view
      if (this.view === 'list') {
        this.hint.content = t`${fg(this.colors.primary)("↑↓")} ${fg(this.colors.textMuted)("navigate")}  ${fg(this.colors.primary)("↵")} ${fg(this.colors.textMuted)("view")}  ${fg(this.colors.primary)("esc")} ${fg(this.colors.textMuted)("close")}`
      } else if (this.view === 'detail') {
        this.hint.content = t`${fg(this.colors.primary)("↑↓")} ${fg(this.colors.textMuted)("navigate")}  ${fg(this.colors.primary)("↵")} ${fg(this.colors.textMuted)("view bugs")}  ${fg(this.colors.primary)("c")} ${fg(this.colors.textMuted)("copy all")}  ${fg(this.colors.primary)("esc")} ${fg(this.colors.textMuted)("back")}`
      } else if (this.view === 'bugList') {
        this.hint.content = t`${fg(this.colors.primary)("↑↓")} ${fg(this.colors.textMuted)("navigate")}  ${fg(this.colors.primary)("↵")} ${fg(this.colors.textMuted)("details")}  ${fg(this.colors.primary)("esc")} ${fg(this.colors.textMuted)("back")}`
      } else if (this.view === 'bugDetail') {
        this.hint.content = t`${fg(this.colors.primary)("esc")} ${fg(this.colors.textMuted)("back to list")}`
      }
    }, 1200)
  }

  private renderBugList() {
    if (!this.currentEntry) return

    const children = this.list.getChildren()
    children.forEach((c) => this.list.remove(c.id))

    const severity = this.severityOrder[this.selectedSeverityIndex]
    const config = SEVERITY_CONFIG[severity]

    this.title.content = t`${fg(config.color)(config.symbol)} ${fg(config.color)(bold(config.label))} ${fg(this.colors.textMuted)("issues")} ${fg(this.colors.textDim)("(" + this.filteredBugs.length + ")")}`

    if (this.filteredBugs.length === 0) {
      const noIssues = new TextRenderable(this.renderer, {
        id: "hist-no-issues",
        content: t`  ${fg(this.colors.textMuted)("No issues in this category")}`
      })
      this.list.add(noIssues)
    } else {
      this.filteredBugs.slice(0, 8).forEach((bug, i) => {
        const isSelected = i === this.selectedBugIndex

        const row = new BoxRenderable(this.renderer, {
          id: `hist-bug-row-${i}`,
          width: "100%",
          flexDirection: "row",
          paddingLeft: 1,
          paddingRight: 1,
          backgroundColor: isSelected ? this.colors.bgHover : "transparent",
        })

        const lineRange = `L${bug.startLine}-${bug.endLine}`
        const bugContent = new TextRenderable(this.renderer, {
          id: `hist-bug-content-${i}`,
          content: t`${fg(isSelected ? this.colors.primary : this.colors.textDim)("›")} ${fg(isSelected ? this.colors.text : this.colors.textSecondary)(bug.title.slice(0, 35).padEnd(35))} ${fg(this.colors.textMuted)(lineRange.padStart(12))}`
        })
        row.add(bugContent)
        this.list.add(row)
      })
    }

    this.hint.content = t`${fg(this.colors.primary)("↑↓")} ${fg(this.colors.textMuted)("navigate")}  ${fg(this.colors.primary)("↵")} ${fg(this.colors.textMuted)("details")}  ${fg(this.colors.primary)("esc")} ${fg(this.colors.textMuted)("back")}`
  }

  private renderBugDetail() {
    if (!this.selectedBug) return

    const children = this.list.getChildren()
    children.forEach((c) => this.list.remove(c.id))

    const config = SEVERITY_CONFIG[this.selectedBug.severity]

    // Title with severity
    const titleRow = new TextRenderable(this.renderer, {
      id: "hist-detail-title",
      content: t`${fg(config.color)(config.symbol)} ${fg(config.color)(bold(this.selectedBug.title))}`
    })
    this.list.add(titleRow)

    const spacer1 = new BoxRenderable(this.renderer, { id: "hist-det-sp1", height: 1 })
    this.list.add(spacer1)

    // File and location
    const locationRow = new TextRenderable(this.renderer, {
      id: "hist-detail-location",
      content: t`${fg(this.colors.textDim)("File:")}  ${fg(this.colors.text)(this.selectedBug.file)}`
    })
    this.list.add(locationRow)

    const lineRow = new TextRenderable(this.renderer, {
      id: "hist-detail-lines",
      content: t`${fg(this.colors.textDim)("Lines:")} ${fg(this.colors.primary)(this.selectedBug.startLine.toString())} ${fg(this.colors.textDim)("→")} ${fg(this.colors.primary)(this.selectedBug.endLine.toString())}`
    })
    this.list.add(lineRow)

    const spacer2 = new BoxRenderable(this.renderer, { id: "hist-det-sp2", height: 1 })
    this.list.add(spacer2)

    // Description
    const descLabel = new TextRenderable(this.renderer, {
      id: "hist-detail-desc-label",
      content: t`${fg(this.colors.textMuted)("Description")}`
    })
    this.list.add(descLabel)

    // Wrap description to multiple lines if needed
    const desc = this.selectedBug.description
    const descLines = this.wrapText(desc, 60)
    descLines.forEach((line, i) => {
      const descText = new TextRenderable(this.renderer, {
        id: `hist-detail-desc-${i}`,
        content: t`${fg(this.colors.textSecondary)(line)}`
      })
      this.list.add(descText)
    })

    const spacer3 = new BoxRenderable(this.renderer, { id: "hist-det-sp3", height: 1 })
    this.list.add(spacer3)

    // Suggestion
    const suggLabel = new TextRenderable(this.renderer, {
      id: "hist-detail-sugg-label",
      content: t`${fg(this.colors.success)("▸")} ${fg(this.colors.textMuted)("Suggestion")}`
    })
    this.list.add(suggLabel)

    const sugg = this.selectedBug.suggestion
    const suggLines = this.wrapText(sugg, 60)
    suggLines.forEach((line, i) => {
      const suggText = new TextRenderable(this.renderer, {
        id: `hist-detail-sugg-${i}`,
        content: t`${fg(this.colors.textSecondary)(line)}`
      })
      this.list.add(suggText)
    })

    this.hint.content = t`${fg(this.colors.primary)("esc")} ${fg(this.colors.textMuted)("back to list")}`
  }

  private wrapText(text: string, maxWidth: number): string[] {
    const words = text.split(' ')
    const lines: string[] = []
    let currentLine = ''

    for (const word of words) {
      if (currentLine.length + word.length + 1 <= maxWidth) {
        currentLine += (currentLine ? ' ' : '') + word
      } else {
        if (currentLine) lines.push(currentLine)
        currentLine = word
      }
    }
    if (currentLine) lines.push(currentLine)

    return lines.slice(0, 3) // Max 3 lines
  }
}
