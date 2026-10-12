import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Emits /sw.js from src/sw.js with the files to precache baked in. The list —
// and a hash of their contents, which names the cache — is only known once the
// bundle is written, so every build whose output differs ships a service worker
// that differs byte for byte, which is what makes browsers pick it up.
function serviceWorker() {
  let publicDir = '';
  return {
    name: 'dasha-service-worker',
    apply: 'build',
    enforce: 'post', // after index.html has been added to the bundle
    configResolved(config) {
      publicDir = config.publicDir;
    },
    generateBundle(_options, bundle) {
      const template = readFileSync(new URL('./src/sw.js', import.meta.url), 'utf8');
      const hash = createHash('sha256').update(template);
      const files = [];
      const add = (fileName, contents) => {
        hash.update(fileName).update(contents);
        // The page itself is cached as `/`: it is the shell for every route.
        files.push(fileName === 'index.html' ? '/' : `/${fileName}`);
      };
      for (const [fileName, out] of Object.entries(bundle)) {
        add(fileName, out.type === 'chunk' ? out.code : out.source);
      }
      if (publicDir && existsSync(publicDir)) {
        for (const entry of readdirSync(publicDir, { withFileTypes: true })) {
          if (entry.isFile()) add(entry.name, readFileSync(path.join(publicDir, entry.name)));
        }
      }
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source:
          `const VERSION = ${JSON.stringify(hash.digest('hex').slice(0, 12))};\n` +
          `const PRECACHE = ${JSON.stringify(files.sort())};\n\n${template}`,
      });
    },
  };
}

// During `vite dev` the API runs separately (default :1337); proxy calls to it.
export default defineConfig({
  plugins: [react(), serviceWorker()],
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
