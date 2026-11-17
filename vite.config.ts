import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  define: { __BUILD__: JSON.stringify(new Date().toISOString()) },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'script-defer',
      includeAssets: ['icons/*.png', 'icons/tf-icon.svg', 'favicon.ico'],
      manifest: {
        name: 'Twelvefold',
        short_name: 'Twelvefold',
        description: 'Planejamento por ciclos: metas, tarefas, agenda e finanças.',
        lang: 'pt-BR',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#fbf1ee',
        theme_color: '#5b2140',
        icons: [
          { src: '/icons/tf-icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/tf-icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/tf-icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // só arquivos estáticos do app; dados pessoais (Supabase) nunca vão para o cache
        globPatterns: ['**/*.{js,css,html,woff2,png,svg}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/auth\//],
        runtimeCaching: [],
        // avisos (push) e o clique neles
        importScripts: ['push-sw.js'],
        cleanupOutdatedCaches: true,
        // versão nova assume na hora (sem esperar fechar todas as janelas do app)
        skipWaiting: true,
        clientsClaim: true,
      },
    }),
  ],
  build: { sourcemap: false, target: 'es2022' },
  server: { port: 5173 },
})
