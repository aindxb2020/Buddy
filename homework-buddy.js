const SESSION_KEY = "buddy:currentUser";
const LEGACY_SESSION_KEY = "currentUser";
const HISTORY_STORAGE_KEY = "buddy-chat-history";

const MODEL_CONFIG = {
  "buddy-4": {
    label: "Buddy 4",
    provider: "gemini",
    providerLabel: "Buddy",
    supportsImage: true,
    paid: false,
    summary: "Buddy 4 is active. Buddy handles chat, image explanation, and native image generation."
  },
  "buddy-3.5": {
    label: "Buddy 3.5",
    provider: "openrouter",
    providerLabel: "Buddy",
    supportsImage: false,
    paid: false,
    summary: "Buddy 3.5 is active. Buddy powers this lighter free text model."
  },
  "buddy-4.5": {
    label: "Buddy 4.5",
    provider: "grok",
    providerLabel: "Buddy",
    supportsImage: false,
    paid: true,
    summary: "Buddy 4.5 is paid. Upgrade to unlock Buddy premium reasoning."
  }
};

const elements = {
  emptyState: document.getElementById("empty-state"),
  messageStream: document.getElementById("message-stream"),
  composerForm: document.getElementById("composer-form"),
  promptInput: document.getElementById("prompt-input"),
  attachTrigger: document.getElementById("attach-trigger"),
  imageInput: document.getElementById("image-input"),
  attachmentPreview: document.getElementById("attachment-preview"),
  attachmentImage: document.getElementById("attachment-image"),
  attachmentName: document.getElementById("attachment-name"),
  removeAttachment: document.getElementById("remove-attachment"),
  quickActions: [...document.querySelectorAll(".quick-action")],
  modelPills: [...document.querySelectorAll(".model-pill")],
  modelSummary: document.getElementById("model-summary"),
  recentList: document.getElementById("recent-list"),
  connectionBadge: document.getElementById("buddy-connection"),
  openSidebarButton: document.getElementById("open-sidebar"),
  newChatButton: document.getElementById("new-chat"),
  focusSearchButton: document.getElementById("focus-search"),
  feedbacksButton: document.getElementById("feedbacks-button"),
  collapseSidebarButton: document.getElementById("collapse-sidebar"),
  logoutButton: document.getElementById("logout-button"),
  upgradeButtons: [
    document.getElementById("upgrade-button"),
    document.getElementById("top-upgrade-button")
  ].filter(Boolean),
  paywallModal: document.getElementById("paywall-modal"),
  paywallUpgrade: document.getElementById("paywall-upgrade"),
  closePaywall: document.getElementById("close-paywall"),
  stayFree: document.getElementById("stay-free")
};

const state = {
  currentModel: "buddy-4",
  currentAction: "chat",
  attachment: null,
  historyItems: loadHistory(),
  status: {
    geminiConfigured: false,
    grokConfigured: false,
    openrouterConfigured: false,
    huggingfaceConfigured: false,
    buddy45Paid: false
  }
};

if (ensureAuthenticated()) {
  bindEvents();
  updateSidebarVisibility();
  renderHistory();
  updateModelUi();
  updateActionUi();
  autosizePrompt();
  fetchStatus();
}

function updateSidebarVisibility() {
  const isCollapsed = document.body.classList.contains("sidebar-collapsed");
  if (elements.openSidebarButton) {
    elements.openSidebarButton.hidden = !isCollapsed;
  }
}

