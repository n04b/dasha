import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// During `vite dev` the API runs separately (default :1337); proxy calls to it.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:1337',
      '/icons': 'http://localhost:1337',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
