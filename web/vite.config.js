import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build:demo` makes one self-contained HTML file that uses the fake
// backend (src/api.mock.js instead of src/api.js), for clicking through
// without a Firebase project.
export default defineConfig(({ mode }) => {
  const demo = mode === 'demo';
  return {
    base: './', // relative links, so it works at <you>.github.io/secret-santa/
    plugins: demo ? [react(), viteSingleFile()] : [react()],
    resolve: {
      alias: demo ? [{ find: /^(\.\.?(?:\/[\w.-]+)*)\/api\.js$/, replacement: '$1/api.mock.js' }] : [],
    },
    build: { outDir: demo ? 'dist-demo' : 'dist' },
  };
});
