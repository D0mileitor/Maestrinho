import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawn, spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { ApiError, type ApiMethod } from '@shared/api'
import { LocalApi } from '../api/LocalApi'
import { runCliInProcess } from '../api/cliBridge'
import { looksLikeSecretPrompt, looksLikeShellPrompt, remoteBootstrap, remoteOrqScript } from './remoteOrq'

/** Shell POSIX com curl (Git Bash no Windows). */
function findBash(): string | null {
  const candidates =
    process.platform === 'win32'
      ? ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files\\Git\\usr\\bin\\bash.exe']
      : ['/bin/bash', '/usr/bin/bash', '/bin/sh']
  return candidates.find((c) => fs.existsSync(c)) ?? null
}
const bash = findBash()
const hasCurl = spawnSync(bash ?? 'sh', ['-c', 'command -v curl'], { encoding: 'utf8' }).status === 0

describe('looksLikeShellPrompt', () => {
  it('aceita prompts de shell e recusa pedidos de senha/confirmação', () => {
    expect(looksLikeShellPrompt('Welcome\nana@srv:~$')).toBe(true)
    expect(looksLikeShellPrompt('root@srv:/# ')).toBe(true)
    expect(looksLikeShellPrompt("ana@srv's password:")).toBe(false)
    expect(looksLikeShellPrompt('Are you sure you want to continue connecting (yes/no/[fingerprint])?')).toBe(false)
    expect(looksLikeShellPrompt('Enter passphrase for key:')).toBe(false)
  })

  it('pedido manual: só a linha do cursor bloqueia (aviso de senha no banner não)', () => {
    const banner = 'Your password will expire in 5 days\nana@srv:~$'
    expect(looksLikeSecretPrompt(banner)).toBe(true)
    expect(looksLikeSecretPrompt(banner, 1)).toBe(false)
    expect(looksLikeSecretPrompt("ana@srv's password:", 1)).toBe(true)
  })

  it('o bootstrap não grava o token no arquivo do script', () => {
    const text = remoteBootstrap({ port: 41234, token: 'SEGREDO', terminalId: 't1', terminalName: "o'nome" })
    const script = text.split("<<'MAESTRINHO_ORQ_EOF'")[1]!.split('MAESTRINHO_ORQ_EOF')[0]!
    expect(script).not.toContain('SEGREDO')
    expect(text).toContain("ORQ_TOKEN='SEGREDO'")
    expect(text).toContain("ORQ_TERMINAL_NAME='o'\\''nome'")
    // Sem "!" no texto digitado (expansão de histórico de zsh/bash interativos).
    expect(text).not.toContain('!')
  })
})