function bindEvents() {
  elements.feedbacksButton?.addEventListener("click", () => {
    window.open("https://forms.cloud.microsoft/r/XxRBPXxtud", "_blank");
  });

  elements.modelPills.forEach((pill) => {
    pill.addEventListener("click", () => {
      const model = pill.dataset.model;
      if (!MODEL_CONFIG[model]) {
        return;
      }

      if (MODEL_CONFIG[model].paid && !state.status.buddy45Paid) {
        openPaywall();
        return;
      }

      state.currentModel = model;
      updateModelUi();
      updateConnectionBadge();
    });
  });

  elements.quickActions.forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.action;
      handleQuickAction(action);
    });
  });

  elements.attachTrigger.addEventListener("click", () => {
    if (!activeModelSupportsImage()) {
      appendMessage(
        "assistant",
        "Image explanation is available on Buddy 4. Switch to Buddy 4 to upload an image."
      );
      return;
    }

    state.currentAction = "image";
    updateActionUi();
    elements.imageInput.click();
  });

  elements.imageInput.addEventListener("change", async () => {
    const [file] = elements.imageInput.files || [];
    if (!file) {
      return;
    }

    try {
      state.attachment = await fileToAttachment(file);
      elements.attachmentImage.src = state.attachment.dataUrl;
      elements.attachmentName.textContent = file.name;
      elements.attachmentPreview.hidden = false;
      state.currentAction = "image";
      updateActionUi();

      if (!elements.promptInput.value.trim()) {
        elements.promptInput.value = "Explain this image clearly.";
        autosizePrompt();
      }
    } catch (error) {
      appendMessage("assistant", error.message || "Could not read the image.");
    }
  });

  elements.removeAttachment.addEventListener("click", clearAttachment);
  elements.promptInput.addEventListener("input", autosizePrompt);
  elements.composerForm.addEventListener("submit", handleSubmit);

  elements.newChatButton.addEventListener("click", resetComposer);
  elements.focusSearchButton.addEventListener("click", () => {
    elements.recentList.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  elements.collapseSidebarButton.addEventListener("click", () => {
    document.body.classList.toggle("sidebar-collapsed");
    updateSidebarVisibility();
  });
  elements.openSidebarButton.addEventListener("click", () => {
    document.body.classList.remove("sidebar-collapsed");
    updateSidebarVisibility();
  });
  elements.logoutButton.addEventListener("click", logout);

  elements.recentList.addEventListener("click", handleRecentListClick);
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".recent-item")) {
      closeAllRecentMenus();
    }
  });

  elements.upgradeButtons.forEach((button) => {
    button.addEventListener("click", openPaywall);
  });

  elements.paywallUpgrade.addEventListener("click", () => {
    closePaywallModal();
    appendMessage(
      "assistant",
      "Buddy Plus checkout is not live yet. Buddy 4 and Buddy 3.5 are ready to use now."
    );
  });

  elements.closePaywall.addEventListener("click", closePaywallModal);
  elements.stayFree.addEventListener("click", closePaywallModal);
  elements.paywallModal.addEventListener("click", (event) => {
    if (event.target === elements.paywallModal) {
      closePaywallModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elements.paywallModal.hidden) {
      closePaywallModal();
    }
  });
}

async function handleSubmit(event) {
  event.preventDefault();

  const prompt = String(elements.promptInput.value || "").trim();
  const model = MODEL_CONFIG[state.currentModel];

  if (model.paid && !state.status.buddy45Paid) {
    openPaywall();
    return;
  }

  if (state.currentAction === "video") {
    openPaywall();
    return;
  }

  if (state.currentAction === "image" && !activeModelSupportsImage()) {
    appendMessage("assistant", "Switch to Buddy 4 to explain an image.");
    return;
  }

  if (state.currentAction === "generate" && !state.status.geminiConfigured) {
    appendMessage("assistant", "Buddy image generation is not configured yet.");
    return;
  }

  if (state.currentAction === "generate" && state.currentModel !== "buddy-4") {
    appendMessage("assistant", "Switch to Buddy 4 for Buddy image generation.");
    return;
  }

  if (state.attachment && !activeModelSupportsImage()) {
    appendMessage("assistant", "Image explanation is only available on Buddy 4.");
    return;
  }

  if (!providerReady(model.provider)) {
    appendMessage("assistant", `${model.providerLabel} is not configured yet on the server.`);
    return;
  }

  if (!prompt && !state.attachment) {
    appendMessage("assistant", "Add a prompt or attach an image first.");
    return;
  }

  const userText = prompt || "Explain this image.";
  const attachment = state.attachment;

  appendMessage("user", userText, attachment ? attachment.dataUrl : "");
  saveHistory(userText);

  elements.promptInput.value = "";
  autosizePrompt();
  clearAttachment();
  appendLoadingMessage();

  try {
    const request = buildRequest(userText, attachment);
    const response = await fetch(request.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(request.payload)
    });

    const data = await response.json();
    removeLoadingMessage();

    if (!response.ok) {
      if (response.status === 402 || data.upgradeRequired) {
        openPaywall();
      }

      appendMessage("assistant", data.error || "Something went wrong.");
      return;
    }

    if (data.imageUrl) {
      appendMessage("assistant", data.text || "Here is your generated image.", data.imageUrl);
      return;
    }

    appendMessage("assistant", data.text || "No reply came back.");
  } catch (error) {
    removeLoadingMessage();
    appendMessage("assistant", formatUiError(error));
  }
}

