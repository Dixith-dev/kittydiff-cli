import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as net from 'net';
import yaml from 'js-yaml';

interface LiteLLMConfigModel {
  model_name: string;
  litellm_params: Record<string, any>;
  litellm_settings?: Record<string, any>;
}

interface LiteLLMConfig {
  model_list?: LiteLLMConfigModel[];
  general_settings?: Record<string, any>;
}

export class ProxyManager {
  private process: ChildProcess | null = null;
  private configPath: string;
  private logPath: string;
  private userConfigPath: string;
  private port: number;

  constructor(port: number = 4000) {
    const homeDir = os.homedir();
    const configDir = path.join(homeDir, '.kittydiff');
    this.configPath = path.join(configDir, 'litellm_config.yaml');
    this.logPath = path.join(configDir, 'litellm.log');
    this.userConfigPath = path.join(configDir, 'config.json');
    this.port = this.sanitizePort(port);

    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    this.registerExitHandlers();
  }

  private loadApiKeysFromUserConfig(): Record<string, string> {
    try {
      if (!fs.existsSync(this.userConfigPath)) return {};
      const raw = fs.readFileSync(this.userConfigPath, 'utf8');
      const parsed = JSON.parse(raw) as { api_keys?: Record<string, string> };
      return parsed.api_keys || {};
    } catch {
      return {};
    }
  }

  private sanitizePort(port: number): number {
    const n = Number(port);
    if (!Number.isFinite(n) || n <= 0) return 4000;
    return Math.min(65535, Math.max(1, Math.floor(n)));
  }

  private getBaseUrl(): string {
    return `http://localhost:${this.port}`;
  }

