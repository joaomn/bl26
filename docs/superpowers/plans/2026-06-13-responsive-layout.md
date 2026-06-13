# Responsividade (celular/tablet/desktop) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Bolão.Melo static webapp (`index.html`, `style.css`) display well on phones (~320-480px), tablets (~481-1024px), and desktops (>1024px), fixing the header overflow risk and adding a proper tablet breakpoint.

**Architecture:** Two-file change. `index.html` gets one small markup change (wrap repeated flag emojis in a `<span class="header-flags">` so they can be hidden on small screens). `style.css` gets: (1) a small structural tweak to `.header-flags`/`.screen`/touch-target rules, and (2) the existing single `@media (max-width: 600px)` block replaced by two ordered blocks — `@media (max-width: 1024px)` (tablet) and `@media (max-width: 480px)` (phone, refined from the old 600px block).

**Tech Stack:** Plain HTML/CSS, no build step. Verify with `python3 -m http.server` + browser viewport resizing.

---

## File Structure

- Modify: `index.html` (header markup, line 44)
- Modify: `style.css`:
  - `.screen` rule (lines 36-39) — `dvh` fallback
  - `.filter-btn` (lines 316-326) and `.admin-status-btn` (lines 785-795) — touch target sizing
  - `RESPONSIVE` section (lines 507-518) — replaced by tablet + phone blocks

No new files.

---

### Task 1: Wrap repeated flag emojis in the header markup

**Files:**
- Modify: `index.html:44`

- [ ] **Step 1: Edit the header logo span**

Current line 44:
```html
          <span class="header-logo">🏆 🇧🇷🇧🇷🇧🇷 BOLÃO<span class="accent">.</span>Melo 🇧🇷🇧🇷🇧🇷</span>
```

Replace with:
```html
          <span class="header-logo">🏆 <span class="header-flags">🇧🇷🇧🇷🇧🇷 </span>BOLÃO<span class="accent">.</span>Melo<span class="header-flags"> 🇧🇷🇧🇷🇧🇷</span></span>
```

- [ ] **Step 2: Verify the edit**

Run: `grep -o 'header-flags' index.html`
Expected output (2 lines):
```
header-flags
header-flags
```

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "Wrap header flag emojis in span for responsive hiding"
```

---

### Task 2: Header wrap behavior + tablet breakpoint (`max-width: 1024px`)

**Files:**
- Modify: `style.css:507-518` (the existing `RESPONSIVE` section header + the `@media (max-width: 600px)` block)

This task replaces the section header comment and inserts a new tablet block **before** the existing mobile block (order matters: tablet block must come first so the phone block, edited in Task 3, can override it for narrow widths).

- [ ] **Step 1: Replace the RESPONSIVE section header and insert the tablet block**

Current (lines 507-518):
```css
/* ---------- RESPONSIVE ---------- */

@media (max-width: 600px) {
  .login-card { padding: 36px 24px; margin: 16px; }
  .logo-title { font-size: 2.4rem; }
  .games-section { grid-template-columns: 1fr; }
  .header-inner { padding: 12px 16px; }
  .main { padding: 24px 16px; }
  .game-result { font-size: 1.8rem; }
  .team-flag { font-size: 2rem; }
  .user-badge { max-width: 130px; }
}
```

Replace with:
```css
/* ---------- RESPONSIVE ---------- */

/* Tablet: header wraps to two rows, slightly tighter page padding */
@media (max-width: 1024px) {
  .main { padding: 28px 20px; }

  .header-inner {
    flex-wrap: wrap;
    row-gap: 8px;
  }

  .header-right { margin-left: auto; }
}

