/**
 * History Manager for KittyDiff
 * Handles saving and loading review history data
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { ReviewType } from './git';
import type { Bug } from '../backend/ai-reviewer';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface HistoryEntry {
  id: string
  timestamp: number
  reviewType: ReviewType
  summary: string  // Short description like "Fixed auth bug" or "3 issues in config.ts"
  repository: {
    path: string
    displayPath: string
    repoUrl: string | null
    branch: string
  }
  commitInfo?: {
    hash: string
    shortHash: string
    author: string
    date: string
    message: string
  }
  results: {
    critical: number
    major: number
    minor: number
    info: number
    filesScanned: number
    linesAnalyzed: number
    timeMs: number
    bugs: Bug[]
  }
  model: string
}

interface HistoryData {
  version: number
  entries: HistoryEntry[]
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

const MAX_ENTRIES = 100
const HISTORY_VERSION = 1

// ═══════════════════════════════════════════════════════════════════════════════
// HISTORY MANAGER CLASS
// ═══════════════════════════════════════════════════════════════════════════════

export class HistoryManager {
  private historyPath: string
  private data: HistoryData

  constructor() {
    const homeDir = os.homedir()
    const configDir = path.join(homeDir, '.kittydiff')

    // Ensure config directory exists
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true })
    }

    this.historyPath = path.join(configDir, 'history.json')
    this.data = this.load()
  }

  private load(): HistoryData {
    try {
      if (fs.existsSync(this.historyPath)) {
        const raw = fs.readFileSync(this.historyPath, 'utf8')
        const parsed = JSON.parse(raw)

        // Handle different formats:
        // 1. New format: { version, entries: [...] }
        // 2. Old format: plain array [...]
        let entries: HistoryEntry[] = []

        if (Array.isArray(parsed)) {
          // Old format - the file is just an array of entries
          entries = parsed
        } else if (Array.isArray(parsed?.entries)) {
          // New format with entries property
          entries = parsed.entries
        }

        return {
          version: HISTORY_VERSION,
          entries
        }
      }
    } catch {
      // Silently fail - will use default empty history
    }

    // Default empty history
    return {
      version: HISTORY_VERSION,
      entries: []
    }
  }

  private save(): void {
    try {
      fs.writeFileSync(this.historyPath, JSON.stringify(this.data, null, 2))
    } catch (error) {
      console.error('Failed to save history:', error)
    }
  }

  private generateId(): string {
    const timestamp = Date.now().toString(36)
    const random = Math.random().toString(36).substring(2, 8)
    return `${timestamp}-${random}`
  }

  public addEntry(entry: Omit<HistoryEntry, 'id'>): HistoryEntry {
    const newEntry: HistoryEntry = {
      ...entry,
      id: this.generateId()
    }

    // Ensure entries array exists
    if (!Array.isArray(this.data.entries)) {
      this.data.entries = []
    }

    // Add to beginning of array
    this.data.entries.unshift(newEntry)

    // Trim to MAX_ENTRIES
    if (this.data.entries.length > MAX_ENTRIES) {
      this.data.entries = this.data.entries.slice(0, MAX_ENTRIES)
    }

    this.save()
    return newEntry
  }

  public getEntries(): HistoryEntry[] {
    return this.data.entries
  }

  public getEntry(id: string): HistoryEntry | undefined {
    return this.data.entries.find(e => e.id === id)
  }

  public deleteEntry(id: string): boolean {
    const index = this.data.entries.findIndex(e => e.id === id)
    if (index >= 0) {
      this.data.entries.splice(index, 1)
      this.save()
      return true
    }
    return false
  }

  public clearHistory(): void {
    this.data.entries = []
    this.save()
  }

  public getHistoryPath(): string {
    return this.historyPath
  }
}

