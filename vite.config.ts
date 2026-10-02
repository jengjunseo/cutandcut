import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  optimizeDeps: { include: ['mediabunny', '@mediabunny/mp3-encoder'] },
  server: {
    watch: { ignored: ['**/artifacts/**', '**/test-results/**', '**/playwright-report/**'] },
  },
  worker: { format: 'es' },
  build: { target: 'es2022' },
});
