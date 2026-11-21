import { getBlob, putBlob } from "./db";

/** Chromium's File System Access API. Safari/Firefox fall back to a normal download. */
type DirHandle = {
  name: string;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<{
    createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>;
  }>;
  queryPermission?: (opts: { mode: string }) => Promise<string>;
  requestPermission?: (opts: { mode: string }) => Promise<string>;
};

const KEY = "settings:renderdir";

export const canPickFolder = () => typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === "function";

export async function pickRenderFolder(): Promise<string | null> {
  const picker = (window as unknown as { showDirectoryPicker?: (opts: { mode: string }) => Promise<DirHandle> }).showDirectoryPicker;
  if (!picker) return null;
  const handle = await picker({ mode: "readwrite" });
  await putBlob(KEY, handle as unknown as Blob);
  return handle.name;
}

export async function getRenderFolder(): Promise<DirHandle | null> {
  try {
    return ((await getBlob(KEY)) as unknown as DirHandle | undefined) || null;
  } catch {
    return null;
  }
}

export async function clearRenderFolder(): Promise<void> {
  const { deleteBlob } = await import("./db");
  await deleteBlob(KEY);
}

/** Writes one finished render. `skipped` means the browser wants a fresh user gesture. */
export async function saveRenderToFolder(fileName: string, blob: Blob): Promise<"saved" | "skipped" | "failed"> {
  const dir = await getRenderFolder();
  if (!dir) return "skipped";
  try {
    if (dir.queryPermission && (await dir.queryPermission({ mode: "readwrite" })) !== "granted") return "skipped";
    const file = await dir.getFileHandle(fileName, { create: true });
    const writable = await file.createWritable();
    await writable.write(blob);
    await writable.close();
    return "saved";
  } catch {
    return "failed";
  }
}
