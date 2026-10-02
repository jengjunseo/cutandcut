# CyanCut 개발 지침

README.md와 docs/VERIFICATION.md를 먼저 읽는다. 제품은 로컬 우선 한국어 영상 편집기이며 원본을 자동 업로드하지 않는다.

- TypeScript strict를 유지한다. UI, 순수 편집 모델, 미디어 엔진, 공통 합성기, 저장을 분리한다.
- 시간은 정수 마이크로초. 프레임 번호/FPS에서 직접 시각을 계산하고 소수점 프레임 시간을 누적하지 않는다.
- 링크된 영상/오디오는 함께 편집한다. 잠긴 연결 트랙이 있으면 부분 수정하지 않는다.
- 리플은 전체 트랙의 합집합 시간 구간 제거이며 잠금·겹침에 따른 거절을 사용자에게 설명한다.
- 미리보기와 출력은 src/model.ts의 layers와 src/render.ts를 공유한다. 실제 파일 출력과 일치하지 않는 효과 버튼을 추가하지 않는다.
- Worker/VideoFrame/AudioSample/iterator/ImageBitmap/Blob URL/오디오 노드를 해제한다. 메모리 제한 없이 전체 파일을 PCM/프레임 배열로 읽지 않는다.
- 한 드래그 또는 텍스트 입력 완료를 한 undo commit으로 처리한다. IME와 입력 필드에서는 편집 단축키를 차단한다.
- 컨테이너와 코덱, 디코딩과 인코딩, 구현과 실검증을 구분한다. 검증되지 않은 형식은 지원 완료로 표시하지 않는다.
- 저장 성공은 IndexedDB transaction complete 이후에만 표시한다. 프로젝트 JSON과 미디어 저장은 분리한다.
- 네트워크 요청에 원본을 포함하지 않는다. 출력은 편집 스냅샷, 타임스탬프, backpressure를 사용한다.
- 변경에 맞는 npm test, npm run build와 실제 파일 통합 검증을 실행한다. 전체 테스트: npm run test:e2e (localhost:5174 서버 필요).
- artifacts, 시크릿, .env, .vercel, node_modules, .npm-cache는 커밋하지 않는다.

후속 기능은 README의 지원 범위와 제한을 함께 갱신한다. 브라우저 지원을 확장할 때 실제 입력·출력 테스트 파일, OS/브라우저 버전, 결과를 기록한다.
