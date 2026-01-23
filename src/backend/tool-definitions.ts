/**
 * OpenAI Function Calling Schema Definitions for AI Tools
 * These schemas define the tools available to the AI during code review
 */

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, unknown>
      required?: string[]
    }
  }
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  // ═══════════════════════════════════════════════════════════════════════════════
  // search_repo
  // ═══════════════════════════════════════════════════════════════════════════════
  {
    type: 'function',
    function: {
      name: 'search_repo',
      description:
        'Search the repository for code patterns, symbols, function definitions, or text. Use this to find where code is defined or used, understand project patterns, or locate related code before proposing fixes.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'Search pattern. Supports regex by default. Examples: "function handleAuth", "class.*Repository", "TODO|FIXME"',
          },
          globs: {
            type: 'array',
            items: { type: 'string' },
            description:
              'File patterns to include/exclude. Examples: ["*.ts", "!*.test.ts", "src/**/*.tsx"]',
          },
          maxResults: {
            type: 'number',
            description: 'Maximum number of results to return (default: 50)',
          },
          caseSensitive: {
            type: 'boolean',
            description: 'Whether search is case sensitive (default: false)',
          },
          regex: {
            type: 'boolean',
            description: 'Treat query as regex pattern (default: true)',
          },
        },
        required: ['query'],
      },
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // read_file
  // ═══════════════════════════════════════════════════════════════════════════════
  {
    type: 'function',
    function: {
      name: 'read_file',
      description:
        'Read content from a file in the repository. Use this to see full context around code shown in the diff, or to read files that need to be modified but are not in the diff.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the file relative to repository root. Example: "src/utils/auth.ts"',
          },
          startLine: {
            type: 'number',
            description: 'Starting line number (1-indexed). Omit to read from beginning.',
          },
          endLine: {
            type: 'number',
            description: 'Ending line number (inclusive). Omit to read to end.',
          },
          maxBytes: {
            type: 'number',
            description: 'Maximum bytes to read (default: 50000)',
          },
        },
        required: ['path'],
      },
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // run_check
  // ═══════════════════════════════════════════════════════════════════════════════
  {
    type: 'function',
    function: {
      name: 'run_check',
      description:
        'Run a validation command to check if code compiles, tests pass, or linting succeeds. Use this to validate your suggested fixes before claiming they work.',
      parameters: {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
            enum: ['typecheck', 'test', 'lint', 'build'],
            description:
              'Type of check to run: "typecheck" (tsc --noEmit), "test" (bun test), "lint" (eslint), "build" (bun run build)',
          },
          args: {
            type: 'string',
            description:
              'Additional arguments to pass to the command (optional). Example: "--only src/auth.test.ts"',
          },
          timeoutMs: {
            type: 'number',
            description: 'Timeout in milliseconds (default: 30000)',
          },
        },
        required: ['kind'],
      },
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // git_blame
  // ═══════════════════════════════════════════════════════════════════════════════
  {
    type: 'function',
    function: {
      name: 'git_blame',
      description:
        'Get git blame information for a file to see who wrote each line and when. Use this to understand code history, identify who to ask about specific code, or check if code was recently changed.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Path to the file relative to repository root',
          },
          lineRange: {
            type: 'object',
            properties: {
              start: { type: 'number', description: 'Starting line number (1-indexed)' },
              end: { type: 'number', description: 'Ending line number (inclusive)' },
            },
            required: ['start', 'end'],
            description: 'Optional line range to blame',
          },
        },
        required: ['path'],
      },
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // git_log
  // ═══════════════════════════════════════════════════════════════════════════════
  {
    type: 'function',
    function: {
      name: 'git_log',
      description:
        'View git commit history. Use this to understand how code evolved, find when bugs were introduced, or see related changes.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Optional path to filter commits affecting this file',
          },
          maxCommits: {
            type: 'number',
            description: 'Maximum number of commits to return (default: 20, max: 100)',
          },
          grep: {
            type: 'string',
            description: 'Filter commits by message pattern. Example: "fix auth", "JIRA-123"',
          },
        },
      },
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // git_show
  // ═══════════════════════════════════════════════════════════════════════════════
  {
    type: 'function',
    function: {
      name: 'git_show',
      description:
        'Show details of a specific commit including its diff. Use this to understand what a specific commit changed.',
      parameters: {
        type: 'object',
        properties: {
          rev: {
            type: 'string',
            description: 'Commit hash or reference (e.g., "abc123", "HEAD~1")',
          },
        },
        required: ['rev'],
      },
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // dep_report
  // ═══════════════════════════════════════════════════════════════════════════════
  {
    type: 'function',
    function: {
      name: 'dep_report',
      description:
        'Get a report of project dependencies from package.json. Use this to understand what packages are available, check versions, or identify outdated dependencies.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
]

// Combined tool for the review_code call - includes both review tool and all grounding tools
export const REVIEW_TOOL_WITH_GROUNDING = {
  type: 'function' as const,
  function: {
    name: 'report_code_review',
    description: 'Report all code review findings in structured format',
    parameters: {
      type: 'object',
      properties: {
        bugs: {
          type: 'array',
          description: 'List of all issues found during code review',
          items: {
            type: 'object',
            properties: {
              severity: {
                type: 'string',
                enum: ['critical', 'major', 'minor', 'info'],
                description: 'Issue severity level',
              },
              title: {
                type: 'string',
                description: 'Short, descriptive title for the issue (max 50 chars)',
              },
              file: {
                type: 'string',
                description: 'Path to the file containing the issue',
              },
              startLine: {
                type: 'number',
                description: 'Starting line number of the issue',
              },
              endLine: {
                type: 'number',
                description: 'Ending line number of the issue',
              },
              description: {
                type: 'string',
                description: 'Detailed explanation of the issue and why it is a problem',
              },
              suggestion: {
                type: 'string',
                description: 'Specific recommendation for how to fix the issue',
              },
              fixDiff: {
                type: 'string',
                description:
                  'Best-effort minimal unified diff patch (git-style) to apply as a potential fix; empty string if not available',
              },
            },
            required: ['severity', 'title', 'file', 'startLine', 'endLine', 'description', 'suggestion', 'fixDiff'],
          },
        },
      },
      required: ['bugs'],
    },
  },
}

// Get all tools including grounding tools and the final report tool
export function getAllToolDefinitions(): ToolDefinition[] {
  return [...TOOL_DEFINITIONS, REVIEW_TOOL_WITH_GROUNDING as ToolDefinition]
}
