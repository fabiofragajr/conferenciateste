import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig({
  // Raiz absoluta, não relativa: com rota de dois níveis (/painel/conferencias)
  // um `./assets/app.js` viraria `/painel/assets/app.js` e o app não carregaria.
  base: '/',

  build: {
    target: 'es2022'
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
        start_url: '/',
        scope: '/',
        display: 'standalone',
        // `any` foi tentado para deixar a etiqueta maior em paisagem e voltou
        // atrás: bipando, o celular fica apontado para BAIXO, quase deitado
        // sobre a caixa. Nessa posição a gravidade quase não escolhe lado e o
        // sensor troca de orientação a cada tremida — a tela girava sozinha no
        // meio da leitura, que foi a queixa da operação. Retrato é a posição em
        // que se segura o celular com a outra mão ocupada; o QR é quadrado e
        // não perde nada com isso, e a `.mira` continua larga o bastante para o
        // Code 128 da mesma etiqueta.
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
        // O fallback do leitor é WebAssembly e precisa estar no precache; sem
        // `wasm` aqui, o iPhone abriria o app offline mas não conseguiria bipar.
        globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2,wasm}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        // Toda rota cai no index.html: o app é um documento só, e /painel/rotas
        // precisa abrir offline igual à raiz.
        navigateFallback: 'index.html',
        // requisições ao Supabase nunca podem ser servidas de cache
        navigationPreload: false,
        runtimeCaching: []
      },
      devOptions: { enabled: false }
    })
  ]
});
