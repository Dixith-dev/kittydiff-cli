/**
 * KittyDiff Animations & Theme Constants
 * Kitty animations, phase messages, and visual theme elements
 */

// ═══════════════════════════════════════════════════════════════════════════════
// KITTY ANIMATIONS
// ═══════════════════════════════════════════════════════════════════════════════

export const KITTY_IDLE = [
  [
    "   /\\_/\\   ",
    "  ( o.o )  ",
    "   > ^ <   ",
    "  /|   |\\ ",
    " (_|   |_) ",
  ],
  [
    "   /\\_/\\   ",
    "  ( -.- )  ",
    "   > ^ <   ",
    "  /|   |\\ ",
    " (_|   |_) ",
  ],
  [
    "   /\\_/\\   ",
    "  ( o.o )  ",
    "   > ^ <   ",
    "  /|   |\\ ",
    " (_|   |_) ",
  ],
  [
    "   /\\_/\\   ",
    "  ( ^.^ )  ",
    "   > ^ <   ",
    "  /|   |\\ ",
    " (_|   |_) ",
  ],
]

export const KITTY_SEARCHING = [
  [
    "   /\\_/\\   ",
    "  ( ◕.◕ )  ",
    "   > ∿ <   ",
    "  /|   |\\ ",
    " (_|   |_) ",
  ],
  [
    "   /\\_/\\   ",
    "  ( ◕.◕ )  ",
    "   > ∿ <   ",
    "  /|   |\\ ",
    " (_|   |_) ",
  ],
  [
    "   /\\_/\\   ",
    "  ( ◕ ◕ )  ",
    "   > ∿ <   ",
    "  /|   |\\ ",
    " (_|   |_) ",
  ],
]

export const KITTY_ANALYZING = [
  [
    "   /\\_/\\   ",
    "  ( •_• )  ",
    "   > ═ <   ",
    "  /|   |\\ ",
    " (_|   |_) ",
  ],
  [
    "   /\\_/\\   ",
    "  ( •.• )  ",
    "   > ═ <   ",
    "  /|   |\\ ",
    " (_|   |_) ",
  ],
  [
    "   /\\_/\\   ",
    "  ( -_- )  ",
    "   > ═ <   ",
    "  /|   |\\ ",
    " (_|   |_) ",
  ],
]

export const KITTY_WRITING = [
  [
    "   /\\_/\\   ",
    "  ( >.< )  ",
    "   > ~ <   ",
    "  /|   |\\ ",
    " (_|   |_) ",
  ],
  [
    "   /\\_/\\   ",
    "  ( >·< )  ",
    "   > ~ <   ",
    "  /|   |\\ ",
    " (_|   |_) ",
  ],
]

export const KITTY_DONE = [
  [
    "   /\\_/\\   ",
    "  ( ^ω^ )  ",
    "   > ♥ <   ",
    "  /|   |\\ ",
    " (_|   |_) ",
  ],
]

// ═══════════════════════════════════════════════════════════════════════════════
// REVIEW PHASES
// ═══════════════════════════════════════════════════════════════════════════════

export type ReviewPhase = 'scanning' | 'hunting' | 'analyzing' | 'deepDive' | 'writing' | 'complete'

export const PHASE_MESSAGES: Record<Exclude<ReviewPhase, 'complete'>, string[]> = {
  scanning: [
    "🔍 Kitty is sniffing through your code...",
    "👀 Prowling through the file tree...",
    "🐾 Following the code trails...",
    "📂 Exploring every corner of your repo...",
  ],
  hunting: [
    "🎯 Pouncing on potential bugs...",
    "🐛 Hunting for sneaky issues...",
    "⚡ Chasing down performance gremlins...",
    "🕵️ Tracking elusive edge cases...",
  ],
  analyzing: [
    "🧠 Inspecting every purrfect line...",
    "📊 Crunching the complexity numbers...",
    "🔬 Examining code under the microscope...",
    "💭 Thinking deeply about your patterns...",
  ],
  deepDive: [
    "🌊 Diving into the dependency ocean...",
    "🕳️ Exploring the rabbit holes...",
    "🔗 Tracing the function chain...",
    "🧩 Piecing together the architecture...",
  ],
  writing: [
    "✍️ Scratching out the findings...",
    "📝 Documenting discoveries...",
    "💬 Preparing the verdict...",
    "🎨 Polishing the report...",
  ],
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get a random message for a given review phase
 */
export function getRandomPhaseMessage(phase: Exclude<ReviewPhase, 'complete'>): string {
  const messages = PHASE_MESSAGES[phase]
  return messages[Math.floor(Math.random() * messages.length)]
}

/**
 * Get the appropriate kitty animation frames for a review phase
 */
export function getKittyFramesForPhase(phase: ReviewPhase): string[][] {
  switch (phase) {
    case 'scanning':
    case 'hunting':
      return KITTY_SEARCHING
    case 'analyzing':
    case 'deepDive':
      return KITTY_ANALYZING
    case 'writing':
      return KITTY_WRITING
    case 'complete':
      return KITTY_DONE
  }
}

