import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { thirdPartyNotices } from './scripts/thirdPartyNotices'

const sharedDir = resolve('src/shared')

/**
 * Política de segurança de conteúdo aplicada apenas ao build de produção.
 * Em desenvolvimento o servidor do Vite precisa de scripts inline (HMR / React Refresh).
 */
function productionCsp(): Plugin {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
    // frame-ancestors não vale em <meta> (o navegador ignora e avisa); a janela já bloqueia navegação e iframes.
  ].join('; ')
  return {
    name: 'maestrinho:production-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<head>',
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`
      )
    }
  }
}

export default defineConfig({
  main: {
    plugins: [thirdPartyNotices('processo principal e CLI orq')],
    resolve: {
      alias: {
        '@shared': sharedDir,
        // O campo "module" do pacote aponta para um arquivo inexistente; usamos o build CJS.
        '@xterm/headless': resolve('node_modules/@xterm/headless/lib-headless/xterm-headless.js')
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          // CLI usado pelos agentes dentro dos terminais (executado com ELECTRON_RUN_AS_NODE=1).
          orq: resolve('src/cli/orq.ts')
        }
      }
    }
  },
  preload: {
    plugins: [thirdPartyNotices('preload')],
    resolve: { alias: { '@shared': sharedDir } },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          // Janela do personagem (avisos fora do app): preload próprio, só com os canais do aviso.
          buddy: resolve('src/preload/buddy.ts')
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@shared': sharedDir,
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react(), productionCsp(), thirdPartyNotices('interface')],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          buddy: resolve('src/renderer/buddy.html')
        }
      }
    }
  }
})
