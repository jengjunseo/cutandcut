import { useState } from 'react';
import type { TextStyle } from './model';
import { Field } from './ui';
import { textPresets, styleSnapshot, validTextStyle, type Style } from './text-styles';
type Preset = { id: string; name: string; style: Style };
let clipboard: Style | undefined;
export default function TextStyleTools({
  style,
  canvasWidth,
  patch,
  place,
  notify,
}: {
  style: TextStyle;
  canvasWidth: number;
  patch: (v: Partial<TextStyle>) => void;
  place: (anchor: NonNullable<TextStyle['anchor']>, margin: number) => void;
  notify: (s: string) => void;
}) {
  const [users, setUsers] = useState<Preset[]>(() => {
    try {
      const list = JSON.parse(localStorage.getItem('cyancut-text-presets-v1') || '[]');
      return Array.isArray(list)
        ? list.filter(
            (v) =>
              v &&
              typeof v.id === 'string' &&
              typeof v.name === 'string' &&
              v.style &&
              validTextStyle({ ...v.style, text: '' }),
          )
        : [];
    } catch {
      return [];
    }
  });
  const [selected, setSelected] = useState(''),
    [name, setName] = useState('내 스타일'),
    [margin, setMargin] = useState(96),
    [copied, setCopied] = useState(!!clipboard);
  function persist(next: Preset[]) {
    try {
      localStorage.setItem('cyancut-text-presets-v1', JSON.stringify(next));
      setUsers(next);
    } catch {
      notify('스타일 프리셋을 저장하지 못했습니다. 편집 내용은 유지됩니다.');
    }
  }
  const number = (
    label: string,
    value: number,
    min: number,
    max: number,
    save: (v: number) => void,
  ) => (
    <Field label={label}>
      <input
        key={value}
        type="number"
        defaultValue={value}
        step={0.1}
        min={min}
        max={max}
        onBlur={(e) => {
          const v = Number(e.currentTarget.value);
          if (Number.isFinite(v) && v >= min && v <= max && v !== value) save(v);
          else e.currentTarget.value = String(value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.currentTarget.blur();
        }}
      />
    </Field>
  );
  const color = (label: string, value: string, save: (v: string) => void) => (
    <Field label={label}>
      <input
        type="color"
        value={/^#[\da-f]{6}$/i.test(value) ? value : '#000000'}
        onChange={(e) => save(e.target.value)}
      />
    </Field>
  );
  const shadow = style.shadowStyle ?? { color: '#000000', alpha: 0.65, x: 0, y: 3, blur: 7 },
    bg = style.backgroundStyle ?? {
      alpha: 1,
      paddingX: style.size * 0.3,
      paddingY: 0,
      radius: 0,
      policy: 'line' as const,
    };
  return (
    <>
      <Field label="텍스트 스타일 프리셋">
        <select
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value);
            const preset = [...textPresets, ...users].find((p) => p.id === e.target.value);
            if (preset) {
              const snapshot = structuredClone(preset.style);
              if (textPresets.some((p) => p.id === preset.id) && snapshot.boxWidth)
                snapshot.boxWidth = Math.min(snapshot.boxWidth, Math.round(canvasWidth * 0.8));
              patch(snapshot);
              setName(preset.name);
            }
          }}
        >
          <option value="">스타일 선택</option>
          {[...textPresets, ...users].map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      <details className="text-style-details">
        <summary>세부 스타일 · 프리셋 관리</summary>
        <div className="two-fields">
          {number('줄간격', style.lineHeight ?? 1.45, 0.5, 5, (v) => patch({ lineHeight: v }))}
          {number('자간 (px)', style.letterSpacing ?? 0, -100, 200, (v) =>
            patch({ letterSpacing: v }),
          )}
        </div>
        {number('자동 줄바꿈 폭 (px) · 0은 수동 줄바꿈', style.boxWidth ?? 0, 0, 100000, (v) =>
          patch({ boxWidth: v }),
        )}
        {number('글자 불투명도', style.fillAlpha ?? 1, 0, 1, (v) => patch({ fillAlpha: v }))}
        <div className="two-fields">
          {color('외곽선 색상', style.strokeColor ?? '#111820', (v) => patch({ strokeColor: v }))}
          {number('외곽선 불투명도', style.strokeAlpha ?? 1, 0, 1, (v) =>
            patch({ strokeAlpha: v }),
          )}
        </div>
        <h4>그림자</h4>
        {color('그림자 색상', shadow.color, (v) => patch({ shadowStyle: { ...shadow, color: v } }))}
        <div className="two-fields">
          {number('그림자 불투명도', shadow.alpha, 0, 1, (v) =>
            patch({ shadowStyle: { ...shadow, alpha: v } }),
          )}
          {number('그림자 blur (px)', shadow.blur, 0, 1000, (v) =>
            patch({ shadowStyle: { ...shadow, blur: v } }),
          )}
        </div>
        <div className="two-fields">
          {number('그림자 X (px)', shadow.x, -10000, 10000, (v) =>
            patch({ shadowStyle: { ...shadow, x: v } }),
          )}
          {number('그림자 Y (px)', shadow.y, -10000, 10000, (v) =>
            patch({ shadowStyle: { ...shadow, y: v } }),
          )}
        </div>
        <h4>배경 박스</h4>
        {color(
          '배경 색상',
          style.background === 'transparent' ? '#000000' : style.background,
          (v) => patch({ background: v }),
        )}
        {number('배경 불투명도', bg.alpha, 0, 1, (v) =>
          patch({ backgroundStyle: { ...bg, alpha: v } }),
        )}
        <div className="two-fields">
          {number('배경 좌우 여백 (px)', bg.paddingX, 0, 10000, (v) =>
            patch({ backgroundStyle: { ...bg, paddingX: v } }),
          )}
          {number('배경 상하 여백 (px)', bg.paddingY, 0, 10000, (v) =>
            patch({ backgroundStyle: { ...bg, paddingY: v } }),
          )}
        </div>
        {number('배경 모서리 (px)', bg.radius, 0, 10000, (v) =>
          patch({ backgroundStyle: { ...bg, radius: v } }),
        )}
        <Field label="여러 줄 배경">
          <select
            value={bg.policy}
            onChange={(e) =>
              patch({ backgroundStyle: { ...bg, policy: e.target.value as 'line' | 'block' } })
            }
          >
            <option value="line">줄마다</option>
            <option value="block">하나의 박스</option>
          </select>
        </Field>
        {number('앵커 여백 (프로젝트 px)', margin, 0, 1000, setMargin)}
        <div className="anchor-grid" aria-label="텍스트 3×3 기준점">
          {(['top', 'middle', 'bottom'] as const).flatMap((y) =>
            (['left', 'center', 'right'] as const).map((x) => {
              const anchor = `${y}-${x}` as NonNullable<TextStyle['anchor']>;
              return (
                <button
                  key={anchor}
                  aria-label={`텍스트 기준점 ${anchor}`}
                  aria-pressed={style.anchor === anchor}
                  onClick={() => place(anchor, margin)}
                >
                  {y === 'top' ? '상' : y === 'bottom' ? '하' : '중'}·
                  {x === 'left' ? '좌' : x === 'right' ? '우' : '중'}
                </button>
              );
            }),
          )}
        </div>
        <div className="two-fields">
          <button
            className="secondary"
            onClick={() => {
              clipboard = styleSnapshot(style);
              setCopied(true);
              notify('텍스트 스타일을 복사했습니다.');
            }}
          >
            스타일 복사
          </button>
          <button
            className="secondary"
            disabled={!copied && !clipboard}
            onClick={() => {
              if (clipboard) patch(structuredClone(clipboard));
            }}
          >
            스타일 붙여넣기
          </button>
        </div>
        <Field label="프리셋 이름">
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <button
          className="secondary full"
          onClick={() => {
            const preset = {
              id: crypto.randomUUID(),
              name: name.trim() || '내 스타일',
              style: styleSnapshot(style),
            };
            persist([...users, preset]);
            setSelected(preset.id);
          }}
        >
          현재 스타일 저장
        </button>
        {users.some((p) => p.id === selected) ? (
          <div className="two-fields">
            <button
              onClick={() =>
                persist(
                  users.map((p) => (p.id === selected ? { ...p, name: name.trim() || p.name } : p)),
                )
              }
            >
              프리셋 이름 변경
            </button>
            <button
              onClick={() => {
                persist(users.filter((p) => p.id !== selected));
                setSelected('');
              }}
            >
              프리셋 삭제
            </button>
          </div>
        ) : null}
      </details>
    </>
  );
}
