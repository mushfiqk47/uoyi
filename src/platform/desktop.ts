export interface DesktopBridge {
  isDesktop: boolean;
  platform: string;
  getVersion(): Promise<string>;
  getBootstrapToken(): Promise<{ token: string; mediaToken: string } | null>;
  chooseDirectory(defaultPath?: string): Promise<string | null>;
  revealInFolder(filePath: string): Promise<boolean>;
  openExternal(url: string): Promise<boolean>;
}

declare global {
  interface Window {
    clipweaveDesktop?: DesktopBridge;
  }
}

export function isDesktopApp(): boolean {
  return typeof window !== "undefined" && Boolean(window.clipweaveDesktop?.isDesktop);
}

export function getDesktopBridge(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  return window.clipweaveDesktop ?? null;
}

export async function chooseWorkspaceDirectory(defaultPath?: string): Promise<string | null> {
  const bridge = getDesktopBridge();
  if (!bridge?.chooseDirectory) return null;
  return bridge.chooseDirectory(defaultPath);
}

export async function revealFileInFolder(filePath: string): Promise<boolean> {
  const bridge = getDesktopBridge();
  if (bridge?.revealInFolder) {
    return bridge.revealInFolder(filePath);
  }
  return false;
}

export async function openExternalUrl(url: string): Promise<void> {
  const bridge = getDesktopBridge();
  if (bridge?.openExternal) {
    await bridge.openExternal(url);
    return;
  }
  if (typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
