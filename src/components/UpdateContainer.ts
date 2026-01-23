import {
  BoxRenderable,
  TextRenderable,
  t,
  bold,
  fg,
} from "@opentui/core"
import { KITTY_IDLE, getKittyFramesForPhase } from "../animations"

export class UpdateContainer {
  public overlay: BoxRenderable
  private updateMessage: TextRenderable
  private progressBar: TextRenderable
  private failHint: TextRenderable
  private animationInterval: ReturnType<typeof setInterval> | null = null

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

    const spacer1 = new BoxRenderable(renderer, { id: "up-sp1", height: 1 })
    this.overlay.add(spacer1)

    this.updateMessage = new TextRenderable(renderer, {
      id: "update-message",
      content: t`${fg(colors.text)("Checking for updates...")}`,
    })
    this.overlay.add(this.updateMessage)

    const spacer2 = new BoxRenderable(renderer, { id: "up-sp2", height: 1 })
    this.overlay.add(spacer2)

    this.progressBar = new TextRenderable(renderer, {
      id: "update-progress-bar",
      content: t`${fg(colors.textDim)("[" + "░".repeat(40) + "]")}  ${fg(colors.textMuted)("0%")}`,
    })
    this.overlay.add(this.progressBar)

    const spacer3 = new BoxRenderable(renderer, { id: "up-sp3", height: 1 })
    this.overlay.add(spacer3)

    this.failHint = new TextRenderable(renderer, {
      id: "update-fail-hint",
      content: t`${fg(colors.textDim)("if update keeps failing run command:")}\n${fg(colors.primary)(bold("  npm install -g kittydiff-cli"))}`,
      visible: false
    })
    this.overlay.add(this.failHint)
  }

  private updateProgressBar(progress: number) {
    const filled = Math.floor(progress * 40)
    const empty = 40 - filled
    const percent = Math.floor(progress * 100)
    const bar = "█".repeat(filled) + "░".repeat(empty)
    this.progressBar.content = t`${fg(this.colors.primary)("[")}${fg(this.colors.gradientMid)(bar)}${fg(this.colors.primary)("]")}  ${fg(this.colors.text)(percent.toString() + "%")}`
  }

  public show() {
    this.overlay.visible = true
    this.failHint.visible = false
    this.startAnimation()
  }

  public hide() {
    this.overlay.visible = false
    this.stopAnimation()
    this.kittyArt.content = t`${fg(this.colors.primary)(KITTY_IDLE[0].join("\n"))}`
  }

  private startAnimation() {
    if (this.animationInterval) return

    let progress = 0
    let kittyFrame = 0
    const frames = getKittyFramesForPhase('writing') // Using 'writing' animation for update

    this.animationInterval = setInterval(() => {
      progress += 0.02
      if (progress > 1) {
        progress = 1
        this.updateMessage.content = t`${fg(this.colors.success)(bold("Update complete!"))}`
        this.failHint.visible = true
        clearInterval(this.animationInterval!)
        this.animationInterval = null
      } else {
        this.updateMessage.content = t`${fg(this.colors.text)("Downloading update...")}`
      }

      this.updateProgressBar(progress)

      // Animate kitty
      kittyFrame = (kittyFrame + 1) % frames.length
      this.kittyArt.content = t`${fg(this.colors.primary)(frames[kittyFrame].join("\n"))}`
    }, 100)
  }

  private stopAnimation() {
    if (this.animationInterval) {
      clearInterval(this.animationInterval)
      this.animationInterval = null
    }
  }
}

