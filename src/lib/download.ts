/**
 * Handing the user a file.
 *
 * This is as close as a static browser app gets to writing one: a page has no
 * filesystem access, so the only way out is a Blob the browser saves. Shared
 * by the exchange log drawer and the diagnostics report so both produce the
 * same filename shape.
 */

/** A filename that sorts chronologically and is safe on every platform. */
export function timestampedFilename(prefix: string, extension: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, '');
  return `${prefix}-${stamp}.${extension}`;
}

export function downloadText(filename: string, contents: string, mime: string): void {
  const blob = new Blob([contents], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Revoke on the next tick: revoking synchronously can cancel the
    // download in some browsers before it has started reading the blob.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
