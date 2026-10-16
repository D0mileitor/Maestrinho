// Servidor SSH descartável, só para o teste ponta a ponta dos terminais SSH (ssh-local.mjs).
// Aceita qualquer login (escuta apenas em 127.0.0.1), abre um bash interativo num PTY real com
// HOME temporário e atende "ssh -R" (tcpip-forward). Requer `npm install --no-save ssh2`
// (de propósito fora das dependências do projeto).
//
// Uso: node tests/e2e/ssh-test-server.mjs <arquivo da chave do host> <HOME remoto> [porta]
import { createRequire } from 'node:module'
import net from 'node:net'
import fs from 'node:fs'

const require = createRequire(import.meta.url)
const ssh2 = require('ssh2')
const pty = require('node-pty')

const [hostKeyFile, home, portArg] = process.argv.slice(2)
if (!hostKeyFile || !home) {
  console.error('uso: node ssh-test-server.mjs <chave do host> <HOME remoto> [porta]')
  process.exit(2)
}
const shell =
  process.platform === 'win32'
    ? ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files\\Git\\usr\\bin\\bash.exe'].find((p) => fs.existsSync(p))
    : '/bin/bash'
if (!shell) {
  console.error('bash não encontrado (no Windows, instale o Git for Windows)')
  process.exit(2)
}

const srv = new ssh2.Server({ hostKeys: [fs.readFileSync(hostKeyFile)] }, (client) => {
  client.on('error', (e) => console.log('erro do cliente:', e.message))
  client.on('authentication', (ctx) => ctx.accept())
  client.on('ready', () => {
    client.on('request', (accept, reject, name, info) => {
      console.log('pedido global', name, JSON.stringify(info))
      if (name !== 'tcpip-forward') return reject?.()
      const listener = net.createServer((sock) => {
        client.forwardOut(info.bindAddr, info.bindPort, sock.remoteAddress || '127.0.0.1', sock.remotePort || 0, (err, ch) => {
          if (err) {
            sock.destroy()
            return
          }
          sock.pipe(ch).pipe(sock)
        })
      })
      listener.on('error', () => reject?.())
      listener.listen(info.bindPort, info.bindAddr, () => accept?.(listener.address().port))
      client.on('close', () => listener.close())
    })
    client.on('session', (acceptSession) => {
      const session = acceptSession()
      let size = { cols: 100, rows: 30 }
      let term
      session.on('pty', (acc, _rej, info) => {
        size = { cols: info.cols || 100, rows: info.rows || 30 }
        acc?.()
      })
      session.on('window-change', (acc, _rej, info) => {
        term?.resize(info.cols, info.rows)
        acc?.()
      })
      session.on('env', (acc) => acc?.())
      session.on('shell', (acc) => {
        const stream = acc()
        term = pty.spawn(shell, ['--norc', '--noprofile', '-i'], {
          name: 'xterm-256color',
          cols: size.cols,
          rows: size.rows,
          cwd: home,
          env: { ...process.env, HOME: home, PS1: 'teste@servidor:~$ ', HISTFILE: '/dev/null' }
        })
        term.onData((d) => stream.write(d))
        term.onExit(() => {
          stream.exit(0)
          stream.end()
        })
        stream.on('data', (d) => term.write(d.toString('utf8')))
        stream.on('close', () => {
          try {
            term.kill()
          } catch {
            // já encerrado
          }
        })
      })
    })
  })
})
srv.listen(Number(portArg || 0), '127.0.0.1', () => console.log('PORT', srv.address().port))
