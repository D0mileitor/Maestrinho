// Inicia o electron-vite com um ambiente limpo.
// Processos filhos de extensões do VS Code (e de outras ferramentas baseadas em Electron) herdam
// ELECTRON_RUN_AS_NODE=1, o que faria o Electron rodar como Node puro e o app não abriria.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const pkgDir = path.dirname(require.resolve('electron-vite/package.json'))
const cli = path.join(pkgDir, 'bin', 'electron-vite.js')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_NO_ATTACH_CONSOLE

const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], { stdio: 'inherit', env })
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})
