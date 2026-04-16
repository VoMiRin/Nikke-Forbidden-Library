# Design System Document: The Archive Editorial

## 1. Overview & Creative North Star
**Creative North Star: The Digital Curator**

This design system moves away from the "database" aesthetic and toward a "curated editorial" experience. It treats game scripts not as raw data, but as prestigious literature. The system rejects the rigid, boxy constraints of traditional web archives in favor of **intentional asymmetry, breathability, and tonal depth.** 

By utilizing high-contrast typography scales and layered surfaces, we create a "Zen" environment where the user’s focus is entirely on the narrative. The experience should feel like reading a high-end physical journal—tactile, quiet, and premium.

---

## 2. Colors & Surface Philosophy

### The "No-Line" Rule
Standard 1px borders are strictly prohibited for sectioning or containment. Traditional lines create visual "noise" that interrupts the reading flow. Instead, boundaries are defined through:
1.  **Background Color Shifts:** Placing a `surface-container-low` card against a `surface` background.
2.  **Negative Space:** Using generous padding to imply grouping.

### Surface Hierarchy & Nesting
The UI is a series of stacked, physical layers. We use the Material surface tiers to define importance:
*   **Background (`surface` / `#131313`):** The base floor.
*   **Sections (`surface-container-low` / `#1C1B1B`):** Large structural areas.
*   **Interactive Cards (`surface-container-high` / `#2A2A2A`):** Elements that demand engagement.

### The "Glass & Gradient" Rule
To prevent a "flat" digital feel, floating elements (like the Navigation Bar) must utilize **Glassmorphism**:
*   **Background:** Semi-transparent `surface` color (80% opacity).
*   **Blur:** `backdrop-blur-md`.
*   **Subtle Soul:** Use a linear gradient on Primary CTAs transitioning from `primary` (`#8ED5FF`) to `primary-container` (`#38BDF8`) at a 135-degree angle.

---

## 3. Typography: The Editorial Voice

The system uses a dual-personality typographic approach to balance modern navigation with classical storytelling.

*   **The Structural Voice (Manrope / Inter):** Used for UI elements, labels, and metadata. It is precise, clinical, and modern. 
*   **The Narrative Voice (Noto Serif KR):** Used for the actual script content. Serif fonts enhance readability for long-form text and provide a literary weight that sans-serifs lack.

### Key Scales
*   **Display-LG (Manrope, 3.5rem):** Reserved for major Chapter titles. Use `on-surface` with a slight letter-spacing reduction (-0.02em).
*   **Title-LG (Noto Serif KR, 1.375rem):** Dialogue text. High line-height (1.7) for maximum legibility.
*   **Label-MD (Inter, 0.75rem):** Metadata like character names or timestamps. Always uppercase with increased letter-spacing (+0.05em).

---

## 4. Elevation & Depth

### The Layering Principle
Avoid "drop shadows" to define cards. Instead, stack tiers:
*   Place a `surface-container-highest` (`#353534`) element inside a `surface-container` (`#201F1F`) wrapper. This creates a "soft lift" that feels architectural rather than digital.

### Ambient Shadows
When an element must "float" (e.g., a dialogue choice menu), use an **Ambient Shadow**:
*   **Blur:** 40px - 60px.
*   **Opacity:** 6% of `on-surface`.
*   **Color:** Tint the shadow with a hint of `primary` to make it feel like light is passing through a lens.

### The "Ghost Border" Fallback
If a separation is required for accessibility, use a **Ghost Border**:
*   `outline-variant` (`#3E484F`) at **15% opacity**. It should be felt, not seen.

---

## 5. Components

### Navigation Bar
*   **Style:** Fixed at the top, `surface` color with `backdrop-blur`. 
*   **Transition:** Dark/Light mode toggle should use a 500ms spring physics animation (Framer Motion: `stiffness: 200, damping: 20`).
*   **Visual:** No bottom border. Use a subtle `surface-container-low` background shift on scroll.

### Interactive Chapter Cards
*   **Layout:** Asymmetric. Title aligned left, metadata (`label-sm`) tucked in the bottom right.
*   **Interaction:** On hover, the background shifts from `surface-container` to `surface-container-highest` over 200ms. Scale the card slightly (1.02x).

### Script Viewer Elements
*   **Dialogue Block:** Character name in `label-md` (Inter, uppercase), followed by a 16px gap, then the dialogue in `title-md` (Noto Serif KR).
*   **Choice Blocks:** Styled as "Ghost Buttons"—`outline-variant` at 20% opacity. Upon hover, fill with `primary-container` and transition text to `on-primary-container`.
*   **Messenger Bubbles:** For "phone" style segments, use `surface-container-highest` for the bubble with a `xl` (0.75rem) border radius. Avoid "tails" on bubbles to keep the minimal aesthetic.

### Buttons & Chips
*   **Primary Button:** Gradient fill (`primary` to `primary-container`). `full` (pill) radius. No shadow.
*   **Action Chips:** Small, `surface-container-high` background. Used for tags like "Main Story" or "Bond Episode."

---

## 6. Do's and Don'ts

### Do
*   **Do** use extreme white space. If you think there's enough padding, add 16px more.
*   **Do** prioritize Noto Serif KR for any text longer than two sentences.
*   **Do** use "surface-nesting" to create hierarchy instead of lines.
*   **Do** ensure all transitions use a custom cubic-bezier (e.g., `[0.22, 1, 0.36, 1]`) for a "boutique" feel.

### Don't
*   **Don't** use pure black (`#000000`). Always use the `surface` token (`#131313`).
*   **Don't** use standard "Select" or "Input" boxes. Design them to be "invisible" until interaction, using tonal shifts.
*   **Don't** use high-contrast dividers. Use a 24px/32px/48px spacing scale to separate content blocks.
*   **Don't** use icons without labels unless they are universally recognized (e.g., Search, Settings). Even then, prefer text-based labels for an editorial look.