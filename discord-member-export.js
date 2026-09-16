/*
Discord Server Member Export (Discord Web DevTools)

Usage:
1) Open Discord Web in your VS Code integrated browser.
2) Open DevTools Console.
3) Paste this entire file and run: await exportDiscordServerMembers();

Output:
- Downloads mutual-server-members.json
- Returns the same object in the console.
*/

async function exportDiscordServerMembers(options = {}) {
  const config = {
    serverOpenDelayMs: 3000,
    channelOpenDelayMs: 1900,
    memberListToggleDelayMs: 900,
    betweenServerDelayMs: 1200,
    actionJitterMs: 450,
    scrollStepDelayMs: 900,
    maxScrollIterations: 500,
    stableCyclesToStop: 10,
    bottomStableCyclesToStop: 8,
    bottomThresholdPx: 12,
    scrollStepViewportFraction: 0.38,
    minScrollStepPx: 90,
    maxScrollStepPx: 380,
    sweepPasses: 2,
    postScrollSettleMs: 160,
    folderExpandDelayMs: 700,
    railDiscoveryDelayMs: 1000,
    allowXPathFallbackDiscovery: false,
    allowIconFallbackClick: false,
    switchTestMode: false,
    switchTestLimit: 30,
    switchTestFoldersOnly: true,
    deepSidebarSearch: true,
    lightRevealMaxSteps: 45,
    lightRevealStepViewportFraction: 0.9,
    lightRevealDelayMs: 90,
    allowMemberListToggle: true,
    autoDismissOverlays: false,
    overlayDismissDelayMs: 120,
    allowFullPageNavigationFallback: false,
    testMode: false,
    testServerId: null,
    verbose: true,
    ...options
  };

  // In single-server mode, avoid expensive sidebar scanning unless explicitly requested.
  if (config.testServerId && options.deepSidebarSearch === undefined) {
    config.deepSidebarSearch = false;
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const jitter = (base, spread = config.actionJitterMs) =>
    Math.max(0, Math.floor(base + Math.random() * Math.max(0, spread)));

  const log = (...args) => {
    if (config.verbose) {
      console.log("[member-export]", ...args);
    }
  };

  const toSnowflake = (value) => {
    if (!value) return null;
    const match = String(value).match(/\b(\d{17,20})\b/);
    return match ? match[1] : null;
  };

  const cleanUrl = (value) => {
    if (!value) return null;
    const text = String(value).trim();
    if (!text) return null;
    if (/^https?:\/\//i.test(text)) return text;
    if (text.startsWith("//")) return `https:${text}`;
    return null;
  };

  const parseGuildListItemId = (value) => {
    if (!value) return null;
    const raw = String(value);
    if (!raw.startsWith("guildsnav___")) return null;
    const token = raw.slice("guildsnav___".length);
    if (!token || token === "home") return null;
    if (token.startsWith("folder-")) return { kind: "folder", id: token };
    const snowflake = toSnowflake(token);
    if (snowflake) return { kind: "guild", id: snowflake };
    // Some Discord builds encode folder ids without "folder-" prefix.
    return { kind: "unknown", id: token };
  };

  const uniqueBy = (items, keyFn) => {
    const map = new Map();
    for (const item of items) {
      const key = keyFn(item);
      if (!key) continue;
      if (!map.has(key)) map.set(key, item);
    }
    return [...map.values()];
  };

  const MEMBER_LIST_TOGGLE_PATH_XPATH =
    "/html/body/div[1]/div[2]/div/div[1]/div/div[2]/div/div/div/div[2]/div[2]/div/div/div[2]/section/div/div[2]/div/svg/path";

  const getNodeByXPath = (xpath) => {
    try {
      return document.evaluate(
        xpath,
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null
      ).singleNodeValue;
    } catch {
      return null;
    }
  };

  const isMemberListToggleElement = (element) => {
    if (!element) return false;
    const togglePath = getNodeByXPath(MEMBER_LIST_TOGGLE_PATH_XPATH);
    const toggleButton =
      togglePath?.closest?.("button,[role='button'],[aria-label]") || null;
    const overlapsToggle =
      Boolean(togglePath && (element === togglePath || togglePath.contains?.(element) || element.contains?.(togglePath))) ||
      Boolean(toggleButton && (element === toggleButton || toggleButton.contains?.(element) || element.contains?.(toggleButton)));
    if (overlapsToggle) return true;
    const host =
      element.closest?.("button,[role='button'],[aria-label]") || element;
    const label =
      host?.getAttribute?.("aria-label") ||
      element.getAttribute?.("aria-label") ||
      "";
    return /member list/i.test(String(label));
  };

  const safeClick = (element, { allowMemberListToggleClick = false } = {}) => {
    if (!element) return false;
    if (!allowMemberListToggleClick && isMemberListToggleElement(element)) return false;
    try {
      element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      element.click();
      return true;
    } catch {
      return false;
    }
  };

  const dismissBlockingOverlays = async () => {
    if (!config.autoDismissOverlays) return;

    const isVisible = (el) => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 2 && rect.height > 2;
    };

    const dialogs = [...document.querySelectorAll("[role='dialog'],[aria-modal='true']")]
      .filter((el) => isVisible(el));
    let dismissedAny = false;
    for (const dialog of dialogs) {
      const closeBtn =
        dialog.querySelector("button[aria-label*='Close'],button[aria-label*='close'],[role='button'][aria-label*='close']") ||
        dialog.querySelector("button[type='button']");
      if (closeBtn) {
        safeClick(closeBtn);
        dismissedAny = true;
      }
    }

    if (dismissedAny) await sleep(config.overlayDismissDelayMs);
  };

  const getServerRail = () => {
    const byAria = document.querySelector("nav[aria-label*='Servers'], nav[aria-label*='servers']");
    if (byAria) return byAria;

    const byListId = document.querySelector("[data-list-id='guildsnav']");
    if (byListId) return byListId.closest("nav") || byListId;

    // Fallback for Discord DOM variants where aria/data-list-id is missing.
    const byXPath = document.evaluate(
      "/html/body/div[2]/div[2]/div/div[1]/div/div[2]/div/div/div/div[2]/div[1]/nav",
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    ).singleNodeValue;
    if (byXPath) return byXPath;

    return null;
  };

  const getXPathServerIconNodes = () => {
    const listXPath =
      "/html/body/div[2]/div[2]/div/div[1]/div/div[2]/div/div/div/div[2]/div[1]/nav/ul/div/div/div[4]/div";
    const snapshot = document.evaluate(
      listXPath,
      document,
      null,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null
    );
    const nodes = [];
    for (let i = 0; i < snapshot.snapshotLength; i += 1) {
      const row = snapshot.snapshotItem(i);
      if (!row) continue;
      const clickable =
        row.querySelector("span div div") ||
        row.querySelector("svg") ||
        row.firstElementChild ||
        row;
      nodes.push(clickable);
    }
    return nodes;
  };

  const findServerRailScroller = (rail) => {
    if (!rail) return null;
    const candidates = [rail, ...rail.querySelectorAll("div,ul,section")];
    let best = null;
    for (const el of candidates) {
      const overflow = el.scrollHeight - el.clientHeight;
      if (overflow < 40) continue;
      if (!best || overflow > best.scrollHeight - best.clientHeight) best = el;
    }
    return best;
  };

  const harvestVisibleGuildEntries = (rail) => {
    if (!rail) return [];
    const guildNodes = [...rail.querySelectorAll("[role='treeitem'][data-list-item-id^='guildsnav___']")];
    let currentExpandedFolderId = null;
    const entries = [];

    for (const node of guildNodes) {
      const raw = node.getAttribute("data-list-item-id");
      const parsed = parseGuildListItemId(raw);
      const level = node.getAttribute("aria-level");
      const expanded = node.getAttribute("aria-expanded");

      // In some Discord DOM variants level-2 guilds are siblings, not descendants.
      // Track the current expanded folder by list order so foldered guilds keep folder_id.
      if (level === "1") {
        if ((parsed?.kind === "folder" || parsed?.kind === "unknown") && expanded === "true") {
          currentExpandedFolderId = parsed.id ? String(parsed.id) : null;
        } else if (parsed?.kind === "guild") {
          currentExpandedFolderId = null;
        }
      }

      if (!parsed || parsed.kind !== "guild") continue;

      const hrefCarrier = node.querySelector("a[href*='/channels/']") || node.closest?.("a[href*='/channels/']");
      const href = hrefCarrier?.getAttribute("href") || "";
      if (href.includes("/@me")) continue;
      const id = parsed.id;

      let folderId = null;
      const folderRawByClosest = node
        .closest("[role='treeitem'][aria-expanded][data-list-item-id^='guildsnav___']")
        ?.getAttribute("data-list-item-id") || null;
      const folderParsedByClosest = parseGuildListItemId(folderRawByClosest);
      if (folderParsedByClosest?.kind === "folder" || folderParsedByClosest?.kind === "unknown") {
        folderId = folderParsedByClosest.id ? String(folderParsedByClosest.id) : null;
      } else if (level === "2") {
        folderId = currentExpandedFolderId;
      }

      const clickTarget =
        node.querySelector("a,div[role='treeitem'],div[role='button'],button") || node;
      const label =
        clickTarget?.getAttribute("aria-label") ||
        node.getAttribute("aria-label") ||
        node.querySelector("img[alt]")?.getAttribute("alt") ||
        null;
      const iconUrl =
        cleanUrl(node.querySelector("img[src]")?.getAttribute("src")) ||
        cleanUrl(clickTarget?.querySelector?.("img[src]")?.getAttribute("src")) ||
        null;

      entries.push({ id, node: clickTarget, label, icon_url: iconUrl, folder_id: folderId, href });
    }

    return uniqueBy(entries, (x) => x.id);
  };

  const folderIsExpanded = (folderNode) => {
    const direct = folderNode.getAttribute("aria-expanded");
    if (direct === "true") return true;
    if (direct === "false") return false;

    const nested = folderNode.querySelector("[aria-expanded]");
    if (nested?.getAttribute("aria-expanded") === "true") return true;
    if (nested?.getAttribute("aria-expanded") === "false") return false;

    const folderItems = folderNode.querySelector("[data-list-id*='folder-items']");
    return Boolean(folderItems && folderItems.querySelector("[role='treeitem'][data-list-item-id^='guildsnav___']"));
  };

  const expandAllServerFolders = async (rail) => {
    if (!rail) return;
    const folders = [...rail.querySelectorAll("[role='treeitem'][data-list-item-id^='guildsnav___']")]
      .filter((node) => {
        const parsed = parseGuildListItemId(node.getAttribute("data-list-item-id"));
        if (!parsed) return false;
        const looksLikeFolder =
          parsed.kind === "folder" ||
          (parsed.kind === "unknown" && node.hasAttribute("aria-expanded"));
        if (!looksLikeFolder) return false;
        return !folderIsExpanded(node);
      });
    for (const folder of folders) {
      // Prefer clicking the folder treeitem itself; child buttons can route elsewhere.
      safeClick(folder);
      await sleep(jitter(Math.max(120, Math.floor(config.folderExpandDelayMs * 0.45)), 80));
      if (!folderIsExpanded(folder)) {
        const clickTarget =
          folder.querySelector("div[role='button'],button,[tabindex],svg") || folder;
        safeClick(clickTarget);
        await sleep(jitter(Math.max(120, Math.floor(config.folderExpandDelayMs * 0.45)), 80));
      }
    }
  };

  const getGuildEntries = async () => {
    log("Phase 1/2: discovering servers from sidebar...");
    await ensureServerListVisible();
    const rail = getServerRail();
    if (!rail) return [];

    await expandAllServerFolders(rail);

    const scroller = findServerRailScroller(rail);
    const seen = new Map();
    const upsert = (entry) => {
      if (!entry?.id) return;
      const existing = seen.get(entry.id);
      if (!existing) {
        seen.set(entry.id, entry);
        return;
      }
      if (!existing.node && entry.node) existing.node = entry.node;
      if (!existing.label && entry.label) existing.label = entry.label;
      if (!existing.icon_url && entry.icon_url) existing.icon_url = entry.icon_url;
      if (!existing.folder_id && entry.folder_id) existing.folder_id = entry.folder_id;
      if (!existing.href && entry.href) existing.href = entry.href;
    };

    for (const entry of harvestVisibleGuildEntries(rail)) upsert(entry);
    if (!scroller) return [...seen.values()];

    const startTop = scroller.scrollTop;
    const stepPx = Math.max(120, Math.floor(scroller.clientHeight * 0.75));
    let noGrowthCycles = 0;

    for (let i = 0; i < 300; i += 1) {
      const sizeBefore = seen.size;
      await expandAllServerFolders(rail);
      for (const entry of harvestVisibleGuildEntries(rail)) upsert(entry);

      const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
      if (atBottom) {
        noGrowthCycles = seen.size === sizeBefore ? noGrowthCycles + 1 : 0;
        if (noGrowthCycles >= 3) break;
      } else {
        scroller.scrollTop = Math.min(scroller.scrollHeight, scroller.scrollTop + stepPx);
        await sleep(jitter(220, 80));
      }
    }

    // Refresh click targets near top so traversal starts with mounted nodes.
    scroller.scrollTop = 0;
    await sleep(150);
    for (const entry of harvestVisibleGuildEntries(rail)) upsert(entry);

    // Restore prior rail position for less UI disruption.
    scroller.scrollTop = startTop;

    const harvested = [...seen.values()];
    if (harvested.length > 1 || !config.allowXPathFallbackDiscovery) return harvested;

    // Fallback for DOM variants where guild ids are not exposed on rail nodes.
    // Discover ids by clicking each sidebar icon and reading /channels/<guild>/<channel>.
    const xpathNodes = getXPathServerIconNodes();
    if (xpathNodes.length === 0) return harvested;

    const discovered = new Map(harvested.map((e) => [e.id, e]));
    for (const node of xpathNodes) {
      safeClick(node);
      await sleep(jitter(config.railDiscoveryDelayMs, Math.max(120, Math.floor(config.railDiscoveryDelayMs / 3))));
      const guildId = getCurrentGuildIdFromUrl();
      if (!guildId) continue;
      if (discovered.has(guildId)) continue;
      const label =
        node.getAttribute?.("aria-label") ||
        node.closest?.("[aria-label]")?.getAttribute("aria-label") ||
        node.querySelector?.("img[alt]")?.getAttribute("alt") ||
        null;
      const iconUrl =
        cleanUrl(node.querySelector?.("img[src]")?.getAttribute("src")) ||
        cleanUrl(node.closest?.("div")?.querySelector?.("img[src]")?.getAttribute("src")) ||
        null;
      const href = [...document.querySelectorAll(`a[href^='/channels/${guildId}/']`)]
        .map((a) => a.getAttribute("href"))
        .find((x) => /\/channels\/\d+\/\d+/.test(x || "")) || null;
      discovered.set(guildId, { id: guildId, node, label, icon_url: iconUrl, folder_id: null, href });
    }

    return [...discovered.values()];
  };

  const getSelectedGuildEntry = () => {
    const selectedCandidates = [
      document.querySelector("a[aria-current='page'][href*='/channels/']"),
      document.querySelector("[role='treeitem'][data-list-item-id^='guildsnav___'][aria-selected='true']"),
      document.querySelector("nav [aria-selected='true'][data-list-item-id^='guildsnav___']"),
      document.querySelector("[class*='guilds'] [aria-selected='true']"),
      document.querySelector("[class*='guilds'] [class*='selected']")
    ].filter(Boolean);

    for (const candidate of selectedCandidates) {
      const hrefCarrier = candidate.closest("a[href*='/channels/']") || candidate.querySelector("a[href*='/channels/']");
      const href = hrefCarrier?.getAttribute("href") || candidate.getAttribute("href") || "";
      const hrefMatch = href.match(/\/channels\/(\d+)\/?/);
      const parsed = parseGuildListItemId(candidate.getAttribute("data-list-item-id"));
      const dataId = parsed?.kind === "guild" ? parsed.id : null;
      const id = hrefMatch?.[1] || dataId || getCurrentGuildIdFromUrl();
      if (!id) continue;

      const label =
        candidate.getAttribute("aria-label") ||
        hrefCarrier?.getAttribute("aria-label") ||
        candidate.querySelector("img[alt]")?.getAttribute("alt") ||
        null;
      const iconUrl =
        cleanUrl(candidate.querySelector("img[src]")?.getAttribute("src")) ||
        cleanUrl(hrefCarrier?.querySelector("img[src]")?.getAttribute("src")) ||
        null;

      return { id, node: candidate, label, icon_url: iconUrl, href: href || null };
    }

    const currentGuildId = getCurrentGuildIdFromUrl();
    if (currentGuildId) {
      const href = [...document.querySelectorAll(`a[href^='/channels/${currentGuildId}/']`)]
        .map((a) => a.getAttribute("href"))
        .find((x) => /\/channels\/\d+\/\d+/.test(x || "")) || null;
      return { id: currentGuildId, node: null, label: null, icon_url: null, href };
    }
    return null;
  };

  const getCurrentGuildIdFromUrl = () => {
    const match = location.pathname.match(/^\/channels\/(\d+)\/([^/]+)/);
    return match ? match[1] : null;
  };

  const getCurrentChannelIdFromUrl = () => {
    const match = location.pathname.match(/^\/channels\/(\d+)\/(\d+)/);
    return match ? match[2] : null;
  };

  const ensureServerListVisible = async () => {
    const rail = getServerRail();
    if (rail) return true;
    const showBtn = document.querySelector(
      "button[aria-label*='Show Server List'],button[aria-label*='Show server list']"
    );
    if (!showBtn) return false;
    safeClick(showBtn);
    await sleep(350);
    return Boolean(getServerRail());
  };

  const findGuildTreeItemById = (guildId) =>
    document.querySelector(`[role='treeitem'][data-list-item-id='guildsnav___${guildId}']`);

  const findGuildNodeByIdLoose = (guildId) => {
    const exact = findGuildTreeItemById(guildId);
    if (exact) return exact;

    const all = [...document.querySelectorAll("[data-list-item-id^='guildsnav___']")];
    for (const node of all) {
      const parsed = parseGuildListItemId(node.getAttribute("data-list-item-id"));
      if (parsed?.kind === "guild" && parsed.id === guildId) {
        return node;
      }
    }
    return null;
  };

  const findGuildActivationNodeByHref = (guildId) => {
    if (!guildId) return null;
    const selectors = [
      `a[href^='/channels/${guildId}/']`,
      `a[href='/channels/${guildId}']`
    ];
    for (const selector of selectors) {
      const anchors = [...document.querySelectorAll(selector)];
      for (const anchor of anchors) {
        const treeItem = anchor.closest("[role='treeitem']");
        if (treeItem) {
          const activation =
            treeItem.querySelector("a[href*='/channels/']") ||
            treeItem.querySelector("div[role='button']") ||
            treeItem.querySelector("button") ||
            treeItem;
          return activation;
        }
        return anchor;
      }
    }
    return null;
  };

  const getGuildTreeItemFromNode = (node) => {
    if (!node) return null;
    const tree = node.closest?.("[role='treeitem'][data-list-item-id^='guildsnav___']") || node;
    const parsed = parseGuildListItemId(tree?.getAttribute?.("data-list-item-id"));
    if (!parsed || parsed.kind !== "guild") return null;
    return tree;
  };

  const getGuildActivationTarget = (treeItem) => {
    if (!treeItem) return null;
    return (
      treeItem.querySelector("a[href*='/channels/']") ||
      treeItem.querySelector("div[role='button']") ||
      treeItem.querySelector("button") ||
      treeItem.querySelector("svg") ||
      treeItem.querySelector("[tabindex]") ||
      treeItem
    );
  };

  const openFolderById = async (folderId) => {
    if (!folderId) return;
    const folderNode = document.querySelector(`[role='treeitem'][data-list-item-id='guildsnav___${folderId}']`);
    if (!folderNode) return;
    if (folderNode.getAttribute("aria-expanded") === "true") return;
    const clickTarget =
      folderNode.querySelector("div[role='treeitem'],div[role='button'],button,svg") || folderNode;
    safeClick(clickTarget);
    await sleep(jitter(config.folderExpandDelayMs, Math.max(120, Math.floor(config.folderExpandDelayMs / 2))));
    if (folderNode.getAttribute("aria-expanded") !== "true") {
      safeClick(clickTarget);
      await sleep(jitter(config.folderExpandDelayMs, Math.max(120, Math.floor(config.folderExpandDelayMs / 2))));
    }
  };

  const ensureGuildNodeAvailable = async (guildId, folderId = null, iconUrl = null) => {
    await ensureServerListVisible();
    const rail = getServerRail();
    if (folderId) {
      await openFolderById(folderId);
    } else if (rail) {
      // Cheap pre-pass: expand currently visible folders before first lookup.
      await expandAllServerFolders(rail);
    }

    let node = findGuildNodeByIdLoose(guildId);
    if (node) return node;
    let hrefNode = findGuildActivationNodeByHref(guildId);
    if (hrefNode) return hrefNode;

    if (!config.deepSidebarSearch) {
      if (!rail) return null;
      const scroller = findServerRailScroller(rail);
      if (!scroller) return null;
      const stepPx = Math.max(120, Math.floor(scroller.clientHeight * config.lightRevealStepViewportFraction));
      scroller.scrollTop = 0;
      await sleep(config.lightRevealDelayMs);

      // Try once more at top after folders expand, before any scrolling.
      await expandAllServerFolders(rail);
      node = findGuildNodeByIdLoose(guildId);
      if (node) return node;
      hrefNode = findGuildActivationNodeByHref(guildId);
      if (hrefNode) return hrefNode;

      for (let i = 0; i < Math.max(1, Number(config.lightRevealMaxSteps) || 45); i += 1) {
        await expandAllServerFolders(rail);
        node = findGuildNodeByIdLoose(guildId);
        if (node) return node;
        hrefNode = findGuildActivationNodeByHref(guildId);
        if (hrefNode) return hrefNode;

        const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
        if (atBottom) break;
        scroller.scrollTop = Math.min(scroller.scrollHeight, scroller.scrollTop + stepPx);
        await sleep(config.lightRevealDelayMs);
      }
      return null;
    }

    if (!rail) return null;

    const scroller = findServerRailScroller(rail);
    const stepPx = scroller ? Math.max(120, Math.floor(scroller.clientHeight * 0.75)) : 160;

    for (let pass = 0; pass < 3; pass += 1) {
      if (folderId) {
        await openFolderById(folderId);
      }
      await expandAllServerFolders(rail);
      node = findGuildNodeByIdLoose(guildId);
      if (node) return node;

      if (!scroller) continue;

      scroller.scrollTop = 0;
      await sleep(120);
      for (let i = 0; i < 300; i += 1) {
        if (folderId) {
          await openFolderById(folderId);
        }
        await expandAllServerFolders(rail);
        node = findGuildNodeByIdLoose(guildId);
        if (node) return node;

        const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
        if (atBottom) break;
        scroller.scrollTop = Math.min(scroller.scrollHeight, scroller.scrollTop + stepPx);
        await sleep(120);
      }
    }

    if (iconUrl && config.allowIconFallbackClick) {
      const key = String(iconUrl).split("?")[0];
      const icons = [...document.querySelectorAll("div[style*='background-image'],img[src]")];
      for (const el of icons) {
        const bg = el.style?.backgroundImage || "";
        const src = el.getAttribute?.("src") || "";
        if (bg.includes(key) || src.includes(key)) {
          const treeItem = el.closest("[role='treeitem'][data-list-item-id^='guildsnav___']");
          if (treeItem) return treeItem;
        }
      }
    }

    return null;
  };

  const getServerNameFromView = (fallback = null) => {
    const heading =
      document.querySelector("header h1") ||
      document.querySelector("h1[class*='title']") ||
      document.querySelector("[aria-label*='Server'] h1");
    const headingText = heading?.textContent?.trim();
    return headingText || fallback || "Unknown Server";
  };

  const openServerByGuildEntry = async (entry) => {
    if (entry?.id && getCurrentGuildIdFromUrl() === entry.id) return true;
    await dismissBlockingOverlays();
    await ensureServerListVisible();
    const liveNode = entry?.id
      ? await ensureGuildNodeAvailable(entry.id, entry.folder_id || null, entry.icon_url || null)
      : null;
    const strictTree = getGuildTreeItemFromNode(liveNode);
    if (!strictTree) {
      if (liveNode) {
        safeClick(liveNode);
        await sleep(jitter(config.serverOpenDelayMs, 120));
        if (getCurrentGuildIdFromUrl() === entry?.id) return true;
      }
      log("open-fail", {
        server_id: entry?.id || null,
        folder_id: entry?.folder_id || null,
        has_href: Boolean(entry?.href),
        found_treeitem_now: Boolean(findGuildTreeItemById(entry?.id || "")),
        current_guild: getCurrentGuildIdFromUrl()
      });
      const hrefActivationNode = findGuildActivationNodeByHref(entry?.id || "");
      if (hrefActivationNode) {
        safeClick(hrefActivationNode);
        await sleep(jitter(config.serverOpenDelayMs, 120));
        if (getCurrentGuildIdFromUrl() === entry?.id) return true;
      }
      const discoveredHref = [...document.querySelectorAll(`a[href^='/channels/${entry?.id || ""}/']`)]
        .map((a) => a.getAttribute("href"))
        .find((x) => /\/channels\/\d+(\/\d+)?/.test(x || "")) || null;
      const fallbackHref =
        (entry?.href && /\/channels\/\d+(\/\d+)?/.test(entry.href) ? entry.href : null) ||
        discoveredHref;
      if (fallbackHref && config.allowFullPageNavigationFallback) {
        location.assign(fallbackHref);
        await sleep(jitter(config.serverOpenDelayMs + 350));
        return getCurrentGuildIdFromUrl() === entry?.id;
      }
      if (entry?.id && config.allowFullPageNavigationFallback) {
        location.assign(`/channels/${entry.id}`);
        await sleep(jitter(config.serverOpenDelayMs + 450));
        return getCurrentGuildIdFromUrl() === entry.id;
      }
      return getCurrentGuildIdFromUrl() === entry?.id;
    }
    try {
      strictTree.scrollIntoView({ block: "center" });
    } catch {}
    await sleep(80);
    const activationTarget = getGuildActivationTarget(strictTree);
    safeClick(activationTarget);
    await sleep(jitter(config.serverOpenDelayMs));
    if (getCurrentGuildIdFromUrl() !== entry.id) {
      // Retry once with the treeitem itself; some builds require direct treeitem click.
      safeClick(strictTree);
      await sleep(jitter(Math.max(350, Math.floor(config.serverOpenDelayMs * 0.6)), 120));
    }
    return getCurrentGuildIdFromUrl() === entry.id;
  };

  const openATextChannelIfNeeded = async (guildId) => {
    const currentGuild = getCurrentGuildIdFromUrl();
    if (currentGuild !== guildId) return false;

    if (getCurrentChannelIdFromUrl()) return true;

    const channelLink = [...document.querySelectorAll(`a[href^='/channels/${guildId}/']`)]
      .find((a) => /\/channels\/\d+\/\d+/.test(a.getAttribute("href") || ""));

    if (!channelLink) return false;

    safeClick(channelLink);
    await sleep(jitter(config.channelOpenDelayMs));
    return Boolean(getCurrentChannelIdFromUrl());
  };

  const isElementVisible = (el) => {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 2 && rect.height > 2;
  };

  const queryVisible = (selector) =>
    [...document.querySelectorAll(selector)].find((el) => isElementVisible(el)) || null;

  const ensureMemberListVisible = async ({ allowToggleAttempt = true } = {}) => {
    const visiblePane = findMemberPane();
    if (visiblePane) return true;

    const hideBtn = queryVisible("button[aria-label*='Hide Member List'],button[aria-label*='Hide member list']");
    if (hideBtn) return true;

    if (!config.allowMemberListToggle || !allowToggleAttempt) return false;

    const showBtn = queryVisible("button[aria-label*='Show Member List'],button[aria-label*='Show member list']");
    if (showBtn) {
      safeClick(showBtn, { allowMemberListToggleClick: true });
      await sleep(config.memberListToggleDelayMs);
      return Boolean(findMemberPane());
    }

    return Boolean(findMemberPane());
  };

  const ensureMemberPanelReady = async () => {
    for (let i = 0; i < 4; i += 1) {
      // Allow a single toggle attempt, then only observe/wait to avoid toggle flip-flops.
      if (await ensureMemberListVisible({ allowToggleAttempt: i === 0 })) return true;
      await sleep(220);
    }
    return Boolean(findMemberPane());
  };

  const findMemberPane = () => {
    const direct =
      queryVisible("[data-list-id='members']") ||
      queryVisible("[class*='membersWrap']");
    if (direct) return direct;

    const candidates = [...document.querySelectorAll("section,aside,div")]
      .filter((el) => {
        const cls = el.className ? String(el.className) : "";
        const aria = el.getAttribute("aria-label") || "";
        if (!isElementVisible(el)) return false;
        return cls.includes("members") || aria.toLowerCase().includes("members");
      });
    return candidates[0] || null;
  };

  const findScrollable = (root) => {
    if (!root) return null;
    const all = [root, ...root.querySelectorAll("*")];
    let best = null;
    for (const el of all) {
      const overflows = el.scrollHeight - el.clientHeight;
      if (overflows < 40) continue;
      if (!best || overflows > best.scrollHeight - best.clientHeight) {
        best = el;
      }
    }
    return best;
  };

  const getMemberRows = (pane) => {
    if (!pane) return [];

    const rows = [...pane.querySelectorAll("[data-list-item-id^='members-'], [id^='member-'], [class*='member']")]
      .filter((el) => {
        const listItemId = el.getAttribute("data-list-item-id") || "";
        const id = el.getAttribute("id") || "";
        if (listItemId.startsWith("members-")) return true;
        if (id.startsWith("member-")) return true;
        const cls = String(el.className || "");
        if (cls.toLowerCase().includes("member")) return true;
        return false;
      });

    return rows;
  };

  const extractUserIdFromRow = (row) => {
    const candidates = [
      row.getAttribute("data-user-id"),
      row.getAttribute("data-list-item-id"),
      row.getAttribute("id"),
      row.querySelector("[data-user-id]")?.getAttribute("data-user-id"),
      row.querySelector("[data-list-item-id]")?.getAttribute("data-list-item-id"),
      row.querySelector("a[href*='/users/']")?.getAttribute("href"),
      row.querySelector("img[src]")?.getAttribute("src")
    ];

    for (const candidate of candidates) {
      const id = toSnowflake(candidate);
      if (id) return id;
    }

    return null;
  };

  const normalizeText = (value) => {
    if (!value) return null;
    const text = String(value).replace(/\r?\n/g, " ").trim();
    return text || null;
  };

  const normalizeName = (value) => {
    if (!value) return null;
    const text = String(value).normalize("NFC").replace(/\r?\n/g, " ").trim();
    return text || null;
  };

  const extractNamesFromRow = (row) => {
    const directUsername =
      row.querySelector("[id*='member-username-']")?.textContent ||
      row.querySelector("[class*='username']")?.textContent ||
      null;

    const displayName =
      row.querySelector("[class*='nameAndDecorators'] [class*='name']")?.textContent ||
      row.querySelector("[class*='displayName']")?.textContent ||
      row.querySelector("[class*='name']")?.textContent ||
      null;

    const cleanedUsername = normalizeName(directUsername);
    const cleanedDisplayName = normalizeName(displayName);

    if (cleanedUsername && cleanedDisplayName) {
      return {
        username: cleanedUsername,
        display_name: cleanedDisplayName
      };
    }

    const fallbackText = normalizeName(row.textContent);
    if (!cleanedUsername && !cleanedDisplayName && fallbackText) {
      const parts = fallbackText
        .replace(/\bBOT\b/g, "")
        .split(/\s{2,}|•|\|/)
        .map((p) => normalizeName(p))
        .filter(Boolean);

      return {
        username: parts[0] || null,
        display_name: parts[0] || null
      };
    }

    return {
      username: cleanedUsername || cleanedDisplayName || null,
      display_name: cleanedDisplayName || cleanedUsername || null
    };
  };

  const extractIsBotFromRow = (row) => {
    const text = row.textContent || "";
    if (/\bBOT\b/i.test(text)) return true;
    if (row.querySelector("[class*='botTag'], [aria-label*='Bot'], [aria-label*='bot']")) return true;
    return false;
  };

  const extractUserIconFromRow = (row) =>
    cleanUrl(
      row.querySelector("img[src]")?.getAttribute("src") ||
      row.querySelector("[style*='background-image']")?.style?.backgroundImage?.match(/url\(\"?(.*?)\"?\)/)?.[1]
    );

  const collectMembersFromCurrentServer = async () => {
    const pane = findMemberPane();
    if (!pane) return [];

    const scroller = findScrollable(pane);
    if (!scroller) return [];

    const seen = new Map();
    let stableCycles = 0;
    let edgeStableCycles = 0;
    let lastScrollTop = -1;

    const distanceToBottom = () =>
      Math.max(0, scroller.scrollHeight - (scroller.scrollTop + scroller.clientHeight));

    const isNearBottom = () => distanceToBottom() <= config.bottomThresholdPx;
    const isNearTop = () => scroller.scrollTop <= config.bottomThresholdPx;

    const nextScrollStep = () => {
      const baseline = Math.floor(scroller.clientHeight * config.scrollStepViewportFraction);
      const randomBoost = Math.floor(Math.random() * 60);
      return Math.max(
        config.minScrollStepPx,
        Math.min(config.maxScrollStepPx, baseline + randomBoost)
      );
    };

    const harvestVisibleRows = () => {
      const sizeBeforeCollect = seen.size;
      const rows = getMemberRows(pane);

      for (const row of rows) {
        const userId = extractUserIdFromRow(row);
        if (!userId) continue;

        const { username, display_name } = extractNamesFromRow(row);
        const isBot = extractIsBotFromRow(row);
        const userIconUrl = extractUserIconFromRow(row);

        if (!seen.has(userId)) {
          seen.set(userId, {
            user_id: userId,
            username: username || null,
            display_name: display_name || null,
            is_bot: Boolean(isBot),
            user_icon_url: userIconUrl || null
          });
          continue;
        }

        const existing = seen.get(userId);
        if (!existing.username && username) existing.username = username;
        if (!existing.display_name && display_name) existing.display_name = display_name;
        if (isBot) existing.is_bot = true;
        if (!existing.user_icon_url && userIconUrl) existing.user_icon_url = userIconUrl;
      }

      return seen.size > sizeBeforeCollect;
    };

    // Start from the top so each down-pass sees a full contiguous stream.
    scroller.scrollTop = 0;
    await sleep(jitter(config.scrollStepDelayMs));

    for (let pass = 0; pass < Math.max(1, config.sweepPasses); pass += 1) {
      const direction = pass % 2 === 0 ? 1 : -1; // down on even passes, up on odd passes
      stableCycles = 0;
      edgeStableCycles = 0;

      for (let i = 0; i < config.maxScrollIterations; i += 1) {
        const foundNewBeforeMove = harvestVisibleRows();
        if (foundNewBeforeMove) {
          stableCycles = 0;
        } else {
          stableCycles += 1;
        }

        const atEdgeBeforeMove = direction > 0 ? isNearBottom() : isNearTop();
        const step = nextScrollStep();
        if (direction > 0) {
          scroller.scrollTop = atEdgeBeforeMove
            ? scroller.scrollHeight
            : Math.min(scroller.scrollHeight, scroller.scrollTop + step);
        } else {
          scroller.scrollTop = atEdgeBeforeMove
            ? 0
            : Math.max(0, scroller.scrollTop - step);
        }

        await sleep(jitter(config.scrollStepDelayMs));
        await sleep(config.postScrollSettleMs);

        const foundNewAfterMove = harvestVisibleRows();
        const foundNew = foundNewBeforeMove || foundNewAfterMove;
        if (foundNew) {
          stableCycles = 0;
        }

        const moved = scroller.scrollTop !== lastScrollTop;
        lastScrollTop = scroller.scrollTop;
        const atEdgeAfterMove = direction > 0 ? isNearBottom() : isNearTop();

        if (atEdgeAfterMove && !foundNew && !moved) {
          edgeStableCycles += 1;
        } else if (atEdgeAfterMove && !foundNew) {
          edgeStableCycles += 1;
        } else {
          edgeStableCycles = 0;
        }

        if (stableCycles >= config.stableCyclesToStop && edgeStableCycles >= config.bottomStableCyclesToStop) {
          break;
        }
      }
    }

    return [...seen.values()].sort((a, b) => a.user_id.localeCompare(b.user_id));
  };

  let guildEntries = [];
  if (config.testServerId) {
    // Fast path: do not scan full sidebar when a specific server id is provided.
    const targetId = String(config.testServerId);
    const selected = getSelectedGuildEntry();
    if (selected?.id === targetId) {
      guildEntries = [selected];
    } else {
      guildEntries = [{ id: targetId, node: null, label: null, icon_url: null, folder_id: null, href: null }];
    }
  } else {
    guildEntries = await getGuildEntries();
    if (guildEntries.length === 0) {
      const selected = getSelectedGuildEntry();
      if (selected) {
        guildEntries = [selected];
      }
    }
  }

  if (!config.testServerId && config.testMode) {
    const currentGuildId = getCurrentGuildIdFromUrl();
    if (currentGuildId) {
      guildEntries = guildEntries.filter((g) => g.id === currentGuildId);
    } else {
      guildEntries = guildEntries.slice(0, 1);
    }
  }

  if (guildEntries.length === 0) {
    throw new Error("No servers found in the sidebar. Try running while a guild channel is open, or pass testServerId explicitly.");
  }

  log(`Found ${guildEntries.length} servers in sidebar.`);

  if (config.switchTestMode) {
    const candidates = config.switchTestFoldersOnly
      ? guildEntries.filter((g) => Boolean(g.folder_id))
      : guildEntries;
    const sample = candidates.slice(0, Math.max(1, Number(config.switchTestLimit) || 30));
    const result = {
      tested_at: new Date().toISOString(),
      source: "discord-web-dom",
      switch_test: true,
      tested_count: sample.length,
      ok: [],
      failed: []
    };

    log(`Switch test: trying ${sample.length} servers (${config.switchTestFoldersOnly ? "folders-only" : "all"}).`);
    for (let i = 0; i < sample.length; i += 1) {
      const entry = sample[i];
      log(`(switch ${i + 1}/${sample.length}) ${entry.id}...`);
      const opened = await openServerByGuildEntry(entry);
      const currentGuild = getCurrentGuildIdFromUrl();
      if (opened) {
        result.ok.push({ server_id: entry.id, folder_id: entry.folder_id || null, current_guild: currentGuild });
      } else {
        result.failed.push({ server_id: entry.id, folder_id: entry.folder_id || null, current_guild: currentGuild });
      }
      await sleep(jitter(Math.max(120, Math.floor(config.betweenServerDelayMs * 0.4)), 50));
    }
    log(`Switch test complete: ok=${result.ok.length}, failed=${result.failed.length}.`);
    return result;
  }

  log("Phase 2/2: scraping members from each server...");

  const exportPayload = {
    exported_at: new Date().toISOString(),
    source: "discord-web-dom",
    servers: []
  };

  for (let index = 0; index < guildEntries.length; index += 1) {
    const entry = guildEntries[index];
    log(`(${index + 1}/${guildEntries.length}) Opening server ${entry.id}...`);

    const opened = await openServerByGuildEntry(entry);
    if (!opened) {
      log(`Skipped ${entry.id}: unable to switch to this server.`);
      continue;
    }

    await dismissBlockingOverlays();
    await openATextChannelIfNeeded(entry.id);
    await dismissBlockingOverlays();
    const memberPanelReady = await ensureMemberPanelReady();
    if (!memberPanelReady) {
      log(`Skipped ${entry.id}: member panel not visible after retries.`);
      continue;
    }
    await sleep(220);

    const serverName = getServerNameFromView(entry.label);
    const members = await collectMembersFromCurrentServer();

    exportPayload.servers.push({
      server_id: entry.id,
      server_name: serverName || entry.label || "Unknown Server",
      server_icon_url: entry.icon_url || null,
      members
    });

    log(`Captured ${members.length} members from "${serverName}".`);
    await sleep(jitter(config.betweenServerDelayMs));
  }

  const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "mutual-server-members.json";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);

  log(`Export complete: ${exportPayload.servers.length} servers.`);
  return exportPayload;
}

window.exportDiscordServerMembers = exportDiscordServerMembers;
