# Student portal — visual reference designs

These `.dc.html` files are the **visual reference** for the student design language
(spec: `docs/superpowers/plans/2026-09-02-student-design-language.md`). They are the
target for **structure, proportion, hierarchy, spacing rhythm and composition** — not
code to copy.

> That spec is **gitignored** — it is one task's scaffolding and is not in a clone. The
> durable rules are `docs/design/design-system.html`, the tokens in `packages/ui`, and the
> `ui-conventions` skill; where a section reference below points at the spec, read those.

**How to use them when building:**

1. **Read them for intent, not values.** Match the _layout_ (what sits where, the size
   relationships, the whitespace rhythm, the hero-then-grid structure). Do **not** copy
   their raw hex or fonts.
2. **Map every value to a real token.** A 28–36px heading → `--text-2xl`/`--text-3xl` +
   `--tracking-tight`; a 40px block gap → `--gap-section`; a 20px card pad →
   `--pad-card`; a card → the shared `Card` (already `rounded-xl border shadow-sm`); the
   one accent → `--red-600`, sparingly. The mapping table is §1 of the spec.
3. **Ignore three things in these files:** the display font (`Hanken Grotesk`) — build
   with **Inter only** (`--font-sans`); any raw hex — resolve to the nearest token; and
   the **"i" glyph in the rail — it is NOT the brand.** The brand is the **IACE**
   lockup rendered by the existing `Brandmark` component, and it sits in the
   **top-left of the header**, with the rail as **nav icons only** (no brand glyph).
   `Main.dc.html` and `MainPanel.dc.html` are the two Home treatments; **`MainPanel`**
   is the cleaner, Inter-only, token-aligned one.

   **The chrome comes from the existing `AppShell` (rail, top-bar `Brandmark`, page
   header) — do NOT rebuild it from these mockups.** These files inform the CONTENT
   AREA only; the shell, its rail, and the IACE brandmark stay exactly as shipped.

4. **Frames:** `Main` shows Home _on the background_ (`PageFrame` — the locked
   direction). `MainPanel` shows the _contained-panel_ alternative (`PanelFrame`) — use
   that pattern for the dense screens (question report, review, leaderboard) per §4.

Files: `Main` (Home, on-bg), `MainPanel` (Home, contained), `Tests`, `TestAbout`,
`Result`, `Performance`. The live canvas (same content, pannable) is the fastest way
for a human to eyeball proportions; these files are what a builder reads.