function buildRequest(prompt, attachment) {
  if (state.currentAction === "generate") {
    return {
      endpoint: "/api/generate-image",
      payload: {
        prompt,
        modelTier: state.currentModel,
        width: 768,
        height: 768
      }
    };
  }

  if (attachment) {
    return {
      endpoint: "/api/image-explain",
      payload: {
        prompt,
        modelTier: state.currentModel,
        mimeType: attachment.mimeType,
        data: attachment.base64
      }
    };
  }

  return {
    endpoint: "/api/chat",
    payload: {
      prompt,
      modelTier: state.currentModel,
      mode: state.currentAction
    }
  };
}

function handleQuickAction(action) {
  if (action === "video") {
    state.currentAction = "video";
    updateActionUi();
    openPaywall();
    return;
  }

  if (action === "image") {
    if (!activeModelSupportsImage()) {
      appendMessage("assistant", "Buddy 4 handles image explanation. Switch to Buddy 4 to upload an image.");
      return;
    }

    state.currentAction = "image";
    elements.promptInput.placeholder = "Explain this image and tell me what matters.";
    updateActionUi();
    elements.imageInput.click();
    return;
  }

  state.currentAction = action || "chat";
  updateActionUi();

  if (action === "generate") {
    state.currentModel = "buddy-4";
    updateModelUi();
    updateConnectionBadge();
    elements.promptInput.placeholder = "Describe the image you want Buddy to generate.";
  } else if (action === "write") {
    elements.promptInput.placeholder = "Write, rewrite, or edit something...";
  } else if (action === "lookup") {
    elements.promptInput.placeholder = "Ask Buddy to explain or research something...";
  } else {
    elements.promptInput.placeholder = "Ask anything";
  }

  elements.promptInput.focus();
}

function updateModelUi() {
  elements.modelPills.forEach((pill) => {
    pill.classList.toggle("active", pill.dataset.model === state.currentModel);
  });

  const activeModel = MODEL_CONFIG[state.currentModel];
  elements.modelSummary.textContent = activeModel.summary;
}

function updateActionUi() {
  elements.quickActions.forEach((button) => {
    button.classList.toggle("quick-action-active", button.dataset.action === state.currentAction);
  });
}

async function fetchStatus() {
  if (window.location.protocol === "file:") {
    elements.connectionBadge.textContent = "Open Buddy with http://localhost:3000";
    return;
  }

  try {
    const response = await fetch("/api/status");
    const data = await response.json();

    state.status.geminiConfigured = Boolean(data.geminiConfigured);
    state.status.grokConfigured = Boolean(data.grokConfigured);
    state.status.openrouterConfigured = Boolean(data.openrouterConfigured);
    state.status.huggingfaceConfigured = Boolean(data.huggingfaceConfigured);
    state.status.buddy45Paid = Boolean(data.buddy45Paid);

    if (MODEL_CONFIG[state.currentModel].paid && !state.status.buddy45Paid) {
      state.currentModel = "buddy-4";
      updateModelUi();
    }

    updateConnectionBadge();
  } catch (error) {
    elements.connectionBadge.textContent = "Server offline";
  }
}

