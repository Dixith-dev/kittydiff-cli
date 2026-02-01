import {
  BoxRenderable,
  TextRenderable,
  TextareaRenderable,
  t,
  bold,
  fg,
} from "@opentui/core"
import { ConfigManager } from "../core/config"

interface Model {
  id: string
  name: string
  description: string
}

interface Provider {
  id: string
  name: string
  icon: string
  models: Model[]
}

type LiteLLMModel = {
  id: string; // e.g. "openai/gpt-4o" or "google/gemini-2.0-pro"
  object?: string;
  created?: number;
  owned_by?: string;
  // you can extend this with any extra LiteLLM fields if needed
};

export async function fetchAvailableModels(baseURL: string, apiKey?: string): Promise<LiteLLMModel[]> {
  const maxAttempts = 3;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // Increased to 60s for slower proxies
    try {
      const res = await fetch(`${baseURL}/v1/models`, {
        headers: {
          Authorization: `Bearer ${apiKey ?? "sk-noop"}`,
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        // Retry on server errors
        if ((res.status === 502 || res.status === 503 || res.status === 504) && attempt < maxAttempts - 1) {
          await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
          continue;
        }
        throw new Error(`Failed to fetch models: ${res.status} ${res.statusText}`);
      }

      const json = await res.json() as { data?: LiteLLMModel[]; object?: string };

      // Handle different response formats
      let models: LiteLLMModel[] = [];
      if (Array.isArray(json.data)) {
        models = json.data;
      } else if (Array.isArray(json)) {
        // Some proxies return the array directly
        models = json as LiteLLMModel[];
      } else {
        throw new Error('Unexpected response format from models endpoint');
      }

      // Filter out invalid entries and log for debugging
      const validModels = models.filter(m => m && typeof m.id === 'string');
      if (validModels.length !== models.length) {
        console.error(`[kittydiff] Filtered out ${models.length - validModels.length} invalid model entries`);
      }

      return validModels;
    } catch (err) {
      lastError = err as Error;
      if (attempt < maxAttempts - 1) {
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
        continue;
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastError ?? new Error('Failed to fetch models after retries');
}

export function groupModelsByProvider(models: LiteLLMModel[]): Provider[] {
  const map = new Map<string, Provider>();

  for (const m of models) {
    const [providerId, ...rest] = m.id.split("/");

    let key: string;
    let modelName: string;

    if (!rest.length) {
      // No provider prefix - use owned_by as provider or fall back to "other"
      key = m.owned_by?.toLowerCase().replace(/\s+/g, "_") || "other";
      modelName = m.id;
    } else {
      key = providerId;
      modelName = rest.join("/");
    }

    if (!map.has(key)) {
      let name = key.charAt(0).toUpperCase() + key.slice(1);
      if (key === "gemini") name = "Google";
      if (key === "other") name = "Other";

      map.set(key, {
        id: key,
        name,
        icon: "❯",
        models: []
      });
    }

    map.get(key)!.models.push({
      id: m.id,
      name: modelName,
      description: m.owned_by || ""
    });
  }

  // Sort providers: alphabetical, but "Other" always at the end
  const providers = Array.from(map.values());
  providers.sort((a, b) => {
    if (a.id === "other") return 1;
    if (b.id === "other") return -1;
    return a.name.localeCompare(b.name);
  });

  return providers;
}

export class ModelSelector {
  public overlay: BoxRenderable
  private title: TextRenderable
  private searchInput: TextareaRenderable
  private list: BoxRenderable
  private hint: TextRenderable
  private errorText: TextRenderable
  private apiKeyInput: TextareaRenderable | null = null
  private searchContainer: BoxRenderable  // Reference to hide/show during API key entry

  private view: 'provider' | 'model' | 'apiKey' = 'provider'
  private selectedProviderIndex = 0
  private selectedModelIndex = 0
  private currentProvider: Provider | null = null
  private searchQuery = ""
  private providers: Provider[] = []
  private filteredProviders: Provider[] = []
  private filteredModels: Model[] = []
  private isLoading = false
  private modelPage = 0
  private readonly MODELS_PER_PAGE = 10

  public configuredProvider: Provider | null = null
  public configuredModel: Model | null = null

  constructor(
    private renderer: any,
    private colors: any,
    private configManager: ConfigManager
  ) {
    this.overlay = new BoxRenderable(renderer, {
      id: "model-selector-overlay",
      width: 56,
      flexDirection: "column",
      alignItems: "center",
      visible: false,
      border: true,
      borderStyle: "rounded",
      borderColor: colors.border,
      paddingTop: 1,
      paddingBottom: 1,
      paddingLeft: 2,
      paddingRight: 2,
    })

    this.title = new TextRenderable(renderer, {
      id: "selector-title",
      content: t`${fg(colors.primary)(bold("⚙ Setup"))}  ${fg(colors.textMuted)("Select your AI provider")}`,
    })
    this.overlay.add(this.title)

    this.searchContainer = new BoxRenderable(renderer, {
      id: "model-search-container",
      width: "100%",
      height: 3,
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 0,
      marginTop: 1,
      border: true,
      borderStyle: "rounded",
      borderColor: colors.border,
      paddingLeft: 1
    })

    const searchIcon = new TextRenderable(renderer, {
      id: "model-search-icon",
      content: t`${fg(colors.primary)("🔍")} `,
    })
    this.searchContainer.add(searchIcon)

    this.searchInput = new TextareaRenderable(renderer, {
      id: "model-search-input",
      flexGrow: 1,
      height: 1,
      placeholder: "Filter...",
      backgroundColor: "transparent",
      focusedBackgroundColor: "transparent",
      textColor: colors.text,
      onContentChange: () => {
        // Prevent search from triggering while in API key view
        if (this.view === 'apiKey') return

        this.searchQuery = this.searchInput.plainText.toLowerCase().split("\n")[0]
        if (this.view === 'provider') {
          this.selectedProviderIndex = 0
          this.filteredProviders = this.providers.filter(p =>
            p.name.toLowerCase().includes(this.searchQuery)
          )
          this.renderProviderList()
        } else if (this.currentProvider) {
          this.selectedModelIndex = 0
          this.filteredModels = this.currentProvider.models.filter(m =>
            m.name.toLowerCase().includes(this.searchQuery)
          )
          this.renderModelList()
        }
      }
    })
    this.searchContainer.add(this.searchInput)
    this.overlay.add(this.searchContainer)

    const spacer = new BoxRenderable(renderer, { id: "sel-sp1", height: 1 })
    this.overlay.add(spacer)

    this.list = new BoxRenderable(renderer, {
      id: "selector-list",
      flexDirection: "column",
      alignItems: "flex-start",
      width: "100%",
    })
    this.overlay.add(this.list)

    this.errorText = new TextRenderable(renderer, {
      id: "selector-error",
      content: ""
    })
    // Don't add errorText initially, only when needed

    this.hint = new TextRenderable(renderer, {
      id: "selector-hint",
      content: t`${fg(colors.primary)("↑↓")} ${fg(colors.textMuted)("navigate")}  ${fg(colors.primary)("↵")} ${fg(colors.textMuted)("select")}  ${fg(colors.primary)("esc")} ${fg(colors.textMuted)("back")}`,
      marginTop: 1,
    })
    this.overlay.add(this.hint)
  }

  public show() {
    this.overlay.visible = true
    this.view = 'provider'
    this.selectedProviderIndex = 0
    this.selectedModelIndex = 0
    this.currentProvider = null
    this.searchQuery = ""
    this.searchInput.setText("")
    this.searchInput.focus()

    // Initial render while loading
    this.providers = []
    this.filteredProviders = []
    this.renderProviderList()

    this.loadModels()
  }

  private async loadModels() {
    this.isLoading = true;
    this.renderProviderList(); // Show loading state

    try {
      const proxyUrl = this.configManager.getProxyUrl();
      const proxyKey = this.configManager.getProxyKey();
      const models = await fetchAvailableModels(proxyUrl, proxyKey);

      // Debug: log how many models were fetched
      console.error(`[kittydiff] Fetched ${models.length} models from ${proxyUrl}/v1/models`);

      this.providers = groupModelsByProvider(models);

      // Debug: log provider breakdown
      for (const provider of this.providers) {
        console.error(`[kittydiff] Provider "${provider.name}": ${provider.models.length} models`);
      }

      this.filteredProviders = [...this.providers];
    } catch (err: any) {
      console.error(`[kittydiff] Error loading models:`, err);
      this.filteredProviders = []; // Clear list
      const errorMsg = new TextRenderable(this.renderer, {
        id: "error-msg",
        content: t`${fg(this.colors.error)("Error fetching models: " + err.message)}`
      });
      this.list.add(errorMsg);
    } finally {
      this.isLoading = false;
      this.renderProviderList();
    }
  }

  public hide() {
    this.overlay.visible = false
    this.searchInput.blur()
    if (this.apiKeyInput) {
      this.apiKeyInput.blur()
    }
  }

  public navigateUp() {
    if (this.view === 'provider') {
      if (this.filteredProviders.length === 0) return
      this.selectedProviderIndex = this.selectedProviderIndex <= 0
        ? this.filteredProviders.length - 1
        : this.selectedProviderIndex - 1
      this.renderProviderList()
    } else {
      if (this.filteredModels.length === 0) return
      this.selectedModelIndex = this.selectedModelIndex <= 0
        ? this.filteredModels.length - 1
        : this.selectedModelIndex - 1

      // Update page based on selection
      const newPage = Math.floor(this.selectedModelIndex / this.MODELS_PER_PAGE)
      if (newPage !== this.modelPage) {
        this.modelPage = newPage
      }
      this.renderModelList()
    }
  }

  public navigateDown() {
    if (this.view === 'provider') {
      if (this.filteredProviders.length === 0) return
      this.selectedProviderIndex = this.selectedProviderIndex >= this.filteredProviders.length - 1
        ? 0
        : this.selectedProviderIndex + 1
      this.renderProviderList()
    } else {
      if (this.filteredModels.length === 0) return
      this.selectedModelIndex = this.selectedModelIndex >= this.filteredModels.length - 1
        ? 0
        : this.selectedModelIndex + 1

      // Update page based on selection
      const newPage = Math.floor(this.selectedModelIndex / this.MODELS_PER_PAGE)
      if (newPage !== this.modelPage) {
        this.modelPage = newPage
      }
      this.renderModelList()
    }
  }

  public nextPage() {
    if (this.view === 'model' && this.filteredModels.length > this.MODELS_PER_PAGE) {
      const maxPage = Math.floor((this.filteredModels.length - 1) / this.MODELS_PER_PAGE)
      this.modelPage = (this.modelPage >= maxPage) ? 0 : this.modelPage + 1
      // Update selected index to stay on page
      this.selectedModelIndex = this.modelPage * this.MODELS_PER_PAGE
      this.renderModelList()
    }
  }

  public select() {
    if (this.view === 'provider') {
      if (this.filteredProviders.length === 0) return
      this.currentProvider = this.filteredProviders[this.selectedProviderIndex]

      // Check if API key exists for this provider
      const existingKey = this.configManager.getApiKey(this.currentProvider.id)
      if (!existingKey) {
        this.view = 'apiKey'
        this.searchInput.blur()
        this.renderApiKeyInput()
        return
      }

      this.view = 'model'
      this.selectedModelIndex = 0
      this.modelPage = 0
      this.filteredModels = this.currentProvider.models
      this.searchQuery = ""
      this.searchInput.setText("")
      this.searchInput.focus()
      this.renderModelList()
    } else if (this.view === 'apiKey') {
      // Get the API key directly from the textarea
      if (this.apiKeyInput) {
        const key = this.apiKeyInput.plainText.trim()
        if (key && this.currentProvider) {
          this.configManager.setApiKey(this.currentProvider.id, key)
          this.apiKeyInput.blur()
          this.apiKeyInput = null
          this.view = 'model'
          this.selectedModelIndex = 0
          this.modelPage = 0
          this.filteredModels = this.currentProvider.models
          this.searchQuery = ""
          this.searchInput.setText("")
          this.searchContainer.visible = true  // Show search container again
          this.searchInput.focus()
          this.renderModelList()
        }
      }
    } else if (this.view === 'model' && this.currentProvider) {
      if (this.filteredModels.length === 0) return
      this.configuredProvider = this.currentProvider
      this.configuredModel = this.filteredModels[this.selectedModelIndex]
      // Persist model selection to config
      this.configManager.setSelectedModel(this.configuredModel.id)
      return true // Signifies completion
    }
    return false
  }

  public goBack(): boolean {
    if (this.view === 'apiKey') {
      this.view = 'provider'
      this.currentProvider = null
      if (this.apiKeyInput) {
        this.apiKeyInput.blur()
        this.apiKeyInput = null
      }
      this.searchContainer.visible = true  // Show search container again
      this.searchInput.focus()
      this.renderProviderList()
      return true
    }
    if (this.view === 'model') {
      this.view = 'provider'
      this.currentProvider = null
      this.searchQuery = ""
      this.searchInput.setText("")
      this.searchInput.focus()
      this.filteredProviders = [...this.providers]
      this.renderProviderList()
      return true
    }
    return false
  }

  private renderProviderList() {
    const children = this.list.getChildren()
    children.forEach((c) => this.list.remove(c.id))

    this.title.content = t`${fg(this.colors.primary)(bold("⚙ Setup"))}  ${fg(this.colors.textMuted)("Select your AI provider")}`

    if (this.isLoading) {
      this.list.add(new TextRenderable(this.renderer, { id: "p-loading", content: t`${fg(this.colors.textMuted)("Loading models from proxy...")}` }))
      return
    }

    if (this.filteredProviders.length === 0) {
      this.list.add(new TextRenderable(this.renderer, { id: "p-no-res", content: t`${fg(this.colors.textMuted)("No providers found")}` }))
    }

    this.filteredProviders.forEach((p, i) => {
      const isSelected = i === this.selectedProviderIndex
      const row = new BoxRenderable(this.renderer, {
        id: `p-row-${i}`,
        width: "100%",
        flexDirection: "row",
        justifyContent: "space-between",
        paddingLeft: 1,
        paddingRight: 1,
        backgroundColor: isSelected ? this.colors.bgHover : "transparent",
      })

      const leftPart = new TextRenderable(this.renderer, {
        id: `p-txt-left-${i}`,
        content: t`${fg(isSelected ? this.colors.primary : this.colors.textDim)(p.icon)} ${fg(isSelected ? this.colors.primary : this.colors.text)(p.name)}`
      })

      const rightPart = new TextRenderable(this.renderer, {
        id: `p-txt-right-${i}`,
        content: t`${fg(this.colors.textMuted)(p.models.length + " models")}`
      })

      row.add(leftPart)
      row.add(rightPart)
      this.list.add(row)
    })

    if (this.configuredProvider && this.configuredModel) {
      this.list.add(new BoxRenderable(this.renderer, { id: "p-sp", height: 1 }))
      this.list.add(new TextRenderable(this.renderer, {
        id: "p-curr",
        content: t`${fg(this.colors.textDim)("Current:")} ${fg(this.colors.success)(this.configuredProvider.name)} ${fg(this.colors.textDim)("›")} ${fg(this.colors.text)(this.configuredModel.name)}`
      }))
    }
    this.hint.content = t`${fg(this.colors.primary)("↑↓")} ${fg(this.colors.textMuted)("navigate")}  ${fg(this.colors.primary)("↵")} ${fg(this.colors.textMuted)("select")}  ${fg(this.colors.primary)("esc")} ${fg(this.colors.textMuted)("close")}`
  }

  private renderApiKeyInput() {
    if (!this.currentProvider) return
    const children = this.list.getChildren()
    children.forEach((c) => this.list.remove(c.id))

    this.title.content = t`${fg(this.colors.primary)(bold(this.currentProvider.icon + " " + this.currentProvider.name))}  ${fg(this.colors.textMuted)("Enter API Key")}`

    // Hide the search container to prevent input conflicts
    this.searchContainer.visible = false
    this.searchInput.blur()

    // Simple spacer
    const spacer = new BoxRenderable(this.renderer, { id: "key-spacer", height: 1 })
    this.list.add(spacer)

    // Just add the input directly - no container box
    this.apiKeyInput = new TextareaRenderable(this.renderer, {
      id: "api-key-input",
      width: 70,
      height: 1,
      placeholder: "sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      backgroundColor: this.colors.bgHover,
      focusedBackgroundColor: this.colors.bgElevated,
      textColor: this.colors.text,
    })

    this.list.add(this.apiKeyInput)

    this.hint.content = t`${fg(this.colors.primary)("↵")} ${fg(this.colors.textMuted)("save & continue")}  ${fg(this.colors.primary)("esc")} ${fg(this.colors.textMuted)("back")}`

    // Focus the input
    if (this.apiKeyInput) {
      this.apiKeyInput.focus()
    }
  }

  private renderModelList() {
    if (!this.currentProvider) return
    const children = this.list.getChildren()
    children.forEach((c) => this.list.remove(c.id))

    this.title.content = t`${fg(this.colors.primary)(bold(this.currentProvider.icon + " " + this.currentProvider.name))}  ${fg(this.colors.textMuted)("Select a model")}`

    if (this.filteredModels.length === 0) {
      this.list.add(new TextRenderable(this.renderer, { id: "m-no-res", content: t`${fg(this.colors.textMuted)("No models found")}` }))
    }

    const start = this.modelPage * this.MODELS_PER_PAGE
    const end = Math.min(start + this.MODELS_PER_PAGE, this.filteredModels.length)
    const pageModels = this.filteredModels.slice(start, end)
    const totalPages = Math.ceil(this.filteredModels.length / this.MODELS_PER_PAGE)

    pageModels.forEach((m, i) => {
      const actualIndex = start + i
      const isSelected = actualIndex === this.selectedModelIndex
      const row = new BoxRenderable(this.renderer, {
        id: `m-row-${actualIndex}`,
        width: "100%",
        flexDirection: "row",
        paddingLeft: 1,
        backgroundColor: isSelected ? this.colors.bgHover : "transparent",
      })
      row.add(new TextRenderable(this.renderer, {
        id: `m-txt-${actualIndex}`,
        content: t`${fg(isSelected ? this.colors.primary : this.colors.textDim)("›")} ${fg(isSelected ? this.colors.primary : this.colors.text)(m.name)}`
      }))
      this.list.add(row)
    })

    if (totalPages > 1) {
      this.list.add(new BoxRenderable(this.renderer, { id: "m-page-sp", height: 1 }))
      const pagination = new TextRenderable(this.renderer, {
        id: "m-pagination",
        content: t`  ${fg(this.colors.textDim)("Page")} ${fg(this.colors.primary)((this.modelPage + 1).toString())} ${fg(this.colors.textDim)("of")} ${fg(this.colors.textDim)(totalPages.toString())}  ${fg(this.colors.textMuted)("(tab for next)")}`
      })
      this.list.add(pagination)
    }

    this.hint.content = t`${fg(this.colors.primary)("↑↓")} ${fg(this.colors.textMuted)("navigate")}  ${fg(this.colors.primary)("tab")} ${fg(this.colors.textMuted)("page")}  ${fg(this.colors.primary)("↵")} ${fg(this.colors.textMuted)("confirm")}  ${fg(this.colors.primary)("esc")} ${fg(this.colors.textMuted)("back")}`
  }
}