@media (max-width: 480px) {
  .login-card { padding: 36px 24px; margin: 16px; }
  .logo-title { font-size: 2.4rem; }
  .games-section { grid-template-columns: 1fr; }
  .header-inner { padding: 12px 16px; }
  .main { padding: 24px 16px; }
  .game-result { font-size: 1.8rem; }
  .team-flag { font-size: 2rem; }
  .user-badge { max-width: 130px; }
}
```

Note: this step changes the breakpoint from `600px` to `480px` and adds the new tablet block above it. Task 3 adds more rules inside the `480px` block.

- [ ] **Step 2: Verify the edit**

Run: `grep -n "max-width: 1024px\|max-width: 480px\|max-width: 600px" style.css`
Expected output (the 600px block is gone, both new breakpoints present):
```
510:@media (max-width: 1024px) {
521:@media (max-width: 480px) {
```

- [ ] **Step 3: Commit**

```bash
git add style.css
git commit -m "Add tablet breakpoint and header wrap behavior"
```

---

### Task 3: Phone breakpoint refinements (480px)

**Files:**
- Modify: `style.css` — the `@media (max-width: 480px)` block added in Task 2

- [ ] **Step 1: Add phone-only rules to the 480px block**

Current block (from Task 2):
```css
@media (max-width: 480px) {
  .login-card { padding: 36px 24px; margin: 16px; }
  .logo-title { font-size: 2.4rem; }
  .games-section { grid-template-columns: 1fr; }
  .header-inner { padding: 12px 16px; }
  .main { padding: 24px 16px; }
  .game-result { font-size: 1.8rem; }
  .team-flag { font-size: 2rem; }
  .user-badge { max-width: 130px; }
}
```

Replace with:
```css
@media (max-width: 480px) {
  .login-card { padding: 36px 24px; margin: 16px; }
  .logo-title { font-size: 2.4rem; }
  .games-section { grid-template-columns: 1fr; }
  .header-inner { padding: 12px 16px; }
  .main { padding: 24px 16px; }
  .game-result { font-size: 1.8rem; }
  .team-flag { font-size: 2rem; }
  .user-badge { max-width: 130px; }

  .header-logo { font-size: 1.25rem; letter-spacing: 1.5px; }
  .header-flags { display: none; }
  .game-card { padding: 18px; }
  .bets-table { font-size: 0.76rem; }
  .bets-table th, .bets-table td { padding: 7px 8px; }
}
```

- [ ] **Step 2: Verify the edit**

Run: `grep -n "header-flags\|header-logo { font-size: 1.25rem" style.css`
Expected output (2 matches, both inside the 480px block — line numbers will be near the new block):
```
<line>:  .header-flags { display: none; }
<line>:  .header-logo { font-size: 1.25rem; letter-spacing: 1.5px; }
```

- [ ] **Step 3: Commit**

```bash
git add style.css
git commit -m "Refine phone breakpoint: shrink header logo, hide flags, tighten card/table"
```

---

### Task 4: General polish — dvh fallback + touch targets

**Files:**
- Modify: `style.css:38` (`.screen` rule)
- Modify: `style.css` — `.filter-btn` rule (around line 316-326)
- Modify: `style.css` — `.admin-status-btn` rule (around line 785-795)

- [ ] **Step 1: Add `100dvh` fallback to `.screen`**

Current (line 38):
```css
.screen { display: none; min-height: 100vh; }
```

Replace with:
```css
.screen { display: none; min-height: 100vh; min-height: 100dvh; }
```

- [ ] **Step 2: Give `.filter-btn` a comfortable touch target**

Current:
```css
.filter-btn {
  padding: 8px 20px;
  border-radius: 99px;
  border: 1.5px solid rgba(255,255,255,0.12);
  background: transparent;
  color: var(--gray-400);
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}
```

Replace with:
```css
.filter-btn {
  padding: 8px 20px;
  min-height: 40px;
  display: inline-flex;
  align-items: center;
  border-radius: 99px;
  border: 1.5px solid rgba(255,255,255,0.12);
  background: transparent;
  color: var(--gray-400);
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}
```

- [ ] **Step 3: Give `.admin-status-btn` a comfortable touch target**

Current:
```css
.admin-status-btn {
  padding: 5px 11px;
  border-radius: 99px;
  border: 1px solid rgba(255,255,255,0.15);
  background: transparent;
  color: var(--gray-400);
  font-size: 0.76rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}
```

Replace with:
```css
.admin-status-btn {
  padding: 5px 11px;
  min-height: 40px;
  display: inline-flex;
  align-items: center;
  border-radius: 99px;
  border: 1px solid rgba(255,255,255,0.15);
  background: transparent;
  color: var(--gray-400);
  font-size: 0.76rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}
```

- [ ] **Step 4: Verify the edits**

Run: `grep -n "100dvh\|min-height: 40px" style.css`
Expected output (3 matches):
```
<line>:.screen { display: none; min-height: 100vh; min-height: 100dvh; }
<line>:  min-height: 40px;
<line>:  min-height: 40px;
```

- [ ] **Step 5: Commit**

```bash
git add style.css
git commit -m "Add dvh fallback and comfortable touch targets for filter/admin buttons"
```

---

### Task 5: Visual verification across breakpoints

**Files:** none (verification only — may produce a follow-up fix commit if issues are found)

- [ ] **Step 1: Start a local static server**

Run: `python3 -m http.server 8000` (in the project root, in the background)

- [ ] **Step 2: Open the app and log in**

Open `http://localhost:8000` in a browser. Log in with the admin email (`joaoaraujomn@gmail.com`) so the admin panel, game cards, ticker, and bets table all render — this gives the fullest layout to check.

- [ ] **Step 3: Check each width**

Using the browser's responsive/device toolbar, check the app at these widths and confirm:

| Width | Checks |
|-------|--------|
| 360px | Header shows "🏆 BOLÃO.Melo" only (no flags), on its own row, no horizontal overflow/scrollbar. User badge + Sair button on the row below, right-aligned. Games grid is 1 column. Bets table scrolls horizontally if it doesn't fit; text is readable. Filter pills and admin buttons are easy to tap (visibly ~40px tall). |
| 414px | Same as 360px — still no overflow, still 1 column. |
| 768px | Header still wraps to two rows (logo row, then badge+Sair row), no overflow. Games grid is 2 columns. Flags are visible in the header (only hidden below 480px). |
| 1024px | Same wrapped header as 768px (this is the tablet breakpoint boundary). Games grid is 2 columns. |
| 1440px | Header is a single row (logo left, badge+Sair right) like before. Games grid is 3 columns. Content stays centered with `max-width: 1100px`. |

- [ ] **Step 4: Fix any issues found**

If the header still overflows at any width between 320px and 1024px (e.g., flags visible at 481-600px push the logo too wide), adjust the threshold in `style.css`:
- Try lowering the flag-hiding threshold by changing `@media (max-width: 480px)` to `@media (max-width: 600px)` for just the `.header-flags { display: none; }` and `.header-logo { font-size: 1.25rem; letter-spacing: 1.5px; }` rules (move those two declarations into their own `@media (max-width: 600px)` block, placed after the 480px block).

If any other issue is found (e.g., a card looking cramped at a specific width), make the smallest targeted CSS change that fixes it, re-check the affected widths, and commit:

```bash
git add style.css
git commit -m "Fix responsive issue found during visual verification"
```

- [ ] **Step 5: Stop the local server**

Run: `kill %1` (or Ctrl+C if running in foreground)

---

## Self-Review Notes

- **Spec coverage:** Header wrap/shrink (Tasks 1-3), tablet breakpoint (Task 2), refined phone breakpoint incl. game-card padding and bets-table font-size (Task 3), `dvh` + touch targets (Task 4), visual verification at 360/414/768/1024/1440px (Task 5) — all spec items covered.
- **Order dependency:** Task 2 must land before Task 3 (Task 3 edits the block Task 2 creates). Tasks 1 and 4 are independent and could be done in any order relative to 2/3, but are sequenced after for a clean diff narrative.
- **No placeholders:** All CSS/HTML snippets are complete and copy-pasteable.
