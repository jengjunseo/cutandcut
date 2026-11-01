import { BufferTarget, StreamTarget, type StreamTargetChunk } from 'mediabunny';
import { exportFolder, removeExportFile, exportMime, type ExportDestination } from './export-files';
import type { ExportFormat } from './export-policy';

type SyncFile = {
  write(data: Uint8Array, options: { at: number }): number;
  flush(): void;
  close(): void;
};
/** Encoded output is written with backpressure; decoded frame/PCM blocks remain in the existing engine. */
export async function createExportOutput(destination: ExportDestination, format: ExportFormat) {
  let handle = destination.handle;
  let sync: SyncFile | undefined;
  let writable: FileSystemWritableFileStream | undefined;
  let closed = false;
  if (!handle && typeof navigator.storage?.getDirectory === 'function') {
    handle = await (await exportFolder(true)).getFileHandle(destination.id, { create: true });
    const local = handle as FileSystemFileHandle & {
      createSyncAccessHandle?: () => Promise<SyncFile>;
    };
    if (local.createSyncAccessHandle) sync = await local.createSyncAccessHandle();
  }
  if (handle && !sync) writable = await handle.createWritable();
  async function close(abort = false) {
    if (closed) return;
    closed = true;
    if (sync) {
      try {
        if (!abort) sync.flush();
      } finally {
        sync.close();
      }
    } else if (writable) {
      if (abort) await writable.abort();
      else {
        try {
          await writable.close();
        } catch (error) {
          await writable.abort().catch(() => {});
          throw error;
        }
      }
    }
  }
  const buffer = !handle ? new BufferTarget() : undefined;
  const target =
    buffer ??
    new StreamTarget(
      new WritableStream<StreamTargetChunk>({
        async write(chunk) {
          if (sync) {
            if (sync.write(chunk.data, { at: chunk.position }) !== chunk.data.byteLength)
              throw new DOMException(
                '출력 파일을 기록할 저장 공간이 부족합니다.',
                'QuotaExceededError',
              );
          } else await writable!.write(chunk);
        },
        // Output.cancel() also closes a target; only commit an external writable after successful finalize.
      }),
      { chunked: true, chunkSize: 1024 * 1024 },
    );
  return {
    target,
    streaming: !!handle,
    async complete() {
      if (buffer) return { buffer: buffer.buffer! };
      await close();
      const file = await handle!.getFile();
      if (!destination.handle && file.size <= 64 * 1024 ** 2) {
        const bytes = await file.arrayBuffer();
        await removeExportFile(destination.id);
        return { buffer: bytes };
      }
      return {
        file: new File([file], `CyanCut.${format}`, { type: exportMime(format) }),
        temporary: !destination.handle,
      };
    },
    async abort() {
      try {
        await close(true);
      } finally {
        if (!destination.handle) await removeExportFile(destination.id);
      }
    },
  };
}
