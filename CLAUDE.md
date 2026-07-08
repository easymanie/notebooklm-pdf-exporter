# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Chrome extension (Manifest V3) that exports NotebookLM chats and reports as PDF or Markdown, with inline citation resolution and enriched source metadata. The exported files are used as input for AI-assisted story drafting — source attribution accuracy is the core value.

## Development

No build step, no package manager, no tests. This is a plain Chrome extension loaded unpacked.

**Load/reload:** `chrome://extensions/` → Developer mode → Load unpacked (point to this folder). After code changes, click the refresh icon on the extension card and refresh any open NotebookLM tabs.

**Syntax check:** `node -c content.js && node -c popup.js`

## Architecture

All logic lives in two files — `content.js` (injected into NotebookLM pages) and `popup.js` (extension popup).

### content.js (~1200 lines)

Single IIFE with these responsibilities in order:

1. **DOM selectors** — Functions to find chat panel, messages, scroll container, sources, artifacts, copy button. NotebookLM uses Angular Material components (`mat-card`, `mat-card-content`) and custom elements (`chat-message`).

2. **Source extraction** — `extractSources()` reads `div[aria-label]` elements inside `section.source-panel`. `enrichSources()` clicks each source to open its detail view (`div.source-panel-view-content`), scrapes the AI-generated source guide summary, then navigates back via `navigateBackToSourceList()`.

3. **Source detail navigation** — `navigateBackToSourceList()` tries 7 strategies to return from the detail view to the source list (close button, panel header, h2 header, mat-icon arrow_back, generic close/back buttons, Escape key, view header). Each strategy clicks and polls `isListVisible()` which checks that the detail view is gone AND list items are present.

4. **Citation resolution** — `extractCitationMap()` finds `button.citation-marker` elements containing `span[aria-label="N: Source Name"]`. The aria-label format is `"N: Source Name"` where N is the per-response citation number. `citationLegend()` formats this as a blockquoted mapping after each AI response.

5. **Button injection** — Creates an "Export ▼" dropdown button (PDF + Markdown options) injected into `span.chat-header-buttons`. Falls back to floating position. Uses MutationObserver to detect when chat/artifacts appear.

6. **Chat extraction** — `extractFullChat()` scrolls through all `div.chat-message-pair` elements using `scrollIntoView()`, handles virtual scrolling by checking if new pairs appear. Deduplicates via 150-char text prefix. Per AI response, resolves citations before converting to markdown.

7. **DOM→Markdown conversion** — `domToMarkdown()` clones elements, converts `button.citation-marker` to `[N]` text, strips action buttons, then recursively walks the DOM via `nodeToMarkdown()` producing GFM.

8. **Export** — `extractContent()` orchestrates the full pipeline (sources → chat/artifact → enrich sources → append sources section). `handleExport(format)` calls this then either triggers `window.print()` (PDF) or downloads a `.md` file via Blob URL.

9. **Diagnostics** — `scanPage()` reports detailed DOM state including sources, citation elements with all attributes, aria labels, and notable classes. Used via the popup's Diagnose button for debugging selector changes.

10. **Message listener** — Handles `exportPDF`, `exportMarkdown`, `getStatus`, and `diagnose` actions from the popup.

### popup.js (~200 lines)

Queries active tab, sends `getStatus` to content script, enables export buttons if content is found. Diagnose button sends `diagnose` and renders a detailed report of what the content script can see on the page.

### styles.css

Two sections: screen styles (export button, dropdown, notifications) and `@media print` styles (hides everything except the print container, A4 layout, serif typography).

## NotebookLM DOM gotchas

- The source panel DOM completely replaces its content when a source detail view is opened — `extractSources()` returns empty if called while a detail view is open.
- Citations are NOT `<a>` or `<sup>` elements. They are `button.citation-marker` with a child `span[aria-label]`.
- The chat uses virtual scrolling — not all messages exist in the DOM at once. The extraction loop must scroll and re-query `div.chat-message-pair` repeatedly.
- Do NOT use `CSS.escape()` for matching aria-label values — it escapes dots, spaces etc., breaking the match. Instead iterate elements and compare via `getAttribute("aria-label")` directly. `findSourceButton()` uses this approach.
- The "Source guide" label text (`button_magic`, `Source guide`, `arrow_drop_up`) appears as textContent from icon elements and must be stripped when extracting summaries.
- Source panel DOM references go stale when detail views open/close — always re-query `document.querySelector("section.source-panel")` rather than caching.
