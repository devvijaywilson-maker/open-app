/**
 * Robust clipboard utility that works reliably across HTTPS, HTTP (LAN),
 * mobile devices, and legacy environments without triggering layout jumps or scrolling.
 */

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  // 1. Try Modern Clipboard API (available in secure contexts)
  if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to offscreen fallback
    }
  }

  // 2. Offscreen input fallback with strict zero-scroll
  try {
    const activeEl = document.activeElement as HTMLElement | null;
    const tempTextArea = document.createElement("textarea");
    tempTextArea.value = text;
    tempTextArea.setAttribute("readonly", "");
    tempTextArea.style.position = "fixed";
    tempTextArea.style.top = "0";
    tempTextArea.style.left = "-9999px";
    tempTextArea.style.width = "2px";
    tempTextArea.style.height = "2px";
    tempTextArea.style.padding = "0";
    tempTextArea.style.border = "none";
    tempTextArea.style.outline = "none";
    tempTextArea.style.boxShadow = "none";
    tempTextArea.style.background = "transparent";
    tempTextArea.style.opacity = "0";
    tempTextArea.style.pointerEvents = "none";

    document.body.appendChild(tempTextArea);

    // Save scroll position
    const scrollX = window.scrollX || window.pageXOffset || 0;
    const scrollY = window.scrollY || window.pageYOffset || 0;

    tempTextArea.select();
    tempTextArea.setSelectionRange(0, text.length);

    const success = document.execCommand("copy");
    document.body.removeChild(tempTextArea);

    // Immediately restore scroll if browser shifted
    window.scrollTo(scrollX, scrollY);

    if (activeEl && typeof activeEl.focus === "function") {
      activeEl.focus({ preventScroll: true });
    }

    return success;
  } catch (err) {
    console.error("Clipboard write error:", err);
    return false;
  }
}

export async function readTextFromClipboard(): Promise<{ text: string | null; error?: string }> {
  if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.readText === "function") {
    try {
      const text = await navigator.clipboard.readText();
      return { text };
    } catch (err: any) {
      return { text: null, error: err?.message || "Permission denied" };
    }
  }
  return { text: null, error: "Clipboard read not supported in this context" };
}
