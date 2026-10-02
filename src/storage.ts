import { validateProject, type Project } from './model';
let database: Promise<IDBDatabase> | undefined;
function db() {
  return (database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('cyancut-local', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('project');
      request.result.createObjectStore('files');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      database = undefined;
      reject(request.error);
    };
  }));
}
async function write(store: string, key: string, value: unknown) {
  const d = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () =>
      reject(tx.error ?? new Error('브라우저 저장소에 기록할 수 없습니다.'));
  });
}
async function read<T>(store: string, key: string): Promise<T | undefined> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store);
    const r = tx.objectStore(store).get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export const saveProject = (p: Project) => write('project', 'recent', p);
export const saveFile = (assetId: string, file: File) => write('files', assetId, file);
export const loadFile = (assetId: string) => read<File>('files', assetId);
export async function restoreProject() {
  const p = await read<Project>('project', 'recent');
  return p ? validateProject(p) : undefined;
}
export async function forgetUnusedFiles(activeIds: string[]) {
  const d = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction('files', 'readwrite');
    const store = tx.objectStore('files');
    const request = store.openKeyCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        if (!activeIds.includes(String(cursor.key))) store.delete(cursor.key);
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
