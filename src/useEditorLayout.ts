import { useEffect, useState } from 'react';

export type UIMode = 'standard' | 'mobile';
const preferenceKey = 'cyancut-ui-mode';
const tabletQuery = '(min-width: 900px) and (min-height: 600px)';

/** UI preferences stay outside the project and its undo history. */
export function useEditorLayout(notify: (message: string) => void) {
  const [mode, setMode] = useState<UIMode>(() => {
    try {
      return localStorage.getItem(preferenceKey) === 'mobile' ? 'mobile' : 'standard';
    } catch {
      return 'standard';
    }
  });
  const [viewport, setViewport] = useState(() => ({
    height: window.visualViewport?.height ?? window.innerHeight,
    width: window.innerWidth,
    tablet: window.matchMedia(tabletQuery).matches,
  }));
  useEffect(() => {
    if (mode !== 'mobile') return;
    const query = window.matchMedia(tabletQuery);
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        setViewport({
          height: window.visualViewport?.height ?? window.innerHeight,
          width: window.innerWidth,
          tablet: query.matches,
        }),
      );
    };
    measure();
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    query.addEventListener('change', measure);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
      query.removeEventListener('change', measure);
    };
  }, [mode]);
  function changeMode(next: UIMode) {
    setMode(next);
    try {
      localStorage.setItem(preferenceKey, next);
    } catch {
      notify('UI 모드는 변경됐지만 기기에 저장하지 못했습니다. 다음에 다시 선택해주세요.');
    }
  }
  return { mode, changeMode, mobile: mode === 'mobile', ...viewport };
}