describe.runIf(bash && hasCurl)('orq remoto (script com curl) contra a API real', () => {
  let api: LocalApi
  let dir: string
  let script: string
  const writes: { note: string; content: string }[] = []

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orq-remoto-'))
    script = path.join(dir, 'orq')
    fs.writeFileSync(script, remoteOrqScript(), { mode: 0o755 })
    const dispatch = async (_caller: string, method: ApiMethod, body: unknown): Promise<unknown> => {
      const b = body as Record<string, unknown>
      if (method === 'whoami') {
        return {
          id: 't1',
          name: 'servidor-dev',
          role: null,
          manager: false,
          preset: { id: 'ssh', label: 'SSH' },
          workspace: { dir: '/tmp/ws', name: 'ws' },
          floor: null,
          cwd: '/tmp/ws',
          peers: { terminals: 0, notes: 1 }
        }
      }
      if (method === 'note.read') return { id: 'n1', file: 'spec.md', content: '# Spec remota\n', revision: 'abc' }
      if (method === 'note.write') {
        writes.push({ note: String(b['note']), content: String(b['content']) })
        return { id: 'n1', file: 'spec.md', revision: 'def' }
      }
      if (method === 'send') throw new ApiError('forbidden', 'Não há conexão entre "servidor-dev" e "fantasma" no canvas.')
      throw new ApiError('not_found', 'método não simulado')
    }
    api = new LocalApi({
      resolveCaller: (t) => (t === 'tok-remoto' ? 't1' : undefined),
      dispatch: (c, m, b) => dispatch(c, m, b),
      runCli: (_c, token, argv, stdin, signal) => runCliInProcess({ argv, stdin, port: api.port, token, signal })
    })
    await api.start()
  })

  afterAll(async () => {
    await api.stop()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  /** Execução assíncrona: o servidor da API roda neste mesmo processo (spawnSync o travaria). */
  function orq(args: string[], input?: string): Promise<{ code: number | null; out: string }> {
    const env = { ...process.env, ORQ_PORT: String(api.port), ORQ_TOKEN: 'tok-remoto' }
    return new Promise((resolve) => {
      const child = spawn(bash!, [script, ...args], { env })
      let out = ''
      child.stdout.on('data', (d: Buffer) => (out += d.toString('utf8')))
      child.stderr.on('data', (d: Buffer) => (out += d.toString('utf8')))
      child.on('close', (code) => resolve({ code, out }))
      child.stdin.end(input ?? '')
    })
  }

  it('whoami e note read funcionam pelo script', async () => {
    const who = await orq(['whoami'])
    expect(who.code).toBe(0)
    expect(who.out).toContain('servidor-dev')
    const note = await orq(['note', 'read', 'spec.md'])
    expect(note.code).toBe(0)
    expect(note.out).toContain('# Spec remota')
  })

  it('texto pelo stdin (-) chega intacto, com aspas, $ e acentos', async () => {
    const r = await orq(['note', 'write', 'spec.md', '-'], 'linha "1" com $HOME e ação\nlinha 2\n')
    expect(r.code).toBe(0)
    expect(writes.at(-1)).toEqual({ note: 'spec.md', content: 'linha "1" com $HOME e ação\nlinha 2\n' })
  })

  it('erros do servidor viram código de saída e mensagem em pt-BR', async () => {
    const r = await orq(['send', 'fantasma', 'oi'])
    expect(r.code).toBe(3)
    expect(r.out).toContain('Não há conexão')
  })

  it('o texto de ativação instala o script e exporta a sessão (HOME temporário)', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'orq-home-'))
    const text = remoteBootstrap({ port: api.port, token: 'tok-remoto', terminalId: 't1', terminalName: 'servidor-dev' })
    const code = await new Promise<{ code: number | null; out: string }>((resolve) => {
      // O shell remoto recebe o texto "digitado" (stdin); depois o orq já funciona na mesma sessão.
      const env = { ...process.env, HOME: home, TERM: 'dumb', ORQ_PORT: '', ORQ_TOKEN: '' }
      const child = spawn(bash!, ['-s'], { env })
      let out = ''
      child.stdout.on('data', (d: Buffer) => (out += d.toString('utf8')))
      child.stderr.on('data', (d: Buffer) => (out += d.toString('utf8')))
      child.on('close', (c) => resolve({ code: c, out }))
      child.stdin.end(`${text}\norq whoami\n`)
    })
    try {
      expect(fs.existsSync(path.join(home, '.maestrinho', 'bin', 'orq'))).toBe(true)
      const installed = fs.readFileSync(path.join(home, '.maestrinho', 'bin', 'orq'), 'utf8')
      expect(installed).toBe(remoteOrqScript().trimEnd() + '\n')
      expect(installed).not.toContain('tok-remoto')
      expect(code.out).toContain('servidor-dev')
    } finally {
      fs.rmSync(home, { recursive: true, force: true })
    }
  })

  it('sem token: recusa com mensagem clara', () => {
    const r = spawnSync(bash!, [script, 'whoami'], { env: { ...process.env, ORQ_PORT: '', ORQ_TOKEN: '' }, encoding: 'utf8' })
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('sessão SSH')
  })
})
