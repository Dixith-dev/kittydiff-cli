import type { Bug } from "../backend/ai-reviewer"
import type { GitCommit } from "./git"

export function computeHistorySummary(
  totalBugs: number,
  filesScanned: number,
  commitInfo?: GitCommit,
  bugs: Bug[] = []
): string {
  if (commitInfo?.message) return commitInfo.message.slice(0, 50)
  if (totalBugs === 0) return `Clean - ${filesScanned} files checked`
  const topBug = bugs[0]
  if (topBug) return topBug.title.slice(0, 50)
  return `${totalBugs} issues in ${filesScanned} files`
}
