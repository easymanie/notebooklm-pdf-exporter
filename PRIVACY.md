# Privacy Policy — NotebookLM PDF Exporter

**Last updated:** 10 February 2026

## Summary

NotebookLM PDF Exporter does not collect, store, or transmit any user data. All processing happens locally in your browser.

## Data handling

- **No data collection**: The extension does not collect any personal information, browsing history, or usage data.
- **No external servers**: The extension does not communicate with any external servers. There is no backend, no analytics, and no telemetry.
- **Local processing only**: All content extraction and PDF generation happens entirely within your browser tab. Content is read from the NotebookLM page DOM, converted to formatted HTML, and rendered via the browser's built-in print dialog.
- **Clipboard access**: The extension may briefly read your clipboard to retrieve content copied via NotebookLM's native "Copy" button. Your previous clipboard contents are restored immediately after. No clipboard data is stored or transmitted.

## Permissions explained

| Permission | Why it's needed |
|---|---|
| `activeTab` | Access the current NotebookLM tab when you click Export |
| `scripting` | Inject the Export PDF button and content extraction script into the NotebookLM page |
| `clipboardRead` | Read content after programmatically clicking NotebookLM's "Copy" button |

## Host permissions

The extension only runs on `https://notebooklm.google.com/*`. It does not access any other websites.

## Contact

For questions about this privacy policy, open an issue at: https://github.com/easymanie/notebooklm-pdf-exporter/issues
