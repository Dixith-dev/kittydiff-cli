export interface Command {
  id: string
  name: string
  description: string
  icon: string
}

export const commands: Command[] = [
  { id: "review-uncommitted", name: "Review Changes", description: "Review all uncommitted changes", icon: "◎" },
  { id: "review-branch", name: "Review Branch", description: "Review current branch against another", icon: "◉" },
  { id: "review-commit", name: "Review Commit", description: "Review a specific commit by ID", icon: "◈" },
  { id: "review-all", name: "Review Codebase", description: "Review the entire codebase", icon: "◇" },
  { id: "status", name: "Git Status", description: "Show repository status", icon: "●" },
  { id: "setup", name: "Setup", description: "Configure AI provider and models", icon: "⚙" },
  { id: "history", name: "History", description: "Browse past code reviews", icon: "↺" },
  { id: "update", name: "Update", description: "Check for updates", icon: "↻" },
  { id: "help", name: "Help", description: "Show all commands and shortcuts", icon: "?" },
]
