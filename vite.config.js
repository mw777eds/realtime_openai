import fs from 'fs';
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  server: {
    host: "localhost",
    port: 1234,
  },
  https: {
    key: fs.readFileSync('localhost-key.pem'),
    cert: fs.readFileSync('localhost-cert.pem'),
  },
  plugins: [viteSingleFile()],
  build: {
    target: "esnext",
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 100000000,
    cssCodeSplit: false,
    brotliSize: false,
    rollupOptions: {
      inlineDynamicImports: true,
      //   output: {
      //     manualChunks: () => "everything.js",
      //   },
    },
  },
});
