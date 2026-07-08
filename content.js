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
    const chatPanel = findChatPanel();
    if (!chatPanel) return null;

    // Strategy 1: Angular CDK virtual scroll viewport (if used)
    const viewport = chatPanel.querySelector("cdk-virtual-scroll-viewport");
    if (viewport && viewport.scrollHeight > viewport.clientHeight + 20) {
      return viewport;
    }

    // Strategy 2: Walk all descendants of the chat panel and find the
    // one that's actually scrollable (overflow auto/scroll AND has
    // more content than fits)
    const allEls = chatPanel.querySelectorAll("*");
    let best = null;
    let bestOverflow = 0;

    for (const el of allEls) {
      if (el.id === BUTTON_ID || el.id === PRINT_CONTAINER_ID) continue;
      const overflow = el.scrollHeight - el.clientHeight;
      if (overflow < 50) continue;

      const style = window.getComputedStyle(el);
      const oy = style.overflowY;
      if (oy === "auto" || oy === "scroll" || oy === "overlay") {
        if (overflow > bestOverflow) {
          bestOverflow = overflow;
          best = el;
        }
      }
    }

    if (best) return best;

    // Strategy 3: The chat panel itself might be scrollable
    if (chatPanel.scrollHeight > chatPanel.clientHeight + 50) {
      return chatPanel;
    }

    // Strategy 4: Maybe the whole page scrolls
    if (document.documentElement.scrollHeight > document.documentElement.clientHeight + 100) {
      return document.documentElement;
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

  function extractSources() {
    const sources = [];
    const sourcePanel = document.querySelector("section.source-panel");
    if (!sourcePanel) return sources;

    const skipLabels = new Set([
      "Select all sources",
      "Collapse source panel",
      "Add source",
    ]);
    const seen = new Set();

    const candidates = sourcePanel.querySelectorAll("div[aria-label]");
    for (const item of candidates) {
      const name = (item.getAttribute("aria-label") || "").trim();
      if (!name || skipLabels.has(name) || seen.has(name)) continue;
      seen.add(name);

      const link = item.querySelector("a[href]");
      const href = link ? link.href : null;

      let type = "document";
      if (/\.pdf$/i.test(name)) type = "pdf";
      else if (/\.html?$/i.test(name)) type = "webpage";
      else if (href || !/\.\w{2,4}$/.test(name)) type = "webpage";

      sources.push({ name, type, url: href, description: null });
    }

    return sources;
  }

  function findSourceButton(name) {
    // Can't use CSS.escape on aria-label values — it escapes dots, spaces etc.
    // Instead, iterate all buttons in the source panel and match by aria-label.
    const panel = document.querySelector("section.source-panel");
    if (!panel) return null;
    const buttons = panel.querySelectorAll("button[aria-label]");
    for (const btn of buttons) {
      if (btn.getAttribute("aria-label") === name) return btn;
    }
    return null;
  }

  async function waitForElement(selector, timeout) {
    const deadline = Date.now() + (timeout || 3000);
    while (Date.now() < deadline) {
      const el = document.querySelector(selector);
      if (el) return el;
      await sleep(200);
    }
    return null;
  }

  async function navigateBackToSourceList() {
    // Multiple strategies to get back from the source detail view to the list.

    const isListVisible = () => {
      const panel = document.querySelector("section.source-panel");
      if (!panel) return false;
      // Detail view gone AND source list items present
      const hasDetail = panel.querySelector("div.source-panel-view-content") ||
                        panel.querySelector("section.source-panel-view");
      const hasList = panel.querySelector("div[aria-label]");
      return !hasDetail && !!hasList;
    };

    const pollForList = async (maxWait) => {
      const attempts = Math.ceil((maxWait || 3000) / 200);
      for (let t = 0; t < attempts; t++) {
        await sleep(200);
        if (isListVisible()) return true;
      }
      return false;
    };

    if (isListVisible()) return true;

    // Log all buttons in source panel for debugging
    const sourcePanel = document.querySelector("section.source-panel");
    if (sourcePanel) {
      const allBtns = sourcePanel.querySelectorAll("button");
      console.log(`[NotebookLM PDF]   Source panel has ${allBtns.length} buttons:`);
      allBtns.forEach((b, i) => {
        const label = b.getAttribute("aria-label") || "";
        const text = b.textContent.trim().substring(0, 60);
        const cls = b.className || "";
        console.log(`[NotebookLM PDF]     ${i}: aria="${label}" text="${text}" class="${cls}"`);
      });
    }

    // Strategy 1: "Close source guide" button
    const closeBtn = document.querySelector(
      'button[aria-label="Close source guide"]'
    );
    if (closeBtn) {
      console.log("[NotebookLM PDF]   Back strategy 1: Close source guide button");
      closeBtn.click();
      if (await pollForList(3000)) return true;
    }

    // Strategy 2: Clickable panel header (the source name / back arrow area)
    const headerClick = document.querySelector(
      "section.source-panel span.panel-header-clickable"
    );
    if (headerClick) {
      console.log("[NotebookLM PDF]   Back strategy 2: panel header click");
      headerClick.click();
      if (await pollForList(3000)) return true;
    }

    // Strategy 3: The h2 panel header itself
    const h2Header = document.querySelector(
      "section.source-panel h2.panel-header-content"
    );
    if (h2Header) {
      console.log("[NotebookLM PDF]   Back strategy 3: h2 header click");
      h2Header.click();
      if (await pollForList(3000)) return true;
    }

    // Strategy 4: Any button containing mat-icon with arrow_back
    if (sourcePanel) {
      const icons = sourcePanel.querySelectorAll("mat-icon");
      for (const icon of icons) {
        const iconText = icon.textContent.trim().toLowerCase();
        if (iconText === "arrow_back" || iconText === "close" || iconText === "arrow_back_ios") {
          const clickTarget = icon.closest("button") || icon.parentElement;
          if (clickTarget) {
            console.log(`[NotebookLM PDF]   Back strategy 4: mat-icon "${iconText}" in ${clickTarget.tagName}`);
            clickTarget.click();
            if (await pollForList(3000)) return true;
          }
        }
      }
    }

    // Strategy 5: Any button with close/back in aria-label or text
    if (sourcePanel) {
      const allButtons = sourcePanel.querySelectorAll("button");
      for (const btn of allButtons) {
        const label = (btn.getAttribute("aria-label") || "").toLowerCase();
        const text = btn.textContent.trim().toLowerCase();
        if (
          label.includes("close") ||
          label.includes("back") ||
          text.includes("arrow_back") ||
          text.includes("close")
        ) {
          console.log(
            `[NotebookLM PDF]   Back strategy 5: button aria="${label}" text="${text.substring(0, 40)}"`
          );
          btn.click();
          if (await pollForList(3000)) return true;
        }
      }
    }

    // Strategy 6: Escape key — Angular Material often responds to Escape
    console.log("[NotebookLM PDF]   Back strategy 6: Escape key");
    const panel = document.querySelector("section.source-panel") || document.body;
    panel.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape", code: "Escape", keyCode: 27, bubbles: true, cancelable: true
    }));
    if (await pollForList(2000)) return true;

    // Strategy 7: Click the source-panel-view header area itself (acts as back)
    const viewHeader = document.querySelector("section.source-panel-view .panel-header") ||
                       document.querySelector("section.source-panel .source-panel-view .panel-header");
    if (viewHeader) {
      console.log("[NotebookLM PDF]   Back strategy 7: click view header");
      viewHeader.click();
      if (await pollForList(3000)) return true;
    }

    console.warn("[NotebookLM PDF]   All back strategies failed. DOM state:");
    if (sourcePanel) {
      console.warn("[NotebookLM PDF]   Panel HTML (first 500):", sourcePanel.innerHTML.substring(0, 500));
    }
    return false;
  }

  async function enrichSources(sources, updateStatus) {
    // Click each source to open its detail view, scrape the source guide
    // summary, then navigate back to the source list.
    if (sources.length === 0) return sources;

    // Make sure we start from the source list view (not a detail view)
    if (document.querySelector("div.source-panel-view-content")) {
      await navigateBackToSourceList();
    }

    for (let i = 0; i < sources.length; i++) {
      const src = sources[i];
      updateStatus(`Reading source ${i + 1}/${sources.length}...`);
      console.log(`[NotebookLM PDF] Enriching source ${i + 1}/${sources.length}: "${src.name}"`);

      // Find and click the source button (re-query each time since DOM changes)
      const srcBtn = findSourceButton(src.name);
      if (!srcBtn) {
        console.warn(`[NotebookLM PDF]   Button NOT found, skipping`);
        continue;
      }
      console.log(`[NotebookLM PDF]   Button found, clicking...`);

      srcBtn.click();

      // Wait for the detail view to appear
      const detailPanel = await waitForElement(
        "div.source-panel-view-content",
        3000
      );
      if (!detailPanel) {
        console.warn(`[NotebookLM PDF]   Detail panel did NOT appear`);
        await navigateBackToSourceList();
        continue;
      }
      console.log(`[NotebookLM PDF]   Detail panel appeared`);

      // Give the source guide a moment to render its summary
      await sleep(400);

      // Re-query in case the content populated after initial appearance
      const panel = document.querySelector("div.source-panel-view-content");
      if (!panel) {
        console.warn(`[NotebookLM PDF]   Panel disappeared after wait`);
        await navigateBackToSourceList();
        continue;
      }

      // Extract the AI-generated source guide summary.
      const fullText = panel.textContent.trim();
      console.log(`[NotebookLM PDF]   Full text length: ${fullText.length}`);
      const titleEl = panel.querySelector("div.source-title");
      const titleText = titleEl ? titleEl.textContent.trim() : "";

      // The summary follows the title + icon labels.
      let summary = fullText;
      if (titleText) {
        const titleIdx = summary.indexOf(titleText);
        if (titleIdx >= 0) {
          summary = summary.substring(titleIdx + titleText.length);
        }
      }
      // Remove icon/label text that leaks from mat-icon elements
      summary = summary
        .replace(/button_magic/g, "")
        .replace(/Source guide/g, "")
        .replace(/arrow_drop_up/g, "")
        .replace(/arrow_drop_down/g, "")
        .trim();

      // The summary ends before topic tags or document excerpts.
      // Find the last sentence-ending period before the text degrades
      // into short topic phrases or raw document content.
      if (summary.length > 500) {
        const cut = summary.lastIndexOf(".", 500);
        if (cut > 100) summary = summary.substring(0, cut + 1);
      }

      src.description = summary || null;
      console.log(`[NotebookLM PDF]   Description: ${summary ? summary.substring(0, 80) + "..." : "NULL"}`);

      // Navigate back to source list before the next iteration
      console.log(`[NotebookLM PDF]   Navigating back...`);
      const ok = await navigateBackToSourceList();
      if (!ok) {
        console.warn(
          "[NotebookLM PDF] Could not navigate back after source:",
          src.name
        );
        break;
      }
      console.log(`[NotebookLM PDF]   Back to source list`);
    }

    return sources;
  }

  function sourcesToMarkdown(sources) {
    if (sources.length === 0) return "";

    const lines = ["\n---\n", "## Sources\n"];
    sources.forEach((src, i) => {
      const num = i + 1;
      if (src.url) {
        lines.push(`${num}. [${src.name}](${src.url})`);
      } else {
        lines.push(`${num}. ${src.name}`);
      }
      if (src.description) {
        lines.push(`   ${src.description}`);
      }
    });
    return lines.join("\n");
  }

  // --- Citation Resolution ---

  function extractCitationMap(element) {
    // NotebookLM citations are:
    //   button.citation-marker
    //     └── span[aria-label="N: Source Name"]
    // Extract the mapping from citation number to source name.
    const map = {};
    const markers = element.querySelectorAll("button.citation-marker");

    for (const btn of markers) {
      const labelSpan = btn.querySelector("span[aria-label]");
      if (!labelSpan) continue;

      const aria = labelSpan.getAttribute("aria-label") || "";
      // Format: "1: Source Name Here"
      const match = aria.match(/^(\d+):\s*(.+)$/);
      if (match) {
        map[match[1]] = match[2].trim();
      }
    }

    return map;
  }

  function citationLegend(citationMap) {
    const entries = Object.entries(citationMap);
    if (entries.length === 0) return "";
    const lines = entries.map(([num, name]) => `[${num}]: ${name}`);
    return "\n> " + lines.join("\n> ") + "\n";
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

  const WRAPPER_ID = "nlm-pdf-export-wrapper";

  function createExportButton() {
    const wrapper = document.createElement("div");
    wrapper.id = WRAPPER_ID;
    wrapper.className = "nlm-export-wrapper";

    const btn = document.createElement("button");
    btn.id = BUTTON_ID;
    btn.title = "Export this chat";
    btn.className = "nlm-export-btn";
    btn.innerHTML = 'Export <span class="nlm-export-btn-arrow">&#9660;</span>';

    const dropdown = document.createElement("div");
    dropdown.className = "nlm-export-dropdown";

    const pdfItem = document.createElement("button");
    pdfItem.className = "nlm-export-dropdown-item";
    pdfItem.textContent = "Export as PDF";
    pdfItem.addEventListener("click", (e) => {
      e.stopPropagation();
      dropdown.classList.remove("visible");
      handleExport("pdf");
    });

    const mdItem = document.createElement("button");
    mdItem.className = "nlm-export-dropdown-item";
    mdItem.textContent = "Export as Markdown";
    mdItem.addEventListener("click", (e) => {
      e.stopPropagation();
      dropdown.classList.remove("visible");
      handleExport("markdown");
    });

    dropdown.appendChild(pdfItem);
    dropdown.appendChild(mdItem);

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      dropdown.classList.toggle("visible");
    });

    // Close dropdown when clicking outside
    document.addEventListener("click", () => {
      dropdown.classList.remove("visible");
    });

    wrapper.appendChild(btn);
    wrapper.appendChild(dropdown);
    return wrapper;
  }

  function injectButton() {
    if (document.getElementById(WRAPPER_ID)) return;

    // Place button in the chat panel header area
    const chatHeaderButtons = document.querySelector("span.chat-header-buttons");
    if (chatHeaderButtons) {
      chatHeaderButtons.prepend(createExportButton());
      return;
    }

    // Fallback: float in the chat panel
    const chatPanel = findChatPanel();
    if (chatPanel) {
      const wrapper = createExportButton();
      wrapper.classList.add("nlm-export-wrapper-floating");
      chatPanel.style.position = "relative";
      chatPanel.prepend(wrapper);
      return;
    }
  }

  function removeButton() {
    const el = document.getElementById(WRAPPER_ID);
    if (el) el.remove();
  }

  // --- Chat Extraction ---

  function extractVisibleMessages(sources) {
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
        // Resolve citations to source names before converting
        const cMap = extractCitationMap(textEl);
        const md = domToMarkdown(textEl, cMap);
        const legend = citationLegend(cMap);
        messages.push({
          role: "ai",
          text: md + legend,
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

  async function extractFullChat(updateStatus, sources) {
    // Instead of guessing the scroll container, we use scrollIntoView()
    // on message pairs — this works regardless of which element scrolls.

    // Step 1: Scroll the FIRST message into view to get to the top
    updateStatus("Scrolling to top...");
    const firstMsg = document.querySelector("div.chat-message-pair");
    if (!firstMsg) return null;

    firstMsg.scrollIntoView({ block: "start", behavior: "instant" });
    await sleep(800);

    // Step 2: Collect messages by scrolling through every message pair.
    // We scroll each message-pair into view one at a time, extract it,
    // then move to the next. This guarantees we get every message
    // regardless of virtual scrolling.
    const allMessages = [];
    const seenTexts = new Set();
    let lastPairCount = 0;
    let staleRounds = 0;
    const maxRounds = 500;

    for (let round = 0; round < maxRounds; round++) {
      const pairs = document.querySelectorAll("div.chat-message-pair");

      // Extract all currently visible pairs
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
          const key = text.substring(0, 150);
          if (text && key.length > 0 && !seenTexts.has(key)) {
            seenTexts.add(key);
            allMessages.push({ role: "user", text });
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
          // Resolve citations per response
          const cMap = extractCitationMap(textEl);
          const md = domToMarkdown(textEl, cMap);
          const legend = citationLegend(cMap);
          const text = md + legend;
          const key = md.substring(0, 150);
          if (text && key.length > 0 && !seenTexts.has(key)) {
            seenTexts.add(key);
            allMessages.push({ role: "ai", text });
          }
        }
      }

      // Scroll the LAST pair into view to advance
      const lastPair = pairs[pairs.length - 1];
      if (lastPair) {
        lastPair.scrollIntoView({ block: "end", behavior: "instant" });
      }
      await sleep(400);

      // Check if new pairs appeared (virtual scrolling loaded more)
      const newPairs = document.querySelectorAll("div.chat-message-pair");
      if (newPairs.length === lastPairCount) {
        staleRounds++;
        // If no new pairs after several scrolls, we've got everything
        if (staleRounds >= 3) break;
      } else {
        staleRounds = 0;
      }
      lastPairCount = newPairs.length;

      updateStatus(
        `Collecting messages... (${allMessages.length} found)`
      );
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

  function domToMarkdown(element, citationMap) {
    const clone = element.cloneNode(true);

    // Convert citation markers (button.citation-marker) to inline [N] references
    clone.querySelectorAll("button.citation-marker").forEach((btn) => {
      const num = btn.textContent.trim();
      if (num && /^\d+$/.test(num)) {
        btn.replaceWith(document.createTextNode(` [${num}]`));
      } else {
        btn.remove();
      }
    });

    // Remove our own button if present
    const ourWrapper = clone.querySelector(`#${WRAPPER_ID}`);
    if (ourWrapper) ourWrapper.remove();
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

  function downloadMarkdownFile(markdown, title) {
    const filename =
      title.replace(/[^a-zA-Z0-9_\- ]/g, "").replace(/\s+/g, "_") + ".md";
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  // --- Export Handler ---

  async function extractContent(updateStatus) {
    // Extract sources first — needed for citation resolution
    updateStatus("Extracting sources...");
    const sources = extractSources();

    let markdown = null;

    // Primary: extract the full chat via scrolling
    const chatPanel = findChatPanel();
    if (chatPanel) {
      updateStatus("Scanning chat...");
      markdown = await extractFullChat(updateStatus, sources);
    }

    // Secondary: try artifact/report extraction
    if (!markdown) {
      updateStatus("Checking for reports...");
      const artifact = findArtifactContent();
      if (artifact) {
        const cMap = extractCitationMap(artifact);
        markdown = domToMarkdown(artifact, cMap);
        const legend = citationLegend(cMap);
        if (legend) markdown += legend;
      }
      if (!markdown) {
        markdown = await extractArtifact();
      }
    }

    // Enrich sources with metadata from detail views, then append
    if (markdown && markdown.trim().length > 0 && sources.length > 0) {
      await enrichSources(sources, updateStatus);
      const sourcesMd = sourcesToMarkdown(sources);
      if (sourcesMd) {
        markdown += "\n" + sourcesMd;
      }
    }

    return markdown;
  }

  function deriveTitle(markdown) {
    const notebookTitle = document.querySelector("h1.notebook-title");
    const titleMatch = markdown.match(/^#\s+(.+)/m);
    return notebookTitle
      ? notebookTitle.textContent.trim()
      : titleMatch
        ? titleMatch[1].trim()
        : "NotebookLM Export";
  }

  async function handleExport(format) {
    const btn = document.getElementById(BUTTON_ID);
    const originalHTML = btn
      ? btn.innerHTML
      : 'Export <span class="nlm-export-btn-arrow">&#9660;</span>';
    if (btn) {
      btn.textContent = "Extracting...";
      btn.disabled = true;
    }

    const updateStatus = (msg) => {
      if (btn) btn.textContent = msg;
    };

    try {
      const markdown = await extractContent(updateStatus);

      if (!markdown || markdown.trim().length === 0) {
        showNotification(
          "No content found. Make sure a chat or report is open.",
          "error"
        );
        return;
      }

      const title = deriveTitle(markdown);

      if (format === "markdown") {
        updateStatus("Downloading Markdown...");
        downloadMarkdownFile(markdown, title);
        showNotification("Markdown file downloaded.", "success");
      } else {
        updateStatus("Generating PDF...");
        const htmlContent = generatePrintHTML(markdown);
        triggerPrint(htmlContent, title);
        showNotification(
          "PDF ready! Use the print dialog to save.",
          "success"
        );
      }
    } catch (err) {
      console.error("[NotebookLM PDF] Export failed:", err);
      showNotification("Export failed: " + err.message, "error");
    } finally {
      if (btn) {
        btn.innerHTML = originalHTML;
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

    // Inspect citation elements for debugging.
    // Broad search: look inside AI response cards for any small inline elements
    // that might be citations (numbered references, footnotes, etc.)
    const citationElements = [];
    const aiCards = document.querySelectorAll(
      "mat-card.to-user-message-card-content"
    );
    for (const card of aiCards) {
      // Look for the known selectors
      card
        .querySelectorAll('a[href*="citation"], .citation, sup')
        .forEach((el) => citationElements.push(describeCitationEl(el)));

      // Also scan for any small clickable/inline elements with short numeric text
      // that could be citation markers (spans, buttons, anchors, custom elements)
      card.querySelectorAll("a, button, span").forEach((el) => {
        const text = el.textContent.trim();
        if (text.length > 0 && text.length <= 3 && /^\d+$/.test(text)) {
          // Small numbered element — likely a citation
          citationElements.push(describeCitationEl(el));
        }
      });
      // Limit per card to avoid noise
      if (citationElements.length >= 30) break;
    }

    function describeCitationEl(el) {
      const info = {
        tag: el.tagName.toLowerCase(),
        text: el.textContent.trim(),
        href: el.getAttribute("href"),
        title: el.getAttribute("title"),
        ariaLabel: el.getAttribute("aria-label"),
        className: el.className || null,
        dataAttrs: {},
      };
      for (const attr of el.attributes) {
        if (attr.name.startsWith("data-")) {
          info.dataAttrs[attr.name] = attr.value;
        }
      }
      if (el.parentElement) {
        info.parentTag = el.parentElement.tagName.toLowerCase();
        info.parentClass = el.parentElement.className || null;
        info.parentTitle = el.parentElement.getAttribute("title");
        info.parentAriaLabel =
          el.parentElement.getAttribute("aria-label");
      }
      return info;
    }

    // Capture source detail view if open
    let sourceDetailView = null;
    const detailPanel = document.querySelector("div.source-panel-view-content");
    if (detailPanel) {
      const childEls = [];
      detailPanel.querySelectorAll("*").forEach((child) => {
        if (child.children.length === 0 && child.textContent.trim()) {
          childEls.push({
            tag: child.tagName.toLowerCase(),
            class: child.className || null,
            text: child.textContent.trim().substring(0, 200),
          });
        }
      });
      sourceDetailView = {
        fullText: detailPanel.textContent.trim().substring(0, 1000),
        childElements: childEls.slice(0, 30),
      };
    }

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

    // Identify the scroll container element for debugging
    let scrollContainerInfo = null;
    if (scrollContainer) {
      const tag = scrollContainer.tagName.toLowerCase();
      const cls = scrollContainer.className
        ? scrollContainer.className.toString().split(" ").slice(0, 4).join(".")
        : "(no class)";
      scrollContainerInfo = `${tag}.${cls}`;
    }

    return {
      hasChatPanel: !!chatPanel,
      hasScrollContainer: !!scrollContainer,
      scrollContainerEl: scrollContainerInfo,
      scrollHeight: scrollContainer ? scrollContainer.scrollHeight : 0,
      clientHeight: scrollContainer ? scrollContainer.clientHeight : 0,
      scrollOverflow: scrollContainer
        ? scrollContainer.scrollHeight - scrollContainer.clientHeight
        : 0,
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
      sources: extractSources(),
      sourceDetailView,
      citationElements: citationElements.slice(0, 20),
      ariaLabels: ariaLabels.slice(0, 50),
      notableClasses: [...notableClasses].slice(0, 50),
    };
  }

  // --- Message Listener ---

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "exportPDF") {
      handleExport("pdf").catch(console.error);
      sendResponse({ status: "started" });
    } else if (message.action === "exportMarkdown") {
      handleExport("markdown").catch(console.error);
      sendResponse({ status: "started" });
    } else if (message.action === "getStatus") {
      const chatPanel = findChatPanel();
      const msgCount = findMessagePairs().length;
      const artifact = findArtifactContent();
      const sources = extractSources();
      sendResponse({
        onNotebookLM: true,
        hasContent: msgCount > 0 || !!artifact,
        hasReport: !!artifact,
        hasChat: msgCount > 0,
        messageCount: msgCount,
        sourceCount: sources.length,
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
