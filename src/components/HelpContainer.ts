import {
  BoxRenderable,
  TextRenderable,
  t,
  bold,
  fg,
} from "@opentui/core"

interface Command {
  id: string
  name: string
  description: string
  icon: string
}

export class HelpContainer {
  public overlay: BoxRenderable
  private content: BoxRenderable
  private title: TextRenderable
  private hint: TextRenderable

  constructor(
    private renderer: any,
    private colors: any,
    private commands: Command[],
    private configManager: any
  ) {
    this.overlay = new BoxRenderable(renderer, {
      id: "help-overlay",
      width: 72,
      flexDirection: "column",
      alignItems: "center",
      visible: false,
      border: true,
      borderStyle: "rounded",
      borderColor: colors.border,
      paddingTop: 1,
      paddingBottom: 1,
      paddingLeft: 3,
      paddingRight: 3,
    })

    this.title = new TextRenderable(renderer, {
      id: "help-title",
      content: t`${fg(colors.primary)(bold("? Help"))}  ${fg(colors.textMuted)("Commands & Shortcuts")}`,
    })
    this.overlay.add(this.title)

    const spacer1 = new BoxRenderable(renderer, {
      id: "help-spacer-1",
      height: 1,
    })
    this.overlay.add(spacer1)

    this.content = new BoxRenderable(renderer, {
      id: "help-content",
      flexDirection: "column",
      alignItems: "center",
      width: "100%",
    })
    this.overlay.add(this.content)

    this.hint = new TextRenderable(renderer, {
      id: "help-hint",
      content: t`${fg(colors.primary)("esc")} ${fg(colors.textMuted)("close")}`,
      marginTop: 1,
    })
    this.overlay.add(this.hint)
  }

  public render() {
    const children = this.content.getChildren()
    children.forEach((c) => this.content.remove(c.id))

    const dividerWidth = 64

    // Divider line
    const topDivider = new TextRenderable(this.renderer, {
      id: "help-top-divider",
      content: t`${fg(this.colors.border)("─".repeat(dividerWidth))}`,
    })
    this.content.add(topDivider)

    const topSpacer = new BoxRenderable(this.renderer, {
      id: "help-top-spacer",
      height: 1,
    })
    this.content.add(topSpacer)

    // Commands in a centered container
    const commandsContainer = new BoxRenderable(this.renderer, {
      id: "help-commands-container",
      flexDirection: "column",
      alignItems: "flex-start",
      width: dividerWidth,
    })

    this.commands.forEach((cmd) => {
      const cmdText = new TextRenderable(this.renderer, {
        id: `help-cmd-text-${cmd.id}`,
        content: t`  ${fg(this.colors.primary)(cmd.icon)}  ${fg(this.colors.text)(cmd.name.padEnd(22))} ${fg(this.colors.textDim)("·")} ${fg(this.colors.textMuted)(cmd.description)}`,
      })
      commandsContainer.add(cmdText)
    })

    this.content.add(commandsContainer)

    const midSpacer = new BoxRenderable(this.renderer, {
      id: "help-mid-spacer",
      height: 1,
    })
    this.content.add(midSpacer)

    // Middle divider
    const midDivider = new TextRenderable(this.renderer, {
      id: "help-mid-divider",
      content: t`${fg(this.colors.border)("─".repeat(dividerWidth))}`,
    })
    this.content.add(midDivider)

    const midSpacer2 = new BoxRenderable(this.renderer, {
      id: "help-mid-spacer-2",
      height: 1,
    })
    this.content.add(midSpacer2)

    // API Config section - centered
    const apiContainer = new BoxRenderable(this.renderer, {
      id: "help-api-container",
      flexDirection: "column",
      alignItems: "flex-start",
      width: dividerWidth,
    })

    const apiConfigLabel = new TextRenderable(this.renderer, {
      id: "help-api-config-label",
      content: t`  ${fg(this.colors.primary)(bold("⚙"))}  ${fg(this.colors.text)("Configuration")}`,
    })
    apiContainer.add(apiConfigLabel)

    const apiConfigSpacer = new BoxRenderable(this.renderer, {
      id: "help-api-config-spacer",
      height: 1,
    })
    apiContainer.add(apiConfigSpacer)

    // Config path
    const configPath = this.configManager.getConfigPath()
    const homeDir = require('os').homedir()
    const displayPath = configPath.replace(homeDir, "~")

    const pathText = new TextRenderable(this.renderer, {
      id: "help-api-path-text",
      content: t`      ${fg(this.colors.textMuted)("Path")}        ${fg(this.colors.textDim)("·")} ${fg(this.colors.text)(displayPath)}`,
    })
    apiContainer.add(pathText)

    // Configured providers
    const apiKeys = this.configManager.getApiKeys()
    const providers = Object.keys(apiKeys)

    if (providers.length > 0) {
      const providerText = new TextRenderable(this.renderer, {
        id: "help-api-providers-text",
        content: t`      ${fg(this.colors.textMuted)("Providers")}   ${fg(this.colors.textDim)("·")} ${fg(this.colors.success)(providers.join(", "))}`,
      })
      apiContainer.add(providerText)
    } else {
      const noProviderText = new TextRenderable(this.renderer, {
        id: "help-api-no-providers-text",
        content: t`      ${fg(this.colors.textMuted)("Providers")}   ${fg(this.colors.textDim)("·")} ${fg(this.colors.warning)("None configured")}`,
      })
      apiContainer.add(noProviderText)
    }

    this.content.add(apiContainer)

    const bottomSpacer = new BoxRenderable(this.renderer, {
      id: "help-bottom-spacer",
      height: 1,
    })
    this.content.add(bottomSpacer)

    // Bottom divider
    const bottomDivider = new TextRenderable(this.renderer, {
      id: "help-bottom-divider",
      content: t`${fg(this.colors.border)("─".repeat(dividerWidth))}`,
    })
    this.content.add(bottomDivider)
  }

  public show() {
    this.overlay.visible = true
    this.render()
  }

  public hide() {
    this.overlay.visible = false
  }
}