function updateConnectionBadge() {
  const model = MODEL_CONFIG[state.currentModel];

  if (state.currentAction === "generate" && state.currentModel === "buddy-4") {
    if (state.status.geminiConfigured) {
      elements.connectionBadge.textContent = "Buddy image generation online";
    } else {
      elements.connectionBadge.textContent = "Image generation not configured";
    }
    return;
  }

  if (!providerReady(model.provider)) {
    elements.connectionBadge.textContent = `${model.providerLabel} not configured`;
    return;
  }

  elements.connectionBadge.textContent = `${model.providerLabel} online`;
}

function providerReady(provider) {
  if (provider === "gemini") return state.status.geminiConfigured;
  if (provider === "grok") return state.status.grokConfigured && state.status.buddy45Paid;
  if (provider === "openrouter") return state.status.openrouterConfigured;
  return false;
}

function activeModelSupportsImage() {
  return Boolean(MODEL_CONFIG[state.currentModel].supportsImage);
}

function appendMessage(role, text, imageSrc = "") {
  elements.emptyState.hidden = true;

  const wrapper = document.createElement("article");
  wrapper.className = `message message-${role}`;

  const head = document.createElement("div");
  head.className = "message-head";

  const title = document.createElement("strong");
  title.textContent = role === "user" ? MODEL_CONFIG[state.currentModel].label : "Buddy";

  const subtitle = document.createElement("span");
  if (role === "user") {
    subtitle.textContent = currentActionLabel();
  } else {
    subtitle.textContent = responseSubtitle();
  }

  head.appendChild(title);
  head.appendChild(subtitle);

  const body = document.createElement("div");
  body.className = "message-body";
  body.textContent = text;

  wrapper.appendChild(head);
  wrapper.appendChild(body);

  if (imageSrc) {
    const image = document.createElement("img");
    image.className = "message-image";
    image.src = imageSrc;
    image.alt = role === "user" ? "Uploaded image" : "Generated image";
    wrapper.appendChild(image);
  }

  elements.messageStream.appendChild(wrapper);
  wrapper.scrollIntoView({ behavior: "smooth", block: "end" });
}

function appendLoadingMessage() {
  const wrapper = document.createElement("article");
  wrapper.className = "message message-assistant";
  wrapper.dataset.loading = "true";

  const head = document.createElement("div");
  head.className = "message-head";

  const title = document.createElement("strong");
  title.textContent = "Buddy";

  const subtitle = document.createElement("span");
  subtitle.textContent = responseSubtitle();

  const body = document.createElement("div");
  body.className = "message-body message-loading-body";

  const spinner = document.createElement("div");
  spinner.className = "assistant-spinner";
  spinner.setAttribute("aria-hidden", "true");

  const spinnerImg = document.createElement("img");
  spinnerImg.src = "https://www.image2url.com/r2/default/images/1777115003135-68493c90-4435-411d-aa8f-d55bb055ac5c.png";
  spinnerImg.alt = "Buddy loading";
  spinnerImg.className = "assistant-spinner-image";

  const hiddenLabel = document.createElement("span");
  hiddenLabel.className = "sr-only";
  hiddenLabel.textContent = "Buddy is thinking...";

  spinner.appendChild(spinnerImg);
  body.appendChild(spinner);
  body.appendChild(hiddenLabel);

  head.appendChild(title);
  head.appendChild(subtitle);
  wrapper.appendChild(head);
  wrapper.appendChild(body);
  elements.messageStream.appendChild(wrapper);
}

function removeLoadingMessage() {
  const loadingNode = elements.messageStream.querySelector("[data-loading='true']");
  if (loadingNode) {
    loadingNode.remove();
  }
}

function clearAttachment() {
  state.attachment = null;
  elements.imageInput.value = "";
  elements.attachmentPreview.hidden = true;
  elements.attachmentImage.removeAttribute("src");
  elements.attachmentName.textContent = "Selected image";
}

