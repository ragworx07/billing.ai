type TauriInternals = {
  invoke?: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
};

type TauriWindow = Window & {
  __TAURI_INTERNALS__?: TauriInternals;
};

const objectUrlRevokeDelay = 60_000;

function tauriInvoke<T>(command: string, args?: Record<string, unknown>) {
  const invoke = (window as TauriWindow).__TAURI_INTERNALS__?.invoke;
  if (!invoke) return null;
  return invoke<T>(command, args);
}

async function blobToBytes(blob: Blob) {
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
}

function triggerBrowserDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), objectUrlRevokeDelay);
}

function openBlobInBrowser(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const opened = window.open(url, '_blank');
  if (opened) {
    window.setTimeout(() => URL.revokeObjectURL(url), objectUrlRevokeDelay);
    return true;
  }

  // Fallback if browser popup blocker blocked window.open
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), objectUrlRevokeDelay);
  return true;
}

export async function downloadBlob(blob: Blob, filename: string) {
  const savedPath = await tauriInvoke<string>('save_file_to_downloads', {
    filename,
    bytes: await blobToBytes(blob),
  });

  if (savedPath) return savedPath;
  triggerBrowserDownload(blob, filename);
  return null;
}

export async function openBlob(blob: Blob, filename: string) {
  const tempPath = await tauriInvoke<string>('save_file_to_temp', {
    filename,
    bytes: await blobToBytes(blob),
  });

  if (tempPath) {
    await tauriInvoke<void>('open_file_path', { path: tempPath });
    return true;
  }

  return openBlobInBrowser(blob);
}

export function printHtmlDocument(html: string) {
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.setAttribute('aria-hidden', 'true');
  document.body.appendChild(iframe);

  const frameWindow = iframe.contentWindow;
  const frameDocument = iframe.contentDocument || frameWindow?.document;
  if (!frameWindow || !frameDocument) {
    iframe.remove();
    return false;
  }

  frameDocument.open();
  frameDocument.write(html);
  frameDocument.close();

  window.setTimeout(() => {
    frameWindow.focus();
    frameWindow.print();
    window.setTimeout(() => iframe.remove(), 1000);
  }, 150);

  return true;
}
