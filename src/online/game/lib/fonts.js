// King Online's web fonts come from next/font (app/(online)/layout.jsx),
// which self-hosts them under family names of its choosing (plus a
// size-matched local fallback) and publishes each family list as a CSS
// variable on <html>. CSS uses the variables directly; canvas text is drawn
// by family name, so the table reads the names from the same variables
// rather than hard-coding them. The plain names are only a fallback for a
// page without the variables.
const VARS = {
  inter: ["--font-inter", "Inter"],
  georgian: ["--font-noto-georgian", '"Noto Sans Georgian"'],
};

let resolved = null;

/** The family lists behind --font-inter and --font-noto-georgian. */
export function webFonts() {
  if (resolved) return resolved;
  if (typeof document === "undefined") {
    return { inter: VARS.inter[1], georgian: VARS.georgian[1] };
  }
  const style = getComputedStyle(document.documentElement);
  const read = ([name, plain]) => style.getPropertyValue(name).trim() || plain;
  resolved = { inter: read(VARS.inter), georgian: read(VARS.georgian) };
  return resolved;
}

// The stacks the table's text uses: Latin-first for numbers and chat,
// Georgian-first for names and labels.
export const latinFont = () =>
  `${webFonts().inter}, system-ui, Arial, sans-serif`;
export const georgianFont = () =>
  `${webFonts().georgian}, ${webFonts().inter}, system-ui, Arial, sans-serif`;

/**
 * Resolves once both fonts are ready to draw with (or after `timeoutMs`).
 * Canvas text is rasterised once, in whatever font is loaded at that moment,
 * and never redrawn when a web font arrives later, so the table waits for
 * them before its first draw. A slow network only delays it so long.
 */
export function waitForWebFonts(timeoutMs = 3000) {
  if (typeof document === "undefined" || !document.fonts?.load) {
    return Promise.resolve();
  }
  const { inter, georgian } = webFonts();
  // The sample text picks the unicode-range subsets to fetch: Latin digits
  // for Inter, Georgian plus Latin for Noto (names can be either).
  const ready = Promise.all([
    document.fonts.load(`bold 13px ${inter}`, "A1+"),
    document.fonts.load(`bold 14px ${georgian}`, "აA"),
  ]).catch(() => {});
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  return Promise.race([ready, timeout]).finally(() => clearTimeout(timer));
}