function openPaywall() {
  elements.paywallModal.hidden = false;
}

function closePaywallModal() {
  elements.paywallModal.hidden = true;
  if (state.currentAction === "video") {
    state.currentAction = "chat";
    updateActionUi();
    elements.promptInput.placeholder = "Ask anything";
  }
}

function autosizePrompt() {
  elements.promptInput.style.height = "auto";
  elements.promptInput.style.height = `${Math.min(elements.promptInput.scrollHeight, 180)}px`;
}

function currentActionLabel() {
  if (state.currentAction === "image") return "Image explanation";
  if (state.currentAction === "generate") return "Image generation";
  if (state.currentAction === "write") return "Writing help";
  if (state.currentAction === "lookup") return "Quick lookup";
  if (state.currentAction === "video") return "Video tools";
  return "Chat";
}

function responseSubtitle() {
  if (state.currentAction === "generate" && state.currentModel === "buddy-4") {
    return "Buddy image response";
  }

  return `${MODEL_CONFIG[state.currentModel].providerLabel} response`;
}

function fileToAttachment(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      const parts = dataUrl.split(",");
      if (parts.length < 2) {
        reject(new Error("Could not read the image."));
        return;
      }

      resolve({
        name: file.name,
        mimeType: file.type || "image/png",
        dataUrl,
        base64: parts[1]
      });
    };
    reader.onerror = () => reject(new Error("Could not read the image."));
    reader.readAsDataURL(file);
  });
}

