/**
 * Update Manager for KittyDiff
 * Handles checking for updates and performing self-updates (bun/npm)
 */

import { spawn } from "child_process"
import * as fs from "fs"
import { fileURLToPath } from "url"

function readLocalPackageInfo(): { name: string; version: string } {
  try {
    const pkgPath = fileURLToPath(new URL("../../package.json", import.meta.url))
    const raw = fs.readFileSync(pkgPath, "utf8")
    const parsed = JSON.parse(raw) as { name?: string; version?: string }
    return {
      name: parsed.name ?? "kittydiff",
      version: parsed.version ?? "0.0.0",
    }
  } catch {
    return { name: "kittydiff", version: "0.0.0" }
  }
}

const LOCAL_PACKAGE = readLocalPackageInfo()
const CURRENT_VERSION = LOCAL_PACKAGE.version
const PACKAGE_NAME = LOCAL_PACKAGE.name
const NPM_REGISTRY_URL = `https://registry.npmjs.org/${encodeURIComponent(PACKAGE_NAME)}/latest`

export interface UpdateCheckResult {
  hasUpdate: boolean
  currentVersion: string
  latestVersion: string
  error?: string
}

export interface UpdateProgress {
  status: 'checking' | 'downloading' | 'installing' | 'complete' | 'error'
  progress: number // 0-100
  message: string
}

export type UpdateProgressCallback = (progress: UpdateProgress) => void

function isBunRuntime(): boolean {
  return typeof (process.versions as any)?.bun === "string"
}

export function getManualUpdateCommand(): string {
  if (isBunRuntime()) return `bun install -g ${PACKAGE_NAME}`
  return `npm install -g ${PACKAGE_NAME}`
}

/**
 * Check if there's a new version available on npm
 */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    const response = await fetch(NPM_REGISTRY_URL, { signal: controller.signal }).finally(() => {
      clearTimeout(timeout)
    })

    if (!response.ok) {
      return {
        hasUpdate: false,
        currentVersion: CURRENT_VERSION,
        latestVersion: CURRENT_VERSION,
        error: `Failed to check for updates: ${response.status} ${response.statusText}`,
      }
    }

    const data = await response.json() as { version: string }
    const latestVersion = data.version

    // Compare versions (simple semver comparison)
    const hasUpdate = isNewerVersion(latestVersion, CURRENT_VERSION)

    return {
      hasUpdate,
      currentVersion: CURRENT_VERSION,
      latestVersion,
    }
  } catch (error) {
    return {
      hasUpdate: false,
      currentVersion: CURRENT_VERSION,
      latestVersion: CURRENT_VERSION,
      error: `Failed to check for updates: ${(error as Error).message}`,
    }
  }
}

/**
 * Compare two semver versions
 * Returns true if newVersion is newer than currentVersion
 */
function isNewerVersion(newVersion: string, currentVersion: string): boolean {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number)
  const newParts = parse(newVersion)
  const currentParts = parse(currentVersion)

  for (let i = 0; i < Math.max(newParts.length, currentParts.length); i++) {
    const newPart = newParts[i] || 0
    const currentPart = currentParts[i] || 0

    if (newPart > currentPart) return true
    if (newPart < currentPart) return false
  }

  return false // versions are equal
}

/**
 * Perform the actual update by running the appropriate global installer
 */
export async function performUpdate(
  onProgress: UpdateProgressCallback
): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    onProgress({
      status: 'downloading',
      progress: 10,
      message: 'Downloading update...',
    })

    const command = isBunRuntime() ? "bun" : "npm"
    const args = ['install', '-g', PACKAGE_NAME]

    const proc = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let progress = 10

    // Simulate progress based on time (npm doesn't give real progress)
    const progressInterval = setInterval(() => {
      if (progress < 90) {
        progress += 2
        onProgress({
          status: progress >= 60 ? 'installing' : 'downloading',
          progress,
          message: progress >= 60 ? 'Installing update...' : 'Downloading update...',
        })
      }
    }, 500)

    proc.stdout?.on('data', (data) => {
      stdout += data.toString()
    })

    proc.stderr?.on('data', (data) => {
      stderr += data.toString()
    })

    proc.on('close', (code) => {
      clearInterval(progressInterval)

      if (code === 0) {
        onProgress({
          status: 'complete',
          progress: 100,
          message: 'Update complete! Please restart kittydiff.',
        })
        resolve({ success: true })
      } else {
        const errorMsg = stderr.trim() || `Update failed with exit code ${code}`
        onProgress({
          status: 'error',
          progress: 0,
          message: `Update failed: ${errorMsg}`,
        })
        resolve({ success: false, error: errorMsg })
      }
    })

    proc.on('error', (err) => {
      clearInterval(progressInterval)
      const errorMsg = `Failed to start update: ${err.message}`
      onProgress({
        status: 'error',
        progress: 0,
        message: errorMsg,
      })
      resolve({ success: false, error: errorMsg })
    })
  })
}

/**
 * Get the current version
 */
export function getCurrentVersion(): string {
  return CURRENT_VERSION
}
