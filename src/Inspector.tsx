import { Settings2, Link2, Unlink, SlidersHorizontal, Type, ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { seconds, tick, trim, move, reorder, type Clip, type Project } from './model';
import { Field, IconButton } from './ui';
export const ratios = {
  '16:9': [16, 9],
  '9:16': [9, 16],
  '1:1': [1, 1],
  '4:5': [4, 5],
  '4:3': [4, 3],
} as const;
export function setRatio(p: Project, ratio: keyof typeof ratios, resolution: number) {
  const [a, b] = ratios[ratio];
  const short = Math.min(a, b);
  return {
    ...p,
    width: Math.round((resolution * a) / short / 2) * 2,
    height: Math.round((resolution * b) / short / 2) * 2,
  };
}
export function ratioOf(p: Project) {
  return (
    (Object.keys(ratios) as (keyof typeof ratios)[]).find(
      (k) => Math.abs(p.width / p.height - ratios[k][0] / ratios[k][1]) < 0.005,
    ) ?? '사용자 지정'
  );
}
type Props = {
  project: Project;
  selected: string[];
  commit: (p: Project) => void;
  notify: (s: string) => void;
  onSelect: (ids: string[]) => void;
};
export default function Inspector({ project: p, selected, commit, notify, onSelect }: Props) {
  const c = p.clips.find((c) => selected.includes(c.id));
  const locked = c && p.tracks.find((t) => t.id === c.trackId)?.locked;
  const [section, setSection] = useState('transform');
  function patch(value: Partial<Clip>) {
    if (!c || locked) return;
    commit({ ...p, clips: p.clips.map((x) => (x.id === c.id ? { ...x, ...value } : x)) });
  }
  function text(value: Partial<NonNullable<Clip['text']>>) {
    if (c?.text) patch({ text: { ...c.text, ...value } });
  }
  function swap(direction: -1 | 1) {
    if (!c) return;
    const result = reorder(p, c.id, direction);
    if (result.error) notify(result.error);
    else commit(result.project);
  }
  const ratio = ratioOf(p);
  return (
    <aside className="inspector-panel">
      <div className="panel-top">
        <span className="eyebrow">{c ? '클립 속성' : '프로젝트 설정'}</span>
        <SlidersHorizontal size={15} />
      </div>
      <div className="inspector-scroll">
        {p.clips.length ? (
          <Field label="클립 선택 · 겹친 클립도 선택 가능">
            <select
              aria-label="속성에서 클립 선택"
              value={c?.id ?? ''}
              onChange={(e) => onSelect(e.target.value ? [e.target.value] : [])}
            >
              <option value="">프로젝트 설정</option>
              {p.clips.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {seconds(c.start).toFixed(2)}초 ({c.kind})
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        {c ? (
          <>
            <div className="selection-heading">
              <span className={`kind-badge ${c.kind}`}>
                {c.kind === 'video'
                  ? '영상'
                  : c.kind === 'audio'
                    ? '오디오'
                    : c.kind === 'text'
                      ? '텍스트'
                      : '이미지'}
              </span>
              <h2>{selected.length > 1 ? `${selected.length}개 클립 선택` : c.name}</h2>
              {locked ? <p className="warning">이 트랙은 잠겨 있습니다.</p> : null}
            </div>
            <fieldset disabled={!!locked}>
              <div className="two-fields order-buttons">
                <button className="secondary" onClick={() => swap(-1)}>
                  앞 클립과 교환
                </button>
                <button className="secondary" onClick={() => swap(1)}>
                  뒤 클립과 교환
                </button>
              </div>
              <div className="inspector-section">
                <h3>시간</h3>
                <div className="two-fields">
                  <Field label="시작 (초)">
                    <NumberInput
                      value={seconds(c.start)}
                      min={0}
                      max={300}
                      onCommit={(v) => commit(move(p, [c.id], tick(v) - c.start))}
                    />
                  </Field>
                  <Field label="길이 (초)">
                    <NumberInput
                      value={seconds(c.duration)}
                      min={1 / p.fps}
                      max={300}
                      onCommit={(v) => commit(trim(p, [c.id], 'end', tick(v) - c.duration))}
                    />
                  </Field>
                </div>
                {c.kind === 'video' || c.kind === 'audio' ? (
                  <Field label="원본 시작 (초)">
                    <NumberInput
                      value={seconds(c.sourceIn)}
                      min={0}
                      max={seconds(p.assets.find((a) => a.id === c.assetId)?.duration ?? 0)}
                      onCommit={(v) => commit(trim(p, [c.id], 'start', tick(v) - c.sourceIn))}
                    />
                  </Field>
                ) : null}
              </div>
              {c.kind === 'text' && c.text ? (
                <div className="inspector-section">
                  <h3>
                    <Type size={14} /> 텍스트
                  </h3>
                  <TextInput key={c.id} value={c.text.text} onCommit={(v) => text({ text: v })} />
                  <Field label="글꼴">
                    <select value="noto" onChange={() => {}}>
                      <option value="noto">Noto Sans KR · 기본 제공</option>
                    </select>
                  </Field>
                  <div className="two-fields">
                    <Field label="크기 (px)">
                      <NumberInput
                        value={c.text.size}
                        min={8}
                        max={300}
                        onCommit={(v) => text({ size: v })}
                      />
                    </Field>
                    <Field label="색상">
                      <input
                        type="color"
                        value={c.text.color}
                        onChange={(e) => text({ color: e.target.value })}
                      />
                    </Field>
                  </div>
                  <div className="two-fields">
                    <Field label="정렬">
                      <select
                        value={c.text.align}
                        onChange={(e) => text({ align: e.target.value as 'left' })}
                      >
                        <option value="left">왼쪽</option>
                        <option value="center">가운데</option>
                        <option value="right">오른쪽</option>
                      </select>
                    </Field>
                    <Field label="굵기">
                      <select
                        value={c.text.bold ? 'bold' : 'normal'}
                        onChange={(e) => text({ bold: e.target.value === 'bold' })}
                      >
                        <option value="normal">보통</option>
                        <option value="bold">굵게</option>
                      </select>
                    </Field>
                  </div>
                  <Field label="외곽선 (px)">
                    <NumberInput
                      value={c.text.outline}
                      min={0}
                      max={16}
                      onCommit={(v) => text({ outline: v })}
                    />
                  </Field>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={c.text.shadow}
                      onChange={(e) => text({ shadow: e.target.checked })}
                    />{' '}
                    그림자
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={c.text.background !== 'transparent'}
                      onChange={(e) =>
                        text({ background: e.target.checked ? '#26343b' : 'transparent' })
                      }
                    />{' '}
                    배경 박스
                  </label>
                  {c.text.background !== 'transparent' ? (
                    <input
                      aria-label="텍스트 배경 색상"
                      type="color"
                      value={c.text.background}
                      onChange={(e) => text({ background: e.target.value })}
                    />
                  ) : null}
                </div>
              ) : null}
              {c.kind === 'audio' ? (
                <div className="inspector-section">
                  <h3>오디오</h3>
                  <Field label={`볼륨 · ${Math.round(c.volume * 100)}%`}>
                    <CommitRange
                      value={c.volume}
                      min={0}
                      max={2}
                      step={0.01}
                      onCommit={(v) => patch({ volume: v })}
                    />
                  </Field>
                  <div className="two-fields">
                    <Field label="페이드 인 (초)">
                      <NumberInput
                        value={seconds(c.fadeIn)}
                        min={0}
                        max={seconds(c.duration)}
                        onCommit={(v) => patch({ fadeIn: tick(v) })}
                      />
                    </Field>
                    <Field label="페이드 아웃 (초)">
                      <NumberInput
                        value={seconds(c.fadeOut)}
                        min={0}
                        max={seconds(c.duration)}
                        onCommit={(v) => patch({ fadeOut: tick(v) })}
                      />
                    </Field>
                  </div>
                </div>
              ) : (
                <div className="inspector-section">
                  <button
                    className="section-toggle"
                    onClick={() => setSection(section ? '' : 'transform')}
                  >
                    <h3>화면 · 변형</h3>
                    <ChevronDown size={14} />
                  </button>
                  {section ? (
                    <>
                      <div className="two-fields">
                        <Field label="가로 위치 (%)">
                          <NumberInput
                            value={c.x * 100}
                            min={-100}
                            max={200}
                            onCommit={(v) => patch({ x: v / 100 })}
                          />
                        </Field>
                        <Field label="세로 위치 (%)">
                          <NumberInput
                            value={c.y * 100}
                            min={-100}
                            max={200}
                            onCommit={(v) => patch({ y: v / 100 })}
                          />
                        </Field>
                      </div>
                      <div className="two-fields">
                        <Field label="크기 (%)">
                          <NumberInput
                            value={c.scale * 100}
                            min={1}
                            max={500}
                            onCommit={(v) => patch({ scale: v / 100 })}
                          />
                        </Field>
                        <Field label="회전 (°)">
                          <NumberInput
                            value={c.rotation}
                            min={-360}
                            max={360}
                            onCommit={(v) => patch({ rotation: v })}
                          />
                        </Field>
                      </div>
                      <Field label={`불투명도 · ${Math.round(c.opacity * 100)}%`}>
                        <CommitRange
                          value={c.opacity}
                          min={0}
                          max={1}
                          step={0.01}
                          onCommit={(v) => patch({ opacity: v })}
                        />
                      </Field>
                      <Field label="화면 맞춤 · 비율 유지">
                        <select
                          value={c.fit}
                          onChange={(e) => patch({ fit: e.target.value as 'contain' })}
                        >
                          <option value="contain">전체 보기 · 여백 추가</option>
                          <option value="cover">채우기 · 크롭</option>
                        </select>
                      </Field>
                      <button
                        className="secondary full"
                        onClick={() => patch({ x: 0.5, y: 0.5, scale: 1, rotation: 0 })}
                      >
                        위치 · 크기 초기화
                      </button>
                    </>
                  ) : null}
                </div>
              )}
              {c.transition ? (
                <div className="inspector-section">
                  <h3>트랜지션</h3>
                  <p>
                    {c.transition.kind === 'dissolve'
                      ? '크로스 디졸브'
                      : c.transition.kind === 'black'
                        ? '검정으로 페이드'
                        : '흰색으로 페이드'}{' '}
                    · {seconds(c.transition.duration).toFixed(2)}초
                  </p>
                  <button
                    className="secondary full"
                    onClick={() => patch({ transition: undefined })}
                  >
                    트랜지션 제거
                  </button>
                </div>
              ) : null}
              {c.linkId ? (
                <button
                  className="secondary full"
                  onClick={() =>
                    commit({
                      ...p,
                      clips: p.clips.map((x) =>
                        x.linkId === c.linkId ? { ...x, linkId: undefined } : x,
                      ),
                    })
                  }
                >
                  <Unlink size={14} /> 원본 오디오 링크 해제
                </button>
              ) : null}
            </fieldset>
          </>
        ) : (
          <>
            <div className="settings-heading">
              <div className="settings-symbol">
                <Settings2 size={22} />
              </div>
              <h2>이야기에 맞는 화면</h2>
              <p>미리보기와 결과 파일에 함께 적용됩니다.</p>
            </div>
            <div className="inspector-section">
              <h3>화면 비율</h3>
              <div className="ratio-grid">
                {Object.entries(ratios).map(([key, [w, h]]) => (
                  <button
                    key={key}
                    className={ratio === key ? 'selected' : ''}
                    aria-pressed={ratio === key}
                    onClick={() =>
                      commit(setRatio(p, key as keyof typeof ratios, Math.min(p.width, p.height)))
                    }
                  >
                    <span
                      className="ratio-icon"
                      style={{
                        width: w / h >= 1 ? 25 : (25 * w) / h,
                        height: w / h >= 1 ? (25 * h) / w : 25,
                      }}
                    />
                    {key}
                  </button>
                ))}
              </div>
              <div className="two-fields">
                <Field label="가로 (px)">
                  <NumberInput
                    value={p.width}
                    min={16}
                    max={1920}
                    step={2}
                    onCommit={(v) => commit({ ...p, width: Math.round(v / 2) * 2 })}
                  />
                </Field>
                <Field label="세로 (px)">
                  <NumberInput
                    value={p.height}
                    min={16}
                    max={1920}
                    step={2}
                    onCommit={(v) => commit({ ...p, height: Math.round(v / 2) * 2 })}
                  />
                </Field>
              </div>
            </div>
            <div className="inspector-section">
              <Field label="해상도">
                <select
                  value={Math.min(p.width, p.height) === 1080 ? '1080' : '720'}
                  onChange={(e) =>
                    commit(
                      setRatio(p, ratio === '사용자 지정' ? '16:9' : ratio, Number(e.target.value)),
                    )
                  }
                >
                  <option value="720">720p · 빠른 편집</option>
                  <option value="1080">1080p · 선명하게</option>
                </select>
              </Field>
              <Field label="프레임레이트">
                <select
                  value={p.fps}
                  onChange={(e) => commit({ ...p, fps: Number(e.target.value) })}
                >
                  {[24, 25, 30, 50, 60].map((f) => (
                    <option key={f} value={f}>
                      {f} FPS
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="캔버스 배경">
                <div className="color-field">
                  <input
                    type="color"
                    value={p.background}
                    onChange={(e) => commit({ ...p, background: e.target.value })}
                  />
                  <span>{p.background.toUpperCase()}</span>
                </div>
              </Field>
            </div>
            <div className="info-box">
              <Link2 size={16} />
              <p>클립을 선택하면 자르기, 위치, 오디오 등의 설정을 편집할 수 있습니다.</p>
            </div>
            <p className="small-note">
              4K와 사용자 폰트는 후속 지원 예정입니다. 현재 최대 한 변 1920px, 로컬 출력 5분.
            </p>
          </>
        )}
      </div>
    </aside>
  );
}
export function NumberInput({
  value,
  min,
  max,
  step = 0.01,
  onCommit,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState(String(Math.round(value * 100) / 100));
  useEffect(() => setDraft(String(Math.round(value * 100) / 100)), [value]);
  const apply = () => {
    const n = Number(draft);
    if (draft !== '' && Number.isFinite(n)) onCommit(Math.max(min, Math.min(max, n)));
    else setDraft(String(value));
  };
  return (
    <input
      type="number"
      value={draft}
      min={min}
      max={max}
      step={step}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={apply}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
    />
  );
}
export function TextInput({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value),
    composing = useRef(false),
    baseline = useRef(value);
  useEffect(() => {
    if (value !== baseline.current && !composing.current) {
      setDraft(value);
      baseline.current = value;
    }
  }, [value]);
  function apply() {
    if (!composing.current && draft !== baseline.current) {
      onCommit(draft);
      baseline.current = draft;
    }
  }
  return (
    <textarea
      className="text-content"
      aria-label="텍스트 내용"
      value={draft}
      rows={4}
      onChange={(e) => setDraft(e.target.value)}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
      }}
      onBlur={apply}
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !composing.current)
          e.currentTarget.blur();
      }}
    />
  );
}
function CommitRange({
  value,
  min,
  max,
  step,
  onCommit,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      type="range"
      value={draft}
      min={min}
      max={max}
      step={step}
      onChange={(e) => setDraft(Number(e.target.value))}
      onPointerUp={() => onCommit(draft)}
      onKeyUp={() => onCommit(draft)}
      onBlur={() => {
        if (draft !== value) onCommit(draft);
      }}
    />
  );
}
