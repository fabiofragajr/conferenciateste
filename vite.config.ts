import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';

const raiz = (arquivo: string) => fileURLToPath(new URL(arquivo, import.meta.url));

export default defineConfig({
  // caminhos relativos: o app pode ser servido de subpasta (GitHub Pages, IIS interno...)
  base: './',

  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        operador: raiz('./index.html'),
        gestor: raiz('./gestor.html'),
        diretor: raiz('./diretor.html')
      }
    }
  },

  server: {
    host: true,
    // getUserMedia exige contexto seguro: em rede interna use `npm run dev -- --https`
    // ou publique com certificado. localhost já é considerado seguro.
    port: 5173
  },

  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['icone-192.png', 'icone-512.png'],
      manifest: {
        name: 'LogDis Entrega — Conferência de volumes',
        short_name: 'LogDis',
        description: 'Conferência de volumes por bipagem na expedição da Milfarma.',
        lang: 'pt-BR',
        start_url: './index.html',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0b1220',
        theme_color: '#0b1220',
        icons: [
          { src: 'icone-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: 'icone-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
        ]
      },
      workbox: {
        // tudo precache: no galpão o app abre sem rede nenhuma
        globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/gestor\.html/, /diretor\.html/],
        // requisições ao Supabase nunca podem ser servidas de cache
        navigationPreload: false,
        runtimeCaching: []
      },
      devOptions: { enabled: false }
    })
  ]
});
