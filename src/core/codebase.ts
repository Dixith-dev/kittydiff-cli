/**
 * Codebase Utilities for KittyDiff
 * Provides filesystem/git helpers for full-repository reviews.
 */

import { spawn } from "child_process"
import * as fs from "fs"
import * as path from "path"

export interface CodebaseFileInfo {
  path: string
  bytes: number
}

export interface CodebaseIndex {
  paths: string[]
  files: CodebaseFileInfo[]
  fileTree: string
  entryPoints: string[]
}

export interface BuildCodebaseIndexOptions {
  includeUntracked?: boolean
  maxFiles?: number
  tree?: {
    maxDepth?: number
    maxEntriesPerDir?: number
  }
}

const DEFAULT_IGNORE_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  ".git",
  ".next",
  "coverage",
  ".cache",
  ".turbo",
  ".idea",
  ".vscode",
])

const DEFAULT_IGNORE_FILES = new Set([
  "package-lock.json",
  "bun.lockb",
  "pnpm-lock.yaml",
  "yarn.lock",
])

const DEFAULT_IGNORE_SUFFIXES = [
  ".lock",
]

async function mapLimit<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let nextIndex = 0

  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (true) {
      const i = nextIndex++
      if (i >= items.length) return
      results[i] = await mapper(items[i]!, i)
    }
  })

  await Promise.all(workers)
  return results
}

function toPosixPath(p: string): string {
  return p.split(path.sep).join("/")
}

function isIgnoredPath(relPath: string): boolean {
  const posix = relPath.replace(/\\/g, "/")
  const parts = posix.split("/").filter(Boolean)
  for (const part of parts) {
    if (DEFAULT_IGNORE_DIRS.has(part)) return true
  }
  const base = parts[parts.length - 1] || posix
  if (DEFAULT_IGNORE_FILES.has(base)) return true
  for (const suf of DEFAULT_IGNORE_SUFFIXES) {
    if (base.endsWith(suf)) return true
  }
  return false
}

function execGit(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn("git", args, { cwd: process.cwd() })
    let stdout = ""
    let stderr = ""
    proc.stdout.on("data", (d) => { stdout += d.toString() })
    proc.stderr.on("data", (d) => { stderr += d.toString() })
    proc.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }))
    proc.on("error", () => resolve({ code: 1, stdout: "", stderr: "failed to run git" }))
  })
}

async function isGitRepo(): Promise<boolean> {
  const res = await execGit(["rev-parse", "--is-inside-work-tree"])
  return res.code === 0 && res.stdout.trim() === "true"
}

async function listFilesViaGit(includeUntracked: boolean): Promise<string[]> {
  const tracked = await execGit(["ls-files", "-z"])
  const trackedFiles = tracked.code === 0
    ? tracked.stdout.split("\0").filter(Boolean)
    : []

  let untrackedFiles: string[] = []
  if (includeUntracked) {
    const untracked = await execGit(["ls-files", "-z", "--others", "--exclude-standard"])
    untrackedFiles = untracked.code === 0
      ? untracked.stdout.split("\0").filter(Boolean)
      : []
  }

  return [...trackedFiles, ...untrackedFiles]
    .map((p) => p.replace(/\\/g, "/"))
    .filter((p) => p && !isIgnoredPath(p))
}

async function listFilesViaFs(root: string): Promise<string[]> {
  const results: string[] = []

  const walk = async (dir: string) => {
    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const abs = path.join(dir, entry.name)
      const rel = toPosixPath(path.relative(root, abs))
      if (!rel || rel.startsWith("../")) continue
      if (isIgnoredPath(rel)) continue
      if (entry.isDirectory()) {
        await walk(abs)
      } else if (entry.isFile()) {
        results.push(rel)
      }
    }
  }

  await walk(root)
  return results
}

export async function buildCodebaseIndex(options: BuildCodebaseIndexOptions = {}): Promise<CodebaseIndex> {
  const {
    includeUntracked = true,
    maxFiles,
    tree = {},
  } = options

  const root = process.cwd()
  const paths = (await isGitRepo())
    ? await listFilesViaGit(includeUntracked)
    : await listFilesViaFs(root)

  const pathsForStats = typeof maxFiles === "number" && maxFiles > 0
    ? paths.slice(0, maxFiles)
    : paths

  const STAT_CONCURRENCY = 16
  const statResults = await mapLimit(pathsForStats, STAT_CONCURRENCY, async (relPath) => {
    try {
      const st = await fs.promises.stat(path.join(root, relPath))
      if (!st.isFile()) return null
      return { path: relPath, bytes: st.size } satisfies CodebaseFileInfo
    } catch {
      return null
    }
  })

  const files = statResults.filter((x): x is CodebaseFileInfo => !!x)

  const fileTree = renderFileTree(paths, {
    maxDepth: tree.maxDepth ?? 4,
    maxEntriesPerDir: tree.maxEntriesPerDir ?? 40,
  })

  const entryPoints = detectEntryPoints(paths)

  return { paths, files, fileTree, entryPoints }
}

