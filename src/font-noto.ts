import regular from '@fontsource/noto-sans-kr/400.css?raw';
import bold from '@fontsource/noto-sans-kr/700.css?raw';
export const styles = [regular, bold];
export const urls = import.meta.glob(
  '../node_modules/@fontsource/noto-sans-kr/files/*-{400,700}-normal.woff2',
  { query: '?url', import: 'default', eager: true },
) as Record<string, string>;
