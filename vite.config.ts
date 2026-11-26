import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig(({ mode }) => {
  const isPortalBuild = mode === 'sco-portal';
  const channel = isPortalBuild ? 'main' : process.env.VITE_RELEASE_CHANNEL ?? 'dev';
  if (!['main', 'dev'].includes(channel)) throw new Error('VITE_RELEASE_CHANNEL must be main or dev');
  const portalPath = '/sim/circuit/';
  const publicAppUrl = isPortalBuild
    ? `https://sco.pe.kr${portalPath}`
    : `https://cho-wh.github.io/circuit/${channel === 'dev' ? 'dev/' : ''}`;
  const base = isPortalBuild
    ? portalPath
    : process.env.GITHUB_PAGES === 'true'
      ? (channel === 'dev' ? '/circuit/dev/' : '/circuit/')
      : '/';

  return {
    define: {
      'import.meta.env.VITE_RELEASE_CHANNEL': JSON.stringify(channel),
      'import.meta.env.VITE_BUILD_ID': JSON.stringify(new Date().toISOString()),
    },
    base,
    plugins: [
      react(),
      {
        name: 'public-link-preview',
        transformIndexHtml: (html) => html.replaceAll('__CIRCUIT_PUBLIC_URL__', publicAppUrl),
      },
    ],
    build: {
      outDir: isPortalBuild ? 'dist/sim/circuit' : 'dist',
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
  };
});
