/**
 * Git Utilities for KittyDiff
 * Provides git operations needed for code review functionality
 */

import { exec } from "child_process"
import { promisify } from "util"

const execAsync = promisify(exec)

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface GitRepositoryInfo {
  repoUrl: string
  branch: string
  filesChanged: number
  insertions: number
  deletions: number
}

export interface GitDiffStats {
  filesChanged: number
  insertions: number
  deletions: number
  files: Array<{
    path: string
    insertions: number
    deletions: number
  }>
}

export interface GitFileChange {
  path: string
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied'
  insertions: number
  deletions: number
  diff?: string
}

export interface GitCommit {
  hash: string
  shortHash: string
  author: string
  date: string
  message: string
  filesChanged: number
  insertions: number
  deletions: number
}

export interface GitBranch {
  name: string
  isCurrent: boolean
  isRemote: boolean
}

// ═══════════════════════════════════════════════════════════════════════════════
// REPOSITORY INFORMATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Check if current directory is a git repository
 */
export async function isGitRepository(): Promise<boolean> {
  try {
    await execAsync("git rev-parse --git-dir")
    return true
  } catch {
    return false
  }
}

/**
 * Get basic repository information
 */
export async function getRepositoryInfo(): Promise<GitRepositoryInfo> {
  try {
    let repoUrl = ""
    let branch = "main"
    let filesChanged = 0
    let insertions = 0
    let deletions = 0

    try {
      const remoteResult = await execAsync("git remote get-url origin")
      repoUrl = remoteResult.stdout.trim()
      // Normalize repo URL format
      repoUrl = repoUrl
        .replace(/^https:\/\/(github\.com|gitlab\.com|bitbucket\.org)\//, "")
        .replace(/^git@(github\.com|gitlab\.com|bitbucket\.org):/, "")
        .replace(/\.git$/, "")
        .replace(/:/g, "/")
    } catch {
      // No remote configured
    }

    try {
      const branchResult = await execAsync("git branch --show-current")
      branch = branchResult.stdout.trim() || "main"
    } catch {
      // Default to main
    }

    try {
      // Use numstat so we can reliably sum insertions/deletions
      const diffResult = await execAsync("git diff --numstat HEAD")
      const stats = parseDiffStats(diffResult.stdout)
      filesChanged = stats.filesChanged
      insertions = stats.insertions
      deletions = stats.deletions
    } catch {
      // No diff available
    }

    return { repoUrl, branch, filesChanged, insertions, deletions }
  } catch {
    return { repoUrl: "", branch: "main", filesChanged: 0, insertions: 0, deletions: 0 }
  }
}

/**
 * Get current branch name
 */
export async function getCurrentBranch(): Promise<string> {
  try {
    const result = await execAsync("git branch --show-current")
    return result.stdout.trim() || "main"
  } catch {
    return "main"
  }
}

/**
 * Get remote repository URL
 */
export async function getRemoteUrl(remote: string = "origin"): Promise<string | null> {
  try {
    const result = await execAsync(`git remote get-url ${remote}`)
    return result.stdout.trim()
  } catch {
    return null
  }
}

/**
 * Get all local branch names, sorted with current branch first
 */
export async function getLocalBranches(): Promise<GitBranch[]> {
  try {
    const result = await execAsync("git branch --format='%(refname:short)%09%(HEAD)'")
    const lines = result.stdout.trim().split("\n").filter(Boolean)
    const branches: GitBranch[] = []

    for (const line of lines) {
      const cleaned = line.replace(/^'|'$/g, "")
      const [name, head] = cleaned.split("\t")
      if (!name) continue
      branches.push({
        name: name.trim(),
        isCurrent: head?.trim() === "*",
        isRemote: false,
      })
    }

    // Sort: current branch first, then alphabetical
    branches.sort((a, b) => {
      if (a.isCurrent && !b.isCurrent) return -1
      if (!a.isCurrent && b.isCurrent) return 1
      return a.name.localeCompare(b.name)
    })

    return branches
  } catch {
    return []
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// DIFF OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get uncommitted changes (working directory vs HEAD)
 */
export async function getUncommittedChanges(): Promise<GitFileChange[]> {
  try {
    const result = await execAsync("git diff --name-status HEAD")
    const lines = result.stdout.trim().split("\n").filter(Boolean)

    const changes: GitFileChange[] = []

    for (const line of lines) {
      const match = line.match(/^([AMD])\s+(.+)$/)
      if (match) {
        const [, status, path] = match
        const fileStatus = status === 'A' ? 'added' : status === 'M' ? 'modified' : 'deleted'

        // Get stats for this file
        const statsResult = await execAsync(`git diff --numstat HEAD -- "${path}"`)
        const stats = parseFileStats(statsResult.stdout)

        changes.push({
          path,
          status: fileStatus,
          insertions: stats.insertions,
          deletions: stats.deletions,
        })
      }
    }

    return changes
  } catch {
    return []
  }
}

/**
 * Get diff between current branch and another branch (default: main)
 */
export async function getBranchDiff(baseBranch: string = "main"): Promise<GitFileChange[]> {
  try {
    const currentBranch = await getCurrentBranch()
    if (currentBranch === baseBranch) {
      return []
    }

    const result = await execAsync(`git diff --name-status ${baseBranch}...${currentBranch}`)
    const lines = result.stdout.trim().split("\n").filter(Boolean)

    const changes: GitFileChange[] = []

    for (const line of lines) {
      const match = line.match(/^([AMD])\s+(.+)$/)
      if (match) {
        const [, status, path] = match
        const fileStatus = status === 'A' ? 'added' : status === 'M' ? 'modified' : 'deleted'

        // Get stats for this file
        const statsResult = await execAsync(`git diff --numstat ${baseBranch}...${currentBranch} -- "${path}"`)
        const stats = parseFileStats(statsResult.stdout)

        changes.push({
          path,
          status: fileStatus,
          insertions: stats.insertions,
          deletions: stats.deletions,
        })
      }
    }

    return changes
  } catch {
    return []
  }
}

/**
 * Get diff for a specific commit
 */
export async function getCommitDiff(commitHash: string): Promise<GitFileChange[]> {
  try {
    // Get parent commit
    const parentResult = await execAsync(`git rev-parse ${commitHash}^`)
    const parentHash = parentResult.stdout.trim()

    const result = await execAsync(`git diff --name-status ${parentHash} ${commitHash}`)
    const lines = result.stdout.trim().split("\n").filter(Boolean)

    const changes: GitFileChange[] = []

    for (const line of lines) {
      const match = line.match(/^([AMD])\s+(.+)$/)
      if (match) {
        const [, status, path] = match
        const fileStatus = status === 'A' ? 'added' : status === 'M' ? 'modified' : 'deleted'

        // Get stats for this file
        const statsResult = await execAsync(`git diff --numstat ${parentHash} ${commitHash} -- "${path}"`)
        const stats = parseFileStats(statsResult.stdout)

        changes.push({
          path,
          status: fileStatus,
          insertions: stats.insertions,
          deletions: stats.deletions,
        })
      }
    }

    return changes
  } catch {
    return []
  }
}

/**
 * Get diff for the entire repository against main (or default branch)
 */
export async function getAllChanges(): Promise<GitFileChange[]> {
  try {
    const baseBranch = "main"
    return await getBranchDiff(baseBranch)
  } catch {
    return []
  }
}

/**
 * Get full unified diff content for a review type.
 */
export async function getFullDiff(reviewType: string, commitHash?: string, baseBranch?: string): Promise<{
  diff: string
  files: GitFileChange[]
  commitInfo?: GitCommit
}> {
  if (reviewType === "review-uncommitted") {
    const files = await getUncommittedChanges()
    const diff = (await execAsync("git diff HEAD")).stdout
    return { diff, files }
  }

  if (reviewType === "review-branch") {
    const base = baseBranch || "main"
    const files = await getBranchDiff(base)
    const diff = (await execAsync(`git diff ${base}...HEAD`)).stdout
    return { diff, files }
  }

  if (reviewType === "review-commit") {
    if (!commitHash) return { diff: "", files: [] }
    const files = await getCommitDiff(commitHash)
    const diff = (await execAsync(`git show ${commitHash} --pretty=format:`)).stdout
    return { diff, files, commitInfo: await getCommit(commitHash) }
  }

  if (reviewType === "review-all") {
    const files = await getAllChanges()
    const diff = (await execAsync("git diff main...HEAD")).stdout
    return { diff, files }
  }

  return { diff: "", files: [] }
}

export type ReviewType =
  | "review-uncommitted"
  | "review-branch"
  | "review-commit"
  | "review-all"

export async function getCommit(hash: string): Promise<GitCommit> {
  const pretty = (await execAsync(`git show -s --format=%H%n%h%n%an%n%ad%n%s ${hash}`)).stdout.trim().split("\n")
  const [fullHash, shortHash, author, date, message] = pretty

  const numstat = (await execAsync(`git show --numstat --format= ${hash}`)).stdout
  const stats = parseDiffStats(numstat)

  return {
    hash: fullHash,
    shortHash,
    author,
    date,
    message,
    filesChanged: stats.filesChanged,
    insertions: stats.insertions,
    deletions: stats.deletions,
  }
}

export async function getRecentCommits(limit = 50): Promise<GitCommit[]> {
  try {
    const log = (await execAsync(`git log -n ${limit} --pretty=format:%H%x09%h%x09%an%x09%ad%x09%s`)).stdout.trim()
    if (!log) return []
    const lines = log.split("\n")
    const commits: GitCommit[] = []

    for (const line of lines) {
      const [hash, shortHash, author, date, message] = line.split("\t")
      commits.push({
        hash,
        shortHash,
        author,
        date,
        message,
        filesChanged: 0,
        insertions: 0,
        deletions: 0,
      })
    }

    return commits
  } catch {
    return []
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PARSING
// ═══════════════════════════════════════════════════════════════════════════════

function parseDiffStats(output: string): GitDiffStats {
  const lines = output.trim().split("\n").filter(Boolean)
  let filesChanged = 0
  let insertions = 0
  let deletions = 0
  const files: GitDiffStats["files"] = []

  for (const line of lines) {
    const match = line.match(/^(\d+|-)\s+(\d+|-)\s+(.+)$/)
    if (!match) continue
    const ins = match[1] === "-" ? 0 : parseInt(match[1], 10)
    const del = match[2] === "-" ? 0 : parseInt(match[2], 10)
    const path = match[3]
    if (!path) continue

    filesChanged++
    insertions += ins
    deletions += del
    files.push({ path, insertions: ins, deletions: del })
  }

  return { filesChanged, insertions, deletions, files }
}

function parseFileStats(output: string): { insertions: number; deletions: number } {
  const match = output.trim().match(/^(\d+|-)\s+(\d+|-)\s+/)
  if (!match) return { insertions: 0, deletions: 0 }
  return {
    insertions: match[1] === "-" ? 0 : parseInt(match[1], 10),
    deletions: match[2] === "-" ? 0 : parseInt(match[2], 10),
  }
}
