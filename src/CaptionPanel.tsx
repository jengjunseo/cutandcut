import { useRef, useState, useEffect } from 'react';
import { type Project, type Clip, seconds, tick } from './model';
import { parseCaptions, addCaptions, serializeCaptions } from './captions';
import { download } from './storage';
export default function CaptionPanel({
  p,
  selected,
  commit,
  select,
  seek,
  notify,
}: {
  p: Project;
  selected: string[];
  commit: (p: Project) => void;
  select: (ids: string[]) => void;
  seek: (t: number) => void;
  notify: (s: string) => void;
}) {
  const latest = useRef(p);
  latest.current = p;
  const input = useRef<HTMLInputElement>(null),
    captions = p.clips.filter((c) => c.kind === 'text').sort((a, b) => a.start - b.start),
    style = captions.find((c) => selected.includes(c.id))?.text;
  return (
    <div className="caption-panel">
      <h2>자막 · 텍스트 목록</h2>
      <p className="small-note">
        한글 입력을 마친 뒤 포커스를 옮기면 저장됩니다. 텍스트 클립 전체를 SRT/VTT로 내보냅니다.
      </p>
      <button className="secondary full" onClick={() => input.current?.click()}>
        SRT / VTT 가져오기
      </button>
      <input
        hidden
        ref={input}
        type="file"
        accept=".srt,.vtt"
        aria-label="자막 파일 선택"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && file.size > 2 * 1024 * 1024) {
            notify('자막 파일은 2MB 이하여야 합니다.');
            return;
          }
          const projectId = p.id;
          if (file)
            void file
              .text()
              .then((text) => {
                if (latest.current.id === projectId)
                  commit(addCaptions(latest.current, parseCaptions(text)));
              })
              .catch((e) => notify(e.message));
          e.target.value = '';
        }}
      />
      <div className="two-fields">
        {(['srt', 'vtt'] as const).map((format) => (
          <button
            key={format}
            className="secondary"
            disabled={!captions.length}
            onClick={() =>
              download(
                new Blob([serializeCaptions(captions, format)], {
                  type: 'text/plain;charset=utf-8',
                }),
                `${p.name}.${format}`,
              )
            }
          >
            {format.toUpperCase()} 저장
          </button>
        ))}
      </div>
      <button
        className="secondary full"
        disabled={!style}
        onClick={() => {
          if (style)
            commit({
              ...p,
              clips: p.clips.map((c) =>
                c.kind === 'text' && !p.tracks.find((t) => t.id === c.trackId)?.locked
                  ? { ...c, text: { ...style, text: c.text!.text } }
                  : c,
              ),
            });
        }}
      >
        선택 자막 스타일을 전체 적용
      </button>
      {captions.map((c) => (
        <CaptionRow
          key={c.id}
          c={c}
          locked={!!p.tracks.find((t) => t.id === c.trackId)?.locked}
          selected={selected.includes(c.id)}
          select={() => {
            select([c.id]);
            seek(c.start);
          }}
          save={(value) =>
            commit({ ...p, clips: p.clips.map((x) => (x.id === c.id ? { ...x, ...value } : x)) })
          }
          notify={notify}
        />
      ))}
      {!captions.length ? (
        <p className="small-note">텍스트 도구에서 자막을 추가하거나 자막 파일을 가져오세요.</p>
      ) : null}
    </div>
  );
}
function CaptionRow({
  c,
  locked,
  selected,
  select,
  save,
  notify,
}: {
  c: Clip;
  locked: boolean;
  selected: boolean;
  select: () => void;
  save: (v: Partial<Clip>) => void;
  notify: (s: string) => void;
}) {
  const composing = useRef(false);
  const [text, setText] = useState(c.text!.text),
    [start, setStart] = useState(seconds(c.start).toFixed(3)),
    [end, setEnd] = useState(seconds(c.start + c.duration).toFixed(3));
  useEffect(() => {
    setText(c.text!.text);
    setStart(seconds(c.start).toFixed(3));
    setEnd(seconds(c.start + c.duration).toFixed(3));
  }, [c.text!.text, c.start, c.duration]);
  function times() {
    const a = tick(Number(start)),
      b = tick(Number(end));
    if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a < 0 || b <= a || b > tick(3600)) {
      notify('자막 시작·끝 구간을 확인하세요.');
      setStart(seconds(c.start).toFixed(3));
      setEnd(seconds(c.start + c.duration).toFixed(3));
      return;
    }
    if (a !== c.start || b !== c.start + c.duration) save({ start: a, duration: b - a });
  }
  return (
    <fieldset disabled={locked} className={`caption-row ${selected ? 'selected' : ''}`}>
      <button className="text-tool" onClick={select} aria-pressed={selected}>
        {c.name} · 해당 장면 보기
      </button>
      <textarea
        aria-label={`${c.name} 목록 내용`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
        onBlur={() => {
          if (!composing.current && text !== c.text!.text) save({ text: { ...c.text!, text } });
        }}
      />
      <div className="two-fields">
        <label>
          시작 (초)
          <input
            aria-label={`${c.name} 목록 시작`}
            type="number"
            min={0}
            step={0.001}
            value={start}
            onChange={(e) => setStart(e.target.value)}
            onBlur={times}
          />
        </label>
        <label>
          끝 (초)
          <input
            aria-label={`${c.name} 목록 끝`}
            type="number"
            min={0}
            step={0.001}
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            onBlur={times}
          />
        </label>
      </div>
    </fieldset>
  );
}
