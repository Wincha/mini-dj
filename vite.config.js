import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const { version } = JSON.parse(readFileSync('./package.json', 'utf8'))

// Mete la versión de package.json en el <title>. Se aplica igual en dev y en
// build, y al ir en el HTML el título ya sale bien en el primer pintado: nada
// de verlo cambiar a medias ni de que la ventana de Electron se quede con el
// título provisional.
const appVersion = () => ({
  name: 'mini-dj-app-version',
  transformIndexHtml: (html) => html.replaceAll('%APP_VERSION%', version),
})

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), appVersion()],
  // Misma versión para el <title> y para la interfaz, de una sola fuente
  define: { __APP_VERSION__: JSON.stringify(version) },
})
