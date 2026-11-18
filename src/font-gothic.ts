import regular from '@fontsource/nanum-gothic/400.css?raw';
import bold from '@fontsource/nanum-gothic/700.css?raw';
export const styles = [regular, bold];
export const urls = import.meta.glob(
  '../node_modules/@fontsource/nanum-gothic/files/*-{400,700}-normal.woff2',
  { query: '?url', import: 'default', eager: true },
) as Record<string, string>;
