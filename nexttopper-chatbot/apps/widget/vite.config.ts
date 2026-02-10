import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Widget is meant to be embedded; we don't need Vite's default public assets in the library build.
  publicDir: false,
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'NextToppersCounselorBot',
      formats: ['es', 'iife'],
      fileName: (format) =>
        format === 'iife'
          ? 'nexttoppers-widget.iife.js'
          : 'nexttoppers-widget.es.js',
    },
    rollupOptions: {
      output: {
        // Our widget uses a single entry; keeping it as one file simplifies embedding.
        inlineDynamicImports: true,
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) return 'nexttoppers-widget.css';
          return '[name][extname]';
        },
      },
    },
  },
});
