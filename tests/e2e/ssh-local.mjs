// Teste ponta a ponta dos terminais SSH contra um servidor SSH descartável local (ssh-test-server.mjs):
// túnel reverso, ativação automática do orq remoto e orq whoami / note read / note append pelo túnel.
// Requer `npm install --no-save ssh2` e um cliente OpenSSH (o do Windows ou o do Git).
// USE_GIT_SSH=1 usa o ssh do Git em vez do OpenSSH do Windows.
import { spawn, execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as h from './helpers.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
process.chdir(path.resolve(here, '..', '..'))
try {
  createRequire(import.meta.url).resolve('ssh2')
} catch {
  console.error('Este teste precisa do pacote ssh2 (só local): npm install --no-save ssh2')
  process.exit(1)
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maestrinho-ssh-'))
const remoteHome = path.join(root, 'remote-home')
fs.mkdirSync(remoteHome)
const hostKey = path.join(root, 'hostkey')
execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', hostKey])

const server = spawn(process.execPath, [path.join(here, 'ssh-test-server.mjs'), hostKey, remoteHome], {
  stdio: ['ignore', 'pipe', 'pipe']
})
let serverLog = ''
const port = await new Promise((resolve, reject) => {
  server.stdout.on('data', (d) => {
    serverLog += d.toString()
    const m = /PORT (\d+)/.exec(serverLog)
    if (m) resolve(Number(m[1]))
  })
  server.stderr.on('data', (d) => (serverLog += d.toString()))
  server.on('exit', (c) => reject(new Error(`servidor SSH de teste saiu (${c})\n${serverLog}`)))
})
console.log('servidor SSH de teste na porta', port)

const env = h.tempEnv('ssh')
const knownHosts = path.join(root, 'known_hosts')
// Preset igual ao "SSH" de fábrica, mais porta e known_hosts temporário (não toca no ~/.ssh do usuário).
const cfg = {
  version: 1,
  settings: { lastWorkspace: env.workspace, recentWorkspaces: [env.workspace], notifyOnIdle: false },
  presets: [
    {
      id: 'ssh-teste',
      label: 'SSH (teste)',
      command: 'ssh',
      args: ['-p', String(port), '-o', 'StrictHostKeyChecking=no', '-o', `UserKnownHostsFile=${knownHosts}`, '-t', '{host}'],
      inputMode: 'raw',
      isShell: true,
      remoteOrq: true,
      idlePatterns: ['[$#%>]\\s?$'],
      messageTemplate: '{text}'
    }
  ]
}
fs.writeFileSync(path.join(env.userData, 'config.json'), JSON.stringify(cfg, null, 2))
h.seedWorkspace(env.workspace, {
  nodes: [
    h.terminalNode('t-srv', 'servidor', 'ssh-teste', 0, 0, { remoteHost: 'teste@127.0.0.1' }),
    h.noteNode('n-spec', 'spec.md', 700, 0)
  ],
  edges: [h.edge('e1', 't-srv', 'n-spec')],
  notes: { 'spec.md': '# Spec compartilhada\nlinha do canvas\n' }
})

const winSsh = 'C:\\Windows\\System32\\OpenSSH'
const useWinSsh = process.platform === 'win32' && !process.env.USE_GIT_SSH && fs.existsSync(path.join(winSsh, 'ssh.exe'))
const PATH = useWinSsh ? `${winSsh};${process.env.PATH}` : process.env.PATH
const { app, win } = await h.launch(env.userData, { PATH, Path: PATH })
try {
  const running = await h.waitRunning(win, ['t-srv'], 30000)
  h.check(running, `terminal SSH iniciado (${useWinSsh ? 'OpenSSH do Windows' : 'ssh do PATH'})`)
  const info = (await win.evaluate(() => window.maestrinho.invoke('pty:infoAll'))).find((i) => i.id === 't-srv')
  console.log('linha de comando:', info?.commandLine)
  h.check(/-R 127\.0\.0\.1:\d+:127\.0\.0\.1:\d+/.test(info?.commandLine ?? ''), 'ssh aberto com túnel reverso -R')
  const prompt = await h.waitScreen(win, 't-srv', (s) => s.includes('teste@servidor'), 30000, 'prompt remoto')
  h.check(Boolean(prompt), 'prompt do servidor remoto apareceu')
  const activated = await h.waitScreen(win, 't-srv', (s) => s.includes('ativo nesta sessão remota'), 30000, 'ativação do orq')
  h.check(Boolean(activated), 'orq ativado automaticamente ao detectar o prompt')
  const installed = path.join(remoteHome, '.maestrinho', 'bin', 'orq')
  h.check(fs.existsSync(installed), 'script orq instalado no HOME remoto')
  if (fs.existsSync(installed)) {
    const content = fs.readFileSync(installed, 'utf8')
    h.check(content.startsWith('#!/bin/sh\n'), 'script começa com #!/bin/sh')
    h.check(!content.includes('ORQ_TOKEN='), 'token não gravado no script')
  }
  const after = (s, marker) => s.split(marker).slice(1).join(marker)
  await h.typeInto(win, 't-srv', 'orq whoami')
  const who = await h.waitScreen(win, 't-srv', (s) => after(s, 'orq whoami').includes('Você é "servidor"'), 20000, 'whoami remoto')
  h.check(Boolean(who), 'orq whoami pelo túnel responde com o nome do terminal')
  await h.typeInto(win, 't-srv', 'orq note read spec.md')
  const note = await h.waitScreen(win, 't-srv', (s) => after(s, 'orq note read spec.md').includes('linha do canvas'), 20000, 'note read remoto')
  h.check(Boolean(note), 'orq note read pelo túnel devolve a nota conectada')
  await h.typeInto(win, 't-srv', 'echo "do servidor" | orq note append spec.md -')
  let appended = false
  for (let i = 0; i < 30 && !appended; i++) {
    appended = fs.readFileSync(path.join(env.workspace, '.maestrinho', 'notes', 'spec.md'), 'utf8').includes('do servidor')
    if (!appended) await h.sleep(500)
  }
  h.check(appended, 'orq note append (stdin) pelo túnel grava a nota local')
} finally {
  await app.close().catch(() => undefined)
  server.kill()
  h.summary()
  if (process.exitCode) console.log('\n--- log do servidor ---\n' + serverLog)
}
