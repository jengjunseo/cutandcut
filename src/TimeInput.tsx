import { useEffect, useState, useRef } from 'react';
import { timecode } from './model';
import { parseTimecode } from './editing';
export default function TimeInput({
  time,
  fps,
  seek,
  notify,
}: {
  time: number;
  fps: number;
  seek: (t: number) => void;
  notify: (s: string) => void;
}) {
  const [value, setValue] = useState(timecode(time, fps)),
    [focused, setFocused] = useState(false);
  const cancelled = useRef(false);
  useEffect(() => {
    if (!focused) setValue(timecode(time, fps));
  }, [time, fps, focused]);
  function commit() {
    try {
      seek(parseTimecode(value, fps));
    } catch (e) {
      notify((e as Error).message);
      setValue(timecode(time, fps));
    }
  }
  return (
    <input
      className="timecode current-time time-input"
      aria-label="재생헤드 타임코드"
      title="HH:MM:SS:FF 또는 초로 입력 · Enter로 이동"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onFocus={() => {
        cancelled.current = false;
        setFocused(true);
      }}
      onBlur={() => {
        if (!cancelled.current) commit();
        setFocused(false);
      }}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === 'Enter') {
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          cancelled.current = true;
          setValue(timecode(time, fps));
          e.currentTarget.blur();
        }
      }}
    />
  );
}
