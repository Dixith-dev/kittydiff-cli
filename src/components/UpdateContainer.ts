import {
  BoxRenderable,
  TextRenderable,
  t,
  bold,
  fg,
} from "@opentui/core"
import { KITTY_IDLE, getKittyFramesForPhase } from "../animations"
import { checkForUpdate, getManualUpdateCommand, performUpdate, type UpdateCheckResult } from "../core/update-manager"

type UpdateState = 'checking' | 'up-to-date' | 'available' | 'downloading' | 'installing' | 'complete' | 'error'

export class UpdateContainer {
  public overlay: BoxRenderable
  private content: BoxRenderable
  private title: TextRenderable
  private versionText: TextRenderable
  private messageText: TextRenderable
  private progressBar: TextRenderable
  private hint: TextRenderable
  private failHint: TextRenderable
  private animationInterval: ReturnType<typeof setInterval> | null = null

  private state: UpdateState = 'checking'
  private checkResult: UpdateCheckResult | null = null
  private isUpdating = false

  constructor(
    private renderer: any,
    private colors: any,
    private kittyArt: TextRenderable
  ) {
    this.overlay = new BoxRenderable(renderer, {
      id: "update-overlay",
      width: 60,
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
      id: "update-title",
      content: t`${fg(colors.primary)(bold("↻ Update"))}`,
    })
    this.overlay.add(this.title)

    const spacer1 = new BoxRenderable(renderer, { id: "up-sp1", height: 1 })
    this.overlay.add(spacer1)

    // Version info
    this.versionText = new TextRenderable(renderer, {
      id: "update-version",
      content: "",
    })
    this.overlay.add(this.versionText)

    const spacer2 = new BoxRenderable(renderer, { id: "up-sp2", height: 1 })
    this.overlay.add(spacer2)

    // Message/status text
    this.messageText = new TextRenderable(renderer, {
      id: "update-message",
      content: t`${fg(colors.text)("Checking for updates...")}`,
    })
    this.overlay.add(this.messageText)

    const spacer3 = new BoxRenderable(renderer, { id: "up-sp3", height: 1 })
    this.overlay.add(spacer3)

    // Progress bar
    this.progressBar = new TextRenderable(renderer, {
      id: "update-progress-bar",
      content: t`${fg(colors.textDim)("[" + "░".repeat(40) + "]")}  ${fg(colors.textMuted)("0%")}`,
    })
    this.overlay.add(this.progressBar)

    const spacer4 = new BoxRenderable(renderer, { id: "up-sp4", height: 1 })
    this.overlay.add(spacer4)

    // Content area for dynamic info
    this.content = new BoxRenderable(renderer, {
      id: "update-content",
      flexDirection: "column",
      alignItems: "center",
      width: "100%",
    })
    this.overlay.add(this.content)

    // Hint text
    this.hint = new TextRenderable(renderer, {
      id: "update-hint",
      content: t`${fg(colors.primary)("esc")} ${fg(colors.textMuted)("close")}`,
      marginTop: 1,
    })
    this.overlay.add(this.hint)

    // Fail hint (for manual update)
    this.failHint = new TextRenderable(renderer, {
      id: "update-fail-hint",
      content: "",
      visible: false,
    })
    this.overlay.add(this.failHint)
  }

  private updateProgressBar(progress: number) {
    const filled = Math.floor((progress / 100) * 40)
    const empty = 40 - filled
    const percent = Math.floor(progress)
    const bar = "█".repeat(filled) + "░".repeat(empty)
    this.progressBar.content = t`${fg(this.colors.primary)("[")}${fg(this.colors.gradientMid)(bar)}${fg(this.colors.primary)("]")}  ${fg(this.colors.text)(percent.toString() + "%")}`
  }

  public async show() {
    this.overlay.visible = true
    this.state = 'checking'
    this.isUpdating = false
    this.failHint.visible = false
    
    // Reset UI
    this.messageText.content = t`${fg(this.colors.text)("Checking for updates...")}`
    this.updateProgressBar(0)
    this.hint.content = t`${fg(this.colors.primary)("esc")} ${fg(this.colors.textMuted)("close")}`
    
    this.startAnimation()

    // Check for updates
    this.checkResult = await checkForUpdate()

    if (this.checkResult.error) {
      this.state = 'error'
      this.messageText.content = t`${fg(this.colors.error)(this.checkResult.error)}`
      this.versionText.content = t`${fg(this.colors.textMuted)("Current:")} ${fg(this.colors.text)(this.checkResult.currentVersion)}`
      this.stopAnimation()
      return
    }

    this.versionText.content = t`${fg(this.colors.textMuted)("Current:")} ${fg(this.colors.text)(this.checkResult.currentVersion)} ${fg(this.colors.textDim)("→")} ${fg(this.colors.textMuted)("Latest:")} ${fg(this.colors.success)(this.checkResult.latestVersion)}`

    if (this.checkResult.hasUpdate) {
      this.state = 'available'
      this.messageText.content = t`${fg(this.colors.warning)("A new version is available!")}`
      this.hint.content = t`${fg(this.colors.primary)("↵")} ${fg(this.colors.textMuted)("update now")}  ${fg(this.colors.primary)("esc")} ${fg(this.colors.textMuted)("close")}`
      this.stopAnimation()
    } else {
      this.state = 'up-to-date'
      this.messageText.content = t`${fg(this.colors.success)("You're on the latest version!")}`
      this.updateProgressBar(100)
      this.stopAnimation()
    }
  }

  public hide() {
    this.overlay.visible = false
    this.stopAnimation()
    this.kittyArt.content = t`${fg(this.colors.primary)(KITTY_IDLE[0].join("\n"))}`
  }

  public async startUpdate(): Promise<boolean> {
    if (this.state !== 'available' || this.isUpdating) {
      return false
    }

    this.isUpdating = true
    this.state = 'downloading'
    this.startAnimation()

    const result = await performUpdate((progress) => {
      this.state = progress.status as UpdateState
      this.updateProgressBar(progress.progress)
      this.messageText.content = t`${fg(this.colors.text)(progress.message)}`

      if (progress.status === 'error') {
        this.showFailHint()
      }
    })

    this.isUpdating = false
    this.stopAnimation()

    if (result.success) {
      this.state = 'complete'
      this.updateProgressBar(100)
      this.hint.content = t`${fg(this.colors.primary)("esc")} ${fg(this.colors.textMuted)("close")}`
      return true
    } else {
      this.state = 'error'
      this.showFailHint()
      return false
    }
  }

  private showFailHint() {
    this.failHint.content = t`${fg(this.colors.textDim)("If update fails, run manually:")}\n${fg(this.colors.primary)(bold("  " + getManualUpdateCommand()))}`
    this.failHint.visible = true
  }

  public getState(): UpdateState {
    return this.state
  }

  public isUpdateAvailable(): boolean {
    return this.state === 'available'
  }

  private startAnimation() {
    if (this.animationInterval) return

    let kittyFrame = 0
    const frames = getKittyFramesForPhase('writing')

    this.animationInterval = setInterval(() => {
      kittyFrame = (kittyFrame + 1) % frames.length
      this.kittyArt.content = t`${fg(this.colors.primary)(frames[kittyFrame].join("\n"))}`
    }, 200)
  }

  private stopAnimation() {
    if (this.animationInterval) {
      clearInterval(this.animationInterval)
      this.animationInterval = null
    }
  }
}