export function detectEntryPoints(filePaths: string[]): string[] {
  const set = new Set(filePaths.map((p) => p.replace(/\\/g, "/")))
  const out: string[] = []

  const addIfExists = (p: string) => { if (set.has(p)) out.push(p) }

  // Common entry points
  addIfExists("src/index.ts")
  addIfExists("src/index.js")
  addIfExists("src/main.ts")
  addIfExists("src/main.js")
  addIfExists("index.ts")
  addIfExists("index.js")
  addIfExists("main.ts")
  addIfExists("main.js")
  addIfExists("app.ts")
  addIfExists("app.js")

  // Prefer package.json-defined entry points when available
  if (set.has("package.json")) {
    try {
      const raw = fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")
      const pkg = JSON.parse(raw) as Record<string, unknown>
      const main = typeof pkg.main === "string" ? pkg.main : undefined
      const module = typeof pkg.module === "string" ? pkg.module : undefined
      const bin = pkg.bin

      const maybeAdd = (val: unknown) => {
        if (typeof val !== "string") return
        const normalized = val.replace(/^\.\//, "").replace(/\\/g, "/")
        if (set.has(normalized)) out.unshift(normalized)
      }

      maybeAdd(module)
      maybeAdd(main)
      if (typeof bin === "string") maybeAdd(bin)
      if (bin && typeof bin === "object") {
        for (const v of Object.values(bin as Record<string, unknown>)) maybeAdd(v)
      }
    } catch {
      // Ignore parse errors
    }
  }

  // Deduplicate while preserving order
  const seen = new Set<string>()
  return out.filter((p) => {
    if (seen.has(p)) return false
    seen.add(p)
    return true
  })
}

interface TreeNode {
  dirs: Map<string, TreeNode>
  files: string[]
}

export function renderFileTree(
  filePaths: string[],
  opts: { maxDepth: number; maxEntriesPerDir: number }
): string {
  const root: TreeNode = { dirs: new Map(), files: [] }

  for (const raw of filePaths) {
    const relPath = raw.replace(/\\/g, "/")
    if (!relPath || isIgnoredPath(relPath)) continue
    const parts = relPath.split("/").filter(Boolean)
    if (parts.length === 0) continue

    let node = root
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!
      const isLast = i === parts.length - 1
      if (isLast) {
        node.files.push(part)
      } else {
        if (!node.dirs.has(part)) node.dirs.set(part, { dirs: new Map(), files: [] })
        node = node.dirs.get(part)!
      }
    }
  }

  const lines: string[] = ["."]

  const renderNode = (node: TreeNode, prefix: string, depth: number) => {
    const dirNames = Array.from(node.dirs.keys()).sort()
    const fileNames = node.files.slice().sort()

    const entries: Array<{ kind: "dir" | "file"; name: string }> = [
      ...dirNames.map((name) => ({ kind: "dir" as const, name })),
      ...fileNames.map((name) => ({ kind: "file" as const, name })),
    ]

    const max = Math.max(0, opts.maxEntriesPerDir)
    const shown = entries.slice(0, max)
    const remaining = entries.length - shown.length

    shown.forEach((entry, index) => {
      const isLast = index === shown.length - 1 && remaining <= 0
      const branch = isLast ? "└─ " : "├─ "
      if (entry.kind === "dir") {
        lines.push(`${prefix}${branch}${entry.name}/`)
        if (depth + 1 < opts.maxDepth) {
          const nextPrefix = `${prefix}${isLast ? "   " : "│  "}`
          renderNode(node.dirs.get(entry.name)!, nextPrefix, depth + 1)
        } else {
          const nextPrefix = `${prefix}${isLast ? "   " : "│  "}`
          const child = node.dirs.get(entry.name)!
          const count = countFiles(child)
          if (count > 0) lines.push(`${nextPrefix}└─ … (${count} files)`)
        }
      } else {
        lines.push(`${prefix}${branch}${entry.name}`)
      }
    })

    if (remaining > 0) {
      lines.push(`${prefix}└─ … (${remaining} more)`)
    }
  }

  renderNode(root, "", 0)
  return lines.join("\n")
}

function countFiles(node: TreeNode): number {
  let count = node.files.length
  for (const child of node.dirs.values()) count += countFiles(child)
  return count
}
