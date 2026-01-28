import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface ToolsConfig {
  enabled: boolean
  maxToolCalls: number
  search_repo: { maxResults: number; timeoutMs: number }
  read_file: { maxBytes: number }
  run_check: { timeoutMs: number; allowedKinds: string[] }
}

export const DEFAULT_TOOLS_CONFIG: ToolsConfig = {
  enabled: true,
  maxToolCalls: 10,
  search_repo: { maxResults: 50, timeoutMs: 10000 },
  read_file: { maxBytes: 50000 },
  run_check: { timeoutMs: 30000, allowedKinds: ['typecheck', 'test', 'lint', 'build'] },
}

export interface CodebaseReviewConfig {
  maxFilesToSummarize: number
  folderDepth: number
}

export const DEFAULT_CODEBASE_REVIEW_CONFIG: CodebaseReviewConfig = {
  maxFilesToSummarize: 250,
  folderDepth: 2,
}

const MAX_CODEBASE_FILES_TO_SUMMARIZE = 1000
const MAX_CODEBASE_FOLDER_DEPTH = 6

function toSafeInt(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.floor(n)
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.floor(value)))
}

export interface Config {
  litellm_proxy_url: string;
  litellm_proxy_key?: string;
  api_keys: Record<string, string>;
  selected_model?: string;
  tools?: Partial<ToolsConfig>;
  codebase_review?: Partial<CodebaseReviewConfig>;
}

export class ConfigManager {
  private configPath: string;
  private config: Config;

  constructor() {
    const homeDir = os.homedir();
    const configDir = path.join(homeDir, '.kittydiff');

    // Ensure config directory exists
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    this.configPath = path.join(configDir, 'config.json');
    this.config = this.load();
  }

  private load(): Config {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf8');
        const parsed = JSON.parse(data);
        return {
          litellm_proxy_url: "http://localhost:4000",
          api_keys: {},
          ...parsed
        };
      }
    } catch (error) {
      console.error('Failed to load config:', error);
    }

    // Default config
    return {
      litellm_proxy_url: "http://localhost:4000",
      api_keys: {}
    };
  }

  public save(config: Partial<Config>) {
    this.config = { ...this.config, ...config };
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
    } catch (error) {
      console.error('Failed to save config:', error);
    }
  }

  public setApiKey(provider: string, key: string) {
    if (!this.config.api_keys) this.config.api_keys = {};
    this.config.api_keys[provider.toLowerCase()] = key;
    this.save({});
  }

  public getApiKey(provider: string): string | undefined {
    return this.config.api_keys?.[provider.toLowerCase()];
  }

  public getProxyUrl(): string {
    return this.config.litellm_proxy_url || "http://localhost:4000";
  }

  public getProxyKey(): string | undefined {
    return this.config.litellm_proxy_key;
  }

  public getConfigPath(): string {
    return this.configPath;
  }

  public getApiKeys(): Record<string, string> {
    return this.config.api_keys || {};
  }

  public setSelectedModel(modelId: string) {
    this.config.selected_model = modelId;
    this.save({});
  }

  public getSelectedModel(): string | undefined {
    return this.config.selected_model;
  }

  public getToolsConfig(): ToolsConfig {
    return {
      ...DEFAULT_TOOLS_CONFIG,
      ...(this.config.tools || {}),
      search_repo: { ...DEFAULT_TOOLS_CONFIG.search_repo, ...(this.config.tools?.search_repo || {}) },
      read_file: { ...DEFAULT_TOOLS_CONFIG.read_file, ...(this.config.tools?.read_file || {}) },
      run_check: { ...DEFAULT_TOOLS_CONFIG.run_check, ...(this.config.tools?.run_check || {}) },
    };
  }

  public getCodebaseReviewConfig(): CodebaseReviewConfig {
    const merged = {
      ...DEFAULT_CODEBASE_REVIEW_CONFIG,
      ...(this.config.codebase_review || {}),
    } as Record<string, unknown>

    return {
      maxFilesToSummarize: clampInt(
        toSafeInt(merged.maxFilesToSummarize, DEFAULT_CODEBASE_REVIEW_CONFIG.maxFilesToSummarize),
        1,
        MAX_CODEBASE_FILES_TO_SUMMARIZE
      ),
      folderDepth: clampInt(
        toSafeInt(merged.folderDepth, DEFAULT_CODEBASE_REVIEW_CONFIG.folderDepth),
        1,
        MAX_CODEBASE_FOLDER_DEPTH
      ),
    }
  }

  public setCodebaseReviewConfig(codebaseReview: Partial<CodebaseReviewConfig>) {
    this.config.codebase_review = { ...this.config.codebase_review, ...codebaseReview }
    this.save({})
  }

  public setToolsConfig(tools: Partial<ToolsConfig>) {
    this.config.tools = { ...this.config.tools, ...tools };
    this.save({});
  }

  public areToolsEnabled(): boolean {
    return this.getToolsConfig().enabled;
  }
}
