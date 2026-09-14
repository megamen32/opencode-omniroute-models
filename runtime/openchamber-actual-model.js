(() => {
  const endpoint = "http://127.0.0.1:20129/latest";
  let actualModel = "";

  const updateLastAssistant = () => {
    if (!actualModel) return;
    const messages = document.querySelectorAll("[data-message-id]");
    const root = messages[messages.length - 1];
    if (!root) return;
    const candidates = [...root.querySelectorAll('[class*="truncate"]')]
      .filter((node) => node.textContent?.trim() && !node.textContent.includes("\n"));
    const label = candidates.at(-1);
    if (label) {
      label.textContent = actualModel;
      label.dataset.omnirouteActualModel = "true";
    }
  };

  const poll = async () => {
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      if (response.ok) {
        const payload = await response.json();
        if (typeof payload?.model === "string" && payload.model.trim()) actualModel = payload.model.trim();
        updateLastAssistant();
      }
    } catch {
      // The loopback telemetry endpoint is optional until the OpenCode plugin is loaded.
    }
  };

  new MutationObserver(updateLastAssistant).observe(document.documentElement, { childList: true, subtree: true });
  void poll();
  window.setInterval(poll, 1000);
})();
