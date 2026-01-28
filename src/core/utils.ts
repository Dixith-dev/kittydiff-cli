/**
 * Shared utility functions for KittyDiff
 */

import * as path from "path"

const SECRET_BASENAMES = new Set([
  ".env",
  ".npmrc",
  ".pypirc",
  ".netrc",
  ".git-credentials",
  "id_rsa",
  "id_ed25519",
  "id_dsa",
  "id_ecdsa",
])

const SECRET_EXTENSIONS = new Set([
  ".pem",
  ".key",
  ".p12",
  ".pfx",
  ".jks",
  ".kdbx",
])

/**
 * Check if a file path potentially contains secrets/credentials.
 * Used to prevent leaking sensitive files into LLM prompts.
 */
export function isPotentialSecretPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/")
  const base = path.posix.basename(normalized)

  if (SECRET_BASENAMES.has(base)) return true
  if (base.startsWith(".env.") && base !== ".env.example") return true

  const ext = path.posix.extname(base).toLowerCase()
  if (SECRET_EXTENSIONS.has(ext)) return true

  if (normalized.includes("/.aws/") && base === "credentials") return true

  return false
}
