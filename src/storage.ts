import { validateProject, type Project } from './model';
let database: Promise<IDBDatabase> | undefined;
function db() {
  return (database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('cyancut-local', 2);
    let failed = false;
    request.onblocked = () => {
      failed = true;
      database = undefined;
      reject(
        new Error(
          '다른 탭이 이전 프로젝트 저장소를 사용하고 있습니다. 다른 CyanCut 탭을 닫고 새로고침하세요.',
        ),
      );
    };
    request.onupgradeneeded = () => {
      const d = request.result;
      if (!d.objectStoreNames.contains('project')) d.createObjectStore('project');
      if (!d.objectStoreNames.contains('files')) d.createObjectStore('files');
      if (!d.objectStoreNames.contains('projects')) {
        const projects = d.createObjectStore('projects');
        const old = request.transaction!.objectStore('project').get('recent');
        old.onsuccess = () => {
          if (old.result)
            projects.put({ project: old.result, updatedAt: Date.now() }, old.result.id);
        };
      }
    };
    request.onsuccess = () => {
      if (failed) {
        request.result.close();
        return;
      }
      request.result.onversionchange = () => {
        request.result.close();
        database = undefined;
      };
      resolve(request.result);
    };
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
export async function saveProject(p: Project) {
  const d = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction(['project', 'projects'], 'readwrite');
    tx.objectStore('project').put(p, 'recent');
    tx.objectStore('projects').put({ project: p, updatedAt: Date.now() }, p.id);
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('프로젝트 저장 실패'));
  });
}
export type SavedProject = { project: Project; updatedAt: number };
export async function recentProjects(): Promise<SavedProject[]> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const r = d.transaction('projects').objectStore('projects').getAll();
    r.onsuccess = () =>
      resolve((r.result as SavedProject[]).sort((a, b) => b.updatedAt - a.updatedAt));
    r.onerror = () => reject(r.error);
  });
}
export const saveFile = (assetId: string, file: File) => write('files', assetId, file);
export const loadFile = (assetId: string) => read<File>('files', assetId);
export async function restoreProject() {
  const p = await read<Project>('project', 'recent');
  return p ? validateProject(p) : undefined;
}
export async function forgetUnusedFiles(activeIds: string[]) {
  const d = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction(['files', 'projects'], 'readwrite');
    const store = tx.objectStore('files');
    const projects = tx.objectStore('projects').getAll();
    projects.onsuccess = () => {
      const protectedIds = new Set([
        ...activeIds,
        ...(projects.result as SavedProject[]).flatMap((row) =>
          row.project.assets.map((a) => a.id),
        ),
      ]);
      const request = store.openKeyCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          if (!protectedIds.has(String(cursor.key))) store.delete(cursor.key);
          cursor.continue();
        }
      };
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
