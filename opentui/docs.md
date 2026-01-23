Developer Guide : 

# Development Guide

## Prerequisites

- [Bun](https://bun.sh) - JavaScript runtime and package manager
- [Zig](https://ziglang.org/learn/getting-started/) - Required for building native modules

## Setup

```bash
git clone https://github.com/sst/opentui.git
cd opentui
bun install
```

## Building

```bash
bun run build
```

**Note:** Only needed when changing native Zig code. TypeScript changes don't require rebuilding.

## Running Examples

```bash
cd packages/core
bun run src/examples/index.ts
```

## Testing

```bash
# TypeScript tests
cd packages/core
bun test

# Native tests
bun run test:native

# Filter native tests
bun run test:native -Dtest-filter="test name"

# Benchmarks
bun run bench:native
```

## Local Development Linking

Link your local OpenTUI to another project:

```bash
./scripts/link-opentui-dev.sh /path/to/your/project
```

**Options:**

- `--react` - Also link `@opentui/react` and React dependencies
- `--solid` - Also link `@opentui/solid` and SolidJS dependencies
- `--dist` - Link built `dist` directories instead of source
- `--copy` - Copy instead of symlink (requires `--dist`)
- `--subdeps` - Find and link packages that depend on opentui (e.g., `opentui-spinner`)

**Examples:**

```bash
# Link core only
./scripts/link-opentui-dev.sh /path/to/your/project

# Link core and solid with subdependency discovery
./scripts/link-opentui-dev.sh /path/to/your/project --solid --subdeps

# Link built artifacts
./scripts/link-opentui-dev.sh /path/to/your/project --react --dist

# Copy for Docker/Windows
./scripts/link-opentui-dev.sh /path/to/your/project --dist --copy
```

The script automatically links:

- Main packages: `@opentui/core`, `@opentui/solid`, `@opentui/react`
- Peer dependencies: `yoga-layout`, `solid-js`, `react`, `react-dom`, `react-reconciler`
- Subdependencies (with `--subdeps`): Packages like `opentui-spinner` that depend on opentui

**Requirements:** Target project must have `node_modules` (run `bun install` first).

## Debugging

OpenTUI captures `console.log` output. Toggle the built-in console with backtick or use [Environment Variables](./env-vars.md) for debugging.

ENV - VARS :- 

# Environment Variables

# Environment Variables

## OTUI_TS_STYLE_WARN

Enable warnings for missing syntax styles

**Type:** `string`  
**Default:** `false`

## OTUI_TREE_SITTER_WORKER_PATH

Path to the TreeSitter worker

**Type:** `string`  
**Default:** `""`

## XDG_CONFIG_HOME

Base directory for user-specific configuration files

**Type:** `string`  
**Default:** `""`

## XDG_DATA_HOME

Base directory for user-specific data files

**Type:** `string`  
**Default:** `""`

## OTUI_DEBUG_FFI

Enable debug logging for the FFI bindings.

**Type:** `boolean`  
**Default:** `false`

## OTUI_TRACE_FFI

Enable tracing for the FFI bindings.

**Type:** `boolean`  
**Default:** `false`

## OPENTUI_FORCE_WCWIDTH

Use wcwidth for character width calculations

**Type:** `boolean`  
**Default:** `false`

## OPENTUI_FORCE_UNICODE

Force Mode 2026 Unicode support in terminal capabilities

**Type:** `boolean`  
**Default:** `false`

## OTUI_USE_CONSOLE

Whether to use the console. Will not capture console output if set to false.

**Type:** `boolean`  
**Default:** `true`

## SHOW_CONSOLE

Show the console at startup if set to true.

**Type:** `boolean`  
**Default:** `false`

## OTUI_DUMP_CAPTURES

Dump captured output when the renderer exits.

**Type:** `boolean`  
**Default:** `false`

## OTUI_NO_NATIVE_RENDER

Disable native rendering. This will not actually output ansi and is useful for debugging.

**Type:** `boolean`  
**Default:** `false`

## OTUI_USE_ALTERNATE_SCREEN

Whether to use the console. Will not capture console output if set to false.

**Type:** `boolean`  
**Default:** `true`

## OTUI_OVERRIDE_STDOUT

Override the stdout stream. This is useful for debugging.

**Type:** `boolean`  
**Default:** `true`

---

_generated via packages/core/dev/print-env-vars.ts_

# Getting Started with OpenTUI

OpenTUI is a TypeScript library for building terminal user interfaces (TUIs). It provides a component-based architecture with flexible layout capabilities, allowing you to create complex console applications.

## Core Concepts

### Renderer

The `CliRenderer` is the heart of OpenTUI. It manages the terminal output, handles input events, and orchestrates the rendering loop. Think of it as the canvas that draws your interface to the terminal. It can run in a "live" mode, when calling `renderer.start()`, which runs a loop capped at the specified target FPS. It also just works without calling `renderer.start()`, which will only re-render when the renderable tree or layout changes.

### FrameBuffer (OptimizedBuffer)

The `FrameBuffer` is a low-level rendering surface for custom graphics and complex visual effects. It is a 2D array of cells that can be drawn to using the `setCell`, `setCellWithAlphaBlending`, `drawText`, `fillRect`, and `drawFrameBuffer` methods. It is optimized for performance and memory usage. It allows for transparent cells and alpha blending, down to the viewport framebuffer.

### Renderables

Renderables are the building blocks of your UI - hierarchical objects that can be positioned, styled, and nested within each other. Each Renderable represents a visual element (like text, boxes, or input fields) and uses the Yoga layout engine for flexible positioning and sizing.

### Constructs (Components)

Constructs look just like React or Solid components, but are not render functions. You can think of them as constructors, a way to create new renderables by composing existing ones. They provide a more declarative way to build your UI. See a comparison on [this page](./renderables-vs-constructs.md).

### Console

OpenTUI includes a built-in console overlay that captures all `console.log`, `console.info`, `console.warn`, `console.error`, and `console.debug` calls. The console appears as a visual overlay that can be positioned at any edge of the terminal, with scrolling and focus management. It's particularly useful for debugging TUI applications without disrupting the main interface.

## Basic Setup

```typescript
import { createCliRenderer, TextRenderable, Text } from "@opentui/core"

const renderer = await createCliRenderer()

// Raw Renderable
const greeting = new TextRenderable(renderer, {
  id: "greeting",
  content: "Hello, OpenTUI!",
  fg: "#00FF00",
  position: "absolute",
  left: 10,
  top: 5,
})

renderer.root.add(greeting)

// Construct/Component (VNode)
const greeting2 = Text({
  content: "Hello, OpenTUI!",
  fg: "#00FF00",
  position: "absolute",
  left: 10,
  top: 5,
})

renderer.root.add(greeting)
```

## Console

When focused, you can use your arrow keys to scroll through the console. `renderer.console.toggle()` will toggle the console overlay, when open but not focused, it will focus the console. `+` and `-` will increase and decrease the size of the console.

```typescript
import { createCliRenderer, ConsolePosition } from "@opentui/core"

const renderer = await createCliRenderer({
  consoleOptions: {
    position: ConsolePosition.BOTTOM,
    sizePercent: 30,
    colorInfo: "#00FFFF",
    colorWarn: "#FFFF00",
    colorError: "#FF0000",
    startInDebugMode: false,
  },
})

console.log("This appears in the overlay")
console.error("Errors are color-coded red")
console.warn("Warnings appear in yellow")

renderer.console.toggle()
```

## Colors: RGBA

OpenTUI uses the `RGBA` class for consistent color representation throughout the library. Colors are internally stored as normalized float values (0.0-1.0) for efficient processing, but the class provides convenient methods for working with different color formats.

```typescript
import { RGBA } from "@opentui/core"

const redFromInts = RGBA.fromInts(255, 0, 0, 255) // RGB integers (0-255)
const blueFromValues = RGBA.fromValues(0.0, 0.0, 1.0, 1.0) // Float values (0.0-1.0)
const greenFromHex = RGBA.fromHex("#00FF00") // Hex strings
const transparent = RGBA.fromValues(1.0, 1.0, 1.0, 0.5) // Semi-transparent white
```

The `parseColor()` utility function accepts both RGBA objects and color strings (hex, CSS color names, "transparent") for flexible color input throughout the API.

## Keyboard

OpenTUI provides a keyboard handler that parses terminal input and provides structured key events. Get the handler via `renderer.keyInput`, an EventEmitter that emits `keypress` and `paste` events with detailed key information.

```typescript
import { type KeyEvent } from "@opentui/core"

const keyHandler = renderer.keyInput

keyHandler.on("keypress", (key: KeyEvent) => {
  console.log("Key name:", key.name)
  console.log("Sequence:", key.sequence)
  console.log("Ctrl pressed:", key.ctrl)
  console.log("Shift pressed:", key.shift)
  console.log("Alt pressed:", key.meta)
  console.log("Option pressed:", key.option)

  if (key.name === "escape") {
    console.log("Escape pressed!")
  } else if (key.ctrl && key.name === "c") {
    console.log("Ctrl+C pressed!")
  } else if (key.shift && key.name === "f1") {
    console.log("Shift+F1 pressed!")
  }
})
```

## Available Renderables

OpenTUI provides several primitive components that you can use to build your interfaces:

### Text

Display styled text content with support for colors, attributes, and text selection.

```typescript
import { TextRenderable, TextAttributes, t, bold, underline, fg } from "@opentui/core"

const plainText = new TextRenderable(renderer, {
  id: "plain-text",
  content: "Important Message",
  fg: "#FFFF00",
  attributes: TextAttributes.BOLD | TextAttributes.UNDERLINE, // bitwise OR to combine attributes
  position: "absolute",
  left: 5,
  top: 2,
})

// You can also use the `t` template literal to create more complex styled text:
const styledTextRenderable = new TextRenderable(renderer, {
  id: "styled-text",
  content: t`${bold("Important Message")} ${fg("#FF0000")(underline("Important Message"))}`,
  position: "absolute",
  left: 5,
  top: 3,
})
```

### Box

A container component with borders, background colors, and layout capabilities. Perfect for creating panels, frames, and organized sections.

```typescript
import { BoxRenderable } from "@opentui/core"

const panel = new BoxRenderable(renderer, {
  id: "panel",
  width: 30,
  height: 10,
  backgroundColor: "#333366",
  borderStyle: "double",
  borderColor: "#FFFFFF",
  title: "Settings Panel",
  titleAlignment: "center",
  position: "absolute",
  left: 10,
  top: 5,
})
```

### Input

Text input field with cursor support, placeholder text, and focus states for user interaction.
Has to be focused to receive input.

```typescript
import { InputRenderable, InputRenderableEvents } from "@opentui/core"

const nameInput = new InputRenderable(renderer, {
  id: "name-input",
  width: 25,
  placeholder: "Enter your name...",
  focusedBackgroundColor: "#1a1a1a",
  position: "absolute",
  left: 10,
  top: 8,
})

// The change event is currently emitted when pressing return or enter. (this will be fixed in the future)
nameInput.on(InputRenderableEvents.CHANGE, (value) => {
  console.log("Input changed:", value)
})
nameInput.focus()
```

### Select

A list selection component for choosing from multiple options.
Has to be focused to receive input. Default keybindings are `up/k` and `down/j` to navigate the list, `enter` to select.

```typescript
import { SelectRenderable, SelectRenderableEvents } from "@opentui/core"

const menu = new SelectRenderable(renderer, {
  id: "menu",
  width: 30,
  height: 8,
  options: [
    { name: "New File", description: "Create a new file" },
    { name: "Open File", description: "Open an existing file" },
    { name: "Save", description: "Save current file" },
    { name: "Exit", description: "Exit the application" },
  ],
  position: "absolute",
  left: 5,
  top: 3,
})

menu.on(SelectRenderableEvents.ITEM_SELECTED, (index, option) => {
  console.log("Selected:", option.name)
})
menu.focus()
```

### TabSelect

Horizontal tab-based selection component with descriptions and scroll support.
Has to be focused to receive input. Default keybindings are `left/[` and `right/]` to navigate the tabs, `enter` to select.

```typescript
import { TabSelectRenderable, TabSelectRenderableEvents } from "@opentui/core"

const tabs = new TabSelectRenderable(renderer, {
  id: "tabs",
  width: 60,
  options: [
    { name: "Home", description: "Dashboard and overview" },
    { name: "Files", description: "File management" },
    { name: "Settings", description: "Application settings" },
  ],
  tabWidth: 20,
  position: "absolute",
  left: 2,
  top: 1,
})

tabs.on(TabSelectRenderableEvents.ITEM_SELECTED, (index, option) => {
  console.log("Selected:", option.name)
})

tabs.focus()
```

### ASCIIFont

Display text using ASCII art fonts with multiple font styles available.

```typescript
import { ASCIIFontRenderable, RGBA } from "@opentui/core"

const title = new ASCIIFontRenderable(renderer, {
  id: "title",
  text: "OPENTUI",
  font: "tiny",
  color: RGBA.fromInts(255, 255, 255, 255),
  position: "absolute",
  left: 10,
  top: 2,
})
```

### FrameBuffer

A low-level rendering surface for custom graphics and complex visual effects.

```typescript
import { FrameBufferRenderable, RGBA } from "@opentui/core"

const canvas = new FrameBufferRenderable(renderer, {
  id: "canvas",
  width: 50,
  height: 20,
  position: "absolute",
  left: 5,
  top: 5,
})

// Custom rendering in the frame buffer
canvas.frameBuffer.fillRect(10, 5, 20, 8, RGBA.fromHex("#FF0000"))
canvas.frameBuffer.drawText("Custom Graphics", 12, 7, RGBA.fromHex("#FFFFFF"))
```

## Layout System

OpenTUI uses the Yoga layout engine, providing CSS Flexbox-like capabilities for responsive layouts:

```typescript
import { GroupRenderable, BoxRenderable } from "@opentui/core"

const container = new GroupRenderable(renderer, {
  id: "container",
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
  width: "100%",
  height: 10,
})

const leftPanel = new BoxRenderable(renderer, {
  id: "left",
  flexGrow: 1,
  height: 10,
  backgroundColor: "#444",
})

const rightPanel = new BoxRenderable(renderer, {
  id: "right",
  width: 20,
  height: 10,
  backgroundColor: "#666",
})

container.add(leftPanel)
container.add(rightPanel)
```

## Next Steps

- Explore the [examples](../src/examples) directory for more complex use cases
- Check out the React and Solid integrations for declarative UI development


# Renderables vs Constructs

Lets look at two ways of composing Renderables, imperative and declarative.
Assume we want to create a simple "login" form with a username and password input.

## Imperative

Creates concrete `Renderable` instances with a `RenderContext` and composes via `add()`. State/behavior are mutated directly on instances (setters/methods), with mouse/key events bubbling upward through `processMouseEvent` for example.

```typescript
import { BoxRenderable, TextRenderable, InputRenderable, createCliRenderer, type RenderContext } from "@opentui/core"

const renderer = await createCliRenderer()

const loginForm = new BoxRenderable(renderer, {
  id: "login-form",
  width: 20,
  height: 10,
  padding: 1,
})

// Compose renderables to a single renderable.
// Needs a RendererContext at creation time.
function createLabeledInput(renderer: RenderContext, props: { label: string; placeholder: string; id: string }) {
  const labeledInput = new BoxRenderable(renderer, {
    id: `${props.id}-labeled-input`,
    flexDirection: "row",
    backgroundColor: "gray",
  })

  labeledInput.add(
    new TextRenderable(renderer, {
      id: `${props.id}-label`,
      content: props.label + " ",
    }),
  )
  labeledInput.add(
    new InputRenderable(renderer, {
      id: `${props.id}-input`,
      placeholder: props.placeholder,
      backgroundColor: "white",
      textColor: "black",
      cursorColor: "blue",
      focusedBackgroundColor: "orange",
      width: 20,
    }),
  )

  return labeledInput
}

const labeledUsername = createLabeledInput(renderer, {
  id: "username",
  label: "Username:",
  placeholder: "Enter your username...",
})
loginForm.add(labeledUsername)

// Now it becomse difficult to focus. because it is in a container.
// This does not work:
labeledUsername.focus()

// Needs to be:
labeledUsername.getRenderable("username-input")?.focus()

const labeledPassword = createLabeledInput(renderer, {
  id: "password",
  label: "Password:",
  placeholder: "Enter your password...",
})
loginForm.add(labeledPassword)

// Compose a button component
function createButton(props: { content: string; onClick: () => void; id: string }) {
  const box = new BoxRenderable(renderer, {
    id: `${props.id}-button`,
    border: true,
    backgroundColor: "gray",
    onMouseDown: props.onClick,
  })
  const text = new TextRenderable(renderer, {
    id: `${props.id}-button-text`,
    content: props.content,
    selectable: false,
  })
  box.add(text)
  return box
}

const buttons = new BoxRenderable(renderer, {
  id: "buttons",
  flexDirection: "row",
  padding: 1,
  width: 20,
})
buttons.add(createButton({ id: "register", content: "Register", onClick: () => {} }))
buttons.add(createButton({ id: "login", content: "Login", onClick: () => {} }))
loginForm.add(buttons)

renderer.root.add(loginForm)
```

## Declarative

Builds an allegedly lightweight VNode graph using functional constructs that return VNodes; no instances exist until `instantiate(ctx, vnode)` is called. During instantiation, children are flattened, renderables are created and added, and any chained method/property calls made on VNodes are replayed on the created instance. `delegate(mapping, vnode)` can annotate the VNode so selected APIs (e.g., `focus`, `add`) are later routed to a specific descendant when the instance is created.

```typescript
import { Text, Input, Box, createCliRenderer, delegate, instantiate } from "@opentui/core"

const renderer = await createCliRenderer()

function LabeledInput(props: { id: string; label: string; placeholder: string }) {
  return delegate(
    {
      focus: `${props.id}-input`,
    },
    Box(
      { flexDirection: "row" },
      Text({ content: props.label + " " }),
      Input({
        id: `${props.id}-input`,
        placeholder: props.placeholder,
        width: 20,
        backgroundColor: "white",
        textColor: "black",
        cursorColor: "blue",
        focusedBackgroundColor: "orange",
      }),
    ),
  )
}

function Button(props: { id: string; content: string; onClick: () => void }) {
  return Box(
    {
      border: true,
      backgroundColor: "gray",
      onMouseDown: props.onClick,
    },
    Text({ content: props.content, selectable: false }),
  )
}

const usernameInput = LabeledInput({ id: "username", label: "Username:", placeholder: "Enter your username..." })
usernameInput.focus()

const loginForm = Box(
  { width: 20, height: 10, padding: 1 },
  usernameInput,
  LabeledInput({ id: "password", label: "Password:", placeholder: "Enter your password..." }),
  Box(
    { flexDirection: "row", padding: 1, width: 20 },
    Button({ id: "login", content: "Login", onClick: () => {} }),
    Button({ id: "register", content: "Register", onClick: () => {} }),
  ),
)

renderer.root.add(loginForm)
```

# Tree-Sitter

## Adding Custom Parsers

There are two ways to add custom parsers to your application:

### 1. Global Default Parsers (Recommended)

Use `addDefaultParsers()` to add parsers globally before initializing any clients. This is useful when you want all Tree-Sitter clients in your application to support the same languages.

```typescript
import { addDefaultParsers, getTreeSitterClient } from "@opentui/core"

// Add Python parser globally
addDefaultParsers([
  {
    filetype: "python",
    wasm: "https://github.com/tree-sitter/tree-sitter-python/releases/download/v0.23.6/tree-sitter-python.wasm",
    queries: {
      highlights: ["https://raw.githubusercontent.com/tree-sitter/tree-sitter-python/master/queries/highlights.scm"],
    },
  },
])

// Now all clients will have Python support
const client = getTreeSitterClient()
await client.initialize()

// Highlight Python code
const pythonCode = 'def hello():\n    print("world")'
const result = await client.highlightOnce(pythonCode, "python")
```

### 2. Per-Client Parsers

Use `client.addFiletypeParser()` to add parsers to a specific client instance. This is useful when different parts of your application need different language support.

```typescript
import { TreeSitterClient } from "@opentui/core"

const client = new TreeSitterClient({ dataPath: "./cache" })
await client.initialize()

// Add Rust parser to this specific client
client.addFiletypeParser({
  filetype: "rust",
  wasm: "https://github.com/tree-sitter/tree-sitter-rust/releases/download/v0.23.2/tree-sitter-rust.wasm",
  queries: {
    highlights: ["https://raw.githubusercontent.com/tree-sitter/tree-sitter-rust/master/queries/highlights.scm"],
  },
})

// Highlight Rust code
const rustCode = 'fn main() {\n    println!("Hello, world!");\n}'
const result = await client.highlightOnce(rustCode, "rust")
```

## Parser Configuration Structure

The `FiletypeParserOptions` interface defines how to configure a parser:

```typescript
interface FiletypeParserOptions {
  filetype: string // The filetype identifier (e.g., "python", "rust")
  wasm: string // URL or local file path to the .wasm parser file
  queries: {
    highlights: string[] // Array of URLs or local file paths to .scm query files
  }
}
```

## Finding Parsers and Queries

### Official Tree-Sitter Parsers

Most popular languages have official parsers:

```typescript
// Official parsers follow this pattern:
const parserUrl =
  "https://github.com/tree-sitter/tree-sitter-{language}/releases/download/v{version}/tree-sitter-{language}.wasm"

// Examples:
// Python: https://github.com/tree-sitter/tree-sitter-python/releases/download/v0.23.6/tree-sitter-python.wasm
// Rust: https://github.com/tree-sitter/tree-sitter-rust/releases/download/v0.23.2/tree-sitter-rust.wasm
// Go: https://github.com/tree-sitter/tree-sitter-go/releases/download/v0.23.4/tree-sitter-go.wasm
```

### Finding Highlight Queries

Highlight queries are usually found in the parser repository's `queries/` directory:

```typescript
// Official queries:
const queryUrl = "https://raw.githubusercontent.com/tree-sitter/tree-sitter-{language}/master/queries/highlights.scm"

// Or from nvim-treesitter (often more comprehensive):
const nvimQueryUrl =
  "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/master/queries/{language}/highlights.scm"
```

### Combining Multiple Queries

Some languages require multiple query files. For example, TypeScript uses JavaScript queries plus TypeScript-specific queries:

```typescript
addDefaultParsers([
  {
    filetype: "typescript",
    wasm: "https://github.com/tree-sitter/tree-sitter-typescript/releases/download/v0.23.2/tree-sitter-typescript.wasm",
    queries: {
      highlights: [
        // Base ECMAScript/JavaScript queries
        "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/master/queries/ecma/highlights.scm",
        // TypeScript-specific queries
        "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/master/queries/typescript/highlights.scm",
      ],
    },
  },
])
```

## Using Local Files

For better performance and offline support, you can bundle parsers and queries with your application:

```typescript
// Using Bun's file import
import pythonWasm from "./parsers/tree-sitter-python.wasm" with { type: "file" }
import pythonHighlights from "./queries/python/highlights.scm" with { type: "file" }

addDefaultParsers([
  {
    filetype: "python",
    wasm: pythonWasm,
    queries: {
      highlights: [pythonHighlights],
    },
  },
])
```

## Automated Parser Management

You can automate parser downloads and import generation using the `updateAssets` utility. This is especially useful when supporting multiple languages or integrating parser management into your build pipeline.

### Creating a Parser Configuration

Create a `parsers-config.json` file in your project:

```json
{
  "parsers": [
    {
      "filetype": "python",
      "wasm": "https://github.com/tree-sitter/tree-sitter-python/releases/download/v0.23.6/tree-sitter-python.wasm",
      "queries": {
        "highlights": ["https://raw.githubusercontent.com/tree-sitter/tree-sitter-python/master/queries/highlights.scm"]
      }
    },
    {
      "filetype": "rust",
      "wasm": "https://github.com/tree-sitter/tree-sitter-rust/releases/download/v0.23.2/tree-sitter-rust.wasm",
      "queries": {
        "highlights": ["https://raw.githubusercontent.com/tree-sitter/tree-sitter-rust/master/queries/highlights.scm"]
      }
    }
  ]
}
```

### Integrating into Build Pipeline

#### CLI Usage

Add the update script to your `package.json`:

```json
{
  "scripts": {
    "prebuild": "bun node_modules/@opentui/core/lib/tree-sitter/assets/update.ts --config ./parsers-config.json --assets ./src/parsers --output ./src/parsers.ts",
    "build": "bun build ./src/index.ts"
  }
}
```

#### Programmatic Usage

Or call it programmatically in your build script:

```typescript
import { updateAssets } from "@opentui/core"

await updateAssets({
  configPath: "./parsers-config.json",
  assetsDir: "./src/parsers",
  outputPath: "./src/parsers.ts",
})
```

### Using Generated Parsers

The script generates a TypeScript file with all parsers pre-configured:

```typescript
import { addDefaultParsers, getTreeSitterClient } from "@opentui/core"
import { getParsers } from "./parsers" // Generated file

addDefaultParsers(getParsers())

const client = getTreeSitterClient()
await client.initialize()

const result = await client.highlightOnce('def hello():\n    print("world")', "python")
```

## Complete Example: Adding Multiple Languages

```typescript
import { addDefaultParsers, getTreeSitterClient, SyntaxStyle } from "@opentui/core"

// Add support for multiple languages before initializing
addDefaultParsers([
  {
    filetype: "python",
    wasm: "https://github.com/tree-sitter/tree-sitter-python/releases/download/v0.23.6/tree-sitter-python.wasm",
    queries: {
      highlights: ["https://raw.githubusercontent.com/tree-sitter/tree-sitter-python/master/queries/highlights.scm"],
    },
  },
  {
    filetype: "rust",
    wasm: "https://github.com/tree-sitter/tree-sitter-rust/releases/download/v0.23.2/tree-sitter-rust.wasm",
    queries: {
      highlights: ["https://raw.githubusercontent.com/tree-sitter/tree-sitter-rust/master/queries/highlights.scm"],
    },
  },
  {
    filetype: "go",
    wasm: "https://github.com/tree-sitter/tree-sitter-go/releases/download/v0.23.4/tree-sitter-go.wasm",
    queries: {
      highlights: ["https://raw.githubusercontent.com/tree-sitter/tree-sitter-go/master/queries/highlights.scm"],
    },
  },
])

// Initialize the client
const client = getTreeSitterClient()
await client.initialize()

// Use with different languages
const syntaxStyle = new SyntaxStyle()

const pythonResult = await client.highlightOnce('def hello():\n    print("world")', "python")

const rustResult = await client.highlightOnce('fn main() {\n    println!("Hello");\n}', "rust")

const goResult = await client.highlightOnce('func main() {\n    fmt.Println("Hello")\n}', "go")
```

## Using with CodeRenderable

The `CodeRenderable` component automatically uses the Tree-Sitter client for syntax highlighting:

```typescript
import { CodeRenderable, getTreeSitterClient } from "@opentui/core"

// Initialize the client with custom parsers
const client = getTreeSitterClient()
await client.initialize()

// Create a code renderable
const codeBlock = new CodeRenderable("code-1", {
  content: 'def hello():\n    print("world")',
  filetype: "python",
  width: 40,
  height: 10,
})

// The CodeRenderable will automatically use the Tree-Sitter client
// to highlight the code
```

## Caching

Parser and query files are automatically cached in the `dataPath` directory to avoid re-downloading them.
You can customize the cache location when creating a client:

```typescript
const client = new TreeSitterClient({
  dataPath: "./my-custom-cache",
})
```

## File Type Resolution

OpenTUI provides utilities to automatically determine filetypes from file paths:

```typescript
import { pathToFiletype, extToFiletype } from "@opentui/core"

// Get filetype from file path
const ft1 = pathToFiletype("src/main.rs") // "rust"
const ft2 = pathToFiletype("app.py") // "python"

// Get filetype from extension
const ft3 = extToFiletype("ts") // "typescript"
const ft4 = extToFiletype("js") // "javascript"
```

Built-in mappings include: `js`, `jsx`, `ts`, `tsx`, `py`, `rb`, `go`, `rs`, `c`, `cpp`, `html`, `css`, and more.