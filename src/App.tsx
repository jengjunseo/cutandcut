import { useCallback, useEffect, useRef, useState, lazy, Suspense } from 'react';
import {
  Scissors,
  Undo2,
  Redo2,
  Download,
  Upload,
  Plus,
  Film,
  Type,
  Layers,
  Music,
  FolderOpen,
  ShieldCheck,
  Keyboard,
  ChevronDown,
  Check,
  LoaderCircle,
  FileJson,
  RotateCcw,
  Link2,
  ArrowRight,
  X,
  Trash2,
  TriangleAlert,
  Clock3,
} from 'lucide-react';
import {
  emptyProject,
  id,
  tick,
  seconds,
  duration,
  frameTick,
  timecode,
  split,
  remove,
  paste,
  linked,
  clipDefaults,
  setTransition,
  validateProject,
  projectLimitError,
  PROJECT_MAX_TIME,
  type Clip,
  type Project,
  type Transition,
} from './model';
import { History } from './history';
import { files, inspect, request, checkCapabilities, type Capabilities } from './engine';
import { freeLayer, insertMedia, markRange, clipBoundary, trimToHead, groupClips } from './editing';
import {
  saveProject,
  restoreProject,
  saveFile,
  loadFile,
  download,
  forgetUnusedFiles,
} from './storage';
import { AudioPreview } from './audio-preview';
import Preview from './Preview';
import Timeline from './Timeline';
import Inspector from './Inspector';
import CaptionPanel from './CaptionPanel';
import AudioMeter from './AudioMeter';
import RecentProjects from './RecentProjects';
import {
  Field,
  IconButton,
  NameInput,
  formatBytes,
  usePopup,
  shortFilename,
  trapDialogFocus,
} from './ui';
const ExportDialog = lazy(() => import('./ExportDialog'));
const shortcuts = [
  ['Space', '재생 / 일시정지'],
  ['J / K / L', '역방향 탐색 / 정지 / 정방향 재생'],
  ['← / →', '이전 / 다음 프레임 · 재생 정지'],
  ['Shift + ← / →', '10프레임 이동'],
  ['Home / End', '프로젝트 시작 / 끝 *'],
  ['V / B', '선택 / 분할 도구'],
  ['Ctrl/Cmd + B', '재생헤드에서 선택 클립 분할'],
  ['Delete / Shift + Delete', '일반 삭제 / 전체 트랙 리플 삭제'],
  ['Ctrl/Cmd + Z', '실행 취소'],
  ['Ctrl/Cmd + Shift + Z', '다시 실행'],
  ['Ctrl/Cmd + C / V', '복사 / 재생헤드에 붙여넣기'],
  ['Ctrl/Cmd + D', '선택 그룹 뒤에 복제'],
  ['Ctrl/Cmd + A', '활성 타임라인 전체 선택 *'],
  ['Ctrl/Cmd + S', '프로젝트 파일 저장'],
  ['+ / −', '타임라인 확대 / 축소 *'],
  ['S', '스냅 토글'],
  ['Escape', '조작 취소 / 선택 해제'],
  ['?', '단축키 도움말'],
  ['I / O', '구간 시작 / 끝 지정'],
  ['↑ / ↓', '이전 / 다음 클립 경계 *'],
  ['[ / ]', '재생헤드 앞 / 뒤 자르기'],
  ['Ctrl/Cmd + G / Ctrl/Cmd + Shift + G', '그룹화 / 그룹 해제 *'],
];
export default function App() {
  const [project, setProject] = useState<Project>(emptyProject),
    projectRef = useRef(project);
  projectRef.current = project;
  const history = useRef(new History()),
    [draft, setDraft] = useState<Project>(),
    [selected, setSelected] = useState<string[]>([]),
    [activeTrack, setActiveTrack] = useState(''),
    [time, setTime] = useState(0),
    timeRef = useRef(time);
  timeRef.current = time;
  const [playing, setPlaying] = useState(false),
    [playingRange, setPlayingRange] = useState(false),
    [rate, setRate] = useState(1),
    audio = useRef(new AudioPreview()),
    [snap, setSnap] = useState(true),
    [tool, setTool] = useState<'select' | 'split'>('select'),
    [zoom, setZoom] = useState(44),
    [tab, setTab] = useState<'media' | 'text' | 'transitions' | 'captions'>('media'),
    [saveStatus, setSaveStatus] = useState('불러오는 중'),
    [ready, setReady] = useState(false),
    [importing, setImporting] = useState(''),
    [importErrors, setImportErrors] = useState<{ file: File; message: string }[]>([]),
    [persistMedia, setPersistMedia] = useState(true),
    [autoInsert, setAutoInsert] = useState(false),
    [assetSelection, setAssetSelection] = useState<string[]>([]),
    [startupCaps, setStartupCaps] = useState<Capabilities>(),
    [capsError, setCapsError] = useState(''),
    [toast, setToast] = useState(''),
    [exportOpen, setExportOpen] = useState(false),
    [helpOpen, setHelpOpen] = useState(false),
    [projectMenu, setProjectMenu] = useState(false),
    [recentOpen, setRecentOpen] = useState(false),
    [processing, setProcessing] = useState(''),
    [switching, setSwitching] = useState(false),
    [dragOver, setDragOver] = useState(false),
    [mobileTab, setMobileTab] = useState('preview'),
    [layout, setLayout] = useState({ left: 270, right: 270, timeline: 330 }),
    [transitionSeconds, setTransitionSeconds] = useState(0.5);
  const fileInput = useRef<HTMLInputElement>(null),
    projectInput = useRef<HTMLInputElement>(null),
    clipboard = useRef<Clip[]>([]),
    toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined),
    saveGeneration = useRef(0),
    importBusy = useRef(false),
    importAbort = useRef<AbortController>(null),
    taskAbort = useRef<AbortController>(null);
  const switchBusy = useRef(false),
    projectTasks = useRef(new AbortController()),
    editGeneration = useRef(0),
    saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const notify = useCallback((message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 6000);
  }, []);
  const commit = useCallback(
    (next: Project) => {
      if (switchBusy.current) return;
      const limit = projectLimitError(next);
      if (limit) {
        notify(limit);
        return;
      }
      const previous = projectRef.current;
      const result = history.current.commit(previous, next);
      if (result !== previous) editGeneration.current++;
      projectRef.current = result;
      setProject(result);
      setDraft(undefined);
    },
    [notify],
  );
  useEffect(() => {
    let live = true;
    setStartupCaps(undefined);
    const timer = setTimeout(
      () =>
        void checkCapabilities(project, 8e6)
          .then((c) => {
            if (live) {
              setStartupCaps(c);
              setCapsError('');
            }
          })
          .catch((e) => {
            if (live) setCapsError(e.message);
          }),
      250,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [project.width, project.height, project.fps]);
  const seek = useCallback((value: number) => {
    const p = projectRef.current;
    setPlaying(false);
    setTime(
      Math.max(0, Math.min(duration(p), frameTick(Math.round(seconds(value) * p.fps), p.fps))),
    );
    audio.current.stop();
  }, []);
  function restoreHistory(action: 'undo' | 'redo') {
    setPlaying(false);
    const next = history.current[action](projectRef.current);
    editGeneration.current++;
    projectRef.current = next;
    setProject(next);
    setDraft(undefined);
    setSelected((ids) => ids.filter((id) => next.clips.some((c) => c.id === id)));
  }
  const undo = () => restoreHistory('undo');
  const redo = () => restoreHistory('redo');
  function saveDownload() {
    download(
      new Blob([JSON.stringify(projectRef.current, null, 2)], { type: 'application/json' }),
      `${projectRef.current.name}.cyancut.json`,
    );
    notify('프로젝트 파일을 저장했습니다. 원본 미디어는 이 JSON에 포함되지 않습니다.');
  }
  function splitSelected() {
    setPlaying(false);
    const p = projectRef.current;
    const next = split(p, selected, timeRef.current);
    if (next === p)
      notify('선택 클립 내부로 재생헤드를 이동하세요. 링크된 트랙의 잠금도 확인하세요.');
    else commit(next);
  }
  function deleteSelected(ripple = false) {
    setPlaying(false);
    const result = remove(projectRef.current, selected, ripple);
    if (result.error) notify(result.error);
    else {
      commit(result.project);
      setSelected([]);
    }
  }
  function duplicate() {
    const p = projectRef.current;
    const copied = linked(p, selected);
    const at = Math.max(...copied.map((c) => c.start + c.duration));
    commit(paste(p, copied, at));
  }
  async function toggle() {
    setPlayingRange(false);
    if (!projectRef.current.clips.length) return;
    if (playing) {
      setPlaying(false);
      audio.current.stop();
      return;
    }
    await audio.current.resume();
    if (timeRef.current >= duration(projectRef.current)) setTime(0);
    setRate(1);
    setPlaying(true);
  }
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const p = await restoreProject();
        if (p && live) {
          for (const a of p.assets) {
            const file = await loadFile(a.id);
            if (file) files.set(a.id, file);
          }
          if (live) {
            projectRef.current = p;
            setProject(p);
            setActiveTrack(p.tracks.find((t) => t.kind === 'visual')?.id ?? '');
            setSaveStatus('최근 프로젝트 복구됨');
            if (p.assets.some((a) => !files.has(a.id)))
              notify('일부 원본이 누락되었습니다. 같은 파일을 다시 가져와 재연결하세요.');
          }
        } else if (live) setSaveStatus('저장 준비');
      } catch (e) {
        if (live) {
          setSaveStatus('저장소 접근 실패');
          notify(
            e instanceof Error
              ? e.message
              : '브라우저 저장소를 사용할 수 없습니다. 프로젝트 파일 저장을 이용하세요.',
          );
        }
      } finally {
        if (live) setReady(true);
      }
    })();
    return () => {
      live = false;
      audio.current.close();
      importAbort.current?.abort();
      projectTasks.current.abort();
      taskAbort.current?.abort();
      clearTimeout(toastTimer.current);
    };
  }, [notify]);
  useEffect(() => {
    if (!ready || switchBusy.current) return;
    const generation = ++saveGeneration.current;
    setSaveStatus('저장 대기');
    const timer = setTimeout(() => {
      setSaveStatus('저장 중');
      void saveProject(project)
        .then(() => {
          if (generation === saveGeneration.current) setSaveStatus('기기에 자동 저장됨');
        })
        .catch(() => {
          if (generation === saveGeneration.current) {
            setSaveStatus('저장 실패');
            notify('자동 저장에 실패했습니다. Ctrl/Cmd+S로 프로젝트 파일을 저장하세요.');
          }
        });
    }, 700);
    saveTimer.current = timer;
    return () => clearTimeout(timer);
  }, [project, ready, notify]);
  useEffect(() => {
    if (!playing) {
      audio.current.stop();
      return;
    }
    let raf = 0,
      last = performance.now(),
      lastUI = 0;
    let playhead = timeRef.current;
    const loop = (now: number) => {
      const delta = Math.min(0.15, (now - last) / 1000);
      last = now;
      playhead += tick(delta * rate);
      const p = projectRef.current;
      const end =
        playingRange && p.workRange ? Math.min(p.workRange.end, duration(p)) : duration(p);
      playhead = Math.max(0, Math.min(end, playhead));
      audio.current.sync(p, playhead, true, rate);
      if (now - lastUI >= 1000 / Math.min(p.fps, 30)) {
        const frameTime = frameTick(Math.floor(((playhead + 0.5) / 1000000) * p.fps), p.fps);
        timeRef.current = frameTime;
        setTime(frameTime);
        lastUI = now;
      }
      if ((playhead >= end && rate > 0) || (playhead <= 0 && rate < 0)) {
        setPlaying(false);
        setTime(playhead);
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      audio.current.stop();
    };
  }, [playing, rate, playingRange]);
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        e.defaultPrevented ||
        e.isComposing ||
        target?.closest('input,textarea,select,[contenteditable="true"],.small-menu') ||
        exportOpen ||
        helpOpen ||
        recentOpen ||
        !ready ||
        switchBusy.current
      )
        return;
      if (e.key === ' ' && target?.closest('button')) return;
      const command = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const focused = !!target?.closest('.timeline-panel');
      if (command) {
        if (key === 's') {
          e.preventDefault();
          saveDownload();
        } else if (key === 'z') {
          e.preventDefault();
          if (e.shiftKey) redo();
          else undo();
        } else if (key === 'b') {
          e.preventDefault();
          splitSelected();
        } else if (key === 'c' && selected.length) {
          e.preventDefault();
          clipboard.current = structuredClone(linked(projectRef.current, selected));
          notify('클립을 복사했습니다.');
        } else if (key === 'v' && clipboard.current.length) {
          e.preventDefault();
          const p = projectRef.current;
          const next = paste(p, clipboard.current, timeRef.current, activeTrack);
          if (next === p)
            notify(
              '트랙 종류와 잠금 상태를 확인하세요. 여러 트랙 복사는 원래 트랙에 붙여넣습니다.',
            );
          else commit(next);
        } else if (key === 'd' && selected.length) {
          e.preventDefault();
          duplicate();
        } else if (key === 'a' && focused) {
          e.preventDefault();
          setSelected(
            project.clips
              .filter((c) => !project.tracks.find((t) => t.id === c.trackId)?.locked)
              .map((c) => c.id),
          );
        } else if (key === 'g' && focused) {
          e.preventDefault();
          commit(groupClips(projectRef.current, selected, e.shiftKey));
        }
        return;
      }
      if (e.key === ' ') {
        e.preventDefault();
        void toggle();
      } else if (key === 'k') {
        setPlaying(false);
      } else if (key === 'j') {
        e.preventDefault();
        setRate(rate < 0 ? Math.max(-8, rate * 2) : -1);
        setPlaying(true);
        notify('역재생은 소리 없는 프레임 탐색으로 동작합니다.');
      } else if (key === 'l') {
        e.preventDefault();
        void audio.current.resume().then(() => {
          setRate(rate > 0 && playing ? Math.min(8, rate * 2) : 1);
          setPlaying(true);
        });
      } else if (key === 'arrowleft' || key === 'arrowright') {
        e.preventDefault();
        seek(
          timeRef.current +
            frameTick(e.shiftKey ? 10 : 1, project.fps) * (key === 'arrowleft' ? -1 : 1),
        );
      } else if (key === 'i' || key === 'o') {
        e.preventDefault();
        commit(markRange(projectRef.current, timeRef.current, key === 'i' ? 'start' : 'end'));
      } else if (focused && (key === 'arrowup' || key === 'arrowdown')) {
        e.preventDefault();
        seek(clipBoundary(projectRef.current, timeRef.current, key === 'arrowup' ? -1 : 1));
      } else if (key === '[' || key === ']') {
        e.preventDefault();
        commit(
          trimToHead(projectRef.current, selected, timeRef.current, key === '[' ? 'start' : 'end'),
        );
      } else if (key === 'delete' || key === 'backspace') {
        e.preventDefault();
        if (selected.length) deleteSelected(e.shiftKey);
      } else if (key === 's') setSnap(!snap);
      else if (key === 'v') setTool('select');
      else if (key === 'b') setTool('split');
      else if (key === 'escape') {
        setDraft(undefined);
        setSelected([]);
        setProjectMenu(false);
      } else if (e.key === '?') {
        e.preventDefault();
        setHelpOpen(true);
      } else if (focused) {
        if (key === 'home') {
          e.preventDefault();
          seek(0);
        } else if (key === 'end') {
          e.preventDefault();
          seek(duration(project));
        } else if (e.key === '+' || e.key === '=') {
          e.preventDefault();
          setZoom(Math.min(200, zoom * 1.3));
        } else if (e.key === '-') {
          e.preventDefault();
          setZoom(Math.max(8, zoom / 1.3));
        }
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  });
  useEffect(() => {
    if (!helpOpen) return;
    const previous = document.activeElement as HTMLElement;
    document.querySelector<HTMLElement>('.help-dialog')?.focus();
    return () => {
      if (previous?.isConnected && previous !== document.body) previous.focus();
      else projectPopup.current?.querySelector<HTMLButtonElement>(':scope > button')?.focus();
    };
  }, [helpOpen]);
  async function importFiles(incoming: File[]) {
    if (switchBusy.current || !ready) return;
    if (importBusy.current) {
      notify('현재 파일 분석이 끝난 뒤 다시 가져오세요.');
      return;
    }
    importBusy.current = true;
    const abort = new AbortController();
    importAbort.current = abort;
    const wasEmpty = !projectRef.current.clips.length;
    const projectId = projectRef.current.id;
    const projectSignal = projectTasks.current.signal;
    const currentImport = () => !abort.signal.aborted && projectRef.current.id === projectId;
    setPlaying(false);
    try {
      for (const file of incoming) {
        if (abort.signal.aborted) break;
        setImporting(`${file.name} 분석 중`);
        try {
          const asset = await inspect(file, abort.signal);
          if (!currentImport()) break;
          if (asset.duration > PROJECT_MAX_TIME)
            throw new Error(
              '현재 원본 한 파일과 프로젝트 타임라인은 각각 60분까지 지원합니다. 60분 이하로 나누어 가져오세요. 출력은 현재 설정에 따라 최대 5분입니다.',
            );
          const p = projectRef.current;
          const missing = p.assets.find(
            (a) =>
              !files.has(a.id) &&
              a.name === file.name &&
              a.size === file.size &&
              a.kind === asset.kind &&
              Math.abs(a.duration - asset.duration) < tick(0.05),
          );
          if (missing) {
            asset.id = missing.id;
            files.set(asset.id, file);
            if (persistMedia)
              try {
                await saveFile(asset.id, file);
                asset.stored = true;
              } catch {
                notify(`${file.name}: 원본 저장 실패. 프로젝트 파일과 원본을 따로 보관하세요.`);
              }
            if (!currentImport()) break;
            const current = projectRef.current;
            commit({
              ...current,
              assets: current.assets.map((a) =>
                a.id === asset.id ? { ...a, stored: asset.stored, thumbnail: asset.thumbnail } : a,
              ),
            });
            notify(`${file.name} 원본을 재연결했습니다.`);
            continue;
          }
          files.set(asset.id, file);
          if (persistMedia && file.size <= 200 * 1024 * 1024) {
            try {
              const estimate = await navigator.storage?.estimate();
              if (estimate?.quota && estimate.quota - (estimate.usage ?? 0) < file.size * 1.2)
                throw new Error('quota');
              await saveFile(asset.id, file);
              asset.stored = true;
            } catch {
              notify(
                `${file.name}: 원본을 기기에 저장하지 못했습니다. 편집은 계속되며 다시 열 때 재연결이 필요합니다.`,
              );
            }
          }
          if (!currentImport()) break;
          const next = autoInsert
            ? insertMedia(projectRef.current, asset, timeRef.current)
            : { ...projectRef.current, assets: [...projectRef.current.assets, asset] };
          commit(next);
          setAssetSelection((ids) => [...ids, asset.id]);
          if (asset.kind === 'image' && /\.gif$/i.test(file.name))
            notify('GIF는 첫 프레임을 정지 이미지로 가져옵니다.');
          if (asset.hasAudio)
            void request<number[]>('waveform', { file, asset }, projectSignal)
              .then((peaks) => {
                if (projectSignal.aborted || projectRef.current.id !== projectId) return;
                const current = projectRef.current;
                if (current.assets.some((a) => a.id === asset.id)) {
                  const updated = {
                    ...current,
                    assets: current.assets.map((a) =>
                      a.id === asset.id ? { ...a, waveform: peaks } : a,
                    ),
                  };
                  projectRef.current = updated;
                  setProject(updated);
                }
              })
              .catch(() => {
                if (!projectSignal.aborted && projectRef.current.id === projectId)
                  notify(`${shortFilename(asset.name)}: 파형 생성에 실패했지만 편집은 유지됩니다.`);
              });
        } catch (e) {
          if (e instanceof DOMException && e.name === 'AbortError') {
            notify('가져오기를 취소했습니다. 이미 가져온 파일과 편집은 유지됩니다.');
            break;
          }
          setImportErrors((rows) => [
            ...rows.slice(-19),
            { file, message: e instanceof Error ? e.message : '파일을 가져오지 못했습니다.' },
          ]);
          notify(
            `${shortFilename(file.name)}: ${e instanceof Error ? e.message : '파일을 가져오지 못했습니다.'}`,
          );
        }
      }
    } finally {
      if (currentImport() && wasEmpty && projectRef.current.clips.length)
        setZoom(
          Math.max(
            8,
            Math.min(
              200,
              ((document.querySelector('.timeline-scroll')?.clientWidth ?? 1000) - 240) /
                Math.max(6, seconds(duration(projectRef.current)) + 1),
            ),
          ),
        );
      setImporting('');
      importBusy.current = false;
      importAbort.current = null;
    }
  }
  function appendAsset(assetId: string, trackId?: string, start?: number) {
    const p = projectRef.current,
      a = p.assets.find((a) => a.id === assetId);
    if (!a) return;
    const compatible =
      trackId &&
      p.tracks.find(
        (t) => t.id === trackId && t.kind === (a.kind === 'audio' ? 'audio' : 'visual'),
      );
    if (trackId && !compatible) {
      notify('영상·이미지는 시각 트랙, 음악은 오디오 트랙에 놓으세요.');
      return;
    }
    const next = insertMedia(p, a, start ?? timeRef.current, trackId);
    if (next === p) notify('트랙과 링크된 오디오의 잠금 상태를 확인하세요.');
    else commit(next);
  }
  function addTrack(kind: 'audio' | 'visual') {
    const t = {
      id: id(),
      name:
        kind === 'audio'
          ? `오디오 ${project.tracks.filter((t) => t.kind === 'audio').length + 1}`
          : `영상 ${project.tracks.filter((t) => t.kind === 'visual').length + 1}`,
      kind,
      locked: false,
      hidden: false,
      muted: false,
    };
    commit({
      ...project,
      tracks: kind === 'visual' ? [t, ...project.tracks] : [...project.tracks, t],
    });
    setActiveTrack(t.id);
  }
  function addText(preset: 'title' | 'subtitle' | 'caption') {
    let p = projectRef.current;
    const layer = freeLayer(p, timeRef.current, tick(5), '텍스트');
    p = layer.project;
    const track = layer.track;
    const c: Clip = {
      id: id(),
      kind: 'text',
      textRole: preset === 'title' ? 'title' : 'caption',
      trackId: track.id,
      name: '텍스트',
      start: timeRef.current,
      duration: tick(5),
      sourceIn: 0,
      ...clipDefaults(),
      y: preset === 'title' ? 0.5 : 0.82,
      text: {
        text:
          preset === 'title'
            ? '우리의 이야기를 시작해요'
            : preset === 'subtitle'
              ? '여기에 자막을 입력하세요'
              : '기억하고 싶은 순간',
        size: preset === 'title' ? Math.round(p.width / 20) : Math.round(p.width / 34),
        color: '#ffffff',
        bold: preset === 'title',
        align: 'center',
        outline: 1,
        shadow: true,
        background: preset === 'caption' ? '#26343b' : 'transparent',
      },
    };
    commit({ ...p, clips: [...p.clips, c] });
    setSelected([c.id]);
    setActiveTrack(track.id);
    setMobileTab('inspector');
  }
  function applyTransition(kind: Transition['kind'], clipId = selected[0]) {
    const result = setTransition(projectRef.current, clipId, kind, tick(transitionSeconds));
    commit(result.project);
    notify(result.message);
  }
  // All entry points share flush, cancellation, durable target save and history reset.
  async function switchProject(load: () => Promise<Project>) {
    if (switchBusy.current || !ready) return;
    switchBusy.current = true;
    setSwitching(true);
    clearTimeout(saveTimer.current);
    saveGeneration.current++;
    importAbort.current?.abort();
    projectTasks.current.abort();
    projectTasks.current = new AbortController();
    taskAbort.current?.abort();
    setPlaying(false);
    audio.current.stop();
    setSaveStatus('전환 전 저장 중');
    try {
      await saveProject(projectRef.current);
      const target = validateProject(await load());
      const originals = new Map<string, File>();
      await Promise.all(
        target.assets.map(async (a) => {
          const file = files.get(a.id) ?? (await loadFile(a.id));
          if (file) originals.set(a.id, file);
        }),
      );
      await saveProject(target);
      files.clear();
      for (const [key, file] of originals) files.set(key, file);
      history.current.clear();
      editGeneration.current++;
      clipboard.current = [];
      projectRef.current = target;
      setProject(target);
      setDraft(undefined);
      setSelected([]);
      setAssetSelection([]);
      setImportErrors([]);
      setTime(0);
      setActiveTrack(target.tracks.find((t) => t.kind === 'visual')?.id ?? '');
      setSaveStatus('기기에 자동 저장됨');
      if (target.assets.some((a) => !files.has(a.id)))
        notify('누락 원본을 다시 가져와 재연결하세요.');
    } catch (e) {
      setSaveStatus('전환 실패 · 현재 작업 유지');
      notify(
        e instanceof Error
          ? e.message
          : '프로젝트 전환에 실패했습니다. 현재 작업을 파일로 저장하세요.',
      );
      throw e;
    } finally {
      switchBusy.current = false;
      setSwitching(false);
    }
  }
  async function openProject(file: File) {
    try {
      await switchProject(async () => {
        if (file.size > 20 * 1024 * 1024) throw new Error('프로젝트 JSON은 20MB 이하여야 합니다.');
        return validateProject(JSON.parse(await file.text()));
      });
    } catch {
      /* switchProject displays the error and preserves the active project. */
    }
  }
  async function activateProject(p: Project) {
    await switchProject(async () => p);
  }
  async function copyProject(backup = false) {
    const p = projectRef.current;
    const copy = {
      ...structuredClone(p),
      id: id(),
      name: p.name + (backup ? ' 복구 지점 ' + new Date().toLocaleTimeString('ko-KR') : ' 복사본'),
    };
    try {
      if (backup) await saveProject(copy, false);
      else await activateProject(copy);
      notify(
        backup
          ? '복구 지점을 저장했습니다. 최근 프로젝트에서 열 수 있습니다.'
          : '복사본을 열었습니다. 원본 파일은 중복 저장하지 않습니다.',
      );
    } catch (e) {
      notify(e instanceof Error ? e.message : '저장 실패');
    }
  }
  async function mediaTask(kind: 'capture' | 'audio-analysis') {
    if (processing || !project.clips.length) return;
    const p = structuredClone(projectRef.current),
      at = timeRef.current;
    const editAtStart = editGeneration.current;
    const abort = new AbortController();
    taskAbort.current = abort;
    setPlaying(false);
    setProcessing(kind === 'capture' ? '정지 프레임 저장 중' : '전체 믹스 음량 검사 중');
    try {
      const sources = p.assets
        .filter((a) => files.has(a.id))
        .map((a) => ({ id: a.id, file: files.get(a.id)! }));
      if (p.clips.some((c) => c.assetId && !files.has(c.assetId)))
        throw new Error('누락 원본을 먼저 재연결하세요.');
      if (kind === 'capture') {
        const blob = await request<Blob>(
          'capture',
          { project: p, time: at, sources },
          abort.signal,
        );
        const file = new File(
            [blob],
            `정지 프레임 ${timecode(at, p.fps).replaceAll(':', '-')}.png`,
            { type: 'image/png' },
          ),
          asset = await inspect(file, abort.signal);
        if (projectRef.current.id !== p.id) return;
        files.set(asset.id, file);
        if (persistMedia) {
          try {
            await saveFile(asset.id, file);
            asset.stored = true;
          } catch {
            notify('정지 프레임의 원본 저장에 실패했습니다. PNG를 별도 저장하세요.');
          }
        }
        if (!abort.signal.aborted) {
          commit(insertMedia(projectRef.current, asset, at));
          download(blob, file.name);
        }
      } else {
        const result = await request<{ peak: number; clippedSamples: number; rms: number }>(
          'audio-analysis',
          { project: p, sources },
          abort.signal,
        );
        if (result.peak === 0) {
          notify('출력에 들리는 오디오가 없습니다.');
          return;
        }
        if (editGeneration.current === editAtStart && projectRef.current.id === p.id) {
          const gain = Math.min(4, ((p.masterVolume ?? 1) * 0.95) / result.peak);
          commit({ ...projectRef.current, masterVolume: gain });
          notify(
            `전체 믹스 피크 ${(20 * Math.log10(result.peak)).toFixed(1)} dBFS · 클리핑 샘플 ${result.clippedSamples}개. 전체 음량 ${Math.round(gain * 100)}%로 피크 정규화했습니다 (최대 400%).`,
          );
        } else notify('검사 중 편집이 바뀌어 정규화를 적용하지 않았습니다.');
      }
    } catch (e) {
      notify(e instanceof Error ? e.message : '미디어 처리 실패');
    } finally {
      setProcessing('');
      taskAbort.current = null;
    }
  }
  function resize(e: React.PointerEvent, part: 'left' | 'right' | 'timeline') {
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const x = e.clientX,
      y = e.clientY,
      base = layout;
    const move = (event: PointerEvent) => {
      setLayout({
        ...base,
        [part]:
          part === 'timeline'
            ? Math.max(180, Math.min(window.innerHeight * 0.65, base.timeline + y - event.clientY))
            : Math.max(
                220,
                Math.min(420, base[part] + (event.clientX - x) * (part === 'right' ? -1 : 1)),
              ),
      });
    };
    const done = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', done);
      target.removeEventListener('pointercancel', done);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', done, { once: true });
    target.addEventListener('pointercancel', done, { once: true });
  }
  function resizeKey(e: React.KeyboardEvent, part: 'left' | 'right' | 'timeline') {
    const keys = part === 'timeline' ? ['ArrowUp', 'ArrowDown'] : ['ArrowRight', 'ArrowLeft'];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const change = (e.key === keys[0] ? 20 : -20) * (part === 'right' ? -1 : 1);
    setLayout((p) => ({
      ...p,
      [part]: Math.max(
        part === 'timeline' ? 180 : 220,
        Math.min(part === 'timeline' ? window.innerHeight * 0.65 : 420, p[part] + change),
      ),
    }));
  }
  const missing = project.assets.filter((a) => !files.has(a.id));
  const projectPopup = usePopup(projectMenu, setProjectMenu);
  const selectedMedia = project.assets.filter(
    (a) => assetSelection.includes(a.id) && files.has(a.id),
  );
  function insertSelectedMedia() {
    let next = projectRef.current;
    for (const asset of next.assets.filter((a) => assetSelection.includes(a.id) && files.has(a.id)))
      next = insertMedia(next, asset, timeRef.current);
    commit(next);
    setAssetSelection([]);
  }
  return (
    <div
      className={`app mobile-${mobileTab}`}
      style={
        {
          '--left-width': `${layout.left}px`,
          '--right-width': `${layout.right}px`,
          '--timeline-height': `${layout.timeline}px`,
        } as React.CSSProperties
      }
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false);
      }}
      onDrop={(e) => {
        if (e.dataTransfer.files.length) {
          e.preventDefault();
          setDragOver(false);
          void importFiles(Array.from(e.dataTransfer.files));
        }
      }}
    >
      <header className="app-header">
        <a className="brand" href="./" onClick={(e) => e.preventDefault()} aria-label="CyanCut">
          <span className="brand-symbol">
            <Scissors size={22} strokeWidth={2.2} />
          </span>
          <span>
            Cyan<span className="brand-light">Cut</span>
          </span>
        </a>
        <span className="header-divider" />
        <div className="project-title" ref={projectPopup}>
          <NameInput
            label="프로젝트 이름"
            name={project.name}
            onCommit={(name) => commit({ ...project, name: name || '이름 없는 프로젝트' })}
          />
          <IconButton
            label="프로젝트 메뉴"
            aria-expanded={projectMenu}
            aria-controls="project-menu"
            onClick={() => setProjectMenu(!projectMenu)}
          >
            <ChevronDown size={14} />
          </IconButton>
          {projectMenu ? (
            <div className="project-menu small-menu" id="project-menu">
              <button
                onClick={() => {
                  setProjectMenu(false);
                  setRecentOpen(true);
                }}
              >
                <FolderOpen size={15} />
                최근 프로젝트 · 저장소
              </button>
              <button
                onClick={() => {
                  setProjectMenu(false);
                  void copyProject();
                }}
              >
                <FileJson size={15} />
                프로젝트 복제
              </button>
              <button
                onClick={() => {
                  setProjectMenu(false);
                  void copyProject(true);
                }}
              >
                <RotateCcw size={15} />
                복구 지점 저장
              </button>
              <button
                disabled={!project.clips.length || !!processing}
                onClick={() => {
                  setProjectMenu(false);
                  void mediaTask('audio-analysis');
                }}
              >
                <Music size={15} />
                전체 음량 검사 · 피크 정규화
              </button>
              <button
                disabled={(project.masterVolume ?? 1) === 1}
                onClick={() => {
                  setProjectMenu(false);
                  commit({ ...project, masterVolume: 1 });
                }}
              >
                전체 음량 초기화
              </button>
              <button
                onClick={() => {
                  setProjectMenu(false);
                  void switchProject(async () => emptyProject()).catch(() => {});
                }}
              >
                <Plus size={15} /> 새 프로젝트
              </button>
              <button
                onClick={() => {
                  projectInput.current?.click();
                  setProjectMenu(false);
                }}
              >
                <FolderOpen size={15} /> 프로젝트 파일 열기
              </button>
              <button
                onClick={() => {
                  saveDownload();
                  setProjectMenu(false);
                }}
              >
                <FileJson size={15} /> 프로젝트 파일 저장
              </button>
              <button
                onClick={() => {
                  setProjectMenu(false);
                  setHelpOpen(true);
                }}
              >
                <Keyboard size={15} /> 단축키 도움말
              </button>
              <button
                onClick={() => {
                  setProjectMenu(false);
                  void forgetUnusedFiles(project.assets.map((a) => a.id))
                    .then(() =>
                      notify('저장된 모든 프로젝트에서 참조하지 않는 원본만 정리했습니다.'),
                    )
                    .catch(() => notify('저장된 원본을 정리할 수 없습니다.'));
                }}
              >
                <Trash2 size={15} /> 사용하지 않는 원본 정리
              </button>
            </div>
          ) : null}
        </div>
        <div
          className={`save-state ${saveStatus.includes('실패') ? 'save-failed' : ''}`}
          role="status"
          title={saveStatus}
        >
          {saveStatus.includes('중') ? (
            <LoaderCircle size={13} className="spin" />
          ) : saveStatus.includes('실패') ? (
            <TriangleAlert size={13} />
          ) : saveStatus === '기기에 자동 저장됨' ? (
            <Check size={13} />
          ) : (
            <Clock3 size={13} />
          )}
          <span>{saveStatus}</span>
        </div>
        <div className="header-actions">
          <IconButton
            label="실행 취소 (Ctrl/Cmd+Z)"
            disabled={!history.current.past.length}
            onClick={undo}
          >
            <Undo2 size={18} />
          </IconButton>
          <IconButton
            label="다시 실행 (Ctrl/Cmd+Shift+Z)"
            disabled={!history.current.future.length}
            onClick={redo}
          >
            <Redo2 size={18} />
          </IconButton>
          <span className="header-divider" />
          <IconButton
            label="단축키 도움말 (?)"
            className="shortcut-help"
            onClick={() => setHelpOpen(true)}
          >
            <Keyboard size={18} />
          </IconButton>
          <button
            className="primary export-button"
            disabled={!project.clips.length}
            onClick={() => {
              setPlaying(false);
              setExportOpen(true);
            }}
          >
            <Download size={16} /> 내보내기
          </button>
        </div>
      </header>
      <div className="mobile-navigation">
        <button
          className={mobileTab === 'media' ? 'selected' : ''}
          aria-pressed={mobileTab === 'media'}
          onClick={() => setMobileTab('media')}
        >
          미디어
        </button>
        <button
          className={mobileTab === 'preview' ? 'selected' : ''}
          aria-pressed={mobileTab === 'preview'}
          onClick={() => setMobileTab('preview')}
        >
          미리보기
        </button>
        <button
          className={mobileTab === 'inspector' ? 'selected' : ''}
          aria-pressed={mobileTab === 'inspector'}
          onClick={() => setMobileTab('inspector')}
        >
          속성
        </button>
      </div>
      <main className="editor-main">
        <aside className="library-panel">
          <div className="library-tabs">
            {[
              ['media', Film, '미디어'],
              ['text', Type, '텍스트'],
              ['transitions', Layers, '전환'],
              ['captions', Type, '자막'],
            ].map(([key, Icon, label]) => {
              const I = Icon as typeof Film;
              return (
                <button
                  key={key as string}
                  className={tab === key ? 'selected' : ''}
                  onClick={() => setTab(key as typeof tab)}
                  aria-pressed={tab === key}
                >
                  <I size={17} />
                  <span>{label as string}</span>
                </button>
              );
            })}
          </div>
          <div className="library-body">
            {tab === 'media' ? (
              <>
                <div className="library-heading">
                  <h2>미디어 보관함</h2>
                  <span className="count-badge">{project.assets.length}</span>
                </div>
                <button
                  className="import-button"
                  onClick={() => fileInput.current?.click()}
                  disabled={!!importing || !ready}
                >
                  <Plus size={17} /> 미디어 가져오기 <span>⌘ / Ctrl + 선택</span>
                </button>
                {assetSelection.length ? (
                  <button
                    className="primary full insert-selection"
                    disabled={!selectedMedia.length}
                    onClick={insertSelectedMedia}
                  >
                    선택한 미디어 추가 · 영상은 연속 배치
                  </button>
                ) : null}
                <p className="library-caption">
                  가져온 파일은 + 또는 배치 선택으로 타임라인에 추가합니다.
                </p>
                <div className="output-support" role="status">
                  <strong>이 기기의 출력 지원</strong>
                  {startupCaps ? (
                    <p>
                      {startupCaps.mp4
                        ? `MP4 가능${startupCaps.aacFallback ? ' · 로컬 AAC 대체 인코더' : ''}`
                        : startupCaps.avc
                          ? 'MP4 AAC 인코더 사용 불가'
                          : 'MP4 영상 인코더 미지원'}{' '}
                      · {startupCaps.webm ? 'WebM 가능' : 'WebM 미지원'} · WAV
                      {startupCaps.mp3 ? ' · MP3' : ''}
                    </p>
                  ) : (
                    <p>{capsError || '실제 인코더 확인 중…'}</p>
                  )}
                  {startupCaps && !startupCaps.mp4 ? (
                    <p>
                      원본은 업로드하지 않습니다. WebM으로 완성하거나 H.264 인코딩을 지원하는
                      Chrome/Edge 환경에서 같은 프로젝트를 여세요.
                    </p>
                  ) : null}
                  {startupCaps?.errors && Object.keys(startupCaps.errors).length ? (
                    <p>
                      일부 인코더 모듈을 불러오지 못했습니다. WAV와 사용 가능한 형식은 별도로 출력할
                      수 있습니다.
                    </p>
                  ) : null}
                </div>
                <label className="import-policy">
                  <input
                    type="checkbox"
                    checked={autoInsert}
                    onChange={(e) => setAutoInsert(e.target.checked)}
                  />{' '}
                  가져오면서 타임라인에 연속 배치
                </label>
                <p className="small-note">
                  해제하면 보관함만 가져옵니다. 이미지·텍스트는 빈 레이어에 배치됩니다.
                </p>
                {importing ? (
                  <div className="import-progress" role="status">
                    <LoaderCircle size={15} className="spin" />
                    {importing}
                    <button className="text-tool" onClick={() => importAbort.current?.abort()}>
                      가져오기 취소
                    </button>
                  </div>
                ) : null}
                {missing.length ? (
                  <div className="missing-banner">
                    <Link2 size={15} />
                    <div>
                      <strong>원본 {missing.length}개 재연결 필요</strong>
                      <p>이름·크기·길이가 같은 파일을 가져오세요.</p>
                      <button onClick={() => fileInput.current?.click()}>
                        파일 재연결 <ArrowRight size={12} />
                      </button>
                    </div>
                  </div>
                ) : null}
                {importErrors.length ? (
                  <details className="import-errors" open>
                    <summary>가져오기 오류 {importErrors.length}개 · 편집 유지됨</summary>
                    {importErrors.map((row, i) => (
                      <div className="import-error-row" key={i}>
                        <strong title={row.file.name}>{row.file.name}</strong>
                        <p>{row.message}</p>
                        <button
                          className="secondary"
                          disabled={!!importing}
                          onClick={() => void importFiles([row.file])}
                        >
                          다시 시도
                        </button>
                      </div>
                    ))}
                    <button className="text-tool" onClick={() => setImportErrors([])}>
                      오류 목록 지우기
                    </button>
                  </details>
                ) : null}
                {project.assets.length ? (
                  <div className="asset-grid">
                    {project.assets.map((a) => (
                      <div
                        key={a.id}
                        className={`asset-card ${files.has(a.id) ? '' : 'missing'}`}
                        draggable={files.has(a.id)}
                        onDragStart={(e) => {
                          e.dataTransfer.setData('application/cyancut-asset', a.id);
                          e.dataTransfer.setData('application/cyancut-asset-id-' + a.id, '1');
                          e.dataTransfer.effectAllowed = 'copy';
                        }}
                      >
                        <label className="asset-selection">
                          <input
                            type="checkbox"
                            aria-label={`${a.name} 배치 선택`}
                            checked={assetSelection.includes(a.id)}
                            onChange={(e) =>
                              setAssetSelection((ids) =>
                                e.target.checked ? [...ids, a.id] : ids.filter((id) => id !== a.id),
                              )
                            }
                          />
                          배치 선택
                        </label>
                        <div className="asset-preview">
                          {a.thumbnail ? (
                            <img src={a.thumbnail} alt={a.name} />
                          ) : (
                            <div className="audio-art">
                              <Music size={23} />
                              {a.waveform ? (
                                <svg viewBox="0 0 120 30" preserveAspectRatio="none">
                                  {a.waveform.map((v, i) => (
                                    <line
                                      key={i}
                                      x1={i}
                                      x2={i}
                                      y1={15 - v * 14}
                                      y2={15 + v * 14}
                                      stroke="currentColor"
                                    />
                                  ))}
                                </svg>
                              ) : null}
                            </div>
                          )}
                          <span className="asset-duration">
                            {a.kind === 'image' ? '이미지' : `${seconds(a.duration).toFixed(1)}s`}
                          </span>
                          <button
                            className="asset-add"
                            aria-label={`${a.name} 타임라인에 추가`}
                            title="타임라인에 추가"
                            disabled={!files.has(a.id)}
                            onClick={() => appendAsset(a.id)}
                          >
                            <Plus size={14} />
                          </button>
                        </div>
                        <strong title={a.name}>{a.name}</strong>
                        <span
                          className="asset-details"
                          title={`${a.container} · ${a.videoCodec || a.audioCodec} · ${formatBytes(a.size)}`}
                        >
                          {a.container} · {a.videoCodec || a.audioCodec} · {formatBytes(a.size)}
                        </span>
                        <details className="asset-diagnostics">
                          <summary>파일 정보</summary>
                          {a.width} × {a.height} · {seconds(a.duration).toFixed(3)}초<br />
                          영상: {a.videoCodec || '없음'} / 오디오: {a.audioCodec || '없음'}
                        </details>
                        <span className="asset-storage">
                          {a.stored ? '원본 기기에 저장됨' : '원본 별도 보관 필요'}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-library">
                    <div className="empty-library-icon">
                      <FolderOpen size={26} strokeWidth={1.2} />
                    </div>
                    <strong>아직 비어 있어요.</strong>
                    <p>
                      첫 번째 파일을 가져오면
                      <br />
                      보관함에서 원하는 미디어를 배치하세요.
                    </p>
                    <div className="format-tags">
                      <span>MP4</span>
                      <span>PNG</span>
                      <span>MP3</span>
                    </div>
                  </div>
                )}
                <div className="library-storage">
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={persistMedia}
                      onChange={(e) => setPersistMedia(e.target.checked)}
                    />{' '}
                    가져온 원본도 기기에 저장
                  </label>
                  <p>
                    파일당 200MB 이하 · 저장소 여유에 따라 적용
                    <br />
                    프로젝트 JSON에는 원본이 포함되지 않습니다.
                  </p>
                </div>
              </>
            ) : tab === 'text' ? (
              <>
                <div className="library-heading">
                  <h2>텍스트 추가</h2>
                  <Type size={17} />
                </div>
                <p className="library-caption">한글 기본 폰트 · 자유로운 위치 조절</p>
                <button className="text-preset title-preset" onClick={() => addText('title')}>
                  <span>이야기의 제목</span>
                  <small>
                    제목 추가 <Plus size={14} />
                  </small>
                </button>
                <button className="text-preset subtitle-preset" onClick={() => addText('subtitle')}>
                  <span>장면을 설명하는 한 줄</span>
                  <small>
                    자막 추가 <Plus size={14} />
                  </small>
                </button>
                <button className="text-preset caption-preset" onClick={() => addText('caption')}>
                  <span>기억하고 싶은 순간</span>
                  <small>
                    배경 박스 텍스트 <Plus size={14} />
                  </small>
                </button>
                <p className="small-note">
                  텍스트는 5초 클립으로 재생헤드에 추가됩니다. 속성 패널에서 내용·스타일·길이를
                  변경하고 미리보기에서 위치를 드래그하세요. 입력은 포커스를 벗어나면 적용됩니다.
                </p>
              </>
            ) : tab === 'captions' ? (
              <CaptionPanel
                p={project}
                selected={selected}
                commit={commit}
                select={setSelected}
                seek={seek}
                notify={notify}
              />
            ) : (
              <>
                <div className="library-heading">
                  <h2>자연스러운 장면 전환</h2>
                </div>
                <p className="library-caption">다음 클립을 선택하거나 끌어놓으세요.</p>
                {[
                  ['dissolve', '크로스 디졸브'],
                  ['black', '검정으로 페이드'],
                  ['white', '흰색으로 페이드'],
                ].map(([kind, label]) => (
                  <button
                    key={kind}
                    className="transition-card"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('application/cyancut-transition', kind);
                    }}
                    onClick={() => applyTransition(kind as Transition['kind'])}
                  >
                    <span className={`transition-art ${kind}`}>
                      <span />
                      <span />
                    </span>
                    <span>{label}</span>
                    <Plus size={14} />
                  </button>
                ))}
                <Field label="전환 길이 (초)">
                  <input
                    type="number"
                    min={0.05}
                    max={3}
                    step={0.05}
                    value={transitionSeconds}
                    onChange={(e) =>
                      setTransitionSeconds(
                        Math.max(0.05, Math.min(3, Number(e.target.value) || 0.5)),
                      )
                    }
                  />
                </Field>
                <div className="info-box">
                  <Layers size={17} />
                  <p>
                    전체 영상 길이는 유지됩니다. 디졸브는 다음 영상의 잘라낸 앞부분을 사용합니다.
                    부족하면 길이를 제한합니다.
                  </p>
                </div>
                <p className="small-note">
                  동일 트랙의 인접한 두 클립에 적용됩니다. 검정·흰색 전환은 접점 전후에 각각 설정한
                  길이만큼 페이드합니다.
                </p>
              </>
            )}
          </div>
          <div className="library-footer">
            <ShieldCheck size={15} />
            <span>로컬 우선 · 업로드 없음</span>
          </div>
        </aside>
        <div
          className="panel-resizer left-resizer"
          role="separator"
          aria-label="미디어 패널 너비"
          tabIndex={0}
          aria-orientation="vertical"
          onKeyDown={(e) => resizeKey(e, 'left')}
          onPointerDown={(e) => resize(e, 'left')}
        />
        <Preview
          mediaActionLabel={selectedMedia.length ? '선택한 미디어 추가' : '보관함에서 배치하기'}
          mediaAction={
            selectedMedia.length
              ? insertSelectedMedia
              : () => {
                  setTab('media');
                  setMobileTab('media');
                  requestAnimationFrame(() =>
                    document
                      .querySelector('.asset-grid')
                      ?.scrollIntoView({ block: 'start', inline: 'nearest' }),
                  );
                }
          }
          capture={() => void mediaTask('capture')}
          processing={processing}
          meter={<AudioMeter audio={audio.current} />}
          playRange={() => {
            if (project.workRange) {
              void audio.current.resume().then(() => {
                setTime(project.workRange!.start);
                timeRef.current = project.workRange!.start;
                setRate(1);
                setPlayingRange(true);
                setPlaying(true);
              });
            }
          }}
          project={draft ?? project}
          time={time}
          playing={playing}
          rate={rate}
          selected={selected}
          seek={seek}
          toggle={() => void toggle()}
          importFiles={() => fileInput.current?.click()}
          update={commit}
          notify={notify}
        />
        <div
          className="panel-resizer right-resizer"
          role="separator"
          aria-label="속성 패널 너비"
          tabIndex={0}
          aria-orientation="vertical"
          onKeyDown={(e) => resizeKey(e, 'right')}
          onPointerDown={(e) => resize(e, 'right')}
        />
        <Inspector
          project={project}
          selected={selected}
          commit={commit}
          notify={notify}
          onSelect={setSelected}
        />
      </main>
      <div
        className="timeline-resizer"
        role="separator"
        aria-label="타임라인 높이"
        tabIndex={0}
        aria-orientation="horizontal"
        onKeyDown={(e) => resizeKey(e, 'timeline')}
        onPointerDown={(e) => resize(e, 'timeline')}
      >
        <span />
      </div>
      <Timeline
        project={draft ?? project}
        time={time}
        selected={selected}
        activeTrack={activeTrack}
        setActiveTrack={setActiveTrack}
        select={setSelected}
        seek={seek}
        commit={commit}
        draft={setDraft}
        split={splitSelected}
        remove={deleteSelected}
        duplicate={duplicate}
        addTrack={addTrack}
        dropAsset={appendAsset}
        applyTransition={applyTransition}
        snap={snap}
        setSnap={setSnap}
        tool={tool}
        setTool={setTool}
        zoom={zoom}
        setZoom={setZoom}
        notify={notify}
      />
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        accept="video/*,audio/*,image/*,.mkv,.mov,.avi,.flac,.ogg,.m4a"
        aria-label="미디어 파일 선택"
        onChange={(e) => {
          void importFiles(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
      <input
        ref={projectInput}
        type="file"
        hidden
        accept=".json,.cyancut"
        aria-label="프로젝트 파일 선택"
        onChange={(e) => {
          if (e.target.files?.[0]) void openProject(e.target.files[0]);
          e.target.value = '';
        }}
      />
      {dragOver ? (
        <div className="global-drop">
          <Upload size={38} />
          <h2>여기에 놓고 편집을 시작하세요.</h2>
          <p>영상 · 이미지 · 음악 / 기기에서 안전하게 처리</p>
        </div>
      ) : null}
      {toast ? (
        <div className="toast" role="status">
          <span>{toast}</span>
          <IconButton label="알림 닫기" onClick={() => setToast('')}>
            <X size={15} />
          </IconButton>
        </div>
      ) : null}
      {exportOpen ? (
        <Suspense
          fallback={
            <div className="modal-backdrop">
              <div className="help-dialog loading-dialog" role="status">
                <LoaderCircle className="spin" size={20} />
                <span>내보내기 화면을 여는 중…</span>
              </div>
            </div>
          }
        >
          <ExportDialog
            project={project}
            range={project.workRange}
            onClose={() => setExportOpen(false)}
          />
        </Suspense>
      ) : null}
      {switching || !ready ? (
        <div className="modal-backdrop" role="status" aria-live="polite">
          <div className="help-dialog loading-dialog">
            <LoaderCircle className="spin" />{' '}
            {ready ? '현재 작업 저장 · 프로젝트 전환 중' : '최근 프로젝트 복구 중'}
          </div>
        </div>
      ) : null}
      {recentOpen ? (
        <RecentProjects
          close={() => {
            setRecentOpen(false);
            projectPopup.current?.querySelector<HTMLButtonElement>(':scope > button')?.focus();
          }}
          open={activateProject}
          notify={notify}
        />
      ) : null}
      {processing ? (
        <div className="processing-status" role="status">
          <LoaderCircle size={16} className="spin" />
          <span>{processing}</span>
          <button className="secondary" onClick={() => taskAbort.current?.abort()}>
            취소
          </button>
        </div>
      ) : null}
      {helpOpen ? (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setHelpOpen(false);
          }}
        >
          <div
            className="help-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="키보드 단축키"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setHelpOpen(false);
              trapDialogFocus(e);
            }}
          >
            <div className="modal-heading">
              <div>
                <span className="eyebrow">빠르고 익숙하게</span>
                <h2>키보드 단축키</h2>
              </div>
              <IconButton label="단축키 도움말 닫기" onClick={() => setHelpOpen(false)}>
                <X size={20} />
              </IconButton>
            </div>
            <div className="shortcuts">
              {shortcuts.map(([key, action]) => (
                <div key={key}>
                  <span>{action}</span>
                  <kbd>{key}</kbd>
                </div>
              ))}
            </div>
            <p className="small-note">
              * 타임라인에 포커스가 있을 때 적용. 입력·IME 조합 중에는 편집 단축키가 동작하지
              않습니다. 붙여넣기는 단일 트랙이면 활성 트랙, 다층 그룹이면 원래 트랙을 유지합니다.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
