import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  preload: {
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  renderer: {
    resolve: { alias: { '@shared': resolve('src/shared') } },
    // явный IPv4: иначе dev-сервер может слушать только ::1, а Electron идёт на 127.0.0.1
    server: { host: '127.0.0.1' },
    plugins: [react()]
  }
})
