import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// A unique id for this build, stamped at build time. It's compiled into the app
// (as __BUILD_ID__) AND written to /version.json, so a running client can poll
// that file and notice when a newer build has shipped without a hard refresh.
const buildId = String(Date.now());

// host:true binds 0.0.0.0 so other machines on the LAN can reach the dev
// server. In production you serve the built bundle from PocketBase's pb_public.
export default defineConfig({
  plugins: [
    react(),
    {
      // Drop a tiny version marker next to the bundle so the client can compare.
      name: 'emit-version',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: buildId }) });
      },
    },
  ],
  define: { __BUILD_ID__: JSON.stringify(buildId) },
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
});
