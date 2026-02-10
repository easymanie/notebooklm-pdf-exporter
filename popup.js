(function () {
  const statusEl = document.getElementById("status");
  const exportBtn = document.getElementById("exportBtn");
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

        if (response.hasChat && response.messageCount > 0) {
          setStatus(
            "green",
            `Chat detected (${response.messageCount} message pairs)`
          );
          exportBtn.disabled = false;
          tipEl.textContent =
            "The extension will scroll through the full chat to capture all messages.";
        } else if (response.hasReport) {
          setStatus(
            "green",
            `Report detected (${response.contentLength.toLocaleString()} chars)`
          );
          exportBtn.disabled = false;
          tipEl.textContent =
            'Click "Export as PDF" to export the report.';
        } else if (response.hasContent) {
          setStatus(
            "green",
            `Content detected (${response.contentLength.toLocaleString()} chars)`
          );
          exportBtn.disabled = false;
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

  // Export button
  exportBtn.addEventListener("click", () => {
    exportBtn.disabled = true;
    exportBtn.textContent = "Exporting...";

    chrome.tabs.sendMessage(
      currentTab.id,
      { action: "exportPDF" },
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
