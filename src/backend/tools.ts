/**
 * AI Tools for KittyDiff
 * Repository grounding tools for AI code reviews
 */

import { spawn } from "child_process"
import * as fs from "fs"
import * as path from "path"

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface ToolResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

export interface SearchResult {
  path: string
  line: number
  col: number
  preview: string
}

export interface SearchOptions {
  globs?: string[]
  maxResults?: number
  timeoutMs?: number
  caseSensitive?: boolean
  regex?: boolean
}

export interface BlameEntry {
  line: number
  commit: string
  author: string
  date: string
  content: string
}

export interface LogEntry {
  hash: string
  shortHash: string
  author: string
  date: string
  message: string
}

export interface Dependency {
  name: string
  version: string
  type: 'prod' | 'dev'
}

export type CheckKind = 'typecheck' | 'test' | 'lint' | 'build'

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

const DEFAULT_MAX_RESULTS = 50
const DEFAULT_TIMEOUT_MS = 10000
const DEFAULT_MAX_BYTES = 50000
const DEFAULT_CHECK_TIMEOUT_MS = 30000
const MAX_OUTPUT_SIZE = 50000

const DEFAULT_IGNORES = [
  'node_modules',
  'dist',
  'build',
  '.git',
  '*.lock',
  'package-lock.json',
  'bun.lockb',
  '.next',
  'coverage',
  '.cache',
  // Avoid leaking common secret material into LLM prompts
  '.env',
  '.env.*',
  '.npmrc',
  '.pypirc',
  '.netrc',
  '.git-credentials',
  'id_rsa',
  'id_ed25519',
  '*.pem',
  '*.key',
  '*.p12',
  '*.pfx',
  '*.jks',
  '*.kdbx',
]

const CHECK_COMMANDS: Record<CheckKind, { cmd: string; args: string[] }> = {
  typecheck: { cmd: 'bunx', args: ['tsc', '--noEmit'] },
  test: { cmd: 'bun', args: ['test'] },
  lint: { cmd: 'bunx', args: ['eslint', '.'] },
  build: { cmd: 'bun', args: ['run', 'build'] },
}

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

function getRepoRoot(): string {
  return process.cwd()
}

function isPathWithinRepo(filePath: string): boolean {
  const repoRoot = getRepoRoot()
  const resolved = path.resolve(repoRoot, filePath)

  // Use path.relative to get the relative path from repo root
  const relativePath = path.relative(repoRoot, resolved)

  // Path is outside repo if:
  // 1. It starts with '..' (goes up from repo root)
  // 2. It's an absolute path (on Windows, path.relative returns absolute for different drives)
  // 3. It equals '..' exactly
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return false
  }

  return true
}

function truncateOutput(output: string, maxSize: number = MAX_OUTPUT_SIZE): { content: string; truncated: boolean } {
  if (output.length <= maxSize) {
    return { content: output, truncated: false }
  }
  return {
    content: output.slice(0, maxSize) + `\n\n[truncated: ${output.length - maxSize} more characters]`,
    truncated: true,
  }
}

/**
 * Check if a string contains shell metacharacters that could enable injection.
 * Used to validate AI-provided inputs before passing to git commands.
 */
