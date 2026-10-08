import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const channel = process.env.VITE_RELEASE_CHANNEL ?? 'dev';
if (!['main', 'dev'].includes(channel)) throw new Error('VITE_RELEASE_CHANNEL must be main or dev');
const publicAppUrl = `https://cho-wh.github.io/circuit/${channel === 'dev' ? 'dev/' : ''}`;

export default defineConfig({
  define: { 'import.meta.env.VITE_RELEASE_CHANNEL': JSON.stringify(channel) },
  base:
    process.env.GITHUB_PAGES === 'true' ? (channel === 'dev' ? '/circuit/dev/' : '/circuit/') : '/',
  plugins: [
    react(),
    {
      name: 'public-link-preview',
      transformIndexHtml: (html) => html.replaceAll('__CIRCUIT_PUBLIC_URL__', publicAppUrl),
    },
  ],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        feedbackAdmin: fileURLToPath(new URL('./admin/feedback/index.html', import.meta.url)),
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
