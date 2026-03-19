(function () {
  const statusEl = document.getElementById("status");
  const exportBtn = document.getElementById("exportBtn");
  const exportMdBtn = document.getElementById("exportMdBtn");
  const tipEl = document.getElementById("tip");
  const diagnoseBtn = document.getElementById("diagnoseBtn");
  const diagPanel = document.getElementById("diagPanel");
  const copyDiagBtn = document.getElementById("copyDiag");

  let currentTab = null;
  let diagData = null;

  function setStatus(dotClass, message) {
    statusEl.innerHTML = `<span class="status-dot ${dotClass}"></span>${message}`;
  }

  // Query the active tab for status
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    currentTab = tabs[0];

    if (
      !currentTab ||
      !currentTab.url ||
      !currentTab.url.includes("notebooklm.google.com")
    ) {
      setStatus("red", "Not on NotebookLM");
      tipEl.textContent =
        "Navigate to notebooklm.google.com and open a notebook to export.";
      return;
    }

    chrome.tabs.sendMessage(
      currentTab.id,
      { action: "getStatus" },
      (response) => {
        if (chrome.runtime.lastError || !response) {
          setStatus("yellow", "Loading...");
          tipEl.textContent =
            "Content script not ready. Try refreshing the page, then reopen this popup.";
          return;
        }

        const srcInfo = response.sourceCount
          ? `, ${response.sourceCount} source${response.sourceCount !== 1 ? "s" : ""}`
          : "";

        if (response.hasChat && response.messageCount > 0) {
          setStatus(
            "green",
            `Chat detected (${response.messageCount} message pairs${srcInfo})`
          );
          exportBtn.disabled = false;
          exportMdBtn.disabled = false;
          tipEl.textContent =
            "The extension will scroll through the full chat to capture all messages and sources.";
        } else if (response.hasReport) {
          setStatus(
            "green",
            `Report detected (${response.contentLength.toLocaleString()} chars)`
          );
          exportBtn.disabled = false;
          exportMdBtn.disabled = false;
          tipEl.textContent =
            "Export as PDF or Markdown.";
        } else if (response.hasContent) {
          setStatus(
            "green",
            `Content detected (${response.contentLength.toLocaleString()} chars)`
          );
          exportBtn.disabled = false;
          exportMdBtn.disabled = false;
          tipEl.textContent =
            "Tip: For best results, open a generated report or note first.";
        } else {
          setStatus("yellow", "No exportable content found");
          tipEl.textContent =
            'Open a report or chat first, then click "Diagnose" to troubleshoot.';
        }
      }
    );
  });

  // Export as PDF
  exportBtn.addEventListener("click", () => {
    exportBtn.disabled = true;
    exportMdBtn.disabled = true;
    exportBtn.textContent = "Exporting...";

    chrome.tabs.sendMessage(
      currentTab.id,
      { action: "exportPDF" },
      () => {
        window.close();
      }
    );
  });

  // Export as Markdown
  exportMdBtn.addEventListener("click", () => {
    exportBtn.disabled = true;
    exportMdBtn.disabled = true;
    exportMdBtn.textContent = "Exporting...";

    chrome.tabs.sendMessage(
      currentTab.id,
      { action: "exportMarkdown" },
      () => {
        window.close();
      }
    );
  });

  // Diagnose button
  diagnoseBtn.addEventListener("click", () => {
    if (!currentTab) return;

    diagnoseBtn.textContent = "Scanning...";
    diagnoseBtn.disabled = true;

    chrome.tabs.sendMessage(
      currentTab.id,
      { action: "diagnose" },
      (response) => {
        diagnoseBtn.textContent = "Diagnose";
        diagnoseBtn.disabled = false;

        if (chrome.runtime.lastError || !response) {
          diagPanel.textContent =
            "Could not reach content script. Try refreshing the NotebookLM page.";
          diagPanel.classList.add("visible");
          return;
        }

        diagData = response;

        const lines = [];
        lines.push("=== DIAGNOSTIC REPORT ===");
        lines.push("");
        lines.push(
          `Copy button found: ${response.hasCopyButton ? "YES (" + response.copyButtonLabel + ")" : "NO"}`
        );
        lines.push(`Close button found: ${response.hasCloseButton ? "YES" : "NO"}`);
        lines.push(
          `Content area found: ${response.hasContentArea ? "YES" : "NO"}`
        );
        if (response.hasContentArea) {
          lines.push(`  Tag: ${response.contentAreaTag}`);
          lines.push(
            `  Text length: ${response.contentLength.toLocaleString()} chars`
          );
        }
        lines.push("");
        lines.push(`--- Sources (${(response.sources || []).length}) ---`);
        (response.sources || []).forEach((s, i) =>
          lines.push(`  ${i + 1}. ${s.name}${s.url ? " → " + s.url : ""} [${s.type}]`)
        );
        lines.push("");
        lines.push(
          `--- Citations (${(response.citationElements || []).length}) ---`
        );
        (response.citationElements || []).forEach((c) => {
          const attrs = [];
          if (c.href) attrs.push(`href="${c.href}"`);
          if (c.title) attrs.push(`title="${c.title}"`);
          if (c.ariaLabel) attrs.push(`aria="${c.ariaLabel}"`);
          if (c.className) attrs.push(`class="${c.className}"`);
          const dataKeys = Object.keys(c.dataAttrs || {});
          dataKeys.forEach((k) => attrs.push(`${k}="${c.dataAttrs[k]}"`));
          lines.push(
            `  <${c.tag}>${c.text}</${c.tag}> ${attrs.join(" ") || "(no attrs)"}`
          );
          if (c.parentTitle || c.parentAriaLabel) {
            lines.push(
              `    parent: ${c.parentTag} title="${c.parentTitle || ""}" aria="${c.parentAriaLabel || ""}"`
            );
          }
        });
        lines.push("");
        lines.push(`--- Aria labels (${response.ariaLabels.length}) ---`);
        response.ariaLabels.forEach((l) => lines.push("  " + l));
        lines.push("");
        lines.push(
          `--- Notable classes (${response.notableClasses.length}) ---`
        );
        response.notableClasses.forEach((c) => lines.push("  " + c));

        diagPanel.textContent = lines.join("\n");
        diagPanel.classList.add("visible");
        copyDiagBtn.classList.add("visible");
      }
    );
  });

  // Copy diagnostic info
  copyDiagBtn.addEventListener("click", () => {
    if (diagData) {
      navigator.clipboard.writeText(JSON.stringify(diagData, null, 2)).then(
        () => {
          copyDiagBtn.textContent = "Copied!";
          setTimeout(() => {
            copyDiagBtn.textContent = "Copy diagnostic info";
          }, 1500);
        },
        () => {
          // Fallback: copy the text content
          navigator.clipboard.writeText(diagPanel.textContent);
          copyDiagBtn.textContent = "Copied!";
          setTimeout(() => {
            copyDiagBtn.textContent = "Copy diagnostic info";
          }, 1500);
        }
      );
    }
  });
})();
