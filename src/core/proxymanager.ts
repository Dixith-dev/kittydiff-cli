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

    // Remove deprecated/problematic configurations
    config.model_list = config.model_list.filter(m => m?.model_name !== "groq/*" && m?.model_name !== "google/*");

    const requiredModels: Array<{ name: string; env: string }> = [
      { name: "openai/*", env: "OPENAI_API_KEY" },
      { name: "anthropic/*", env: "ANTHROPIC_API_KEY" },
      { name: "gemini/*", env: "GEMINI_API_KEY" },
      { name: "openrouter/*", env: "OPENROUTER_API_KEY" },
    ];

    for (const req of requiredModels) {
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

    fs.writeFileSync(this.configPath, yaml.dump(config, { noRefs: true }));
  }

  public async checkAndInstall(): Promise<boolean> {
    return new Promise((resolve) => {
      // Check if litellm exists and has proxy dependencies
      const check = spawn('sh', ['-c', 'python3 -c "import litellm, apscheduler"']);

      check.on('close', (code) => {
        if (code === 0) {
          resolve(true);
        } else {
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
        }
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
   */
  public initialize(): Promise<void> {
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      await this.ensureConfig();
      const installed = await this.checkAndInstall();
      if (installed) {
        await this.start();
      }
    })();

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
        const providerEnvVarByKey: Record<string, string> = {
          openrouter: 'OPENROUTER_API_KEY',
          anthropic: 'ANTHROPIC_API_KEY',
          openai: 'OPENAI_API_KEY',
          google: 'GOOGLE_API_KEY',
          gemini: 'GEMINI_API_KEY',
          groq: 'GROQ_API_KEY',
        };

        for (const [provider, key] of Object.entries(apiKeys)) {
          const envVar = providerEnvVarByKey[provider.toLowerCase()];
          if (envVar && key) env[envVar] = key;
        }

        this.process = spawn('python3', [
          '-m',
          'litellm',
          '--config', this.configPath,
          '--port', String(this.port),
        ], { env });

        this.process.stdout?.pipe(logStream);
        this.process.stderr?.pipe(logStream);

        this.process.on('error', (err) => {
          console.error('Failed to start LiteLLM:', err);
        });
      }

      const ok = await this.waitForHealth(10000); // Reduced from 15s to 10s
      if (ok) this._isRunning = true;
    })().finally(() => {
      this.startPromise = null;
    });

    return this.startPromise;
  }

  public async waitForHealth(timeoutMs = 10000): Promise<boolean> {
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
