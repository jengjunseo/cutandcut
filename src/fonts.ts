export const fontCatalog = [
  { id: 'noto', label: 'Noto Sans KR', family: 'CyanCut Noto' },
  { id: 'gothic', label: '나눔고딕', family: 'CyanCut Gothic' },
  { id: 'myeongjo', label: '나눔명조', family: 'CyanCut Myeongjo' },
] as const;
const sources = {
  noto: () => import('./font-noto'),
  gothic: () => import('./font-gothic'),
  myeongjo: () => import('./font-myeongjo'),
};
const loaded = new Map<string, Promise<FontFace>>();
const catalogs = new Map<string, Promise<Awaited<ReturnType<typeof sources.noto>>>>();
export async function ensureFonts(text: string, fontId = 'noto', weight?: number) {
  if (!text) return;
  const font = fontCatalog.find((f) => f.id === fontId);
  if (!font)
    throw new Error('프로젝트의 글꼴이 없습니다. 기본 한글 글꼴을 직접 선택하고 다시 출력하세요.');
  if (!catalogs.has(font.id))
    catalogs.set(
      font.id,
      sources[font.id]().catch((error) => {
        catalogs.delete(font.id);
        throw new Error(
          `${font.label} 글꼴 모듈을 불러오지 못했습니다. 연결을 확인하고 재시도하거나 기본 글꼴을 선택하세요.`,
          { cause: error },
        );
      }),
    );
  const { styles, urls } = await catalogs.get(font.id)!;
  const points = new Set(Array.from(text).map((c) => c.codePointAt(0)!)),
    work: Promise<FontFace>[] = [];
  for (const css of styles)
    for (const match of css.matchAll(
      /font-weight:\s*(\d+);[\s\S]*?url\(\.\/files\/([^)]*\.woff2)\)[\s\S]*?unicode-range:\s*([^;]+);/g,
    )) {
      const [, w, file, ranges] = match;
      if (weight && Number(w) !== weight) continue;
      if (
        !ranges.split(',').some((r) => {
          const [a, b] = r
            .trim()
            .slice(2)
            .split('-')
            .map((n) => parseInt(n, 16));
          return [...points].some((p) => p >= a && p <= (b ?? a));
        })
      )
        continue;
      const key = `${font.id}/${file}`;
      if (!loaded.has(key)) {
        const url = Object.entries(urls).find(([path]) => path.endsWith('/' + file))?.[1];
        if (!url) throw new Error('한글 글꼴 파일을 찾을 수 없습니다. 새로고침 후 재시도하세요.');
        const face = new FontFace(font.family, `url(${url})`, { weight: w, unicodeRange: ranges });
        loaded.set(
          key,
          face
            .load()
            .then((face) => {
              const set =
                typeof document === 'undefined'
                  ? (globalThis as typeof globalThis & { fonts: FontFaceSet }).fonts
                  : document.fonts;
              set.add(face);
              return face;
            })
            .catch(() => {
              loaded.delete(key);
              throw new Error(
                `${font.label} 글꼴 로딩에 실패했습니다. 다른 글꼴로 조용히 대체하지 않습니다. 연결을 확인하거나 기본 글꼴을 선택한 뒤 다시 출력하세요.`,
              );
            }),
        );
      }
      work.push(loaded.get(key)!);
    }
  await Promise.all(work);
}
