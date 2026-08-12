/**
 * Gmail is a volatile SPA. Keep every selector in this file so a selector
 * change does not leak into the integration UI or message boundary.
 */
export function isVisible(element: HTMLElement): boolean {
  if (!element.isConnected) return false;
  const style = globalThis.getComputedStyle?.(element);
  if (style?.display === "none" || style?.visibility === "hidden") return false;
  // Gmail may transition a landmark through a zero-size layout box. The
  // display/visibility checks are the safe boundary; geometry alone would
  // make fixture DOM and keyboard-only layouts disappear.
  return true;
}

export function findThreadToolbar(
  root: Document = document,
): HTMLElement | null {
  const main = root.querySelector<HTMLElement>('[role="main"]') ?? root.body;
  if (!main) return null;
  const candidates = Array.from(
    main.querySelectorAll<HTMLElement>(
      '[role="toolbar"], [aria-label*="toolbar" i]',
    ),
  );
  return candidates.find(isVisible) ?? null;
}

export function findThreadSurface(
  root: Document = document,
): HTMLElement | null {
  const main = root.querySelector<HTMLElement>('[role="main"]') ?? root.body;
  if (!main) return null;
  return (
    main.querySelector<HTMLElement>("[data-message-id]")?.parentElement ??
    main.querySelector<HTMLElement>("h2")?.parentElement ??
    main
  );
}

export function findComposer(root: Document = document): HTMLElement | null {
  const candidates = Array.from(
    root.querySelectorAll<HTMLElement>(
      '[role="textbox"][contenteditable="true"], [contenteditable="true"][aria-label*="message" i]',
    ),
  );
  return candidates.find(isVisible) ?? null;
}

export function findComposerMountParent(
  root: Document = document,
): HTMLElement | null {
  const composer = findComposer(root);
  if (!composer) return null;
  return (
    composer.closest<HTMLElement>('[role="dialog"]') ??
    composer.parentElement ??
    composer
  );
}

export function findThreadRows(root: Document = document): HTMLElement[] {
  const main = root.querySelector<HTMLElement>('[role="main"]') ?? root.body;
  if (!main) return [];
  return Array.from(
    main.querySelectorAll<HTMLElement>('tr, [role="listitem"]'),
  ).filter(isVisible);
}
