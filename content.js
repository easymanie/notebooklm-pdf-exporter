(function () {
  "use strict";

  const BUTTON_ID = "nlm-pdf-export-btn";
  const PRINT_CONTAINER_ID = "nlm-pdf-print-container";

  let observer = null;

  // --- DOM Selectors (from real NotebookLM diagnostic) ---
  // Chat structure:
  //   section.chat-panel
  //     div.chat-panel-content          (scrollable container)
  //       div.chat-message-pair         (one per Q&A turn)
  //         chat-message.individual-message
  //           mat-card.from-user-message-card-content   (user)
  //           mat-card.to-user-message-card-content     (AI)
  //             mat-card-content.message-content
  //               div.message-text-content              (the actual text)

  // --- Finding Elements ---

  function findChatPanel() {
    return document.querySelector("section.chat-panel");
  }

  function findChatScrollContainer() {
    // The scrollable area within the chat panel
    const candidates = [
      "div.chat-panel-content",
      "section.chat-panel div.panel-content-scrollable",
      "section.chat-panel",
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el && el.scrollHeight > 0) return el;
    }
    return null;
  }

  function findMessagePairs() {
    return document.querySelectorAll("div.chat-message-pair");
  }

  function findMessageTextElements() {
    return document.querySelectorAll("div.message-text-content");
  }

  function findCopyButton() {
    const ariaPatterns = [
      'button[aria-label*="Copy"]',
      'button[aria-label*="copy"]',
    ];
    for (const sel of ariaPatterns) {
      const btn = document.querySelector(sel);
      if (btn) return btn;
    }
    return null;
  }

  function findArtifactContent() {
    // For reports/artifacts opened in the studio panel
    // Exclude .artifact-callout (that's just a small label)
    const el = document.querySelector(
      ".artifact-content:not(.artifact-callout)"
    );
    if (el && el.textContent.trim().length > 200) return el;

    // Also try panel-content-scrollable in the studio panel
    const studio = document.querySelector("section.studio-panel .panel-content-scrollable");
    if (studio && studio.textContent.trim().length > 200) return studio;

    return null;
  }

  // --- Button Injection ---

  function createExportButton() {
    const btn = document.createElement("button");
    btn.id = BUTTON_ID;
    btn.textContent = "Export PDF";
    btn.title = "Export this chat as a clean PDF";
    btn.className = "nlm-export-btn";
    btn.addEventListener("click", handleExportClick);
    return btn;
  }

  function injectButton() {
    if (document.getElementById(BUTTON_ID)) return;

    // Place button in the chat panel header area
    const chatHeaderButtons = document.querySelector("span.chat-header-buttons");
    if (chatHeaderButtons) {
      const btn = createExportButton();
      chatHeaderButtons.prepend(btn);
      return;
    }

    // Fallback: float in the chat panel
    const chatPanel = findChatPanel();
    if (chatPanel) {
      const btn = createExportButton();
      btn.classList.add("nlm-export-btn-floating");
      chatPanel.style.position = "relative";
      chatPanel.prepend(btn);
      return;
    }
  }

  function removeButton() {
    const btn = document.getElementById(BUTTON_ID);
    if (btn) btn.remove();
  }

  // --- Chat Extraction ---

  function extractVisibleMessages() {
    // Collect all currently-rendered message pairs as structured data
    const pairs = findMessagePairs();
    const messages = [];

    for (const pair of pairs) {
      // User message
      const userCard = pair.querySelector(
        "mat-card.from-user-message-card-content"
      );
      if (userCard) {
        const textEl =
          userCard.querySelector("div.message-text-content") ||
          userCard.querySelector("mat-card-content.message-content") ||
          userCard;
        const text = textEl.textContent.trim();
        if (text) {
          messages.push({ role: "user", text });
        }
      }

      // AI response
      const aiCard = pair.querySelector(
        "mat-card.to-user-message-card-content"
      );
      if (aiCard) {
        const textEl =
          aiCard.querySelector("div.message-text-content") ||
          aiCard.querySelector("mat-card-content.message-content") ||
          aiCard;
        // For AI responses, preserve HTML structure (headings, lists, etc.)
        messages.push({
          role: "ai",
          text: domToMarkdown(textEl),
        });
      }
    }

    return messages;
  }

  function messagesToMarkdown(messages) {
    const parts = [];
    for (const msg of messages) {
      if (msg.role === "user") {
        parts.push(`**You:** ${msg.text}`);
      } else {
        parts.push(`**NotebookLM:**\n\n${msg.text}`);
      }
    }
    return parts.join("\n\n---\n\n");
  }

  // --- Scroll-and-Collect for Full Chat ---

  async function extractFullChat(updateStatus) {
    const scrollContainer = findChatScrollContainer();
    if (!scrollContainer) return null;

    // Always scroll to the top and collect the full chat,
    // regardless of current scroll position.
    updateStatus("Scrolling to top...");
    scrollContainer.scrollTop = 0;
    await sleep(600);

    const allMessages = [];
    const seenTexts = new Set();
    const scrollStep = Math.floor(scrollContainer.clientHeight * 0.6);
    const maxScrolls = 300;

    for (let i = 0; i < maxScrolls; i++) {
      // Extract currently visible messages
      const visible = extractVisibleMessages();
      for (const msg of visible) {
        // Deduplicate using first 120 chars of text
        const key = msg.text.substring(0, 120).trim();
        if (key.length > 0 && !seenTexts.has(key)) {
          seenTexts.add(key);
          allMessages.push(msg);
        }
      }

      // Scroll down
      const prevTop = scrollContainer.scrollTop;
      scrollContainer.scrollTop += scrollStep;
      await sleep(300);

      // Reached bottom?
      const atBottom =
        Math.abs(scrollContainer.scrollTop - prevTop) < 5 ||
        scrollContainer.scrollTop + scrollContainer.clientHeight >=
          scrollContainer.scrollHeight - 5;

      if (atBottom) {
        // Capture final position
        const visible2 = extractVisibleMessages();
        for (const msg of visible2) {
          const key = msg.text.substring(0, 120).trim();
          if (key.length > 0 && !seenTexts.has(key)) {
            seenTexts.add(key);
            allMessages.push(msg);
          }
        }
        break;
      }

      const pct = Math.round(
        ((scrollContainer.scrollTop + scrollContainer.clientHeight) /
          scrollContainer.scrollHeight) *
          100
      );
      updateStatus(`Collecting messages... ${pct}%`);
    }

    if (allMessages.length === 0) return null;

    updateStatus(`Collected ${allMessages.length} messages`);
    return messagesToMarkdown(allMessages);
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // --- Artifact/Report Extraction ---

  async function extractArtifact() {
    // Try clipboard via the "Copy summary" button
    const copyBtn = findCopyButton();
    if (copyBtn) {
      let prev = "";
      try {
        prev = await navigator.clipboard.readText();
      } catch (e) {}

      copyBtn.click();
      await sleep(500);

      try {
        const text = await navigator.clipboard.readText();
        if (prev) {
          try { await navigator.clipboard.writeText(prev); } catch (e) {}
        }
        if (text && text !== prev && text.trim().length > 50) {
          return text;
        }
      } catch (e) {
        console.warn("[NotebookLM PDF] Clipboard read failed:", e);
      }
    }

    // Direct DOM extraction from artifact panel
    const artifact = findArtifactContent();
    if (artifact) {
      return domToMarkdown(artifact);
    }

    return null;
  }

  // --- DOM to Markdown ---

  function domToMarkdown(element) {
    const clone = element.cloneNode(true);

    // Remove citations
    clone
      .querySelectorAll('a[href*="citation"], .citation, sup')
      .forEach((el) => el.remove());

    // Remove our own button if present
    const ourBtn = clone.querySelector(`#${BUTTON_ID}`);
    if (ourBtn) ourBtn.remove();

    // Remove action buttons (thumbs up/down, copy, etc.)
    clone
      .querySelectorAll("mat-card-actions, .message-actions, button")
      .forEach((el) => el.remove());

    return nodeToMarkdown(clone).trim();
  }

  function nodeToMarkdown(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return "";
    }

    const tag = node.tagName.toLowerCase();
    const children = Array.from(node.childNodes)
      .map(nodeToMarkdown)
      .join("");

    switch (tag) {
      case "h1":
        return `\n# ${children.trim()}\n\n`;
      case "h2":
        return `\n## ${children.trim()}\n\n`;
      case "h3":
        return `\n### ${children.trim()}\n\n`;
      case "h4":
        return `\n#### ${children.trim()}\n\n`;
      case "strong":
      case "b":
        return `**${children}**`;
      case "em":
      case "i":
        return `*${children}*`;
      case "code":
        if (node.parentElement && node.parentElement.tagName === "PRE")
          return children;
        return `\`${children}\``;
      case "pre":
        return `\n\`\`\`\n${children.trim()}\n\`\`\`\n\n`;
      case "br":
        return "\n";
      case "p":
        return `\n${children.trim()}\n\n`;
      case "ul":
        return `\n${children}\n`;
      case "ol":
        return `\n${children}\n`;
      case "li": {
        const parent = node.parentElement;
        if (parent && parent.tagName === "OL") {
          const index = Array.from(parent.children).indexOf(node) + 1;
          return `${index}. ${children.trim()}\n`;
        }
        return `- ${children.trim()}\n`;
      }
      case "blockquote":
        return (
          "\n" +
          children
            .trim()
            .split("\n")
            .map((line) => `> ${line}`)
            .join("\n") +
          "\n\n"
        );
      case "table":
        return `\n${convertTable(node)}\n\n`;
      case "a":
        return `[${children}](${node.href || ""})`;
      case "img":
        return `![${node.alt || ""}](${node.src || ""})`;
      case "hr":
        return "\n---\n\n";
      case "div":
      case "span":
      case "section":
      case "article":
      case "mat-card":
      case "mat-card-content":
      case "chat-message":
        return children;
      default:
        return children;
    }
  }

  function convertTable(tableEl) {
    const rows = tableEl.querySelectorAll("tr");
    if (rows.length === 0) return "";

    const result = [];
    rows.forEach((row, rowIndex) => {
      const cells = Array.from(row.querySelectorAll("th, td"));
      const cellTexts = cells.map((cell) => cell.textContent.trim());
      result.push("| " + cellTexts.join(" | ") + " |");
      if (rowIndex === 0) {
        result.push("| " + cells.map(() => "---").join(" | ") + " |");
      }
    });
    return result.join("\n");
  }

  // --- PDF Generation ---

  function generatePrintHTML(markdown) {
    return marked.parse(markdown, { gfm: true, breaks: false });
  }

  function triggerPrint(htmlContent, title) {
    const existing = document.getElementById(PRINT_CONTAINER_ID);
    if (existing) existing.remove();

    const container = document.createElement("div");
    container.id = PRINT_CONTAINER_ID;
    container.innerHTML = `
      <div class="nlm-print-header">
        <h1 class="nlm-print-title">${escapeHtml(title)}</h1>
        <p class="nlm-print-date">Exported from NotebookLM on ${new Date().toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" })}</p>
      </div>
      <div class="nlm-print-body">${htmlContent}</div>
    `;
    document.body.appendChild(container);

    window.print();

    setTimeout(() => container.remove(), 1000);
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  // --- Export Handler ---

  async function handleExportClick(e) {
    if (e && e.preventDefault) {
      e.preventDefault();
      e.stopPropagation();
    }

    const btn = document.getElementById(BUTTON_ID);
    let originalText = "Export PDF";
    if (btn) {
      originalText = btn.textContent;
      btn.textContent = "Extracting...";
      btn.disabled = true;
    }

    const updateStatus = (msg) => {
      if (btn) btn.textContent = msg;
    };

    try {
      let markdown = null;

      // Primary: extract the full chat via scrolling
      const chatPanel = findChatPanel();
      if (chatPanel) {
        updateStatus("Scanning chat...");
        markdown = await extractFullChat(updateStatus);
      }

      // Secondary: try artifact/report extraction
      if (!markdown) {
        updateStatus("Checking for reports...");
        markdown = await extractArtifact();
      }

      if (!markdown || markdown.trim().length === 0) {
        showNotification(
          "No content found. Make sure a chat or report is open.",
          "error"
        );
        return;
      }

      updateStatus("Generating PDF...");

      // Derive title from notebook title or first heading
      const notebookTitle = document.querySelector("h1.notebook-title");
      const titleMatch = markdown.match(/^#\s+(.+)/m);
      const title = notebookTitle
        ? notebookTitle.textContent.trim()
        : titleMatch
          ? titleMatch[1].trim()
          : "NotebookLM Export";

      const htmlContent = generatePrintHTML(markdown);
      triggerPrint(htmlContent, title);

      showNotification("PDF ready! Use the print dialog to save.", "success");
    } catch (err) {
      console.error("[NotebookLM PDF] Export failed:", err);
      showNotification("Export failed: " + err.message, "error");
    } finally {
      if (btn) {
        btn.textContent = originalText;
        btn.disabled = false;
      }
    }
  }

  // --- Notification ---

  function showNotification(message, type) {
    const existing = document.querySelector(".nlm-notification");
    if (existing) existing.remove();

    const notif = document.createElement("div");
    notif.className = `nlm-notification nlm-notification-${type}`;
    notif.textContent = message;
    document.body.appendChild(notif);

    setTimeout(() => {
      notif.classList.add("nlm-notification-fade");
      setTimeout(() => notif.remove(), 300);
    }, 3000);
  }

  // --- Mutation Observer ---

  function startObserver() {
    if (observer) return;

    let debounceTimer = null;
    observer = new MutationObserver(() => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const hasChat = findChatPanel() && findMessagePairs().length > 0;
        const hasArtifact = !!findArtifactContent();
        if (hasChat || hasArtifact) {
          injectButton();
        }
      }, 500);
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // --- Diagnostic (for popup) ---

  function scanPage() {
    const chatPanel = findChatPanel();
    const scrollContainer = findChatScrollContainer();
    const messagePairs = findMessagePairs();
    const artifact = findArtifactContent();
    const copyBtn = findCopyButton();

    const ariaLabels = [];
    document.querySelectorAll("[aria-label]").forEach((el) => {
      ariaLabels.push(
        `${el.tagName.toLowerCase()}[aria-label="${el.getAttribute("aria-label")}"]`
      );
    });

    const notableClasses = new Set();
    document.querySelectorAll("[class]").forEach((el) => {
      el.classList.forEach((cls) => {
        if (
          /content|artifact|report|note|chat|message|document|panel|view|editor/i.test(cls)
        ) {
          notableClasses.add(`${el.tagName.toLowerCase()}.${cls}`);
        }
      });
    });

    return {
      hasChatPanel: !!chatPanel,
      hasScrollContainer: !!scrollContainer,
      scrollHeight: scrollContainer ? scrollContainer.scrollHeight : 0,
      clientHeight: scrollContainer ? scrollContainer.clientHeight : 0,
      messageCount: messagePairs.length,
      hasArtifact: !!artifact,
      hasCopyButton: !!copyBtn,
      copyButtonLabel: copyBtn
        ? copyBtn.getAttribute("aria-label") || "(no label)"
        : null,
      hasContentArea: !!chatPanel || !!artifact,
      contentLength: chatPanel
        ? chatPanel.textContent.trim().length
        : artifact
          ? artifact.textContent.trim().length
          : 0,
      ariaLabels: ariaLabels.slice(0, 50),
      notableClasses: [...notableClasses].slice(0, 50),
    };
  }

  // --- Message Listener ---

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "exportPDF") {
      handleExportClick(null).catch(console.error);
      sendResponse({ status: "started" });
    } else if (message.action === "getStatus") {
      const chatPanel = findChatPanel();
      const msgCount = findMessagePairs().length;
      const artifact = findArtifactContent();
      sendResponse({
        onNotebookLM: true,
        hasContent: msgCount > 0 || !!artifact,
        hasReport: !!artifact,
        hasChat: msgCount > 0,
        messageCount: msgCount,
        contentLength: chatPanel
          ? chatPanel.textContent.trim().length
          : artifact
            ? artifact.textContent.trim().length
            : 0,
      });
    } else if (message.action === "diagnose") {
      sendResponse(scanPage());
    }
    return true;
  });

  // --- Init ---

  function init() {
    console.log("[NotebookLM PDF] Extension loaded. Scanning...");
    const diag = scanPage();
    console.log("[NotebookLM PDF] Diagnostic:", JSON.stringify(diag, null, 2));

    injectButton();
    startObserver();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