function containsShellMetachars(str: string): boolean {
  return /[;&|`$(){}[\]<>\\!*?"'\n\r]/.test(str)
}

/**
 * Execute a git command safely using spawn (no shell).
 * Returns stdout on success, throws on failure.
 */
function execGitCommand(args: string[], cwd: string, maxBuffer: number = MAX_OUTPUT_SIZE): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, { cwd })
    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data) => {
      if (stdout.length < maxBuffer) {
        stdout += data.toString()
      }
    })

    proc.stderr.on('data', (data) => {
      if (stderr.length < 10000) {
        stderr += data.toString()
      }
    })

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout)
      } else {
        reject(new Error(stderr || `git command failed with code ${code}`))
      }
    })

    proc.on('error', (err) => {
      reject(err)
    })
  })
}

function isBinaryFile(filePath: string): boolean {
  const binaryExtensions = [
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.svg',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.zip', '.tar', '.gz', '.rar', '.7z',
    '.exe', '.dll', '.so', '.dylib',
    '.wasm', '.bin', '.dat',
    '.mp3', '.mp4', '.avi', '.mov', '.wav',
    '.ttf', '.otf', '.woff', '.woff2', '.eot',
  ]
  const ext = path.extname(filePath).toLowerCase()
  return binaryExtensions.includes(ext)
}

function isPotentialSecretPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/')
  const base = path.basename(normalized)

  if (base === '.env') return true
  if (base.startsWith('.env.') && base !== '.env.example') return true

  const secretBasenames = new Set([
    '.npmrc',
    '.pypirc',
    '.netrc',
    '.git-credentials',
    'id_rsa',
    'id_ed25519',
    'id_dsa',
    'id_ecdsa',
  ])
  if (secretBasenames.has(base)) return true

  const ext = path.extname(base).toLowerCase()
  const secretExts = new Set(['.pem', '.key', '.p12', '.pfx', '.jks', '.kdbx'])
  if (secretExts.has(ext)) return true

  if (normalized.includes('/.aws/') && base === 'credentials') return true

  return false
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOOL: search_repo
// ═══════════════════════════════════════════════════════════════════════════════

export async function searchRepo(
  query: string,
  options: SearchOptions = {}
): Promise<ToolResult<SearchResult[]>> {
  const {
    globs = [],
    maxResults = DEFAULT_MAX_RESULTS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    caseSensitive = false,
    regex = true,
  } = options

  if (!query || query.trim().length === 0) {
    return { success: false, error: 'Query cannot be empty' }
  }

  try {
    const repoRoot = getRepoRoot()

    // Build ripgrep command
    const args: string[] = ['--json', '--line-number', '--column']

    if (!caseSensitive) {
      args.push('--ignore-case')
    }

    if (!regex) {
      args.push('--fixed-strings')
    }

    // Add default ignores
    for (const ignore of DEFAULT_IGNORES) {
      args.push('--glob', `!${ignore}`)
    }

    // Add user-specified globs
    for (const glob of globs) {
      args.push('--glob', glob)
    }

    args.push('--max-count', String(maxResults * 2)) // Fetch extra for filtering
    args.push(query)
    args.push(repoRoot)

    const results: SearchResult[] = []

    return new Promise((resolve) => {
      const rg = spawn('rg', args, { cwd: repoRoot })
      let lineBuffer = ''
      let stderr = ''
      let killed = false

      const cleanup = () => {
        if (!killed) {
          killed = true
          rg.kill()
        }
      }

      const timeout = setTimeout(() => {
        cleanup()
        resolve({
          success: true,
          data: results,
          error: results.length > 0 ? undefined : 'Search timed out',
        })
      }, timeoutMs)

      // Parse JSON lines as they arrive (streaming)
      rg.stdout.on('data', (data) => {
        if (killed) return

        lineBuffer += data.toString()

        // Prevent memory issues by capping buffer size
        const MAX_BUFFER = 1024 * 1024 // 1MB
        if (lineBuffer.length > MAX_BUFFER) {
          // Keep only the tail to continue parsing
          const lastNewline = lineBuffer.lastIndexOf('\n', MAX_BUFFER / 2)
          if (lastNewline > 0) {
            lineBuffer = lineBuffer.slice(lastNewline + 1)
          } else {
            lineBuffer = lineBuffer.slice(-MAX_BUFFER / 2)
          }
        }

        // Process complete lines
        const lines = lineBuffer.split('\n')
        // Keep the last incomplete line in buffer
        lineBuffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.trim()) continue
          if (results.length >= maxResults) {
            // Got enough results, stop early
            cleanup()
            clearTimeout(timeout)
            resolve({ success: true, data: results })
            return
          }

          try {
            const parsed = JSON.parse(line)
            if (parsed.type === 'match') {
              const match = parsed.data
              const relativePath = path.relative(repoRoot, match.path.text)

              // Skip binary files
              if (isBinaryFile(relativePath)) continue

              results.push({
                path: relativePath,
                line: match.line_number,
                col: match.submatches?.[0]?.start ?? 0,
                preview: match.lines?.text?.trim().slice(0, 200) ?? '',
              })
            }
          } catch {
            // Skip malformed JSON lines
          }
        }
      })

      rg.stderr.on('data', (data) => {
        // Cap stderr too
        if (stderr.length < 10000) {
          stderr += data.toString()
        }
      })

      rg.on('close', (code) => {
        if (killed) return
        clearTimeout(timeout)

        // Process any remaining data in buffer
        if (lineBuffer.trim()) {
          try {
            const parsed = JSON.parse(lineBuffer)
            if (parsed.type === 'match' && results.length < maxResults) {
              const match = parsed.data
              const relativePath = path.relative(repoRoot, match.path.text)
              if (!isBinaryFile(relativePath)) {
                results.push({
                  path: relativePath,
                  line: match.line_number,
                  col: match.submatches?.[0]?.start ?? 0,
                  preview: match.lines?.text?.trim().slice(0, 200) ?? '',
                })
              }
            }
          } catch {
            // Skip malformed JSON
          }
        }

        if (code !== 0 && code !== 1 && results.length === 0) {
          // code 1 means no matches, which is fine
          resolve({
            success: false,
            error: stderr || `ripgrep exited with code ${code}`,
          })
        } else {
          resolve({ success: true, data: results })
        }
      })

      rg.on('error', (err) => {
        clearTimeout(timeout)
        resolve({
          success: false,
          error: `Failed to run ripgrep: ${err.message}. Make sure 'rg' is installed.`,
        })
      })
    })
  } catch (err) {
    return {
      success: false,
      error: `Search failed: ${(err as Error).message}`,
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOOL: read_file
// ═══════════════════════════════════════════════════════════════════════════════

export async function readFile(
  filePath: string,
  startLine?: number,
  endLine?: number,
  maxBytes: number = DEFAULT_MAX_BYTES
): Promise<ToolResult<{ content: string; size: number; truncated: boolean; lines: number }>> {
  if (!filePath) {
    return { success: false, error: 'File path is required' }
  }

  if (!isPathWithinRepo(filePath)) {
    return { success: false, error: 'File path must be within the repository' }
  }

  const repoRoot = getRepoRoot()
  const fullPath = path.resolve(repoRoot, filePath)

  if (isPotentialSecretPath(filePath)) {
    return { success: false, error: 'Refusing to read potential secret file' }
  }

  if (isBinaryFile(fullPath)) {
    return { success: false, error: 'Cannot read binary files' }
  }

  try {
    const stat = await fs.promises.stat(fullPath)

    if (!stat.isFile()) {
      return { success: false, error: 'Path is not a file' }
    }

    if (stat.size > maxBytes * 2) {
      // Allow reading up to 2x maxBytes initially, then truncate
    }

    const content = await fs.promises.readFile(fullPath, 'utf-8')
    const allLines = content.split('\n')
    const totalLines = allLines.length

    // Apply line range if specified
    let selectedContent: string
    let selectedLines: string[]

    if (startLine !== undefined || endLine !== undefined) {
      const start = Math.max(1, startLine ?? 1) - 1 // Convert to 0-indexed
      const end = Math.min(totalLines, endLine ?? totalLines)
      selectedLines = allLines.slice(start, end)
      selectedContent = selectedLines.join('\n')
    } else {
      selectedLines = allLines
      selectedContent = content
    }

    const { content: truncatedContent, truncated } = truncateOutput(selectedContent, maxBytes)

    return {
      success: true,
      data: {
        content: truncatedContent,
        size: stat.size,
        truncated,
        lines: selectedLines.length,
      },
    }
  } catch (err) {
    const error = err as NodeJS.ErrnoException
    if (error.code === 'ENOENT') {
      return { success: false, error: `File not found: ${filePath}` }
    }
    return { success: false, error: `Failed to read file: ${error.message}` }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOOL: run_check
// ═══════════════════════════════════════════════════════════════════════════════

export async function runCheck(
  kind: CheckKind,
  args?: string,
  timeoutMs: number = DEFAULT_CHECK_TIMEOUT_MS
): Promise<ToolResult<{ exitCode: number; stdout: string; stderr: string }>> {
  const commandConfig = CHECK_COMMANDS[kind]

  if (!commandConfig) {
    return {
      success: false,
      error: `Unknown check kind: ${kind}. Allowed: ${Object.keys(CHECK_COMMANDS).join(', ')}`,
    }
  }

  try {
    const repoRoot = getRepoRoot()
    const cmdArgs = [...commandConfig.args]

    // Add additional args if provided (sanitize by splitting on spaces)
    if (args) {
      const extraArgs = args.split(/\s+/).filter(Boolean)
      // Only allow safe arguments (no shell metacharacters)
      const safeArgs = extraArgs.filter((arg) => !/[;&|`$(){}]/.test(arg))
      cmdArgs.push(...safeArgs)
    }

    return new Promise((resolve) => {
      const proc = spawn(commandConfig.cmd, cmdArgs, {
        cwd: repoRoot,
        env: { ...process.env, CI: 'true' }, // Disable interactive prompts
      })

      let stdout = ''
      let stderr = ''

      const timeout = setTimeout(() => {
        proc.kill('SIGTERM')
        resolve({
          success: true,
          data: {
            exitCode: -1,
            stdout: truncateOutput(stdout).content,
            stderr: 'Command timed out',
          },
        })
      }, timeoutMs)

      proc.stdout.on('data', (data) => {
        stdout += data.toString()
        // Prevent memory issues with huge output
        if (stdout.length > MAX_OUTPUT_SIZE * 2) {
          stdout = stdout.slice(-MAX_OUTPUT_SIZE)
        }
      })

      proc.stderr.on('data', (data) => {
        stderr += data.toString()
        if (stderr.length > MAX_OUTPUT_SIZE * 2) {
          stderr = stderr.slice(-MAX_OUTPUT_SIZE)
        }
      })

      proc.on('close', (code) => {
        clearTimeout(timeout)
        resolve({
          success: true,
          data: {
            exitCode: code ?? 0,
            stdout: truncateOutput(stdout).content,
            stderr: truncateOutput(stderr).content,
          },
        })
      })

      proc.on('error', (err) => {
        clearTimeout(timeout)
        resolve({
          success: false,
          error: `Failed to run ${kind}: ${err.message}`,
        })
      })
    })
  } catch (err) {
    return {
      success: false,
      error: `Check failed: ${(err as Error).message}`,
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOOL: git_blame
// ═══════════════════════════════════════════════════════════════════════════════

export async function gitBlame(
  filePath: string,
  lineRange?: { start: number; end: number }
): Promise<ToolResult<BlameEntry[]>> {
  if (!filePath) {
    return { success: false, error: 'File path is required' }
  }

  if (!isPathWithinRepo(filePath)) {
    return { success: false, error: 'File path must be within the repository' }
  }

  // Reject shell metacharacters to prevent injection
  if (containsShellMetachars(filePath)) {
    return { success: false, error: 'Invalid characters in file path' }
  }

  try {
    const repoRoot = getRepoRoot()
    const args = ['blame', '--porcelain']

    if (lineRange) {
      // Validate line range values are positive integers
      const start = Math.floor(Math.max(1, lineRange.start))
      const end = Math.floor(Math.max(start, lineRange.end))
      args.push('-L', `${start},${end}`)
    }

    args.push('--', filePath)

    const stdout = await execGitCommand(args, repoRoot)

    const entries: BlameEntry[] = []
    const lines = stdout.split('\n')
    let currentEntry: Partial<BlameEntry> = {}
    let lineNumber = lineRange?.start ?? 1

    for (const line of lines) {
      if (line.startsWith('\t')) {
        // Content line
        currentEntry.content = line.slice(1)
        currentEntry.line = lineNumber++
        if (currentEntry.commit && currentEntry.author && currentEntry.date) {
          entries.push(currentEntry as BlameEntry)
        }
        currentEntry = {}
      } else if (/^[0-9a-f]{40}/.test(line)) {
        // Commit hash line
        currentEntry.commit = line.slice(0, 8)
      } else if (line.startsWith('author ')) {
        currentEntry.author = line.slice(7)
      } else if (line.startsWith('author-time ')) {
        const timestamp = parseInt(line.slice(12), 10)
        currentEntry.date = new Date(timestamp * 1000).toISOString().split('T')[0]
      }
    }

    return { success: true, data: entries }
  } catch (err) {
    return {
      success: false,
      error: `git blame failed: ${(err as Error).message}`,
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOOL: git_log
// ═══════════════════════════════════════════════════════════════════════════════

export async function gitLog(
  filePath?: string,
  maxCommits: number = 20,
  grep?: string
): Promise<ToolResult<LogEntry[]>> {
  if (filePath && !isPathWithinRepo(filePath)) {
    return { success: false, error: 'File path must be within the repository' }
  }

  // Reject shell metacharacters to prevent injection
  if (filePath && containsShellMetachars(filePath)) {
    return { success: false, error: 'Invalid characters in file path' }
  }
  if (grep && containsShellMetachars(grep)) {
    return { success: false, error: 'Invalid characters in grep pattern' }
  }

  try {
    const repoRoot = getRepoRoot()
    const args = [
      'log',
      '-n', String(Math.min(Math.max(1, Math.floor(maxCommits)), 100)),
      '--pretty=format:%H%x09%h%x09%an%x09%ad%x09%s'
    ]

    if (grep) {
      args.push('--grep', grep)
    }

    if (filePath) {
      args.push('--', filePath)
    }

    const stdout = await execGitCommand(args, repoRoot)

    if (!stdout.trim()) {
      return { success: true, data: [] }
    }

    const entries: LogEntry[] = stdout
      .trim()
      .split('\n')
      .map((line) => {
        const [hash, shortHash, author, date, message] = line.split('\t')
        return { hash, shortHash, author, date, message }
      })

    return { success: true, data: entries }
  } catch (err) {
    return {
      success: false,
      error: `git log failed: ${(err as Error).message}`,
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOOL: git_show
// ═══════════════════════════════════════════════════════════════════════════════

export async function gitShow(
  rev: string
): Promise<ToolResult<{ commit: LogEntry; diff: string }>> {
  // Validate revision format:
  // - Hex commit hash (4-40 characters)
  // - HEAD with optional ~N or ^N suffix (e.g., HEAD, HEAD~1, HEAD^2)
  // - Branch names with alphanumeric, dash, underscore, slash
  const validRevPattern = /^(?:[a-f0-9]{4,40}|HEAD(?:[~^]\d+)?|[a-zA-Z][a-zA-Z0-9_\-\/]*)$/
  if (!rev || !validRevPattern.test(rev)) {
    return { success: false, error: 'Invalid revision format' }
  }

  // Additional safety: reject any shell metacharacters
  if (/[;&|`$(){}[\]<>\\!*?"']/.test(rev)) {
    return { success: false, error: 'Invalid characters in revision' }
  }

  try {
    const repoRoot = getRepoRoot()

    // Get commit info using spawn (no shell)
    const infoOutput = await execGitCommand(
      ['show', '-s', '--format=%H%x09%h%x09%an%x09%ad%x09%s', rev],
      repoRoot
    )

    const [hash, shortHash, author, date, message] = infoOutput.trim().split('\t')
    const commit: LogEntry = { hash, shortHash, author, date, message }

    // Get diff using spawn (no shell)
    const diffOutput = await execGitCommand(
      ['show', rev, '--pretty=format:'],
      repoRoot
    )

    const { content: diff } = truncateOutput(diffOutput)

    return { success: true, data: { commit, diff } }
  } catch (err) {
    return {
      success: false,
      error: `git show failed: ${(err as Error).message}`,
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOOL: dep_report
// ═══════════════════════════════════════════════════════════════════════════════

export async function depReport(): Promise<
  ToolResult<{
    packageManager: string
    dependencies: Dependency[]
  }>
> {
  try {
    const repoRoot = getRepoRoot()
    const packageJsonPath = path.join(repoRoot, 'package.json')

    if (!fs.existsSync(packageJsonPath)) {
      return { success: false, error: 'No package.json found in repository root' }
    }

    const packageJson = JSON.parse(await fs.promises.readFile(packageJsonPath, 'utf-8'))

    const dependencies: Dependency[] = []

    // Add production dependencies
    if (packageJson.dependencies) {
      for (const [name, version] of Object.entries(packageJson.dependencies)) {
        dependencies.push({
          name,
          version: String(version),
          type: 'prod',
        })
      }
    }

    // Add dev dependencies
    if (packageJson.devDependencies) {
      for (const [name, version] of Object.entries(packageJson.devDependencies)) {
        dependencies.push({
          name,
          version: String(version),
          type: 'dev',
        })
      }
    }

    // Detect package manager
    let packageManager = 'npm'
    if (fs.existsSync(path.join(repoRoot, 'bun.lockb')) || fs.existsSync(path.join(repoRoot, 'bun.lock'))) {
      packageManager = 'bun'
    } else if (fs.existsSync(path.join(repoRoot, 'yarn.lock'))) {
      packageManager = 'yarn'
    } else if (fs.existsSync(path.join(repoRoot, 'pnpm-lock.yaml'))) {
      packageManager = 'pnpm'
    }

    return {
      success: true,
      data: {
        packageManager,
        dependencies,
      },
    }
  } catch (err) {
    return {
      success: false,
      error: `Failed to read dependencies: ${(err as Error).message}`,
    }
  }
}