  private registerExitHandlers() {
    const cleanup = () => {
      try { this.stop(); } catch { }
    };
    process.once('exit', cleanup);
    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);
  }

  private isPortListening(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = net.createConnection({ port, host: '127.0.0.1' });
      socket.setTimeout(1000);
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('timeout', () => {
        socket.destroy();
        resolve(false);
      });
      socket.once('error', () => resolve(false));
    });
  }

  public async ensureConfig() {
    let config: LiteLLMConfig = { model_list: [] };

    if (fs.existsSync(this.configPath)) {
      try {
        const content = fs.readFileSync(this.configPath, 'utf8');
        const loaded = yaml.load(content) as LiteLLMConfig | undefined;
        if (loaded && typeof loaded === 'object') config = loaded;
      } catch {
        config = { model_list: [] };
      }
    }

    if (!Array.isArray(config.model_list)) config.model_list = [];

    // Map of provider names to their LiteLLM provider prefix and environment variable
    const providerConfigMap: Record<string, { prefix: string; env: string }> = {
      openai: { prefix: "openai", env: "OPENAI_API_KEY" },
      anthropic: { prefix: "anthropic", env: "ANTHROPIC_API_KEY" },
      gemini: { prefix: "gemini", env: "GEMINI_API_KEY" },
      google: { prefix: "gemini", env: "GEMINI_API_KEY" },
      openrouter: { prefix: "openrouter", env: "OPENROUTER_API_KEY" },
      groq: { prefix: "groq", env: "GROQ_API_KEY" },
      cohere: { prefix: "cohere", env: "COHERE_API_KEY" },
      mistral: { prefix: "mistral", env: "MISTRAL_API_KEY" },
      ai21: { prefix: "ai21", env: "AI21_API_KEY" },
      together_ai: { prefix: "together_ai", env: "TOGETHERAI_API_KEY" },
      togetherai: { prefix: "together_ai", env: "TOGETHERAI_API_KEY" },
      perplexity: { prefix: "perplexity", env: "PERPLEXITYAI_API_KEY" },
      deepseek: { prefix: "deepseek", env: "DEEPSEEK_API_KEY" },
      azure: { prefix: "azure", env: "AZURE_API_KEY" },
      bedrock: { prefix: "bedrock", env: "AWS_ACCESS_KEY_ID" },
      vertex_ai: { prefix: "vertex_ai", env: "VERTEXAI_PROJECT" },
      vertexai: { prefix: "vertex_ai", env: "VERTEXAI_PROJECT" },
      replicate: { prefix: "replicate", env: "REPLICATE_API_KEY" },
      huggingface: { prefix: "huggingface", env: "HUGGINGFACE_API_KEY" },
      baseten: { prefix: "baseten", env: "BASETEN_API_KEY" },
      nlp_cloud: { prefix: "nlp_cloud", env: "NLPCLOUD_API_KEY" },
      ollama: { prefix: "ollama", env: "OLLAMA_API_BASE" },
      vllm: { prefix: "vllm", env: "VLLM_API_BASE" },
      xai: { prefix: "xai", env: "XAI_API_KEY" },
    };

    // Load user's configured API keys
    const userApiKeys = this.loadApiKeysFromUserConfig();

    // Build model configurations from user's API keys
    for (const [provider, apiKey] of Object.entries(userApiKeys)) {
      if (!apiKey) continue;

      const configInfo = providerConfigMap[provider.toLowerCase()];
      if (!configInfo) {
        // Unknown provider - try to use provider name as prefix directly
        const prefix = provider.toLowerCase().replace(/[^a-z0-9_]/g, '_');
        const envVar = `${prefix.toUpperCase()}_API_KEY`;
        const wildcardModel = `${prefix}/*`;

        const exists = config.model_list.some(m => m?.model_name === wildcardModel);
        if (!exists) {
          config.model_list.push({
            model_name: wildcardModel,
            litellm_params: {
              model: wildcardModel,
              api_key: `os.environ/${envVar}`,
            },
            litellm_settings: {
              check_provider_endpoint: false,
            },
          });
        }
        continue;
      }

      const wildcardModel = `${configInfo.prefix}/*`;
      const exists = config.model_list.some(m => m?.model_name === wildcardModel);
      if (!exists) {
        config.model_list.push({
          model_name: wildcardModel,
          litellm_params: {
            model: wildcardModel,
            api_key: `os.environ/${configInfo.env}`,
          },
          litellm_settings: {
            check_provider_endpoint: false,
          },
        });
      }
    }

    // Ensure core providers are always available if their env vars are set
    const coreProviders = [
      { name: "openai/*", env: "OPENAI_API_KEY" },
      { name: "anthropic/*", env: "ANTHROPIC_API_KEY" },
      { name: "gemini/*", env: "GEMINI_API_KEY" },
      { name: "openrouter/*", env: "OPENROUTER_API_KEY" },
    ];

    for (const req of coreProviders) {
      const exists = config.model_list.some(m => m?.model_name === req.name);
      if (!exists) {
        config.model_list.push({
          model_name: req.name,
          litellm_params: {
            model: req.name,
            api_key: `os.environ/${req.env}`,
          },
          litellm_settings: {
            check_provider_endpoint: false,
          },
        });
      }
    }

    // Ensure consistent settings across all models
    for (const model of config.model_list) {
      if (!model || typeof model !== 'object') continue;
      if (!model.litellm_settings) model.litellm_settings = {};
      model.litellm_settings.check_provider_endpoint = false;
    }

    // Remove general_settings.master_key if it references an unset env var,
    // as this causes authentication failures when the proxy forwards requests
    if (config.general_settings) {
      if (config.general_settings.master_key === 'os.environ/LITELLM_MASTER_KEY') {
        const envKey = process.env.LITELLM_MASTER_KEY;
        if (!envKey || envKey.trim() === '') {
          delete config.general_settings.master_key;
        }
      }
      // Remove general_settings entirely if empty
      if (Object.keys(config.general_settings).length === 0) {
        delete config.general_settings;
      }
    }

    fs.writeFileSync(this.configPath, yaml.dump(config, { noRefs: true }));
  }

  /**
   * Resolve the litellm executable: prefer the `litellm` binary on PATH,
   * fall back to `python3 -m litellm` (which fails on some installations).
   */
  private resolveLiteLLMCommand(): { command: string; args: string[] } {
    try {
      const { execSync } = require('child_process') as typeof import('child_process');
      const litellmPath = execSync('command -v litellm', { encoding: 'utf8', timeout: 5000 }).trim();
      if (litellmPath) {
        return { command: litellmPath, args: [] };
      }
    } catch {
      // litellm binary not found on PATH
    }
    // Fallback: python3 -m litellm (may not work on all installations)
    return { command: 'python3', args: ['-m', 'litellm'] };
  }

  public async checkAndInstall(): Promise<boolean> {
    return new Promise((resolve) => {
      // First check if the litellm CLI binary is available
      const checkBinary = spawn('sh', ['-c', 'command -v litellm >/dev/null 2>&1']);
      checkBinary.on('close', (binaryCode) => {
        const attemptInstall = () => {
          const hasPip = spawn('sh', ['-c', 'command -v pip3 >/dev/null 2>&1']);
          hasPip.on('close', (pipCode) => {
            if (pipCode !== 0) {
              console.error("pip3 not found; cannot auto-install LiteLLM. Install pip3 or install litellm manually.");
              resolve(false);
              return;
            }

            console.log("LiteLLM dependencies not found. Installing via pip...");
            const install = spawn('pip3', ['install', '--user', 'litellm[proxy]']);

            install.on('close', (installCode) => {
              resolve(installCode === 0);
            });
          });
        };

        const checkPythonDeps = () => {
          const check = spawn('sh', ['-c', 'python3 -c "import litellm, apscheduler"']);
          check.on('close', (code) => {
            if (code === 0) {
              resolve(true);
            } else {
              attemptInstall();
            }
          });
        };

        if (binaryCode === 0) {
          const checkPython = spawn('sh', ['-c', 'command -v python3 >/dev/null 2>&1']);
          checkPython.on('close', (pythonCode) => {
            if (pythonCode === 0) {
              checkPythonDeps();
            } else {
              const checkCli = spawn('litellm', ['--help']);
              checkCli.on('close', (cliCode) => {
                if (cliCode === 0) {
                  resolve(true);
                } else {
                  attemptInstall();
                }
              });
            }
          });
          return;
        }

        // Fallback: check if litellm python module exists
        checkPythonDeps();
      });
    });
  }

  private _isRunning = false;
  private _isHealthy = false;
  private healthPromise: Promise<boolean> | null = null;
  private startPromise: Promise<void> | null = null;
  private initPromise: Promise<void> | null = null;

  /** Returns true if proxy has been confirmed healthy (cached) */
  public get isHealthy(): boolean {
    return this._isHealthy;
  }

  /** Returns true if proxy process is running */
  public get isRunning(): boolean {
    return this._isRunning;
  }

  /**
   * Initialize proxy: ensure config, check/install, and start.
   * Returns a cached promise so multiple calls don't restart.
   * Resets on failure so subsequent calls can retry.
   */
  public initialize(): Promise<void> {
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      await this.ensureConfig();
      const installed = await this.checkAndInstall();
      if (installed) {
        await this.start();
      }
    })().catch((err) => {
      // Reset so next call can retry instead of returning the cached failure
      this.initPromise = null;
      throw err;
    });

    return this.initPromise;
  }

  public async start() {
    if (this._isRunning) return;
    if (this.startPromise) return this.startPromise;

    this.startPromise = (async () => {
      // Check if something is already running on the configured port
      try {
        const res = await fetch(`${this.getBaseUrl()}/health`, { signal: AbortSignal.timeout(500) });
        if (res.ok) {
          this._isRunning = true;
          this._isHealthy = true;
          return;
        }
      } catch {
        // Nothing running, proceed to start
      }

      if (await this.isPortListening(this.port)) {
        throw new Error(`Port ${this.port} is already in use. Set KITTYDIFF_PROXY_PORT or update ~/.kittydiff/config.json.`);
      }

      if (!this.process) {
        const logStream = fs.createWriteStream(this.logPath, { flags: 'a' });

        const apiKeys = this.loadApiKeysFromUserConfig();
        const env: NodeJS.ProcessEnv = { ...process.env };

        // Comprehensive mapping of provider names to their environment variables
        const providerEnvVarByKey: Record<string, string> = {
          openrouter: 'OPENROUTER_API_KEY',
          anthropic: 'ANTHROPIC_API_KEY',
          openai: 'OPENAI_API_KEY',
          google: 'GEMINI_API_KEY',
          gemini: 'GEMINI_API_KEY',
          groq: 'GROQ_API_KEY',
          cohere: 'COHERE_API_KEY',
          mistral: 'MISTRAL_API_KEY',
          ai21: 'AI21_API_KEY',
          together_ai: 'TOGETHERAI_API_KEY',
          togetherai: 'TOGETHERAI_API_KEY',
          perplexity: 'PERPLEXITYAI_API_KEY',
          deepseek: 'DEEPSEEK_API_KEY',
          azure: 'AZURE_API_KEY',
          bedrock: 'AWS_ACCESS_KEY_ID',
          vertex_ai: 'VERTEXAI_PROJECT',
          vertexai: 'VERTEXAI_PROJECT',
          replicate: 'REPLICATE_API_KEY',
          huggingface: 'HUGGINGFACE_API_KEY',
          baseten: 'BASETEN_API_KEY',
          nlp_cloud: 'NLPCLOUD_API_KEY',
          ollama: 'OLLAMA_API_BASE',
          vllm: 'VLLM_API_BASE',
          xai: 'XAI_API_KEY',
        };

        for (const [provider, key] of Object.entries(apiKeys)) {
          let envVar = providerEnvVarByKey[provider.toLowerCase()];
          // For custom providers not in the known list, generate env var name dynamically
          if (!envVar) {
            const prefix = provider.toLowerCase().replace(/[^a-z0-9_]/g, '_');
            envVar = `${prefix.toUpperCase()}_API_KEY`;
          }
          if (envVar && key) env[envVar] = key;
        }

        const { command, args: prefixArgs } = this.resolveLiteLLMCommand();
        this.process = spawn(command, [
          ...prefixArgs,
          '--config', this.configPath,
          '--port', String(this.port),
        ], { env });

        this.process.stdout?.pipe(logStream);
        this.process.stderr?.pipe(logStream);

        this.process.on('error', (err) => {
          console.error('Failed to start LiteLLM:', err);
        });
      }

      const ok = await this.waitForHealth(20000); // 20s to allow slow proxy startups
      if (!ok) {
        throw new Error(
          'AI proxy started but failed health check. Check ~/.kittydiff/litellm.log for errors. ' +
          'Common causes: missing API keys, Python dependency issues, or port conflicts.'
        );
      }
      this._isRunning = true;
    })().catch((err) => {
      this.startPromise = null; // Reset so next call can retry
      if (this.process) {
        try { this.process.kill(); } catch {}
        this.process = null;
      }
      throw err;
    });

    return this.startPromise;
  }

  /**
   * Re-validate proxy health before making API calls.
   * If the proxy was previously healthy but has since died, attempts to restart it.
   */
  public async ensureHealthy(): Promise<boolean> {
    // Try health ping with retries to avoid restarting on transient hiccups
    for (let i = 0; i < 3; i++) {
      try {
        const res = await fetch(`${this.getBaseUrl()}/health`, { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          this._isHealthy = true;
          this._isRunning = true;
          return true;
        }
      } catch {
        // Proxy may be slow or temporarily unavailable
      }
      if (i < 2) await new Promise(r => setTimeout(r, 1000));
    }

    // Proxy not responding after retries - restart
    this._isHealthy = false;
    this._isRunning = false;
    this.healthPromise = null;
    this.startPromise = null;
    this.initPromise = null;

    // Kill stale process if any
    if (this.process) {
      try { this.process.kill(); } catch {}
      this.process = null;
    }

    try {
      await this.start();
      return this._isHealthy;
    } catch {
      return false;
    }
  }

  public async waitForHealth(timeoutMs = 20000): Promise<boolean> {
    // If already confirmed healthy, return immediately
    if (this._isHealthy) return true;

    // If health check is in progress, return the cached promise
    if (this.healthPromise) return this.healthPromise;

    this.healthPromise = (async () => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        try {
          const res = await fetch(`${this.getBaseUrl()}/health`, { signal: AbortSignal.timeout(2000) });
          if (res.ok) {
            this._isRunning = true;
            this._isHealthy = true;
            return true;
          }
        } catch {
          // Ignore conn refused
        }
        await new Promise(r => setTimeout(r, 300)); // Reduced from 500ms to 300ms
      }
      this.healthPromise = null; // Reset on failure so we can try again
      return false;
    })();

    return this.healthPromise;
  }

  public stop() {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this._isRunning = false;
    this._isHealthy = false;
    this.healthPromise = null;
    this.startPromise = null;
    this.initPromise = null;
  }
}
