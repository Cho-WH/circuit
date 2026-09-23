import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: process.env.GITHUB_PAGES === 'true' ? '/circuit/' : '/',
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        feedbackAdmin: fileURLToPath(new URL('./admin/feedback/index.html', import.meta.url)),
      },
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
