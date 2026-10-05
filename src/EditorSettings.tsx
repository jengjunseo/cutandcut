import { useEffect, useRef } from 'react';
import { Monitor, Smartphone, X } from 'lucide-react';
import { IconButton, trapDialogFocus } from './ui';
import type { UIMode } from './useEditorLayout';

export default function EditorSettings({
  mode,
  changeMode,
  close,
}: {
  mode: UIMode;
  changeMode: (mode: UIMode) => void;
  close: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <div className="modal-backdrop">
      <div
        className="help-dialog editor-settings"
        role="dialog"
        aria-modal="true"
        aria-label="앱 설정"
        tabIndex={-1}
        ref={root}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape' && !e.nativeEvent.isComposing) close();
          trapDialogFocus(e);
        }}
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">편집 화면</span>
            <h2>앱 설정</h2>
          </div>
          <IconButton label="앱 설정 닫기" onClick={close}>
            <X size={20} />
          </IconButton>
        </div>
        <fieldset className="ui-mode-choices">
          <legend>UI 모드</legend>
          {(
            [
              [
                'standard',
                Monitor,
                '기본 모드',
                '기존 미디어·미리보기·속성 패널과 도구 배치를 유지합니다.',
              ],
              [
                'mobile',
                Smartphone,
                '모바일 모드',
                '영상과 타임라인은 계속 보고, 도구는 필요할 때 엽니다. 태블릿에서는 패널을 옆에 배치합니다.',
              ],
            ] as const
          ).map(([value, Icon, label, description]) => (
            <label className={`ui-mode-choice ${mode === value ? 'selected' : ''}`} key={value}>
              <input
                type="radio"
                name="ui-mode"
                value={value}
                checked={mode === value}
                onChange={() => changeMode(value)}
              />
              <Icon size={23} />
              <span>
                <strong>{label}</strong>
                <small>{description}</small>
              </span>
            </label>
          ))}
        </fieldset>
        <p className="small-note">
          이 기기에서 선택을 기억합니다. 편집 내용과 출력 화면비는 바뀌지 않습니다.
        </p>
        <button className="primary full" onClick={close}>
          편집 계속하기
        </button>
      </div>
    </div>
  );
}
