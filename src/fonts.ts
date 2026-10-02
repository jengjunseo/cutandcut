import regular from '@fontsource/noto-sans-kr/400.css?raw';
import bold from '@fontsource/noto-sans-kr/700.css?raw';
const urls = import.meta.glob(
  '../node_modules/@fontsource/noto-sans-kr/files/*-{400,700}-normal.woff2',
  { query: '?url', import: 'default', eager: true },
) as Record<string, string>;
const loaded = new Map<string, Promise<FontFace>>();
type FontScope = typeof globalThis & { fonts: FontFaceSet };
export async function ensureFonts(text: string) {
  const points = [...(text + 'CyanCut 0123456789')].map((c) => c.codePointAt(0)!);
  const work: Promise<FontFace>[] = [];
  for (const css of [regular, bold])
    for (const match of css.matchAll(
      /font-weight:\s*(\d+);[\s\S]*?url\(\.\/files\/([^)]*\.woff2)\)[\s\S]*?unicode-range:\s*([^;]+);/g,
    )) {
      const [, weight, file, ranges] = match;
      const intersects = ranges.split(',').some((r) => {
        const [a, b] = r
          .trim()
          .slice(2)
          .split('-')
          .map((n) => parseInt(n, 16));
        return points.some((p) => p >= a && p <= (b ?? a));
      });
      if (!intersects) continue;
      const url = urls['../node_modules/@fontsource/noto-sans-kr/files/' + file];
      if (!url)
        throw new Error('기본 한글 폰트 파일을 찾을 수 없습니다. 새로고침 후 재시도하세요.');
      if (!loaded.has(file)) {
        const face = new FontFace('CyanCut Noto', `url(${url})`, { weight, unicodeRange: ranges });
        loaded.set(
          file,
          face
            .load()
            .then((f) => {
              const scope = globalThis as FontScope;
              const set = typeof document === 'undefined' ? scope.fonts : document.fonts;
              set.add(f);
              return f;
            })
            .catch(() => {
              loaded.delete(file);
              throw new Error(
                '한글 폰트를 불러오지 못했습니다. 연결을 확인한 뒤 재시도하세요. 다른 글꼴로 결과가 바뀌지 않도록 렌더링을 중단했습니다.',
              );
            }),
        );
      }
      work.push(loaded.get(file)!);
    }
  await Promise.all(work);
}
