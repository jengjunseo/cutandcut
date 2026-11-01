import type { ExportFormat } from './export-policy';

export type ExportDestination = { id: string; handle?: FileSystemFileHandle };
const folder = 'cyancut-export-temporary';
export const exportMime = (format: ExportFormat) =>
  ({ mp4: 'video/mp4', webm: 'video/webm', wav: 'audio/wav', mp3: 'audio/mpeg' })[format];
export async function exportFolder(create = false) {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(folder, { create });
}
const validId = (id: string) => /^[a-f0-9-]{36}$/.test(id);
/** Keep another tab's housekeeping from invalidating a result still open in this dialog. */
export async function holdExportFile(id: string): Promise<() => void> {
  if (!navigator.locks) return () => {};
  return new Promise((resolve) => {
    void navigator.locks
      .request(
        `cyancut-export:${id}`,
        () =>
          new Promise<void>((release) => {
            resolve(release);
          }),
      )
      .catch(() => resolve(() => {}));
  });
}
export async function removeExportFile(id: string) {
  if (!validId(id)) return;
  for (let retry = 0; retry < 5; retry++) {
    try {
      await (await exportFolder()).removeEntry(id);
      return;
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== 'InvalidModificationError') return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}
/** Only our completed/abandoned temporary exports; never originals or user-chosen destinations. */
export async function pruneExportFiles() {
  try {
    const root = await exportFolder();
    const iterator = (
      root as FileSystemDirectoryHandle & {
        values(): AsyncIterableIterator<FileSystemHandle>;
      }
    ).values();
    for await (const entry of iterator) {
      if (entry.kind !== 'file' || !validId(entry.name)) continue;
      const file = await (entry as FileSystemFileHandle).getFile();
      if (file.lastModified < Date.now() - 24 * 3600_000) {
        if (navigator.locks) {
          await navigator.locks.request(
            `cyancut-export:${entry.name}`,
            { ifAvailable: true },
            async (lock) => {
              if (lock) await removeExportFile(entry.name);
            },
          );
        } else await removeExportFile(entry.name);
      }
    }
  } catch {
    /* OPFS is optional; a private-mode storage restriction must not block editing. */
  }
}
/** A routing threshold, not a size limit: large exports bypass the browser storage quota when possible. */
export async function chooseExportFile(name: string, format: ExportFormat, estimate: number) {
  const picker = (
    window as typeof window & {
      showSaveFilePicker?: (options: {
        suggestedName: string;
        types: { description: string; accept: Record<string, string[]> }[];
      }) => Promise<FileSystemFileHandle>;
    }
  ).showSaveFilePicker;
  if (estimate <= 256 * 1024 ** 2 || !picker) return undefined;
  return picker.call(window, {
    suggestedName: `${name.trim() || 'CyanCut'}.${format}`,
    types: [
      { description: format.toUpperCase(), accept: { [exportMime(format)]: [`.${format}`] } },
    ],
  });
}
