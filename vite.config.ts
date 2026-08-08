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
      includeAssets: ['favicon.png', 'logdis-simbolo.png', 'icone-192.png', 'icone-512.png', 'icone-maskable-512.png'],
      manifest: {
        name: 'LOGDIS Connect — Conferência de volumes',
        // cabe embaixo do ícone na home do celular sem virar reticências
        short_name: 'LOGDIS',
        description: 'Conferência de volumes por bipagem na expedição da Milfarma.',
        lang: 'pt-BR',
        dir: 'ltr',
        start_url: './index.html',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        categories: ['business', 'productivity', 'utilities'],
        background_color: '#f7f9f8', // --fundo: splash na mesma cor da tela de login
        theme_color: '#105945',      // --logdis-forest
        // `any` e `maskable` são artes diferentes, não a mesma com dois rótulos:
        // o Android corta o maskable na forma dele e só preserva os 80% do
        // centro. O tile arredondado perderia os cantos nesse corte.
        icons: [
          { src: 'icone-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icone-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icone-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
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
