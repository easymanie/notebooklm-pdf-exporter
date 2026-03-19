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

    // Each source in the panel has a div with aria-label containing the source name
    const sourceItems = sourcePanel.querySelectorAll(
      "div.corpus-select-content div[aria-label]"
    );

    for (const item of sourceItems) {
      const name = item.getAttribute("aria-label");
      if (!name) continue;

      // Try to find a link inside the source item
      const link = item.querySelector("a[href]");
      const href = link ? link.href : null;

      // Determine type from name: .pdf, .html, or treat as link/webpage
      let type = "document";
      if (/\.pdf$/i.test(name)) type = "pdf";
      else if (/\.html?$/i.test(name)) type = "webpage";
      else if (href || !/\.\w{2,4}$/.test(name)) type = "webpage";

      sources.push({ name: name.trim(), type, url: href });
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
    });
    return lines.join("\n");
  }

  // --- Citation Resolution ---

  function extractCitationMap(element, sources) {
    // Inspect citation elements BEFORE domToMarkdown clones and converts them.
    // Try to resolve each numbered citation to a source name.
    const map = {};
    const citationEls = element.querySelectorAll(
      'a[href*="citation"], .citation, sup'
    );

    for (const el of citationEls) {
      const num = el.textContent.trim();
      if (!num || !/^\d+$/.test(num)) continue;
      if (map[num]) continue; // already resolved

      // Strategy 1: title or aria-label on the element itself
      const title = el.getAttribute("title") || el.getAttribute("aria-label");
      if (title) {
        map[num] = title.trim();
        continue;
      }

      // Strategy 2: data attributes that might reference a source
      for (const attr of el.attributes) {
        if (attr.name.startsWith("data-") && attr.value) {
          // Check if the value matches or contains a source name
          const match = sources.find(
            (s) =>
              attr.value.includes(s.name) ||
              s.name.includes(attr.value) ||
              attr.value === String(sources.indexOf(s))
          );
          if (match) {
            map[num] = match.name;
            break;
          }
        }
      }
      if (map[num]) continue;

      // Strategy 3: href might encode a source index or identifier
      const href = el.getAttribute("href") || "";
      if (href) {
        // Try extracting a source index from the href (e.g., "#citation-2")
        const indexMatch = href.match(/(\d+)/);
        if (indexMatch) {
          const idx = parseInt(indexMatch[1], 10);
          // NotebookLM often uses 0-based or 1-based index into sources
          if (idx >= 0 && idx < sources.length) {
            map[num] = sources[idx].name;
            continue;
          }
          if (idx - 1 >= 0 && idx - 1 < sources.length) {
            map[num] = sources[idx - 1].name;
            continue;
          }
        }
      }

      // Strategy 4: parent/ancestor with a tooltip
      const ancestor = el.closest("[title], [aria-label]");
      if (ancestor && ancestor !== element) {
        const label =
          ancestor.getAttribute("title") || ancestor.getAttribute("aria-label");
        if (label) {
          map[num] = label.trim();
          continue;
        }
      }

      // Strategy 5: next sibling tooltip element (some UIs render tooltip as adjacent span)
      const nextEl = el.nextElementSibling;
      if (nextEl) {
        const tip =
          nextEl.getAttribute("title") ||
          nextEl.getAttribute("aria-label") ||
          "";
        if (tip && tip.length > 5) {
          map[num] = tip.trim();
        }
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
        const cMap = extractCitationMap(textEl, sources);
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
          const cMap = extractCitationMap(textEl, sources);
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

    // Convert citation superscripts to source references
    clone
      .querySelectorAll('a[href*="citation"], .citation, sup')
      .forEach((el) => {
        const text = el.textContent.trim();
        if (text && /^\d+$/.test(text)) {
          // If we resolved this citation to a source name, use it
          const sourceName = citationMap && citationMap[text];
          if (sourceName) {
            el.replaceWith(
              document.createTextNode(`[${text}: ${sourceName}]`)
            );
          } else {
            el.replaceWith(document.createTextNode(`[${text}]`));
          }
        } else if (text) {
          el.replaceWith(document.createTextNode(`[${text}]`));
        } else {
          el.remove();
        }
      });

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
        const cMap = extractCitationMap(artifact, sources);
        markdown = domToMarkdown(artifact, cMap);
        const legend = citationLegend(cMap);
        if (legend) markdown += legend;
      }
      if (!markdown) {
        markdown = await extractArtifact();
      }
    }

    // Append sources section at the end
    if (markdown && markdown.trim().length > 0) {
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
    let originalText = btn ? btn.textContent : "Export PDF";
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
        btn.textContent = originalText;
        btn.disabled = false;
      }
    }
  }

  async function handleExportClick(e) {
    if (e && e.preventDefault) {
      e.preventDefault();
      e.stopPropagation();
    }
    await handleExport("pdf");
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

    // Inspect citation elements for debugging
    const citationElements = [];
    document
      .querySelectorAll('a[href*="citation"], .citation, sup')
      .forEach((el) => {
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
        // Also check parent for context
        if (el.parentElement) {
          info.parentTag = el.parentElement.tagName.toLowerCase();
          info.parentClass = el.parentElement.className || null;
          info.parentTitle = el.parentElement.getAttribute("title");
          info.parentAriaLabel =
            el.parentElement.getAttribute("aria-label");
        }
        citationElements.push(info);
      });

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
