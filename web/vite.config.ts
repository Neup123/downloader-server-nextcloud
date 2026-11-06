import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  base: mode === 'nextcloud' ? './' : '/',
  build: { outDir: 'dist', emptyOutDir: true, rollupOptions: { input: ['index.html', 'api-reference.html', 'user.html'] } },
  server: { host: '0.0.0.0', port: 5173 },
}));
