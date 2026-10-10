import { defineConfig } from 'vite'

// Content scripts must be classic scripts. Build the content bundle as a
// self-contained IIFE (no import/export statements) so Chrome can inject it.
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: true,
    minify: 'terser',
    lib: {
      entry: 'src/content/contentScript.js',
      name: 'HandsfreeContent',
      formats: ['iife'],
      fileName: () => 'content.js',
    },
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
})