function createHistoryId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `history-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.map((item) => ({
      id: item.id || createHistoryId(),
      title: String(item.title || "New Buddy chat"),
      pinned: Boolean(item.pinned),
      archived: Boolean(item.archived)
    }));
  } catch (error) {
    return [];
  }
}

function persistHistory() {
  localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(state.historyItems));
  renderHistory();
}

function saveHistory(prompt) {
  const title = String(prompt || "").slice(0, 48) || "New Buddy chat";
  const deduped = state.historyItems.filter((item) => item.title !== title);
  state.historyItems = [
    {
      id: createHistoryId(),
      title,
      pinned: false,
      archived: false
    },
    ...deduped
  ].slice(0, 8);
  persistHistory();
}

function renderHistory() {
  const items = state.historyItems
    .filter((item) => !item.archived)
    .sort((left, right) => Number(right.pinned) - Number(left.pinned));

  const itemsToRender = items.length
    ? items
    : [{ id: "welcome", title: "Welcome to Buddy", pinned: false, archived: false }];

  elements.recentList.innerHTML = "";

  itemsToRender.forEach((item) => {
    const itemNode = document.createElement("div");
    itemNode.className = `recent-item${item.pinned ? " recent-item-pinned" : ""}`;
    itemNode.dataset.id = item.id;
    itemNode.dataset.title = item.title;

    const titleButton = document.createElement("button");
    titleButton.className = "recent-title";
    titleButton.type = "button";
    titleButton.textContent = item.title;

    const moreButton = document.createElement("button");
    moreButton.className = "recent-more";
    moreButton.type = "button";
    moreButton.setAttribute("aria-label", "Open chat actions");
    moreButton.textContent = "...";

    const menu = document.createElement("div");
    menu.className = "recent-menu";
    menu.hidden = true;

    [
      ["share", "Share"],
      ["group", "Start a group chat"],
      ["rename", "Rename"],
      ["move", "Move to project"],
      ["pin", item.pinned ? "Unpin chat" : "Pin chat"],
      ["archive", "Archive"],
      ["delete", "Delete"]
    ].forEach(([action, label]) => {
      const button = document.createElement("button");
      button.className = `recent-menu-item${action === "delete" ? " recent-menu-delete" : ""}`;
      button.type = "button";
      button.dataset.action = action;
      button.textContent = label;
      menu.appendChild(button);
    });

    itemNode.appendChild(titleButton);
    itemNode.appendChild(moreButton);
    itemNode.appendChild(menu);
    elements.recentList.appendChild(itemNode);
  });
}

function handleRecentListClick(event) {
  const itemElement = event.target.closest(".recent-item");
  if (!itemElement) {
    closeAllRecentMenus();
    return;
  }

  const menuButton = event.target.closest(".recent-more");
  const menuItem = event.target.closest(".recent-menu-item");
  const titleButton = event.target.closest(".recent-title");
  const itemId = itemElement.dataset.id;
  const itemTitle = itemElement.dataset.title;

  if (menuItem) {
    handleRecentAction(itemId, menuItem.dataset.action);
    return;
  }

  if (menuButton) {
    const menu = itemElement.querySelector(".recent-menu");
    const isHidden = menu ? menu.hidden : true;
    closeAllRecentMenus();
    if (menu) {
      menu.hidden = !isHidden;
    }
    return;
  }

  if (titleButton) {
    elements.promptInput.value = itemTitle;
    autosizePrompt();
    elements.promptInput.focus();
    closeAllRecentMenus();
  }
}

function handleRecentAction(id, action) {
  const item = state.historyItems.find((entry) => entry.id === id);
  if (!item) {
    return;
  }

  if (action === "share") {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(item.title).catch(() => {});
    }
    appendMessage("assistant", `Chat title copied: ${item.title}`);
    closeAllRecentMenus();
    return;
  }

  if (action === "group") {
    appendMessage("assistant", "Group chat features will be available soon.");
    closeAllRecentMenus();
    return;
  }

  if (action === "rename") {
    const newTitle = window.prompt("Rename this chat", item.title);
    if (newTitle && newTitle.trim()) {
      updateHistoryItem(id, (entry) => ({ ...entry, title: newTitle.trim() }));
    }
    closeAllRecentMenus();
    return;
  }

  if (action === "move") {
    appendMessage("assistant", "Move to project is coming soon.");
    closeAllRecentMenus();
    return;
  }

  if (action === "pin") {
    updateHistoryItem(id, (entry) => ({ ...entry, pinned: !entry.pinned }));
    closeAllRecentMenus();
    return;
  }

  if (action === "archive") {
    updateHistoryItem(id, (entry) => ({ ...entry, archived: true }));
    closeAllRecentMenus();
    return;
  }

  if (action === "delete") {
    state.historyItems = state.historyItems.filter((entry) => entry.id !== id);
    persistHistory();
    closeAllRecentMenus();
  }
}

function updateHistoryItem(id, updater) {
  const index = state.historyItems.findIndex((item) => item.id === id);
  if (index < 0) {
    return;
  }

  state.historyItems[index] = updater(state.historyItems[index]);
  persistHistory();
}

function closeAllRecentMenus() {
  document.querySelectorAll(".recent-menu").forEach((menu) => {
    menu.hidden = true;
  });
}

function resetComposer() {
  elements.messageStream.innerHTML = "";
  elements.emptyState.hidden = false;
  state.currentAction = "chat";
  state.currentModel = "buddy-4";
  clearAttachment();
  elements.promptInput.value = "";
  elements.promptInput.placeholder = "Ask anything";
  autosizePrompt();
  updateActionUi();
  updateModelUi();
  updateConnectionBadge();
}

function formatUiError(error) {
  const message = error?.message || "Request failed.";

  if (message === "Failed to fetch") {
    return "Buddy could not reach the local server. Refresh localhost and try again.";
  }

  return message;
}

function ensureAuthenticated() {
  const session = localStorage.getItem(SESSION_KEY) || localStorage.getItem(LEGACY_SESSION_KEY);
  if (!session) {
    window.location.replace("login.html");
    return false;
  }

  if (!localStorage.getItem(SESSION_KEY)) {
    localStorage.setItem(SESSION_KEY, String(session).trim().toLowerCase());
  }

  return true;
}

function logout() {
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(LEGACY_SESSION_KEY);
  window.location.replace("login.html");
}
