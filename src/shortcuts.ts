/** Use physical letter keys so Korean layouts keep the same editing shortcuts. */
export function shortcutKey(event: Pick<KeyboardEvent, 'code' | 'key'>) {
  return /^Key[A-Z]$/.test(event.code)
    ? event.code.slice(3).toLowerCase()
    : event.key.toLowerCase();
}

export const shortcuts = [
  ['Space · J / K / L', '재생·일시정지 / 역방향 탐색·정지·정방향 재생'],
  ['← / → · Shift + ← / →', '1프레임 / 10프레임 이동'],
  ['Page Up / Down', '1초 이동 · Shift 2초 · Ctrl/Cmd 5초 · 둘 다 10초'],
  ['Home / End · Alt + ← / →', '프로젝트 시작·끝 / 이전·다음 클립 경계'],
  ['S · Shift + S', '선택 클립 분할 / 재생헤드의 전체 트랙 분할'],
  ['X · Shift + Delete', '전체 트랙 리플 삭제 (잠금·겹침 시 거절)'],
  ['Z · Delete / Backspace', '일반 삭제 · 빈 공간 유지'],
  ['C · Ctrl/Cmd + C', '연결·그룹 클립 복사'],
  ['Ctrl/Cmd + X', '잘라내기 · 전체 트랙 리플 삭제 후 복사'],
  ['V · Ctrl/Cmd + V', '복사한 클립을 삽입 · 전체 트랙의 뒤쪽을 이동 *'],
  ['A / B / R', '복사한 클립을 끝에 추가 / 덮어쓰기 / 선택 클립 교체 *'],
  ['Ctrl/Cmd + D', '선택 해제'],
  ['Ctrl/Cmd + Shift + D', '선택 그룹 뒤에 복제 (CyanCut 추가)'],
  ['Ctrl/Cmd + Z · Ctrl+Y / Ctrl/Cmd+Shift+Z', '실행 취소 / 다시 실행'],
  ['Ctrl/Cmd + A · Ctrl/Cmd + Alt + A', '전체 / 활성 트랙 선택 *'],
  ['I / O', '타임라인: 앞·뒤 트림 / 미리보기: 구간 시작·끝'],
  ['[ / ]', '선택 클립 앞·뒤 트림 (CyanCut 추가)'],
  ['↑ / ↓', '활성 트랙 위·아래 *'],
  ['Ctrl/Cmd + ← / → · , / .', '선택 클립 1프레임 이동 *'],
  ['Ctrl/Cmd + ↑ / ↓', '선택 클립 위·아래 호환 트랙 이동 *'],
  ['Ctrl/Cmd + Space', '활성 트랙의 재생헤드 아래 클립 선택 *'],
  ['Ctrl/Cmd + I / U', '영상 / 오디오 트랙 추가 *'],
  ['Ctrl/Cmd + Alt + U', '활성 트랙 삭제 *'],
  ['Alt + Shift + ↑ / ↓', '활성 트랙 순서 변경 *'],
  ['Ctrl + M / H / L', '활성 오디오 음소거 / 영상 숨김 / 잠금 *'],
  ['Ctrl/Cmd + P', '스냅 토글 * · 드래그 중 Alt로 임시 해제'],
  ['Ctrl/Cmd + G · Ctrl/Cmd + Shift + G', '그룹화·해제 / 그룹 해제 *'],
  ['+ / − · 0', '타임라인 확대·축소 / 전체 보기 *'],
  ['Ctrl/Cmd + S · Ctrl/Cmd + Shift + S', '프로젝트 파일 저장 / 사본 저장'],
  ['Ctrl/Cmd + O · Ctrl/Cmd + Shift + O', '미디어 / 프로젝트 JSON 열기'],
  ['Ctrl/Cmd + E · Ctrl/Cmd + Shift + E', '출력 / 현재 합성 장면을 정지 클립으로 만들기'],
  ['Ctrl/Cmd + 2 / 3 / 4 / 5 / 9', '속성 / 최근 프로젝트 / 보관함 / 타임라인 / 출력'],
  ['Escape · ? / /', '조작 취소·선택 해제 / 단축키 도움말'],
] as const;
