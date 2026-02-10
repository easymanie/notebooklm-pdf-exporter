# NotebookLM PDF Exporter

A Chrome extension that exports your NotebookLM notes and reports to clean, well-formatted PDFs.

## How it works

1. When you open a report/note in NotebookLM, a blue **Export PDF** button appears
2. The extension grabs the content (via NotebookLM's own copy feature or DOM extraction)
3. It converts the markdown to styled HTML and opens Chrome's print dialog
4. Choose "Save as PDF" in the print dialog to save your file

## Installation

Since this is an unpacked extension (not on the Chrome Web Store), load it manually:

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the `notebooklm-pdf-exporter` folder
5. The extension icon should appear in your toolbar

## Usage

1. Go to [notebooklm.google.com](https://notebooklm.google.com) and open a notebook
2. Open a report, note, or generated summary
3. **Option A**: Click the blue **Export PDF** button that appears in the report header
4. **Option B**: Click the extension icon in the toolbar and click **Export as PDF**
5. In the print dialog, select **Save as PDF** as the destination
6. Click **Save**

## What gets exported

- Generated reports and summaries (best quality — uses NotebookLM's native copy)
- Notes
- Chat conversations

## Troubleshooting

- **No Export PDF button?** Refresh the page. The button appears when a report is open.
- **"No content found" error?** Make sure you have a report, note, or chat open — not just the source list.
- **Clipboard permission denied?** The extension falls back to DOM extraction automatically.
- **Formatting looks off?** In the print dialog, make sure "Background graphics" is unchecked and margins are set to "Default".

## Permissions

- `activeTab` — access the current tab when you click export
- `scripting` — inject the export button into NotebookLM
- `clipboardRead` — read content after clicking NotebookLM's copy button
