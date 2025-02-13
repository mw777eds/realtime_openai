import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  server: {
    host: "localhost",
    port: 1234,
  },
  https: {
    key: fs.readFileSync('path/to/localhost-key.pem'),
    cert: fs.readFileSync('path/to/localhost-cert.pem'),
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
