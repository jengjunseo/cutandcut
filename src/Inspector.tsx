import { Settings2, Link2, Unlink, SlidersHorizontal, Type, ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  seconds,
  tick,
  trim,
  move,
  reorder,
  linked,
  editable,
  id,
  PROJECT_MAX_TIME,
  type Clip,
  type Project,
} from './model';
import { Field } from './ui';
import { changeSpeed } from './editing';
import { ratios, ratioOf, setRatio } from './geometry';
type Props = {
  project: Project;
  selected: string[];
  commit: (p: Project) => void;
  notify: (s: string) => void;
  onSelect: (ids: string[]) => void;
};
export default function Inspector({ project: p, selected, commit, notify, onSelect }: Props) {
  const c = p.clips.find((c) => selected.includes(c.id));
  const locked = c && !editable(p, linked(p, [c.id]));
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
    <aside className="inspector-panel" tabIndex={-1}>
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
              {locked ? <p className="warning">이 클립 또는 연결된 트랙이 잠겨 있습니다.</p> : null}
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
                      max={seconds(PROJECT_MAX_TIME)}
                      onCommit={(v) => commit(move(p, [c.id], tick(v) - c.start))}
                    />
                  </Field>
                  <Field label="길이 (초)">
                    <NumberInput
                      value={seconds(c.duration)}
                      min={1 / p.fps}
                      max={seconds(PROJECT_MAX_TIME)}
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
                      onCommit={(v) =>
                        commit(
                          trim(
                            p,
                            [c.id],
                            'start',
                            Math.round((tick(v) - c.sourceIn) / (c.speed ?? 1)),
                          ),
                        )
                      }
                    />
                  </Field>
                ) : null}
              </div>
              {c.kind === 'video' || c.kind === 'audio' ? (
                <div className="inspector-section">
                  <h3>속도</h3>
                  <Field label="클립 속도">
                    <select
                      aria-label="클립 속도"
                      value={c.speed ?? 1}
                      onChange={(e) =>
                        commit(
                          changeSpeed(p, [c.id], Number(e.target.value), c.preservePitch !== false),
                        )
                      }
                    >
                      {[0.5, 0.75, 1, 1.25, 1.5, 2].map((v) => (
                        <option key={v} value={v}>
                          {v}×
                        </option>
                      ))}
                    </select>
                  </Field>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={c.preservePitch !== false}
                      onChange={(e) =>
                        commit(changeSpeed(p, [c.id], c.speed ?? 1, e.target.checked))
                      }
                    />
                    음정 유지
                  </label>
                  <p className="small-note">
                    원본 구간을 유지하며 링크된 영상·오디오 길이를 함께 바꿉니다. 뒤 클립의 위치는
                    유지되어 빈틈이나 겹침이 생길 수 있습니다.
                  </p>
                </div>
              ) : null}
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
                        onChange={(e) =>
                          text({ align: e.target.value as NonNullable<Clip['text']>['align'] })
                        }
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
                          onChange={(e) => patch({ fit: e.target.value as Clip['fit'] })}
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
                      <div className="two-fields">
                        <button className="secondary" onClick={() => patch({ x: 0.5 })}>
                          가로 중앙 정렬
                        </button>
                        <button className="secondary" onClick={() => patch({ y: 0.5 })}>
                          세로 중앙 정렬
                        </button>
                      </div>
                      {c.kind !== 'text' ? (
                        <>
                          <div className="two-fields">
                            <button
                              className="secondary"
                              aria-pressed={c.flipX ?? false}
                              onClick={() => patch({ flipX: !c.flipX })}
                            >
                              좌우 반전
                            </button>
                            <button
                              className="secondary"
                              aria-pressed={c.flipY ?? false}
                              onClick={() => patch({ flipY: !c.flipY })}
                            >
                              상하 반전
                            </button>
                          </div>
                          <details className="crop-settings">
                            <summary>원본 크롭 · 미리보기 핸들로 조절 가능</summary>
                            {(['left', 'right', 'top', 'bottom'] as const).map((edge, i) => (
                              <Field
                                key={edge}
                                label={`크롭 ${['왼쪽', '오른쪽', '위', '아래'][i]} (%)`}
                              >
                                <NumberInput
                                  value={(c.crop?.[edge] ?? 0) * 100}
                                  min={0}
                                  max={
                                    95 -
                                    (c.crop?.[
                                      {
                                        left: 'right',
                                        right: 'left',
                                        top: 'bottom',
                                        bottom: 'top',
                                      }[edge] as typeof edge
                                    ] ?? 0) *
                                      100
                                  }
                                  onCommit={(v) =>
                                    patch({
                                      crop: {
                                        left: 0,
                                        right: 0,
                                        top: 0,
                                        bottom: 0,
                                        ...c.crop,
                                        [edge]: v / 100,
                                      },
                                    })
                                  }
                                />
                              </Field>
                            ))}
                            <button
                              className="secondary"
                              onClick={() => patch({ crop: undefined })}
                            >
                              원본 크롭 초기화
                            </button>
                          </details>
                        </>
                      ) : null}
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
              {!c.linkId && selected.length === 2 ? (
                <button
                  className="secondary full"
                  onClick={() => {
                    const pair = p.clips.filter((x) => selected.includes(x.id));
                    if (
                      !pair.some((x) => x.kind === 'video') ||
                      !pair.some((x) => x.kind === 'audio') ||
                      pair.some(
                        (x) =>
                          x.linkId ||
                          x.assetId !== pair[0].assetId ||
                          x.start !== pair[0].start ||
                          x.duration !== pair[0].duration ||
                          x.sourceIn !== pair[0].sourceIn ||
                          (x.speed ?? 1) !== (pair[0].speed ?? 1),
                      )
                    ) {
                      notify('같은 원본·시작·길이·속도의 영상과 오디오를 선택하세요.');
                      return;
                    }
                    if (!editable(p, pair)) {
                      notify('연결할 두 트랙의 잠금을 해제하세요.');
                      return;
                    }
                    const key = id();
                    commit({
                      ...p,
                      clips: p.clips.map((x) =>
                        selected.includes(x.id) ? { ...x, linkId: key } : x,
                      ),
                    });
                  }}
                >
                  <Link2 size={14} />
                  영상 · 원본 오디오 다시 연결
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
    setDraft(String(Math.round(value * 100) / 100));
    if (draft !== '' && Number.isFinite(n) && draft !== String(Math.round(value * 100) / 100))
      onCommit(Math.max(min, Math.min(max, n)));
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
