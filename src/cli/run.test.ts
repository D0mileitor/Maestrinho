import { afterEach, describe, expect, it } from 'vitest'
import type { PeersResult, WhoamiResult } from '@shared/api'
import type { Env } from './client'
import { parseLines, parseTimeout } from './commands'
import { editDistance, run } from './run'
import {
  closedPort,
  fail,
  memoryIo,
  ok,
  startFakeApi,
  TEST_TOKEN,
  type FakeApi,
  type FakeCall,
  type FakeReply,
  type MemoryIoOptions
} from './testkit'

let api: FakeApi | undefined
afterEach(async () => {
  await api?.close()
  api = undefined
})

type Routes = Record<string, (call: FakeCall) => FakeReply | Promise<FakeReply>>

async function serve(routes: Routes): Promise<FakeApi> {
  api = await startFakeApi(
    (call) => routes[call.method]?.(call) ?? fail('not_found', `método ${call.method} não tratado`)
  )
  return api
}

async function orq(argv: string[], opts: { env?: Env; io?: MemoryIoOptions } = {}) {
  const io = memoryIo(opts.io)
  const code = await run(argv, opts.env ?? api?.env ?? {}, io)
  return { code, stdout: io.stdout, stderr: io.stderr, io }
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const ME: WhoamiResult = {
  id: 't1',
  name: 'construtor',
  role: { id: 'construtor', name: 'Construtor', instructions: 'Implemente.' },
  manager: false,
  preset: { id: 'claude', label: 'Claude Code' },
  workspace: { dir: '/proj', name: 'proj' },
  floor: null,
  cwd: '/proj',
  peers: { terminals: 1, notes: 0 }
}

const PEERS: PeersResult = {
  terminals: [{ id: 't2', name: 'revisor', role: 'Revisor', preset: 'claude', status: 'running', activity: 'idle' }],
  notes: [{ id: 'n1', file: 'spec.md' }],
  portals: []
}

const SENT = { messageId: 'm1', to: 'revisor', delivered: true }

describe('fora do app, ajuda e versão', () => {
  it('sem ORQ_PORT/ORQ_TOKEN → código 2 com a mensagem padrão', async () => {
    const r = await orq(['peers'], { env: {} })
    expect(r.code).toBe(2)
    expect(r.stderr.split('\n')[0]).toBe('orq: este comando só funciona dentro de um terminal do Maestrinho.')
    expect(r.stdout).toBe('')
  })

  it('não lê o stdin antes de saber que está dentro do app', async () => {
    const r = await orq(['send', 'revisor', '-'], { env: {}, io: { stdin: 'x' } })
    expect(r.code).toBe(2)
    expect(r.io.stdinReads).toBe(0)
  })

  it('--version', async () => {
    const r = await orq(['--version'], { env: {} })
    expect(r).toMatchObject({ code: 0, stdout: 'orq 9.9.9 (Maestrinho)\n' })
  })

  it('ajuda geral com exemplos de stdin e códigos de saída', async () => {
    for (const argv of [[], ['help'], ['--help'], ['-h']]) {
      const r = await orq(argv, { env: {} })
      expect(r.code, argv.join(' ')).toBe(0)
      expect(r.stdout).toContain("orq send revisor - <<'EOF'")
      expect(r.stdout).toContain('Get-Content arq.md | orq send revisor -')
      expect(r.stdout).toContain('Códigos de saída')
      expect(r.stdout).toContain('7 conflito/limite')
    }
  })

  it('ajuda de comando: help <cmd>, <cmd> --help e com subcomando', async () => {
    const a = await orq(['help', 'send'], { env: {} })
    const b = await orq(['send', '--help'], { env: {} })
    const c = await orq(['send', 'revisor', 'oi', '-h', '--opcao-ruim'], { env: {} })
    expect(a.stdout).toContain('--timeout <s>')
    expect(b.stdout).toBe(a.stdout)
    expect(c.stdout).toBe(a.stdout)
    const note = await orq(['note', 'write', '--help'], { env: {} })
    expect(note.stdout).toContain('--if-revision R')
    expect((await orq(['role', '--help'], { env: {} })).stdout).toContain('--create')
  })

  it('comando desconhecido sugere o certo', async () => {
    const typo = await orq(['sned', 'revisor', 'oi'])
    expect(typo.code).toBe(2)
    expect(typo.stderr).toContain('comando desconhecido "sned"')
    expect(typo.stderr).toContain('você quis dizer "orq send"')
    const alias = await orq(['ask', 'revisor', 'oi'])
    expect(alias.stderr).toContain('use: orq send <peer> "<mensagem>" --wait')
    expect((await orq(['help', 'xyz'])).code).toBe(2)
    expect(editDistance('sned', 'send')).toBe(2)
  })

  it('subcomando ausente ou errado', async () => {
    const missing = await orq(['note'])
    expect(missing.code).toBe(2)
    expect(missing.stderr).toContain('falta o subcomando: orq note list|read|write|append')
    const wrong = await orq(['role', 'lst'])
    expect(wrong.stderr).toContain('você quis dizer "orq role list"')
  })

  it('opção desconhecida sem comando', async () => {
    expect((await orq(['--foo'], { env: {} })).code).toBe(2)
  })
})

describe('whoami e peers', () => {
  it('whoami legível e --json cru', async () => {
    await serve({ whoami: () => ok(ME) })
    const human = await orq(['whoami'])
    expect(human.code).toBe(0)
    expect(human.stdout).toContain('Você é "construtor" (id t1) — agente Claude Code (claude).')
    expect(human.stdout).toContain('  Implemente.')
    const json = await orq(['whoami', '--json'])
    expect(JSON.parse(json.stdout)).toEqual(ME)
    expect(json.stdout.endsWith('\n')).toBe(true)
    expect(api!.of('whoami')[0]!.body).toEqual({})
  })

  it('peers legível', async () => {
    await serve({ peers: () => ok(PEERS) })
    const r = await orq(['peers'])
    expect(r.stdout).toBe(
      [
        'Terminais conectados (1):',
        '  NOME     PAPEL    AGENTE  ESTADO  STATUS',
        '  revisor  Revisor  claude  ocioso',
        'Notas conectadas (1): spec.md',
        ''
      ].join('\n')
    )
  })

  it('formato inesperado: avisa e mostra o JSON (sem falhar)', async () => {
    await serve({ peers: () => ok({ terminais: [] }) })
    const r = await orq(['peers'])
    expect(r.code).toBe(0)
    expect(r.stderr).toContain('formato inesperado')
    expect(JSON.parse(r.stdout)).toEqual({ terminais: [] })
  })

  it('argumento a mais → uso incorreto', async () => {
    await serve({ peers: () => ok(PEERS) })
    const r = await orq(['peers', 'extra'])
    expect(r.code).toBe(2)
    expect(api!.calls).toHaveLength(0)
  })
})

describe('send', () => {
  it('junta a mensagem com opções no meio e aceita @peer', async () => {
    await serve({ send: () => ok(SENT) })
    const r = await orq(['send', '@revisor', 'Revise', '--json', 'o', 'diff'])
    expect(r.code).toBe(0)
    expect(api!.of('send')[0]!.body).toEqual({ to: 'revisor', text: 'Revise o diff' })
    expect(JSON.parse(r.stdout)).toEqual(SENT)
    const human = await orq(['send', 'revisor', 'oi'])
    expect(human.stdout).toBe('Mensagem entregue a "revisor".\n')
  })

  it('"-" lê do stdin (CRLF → LF, sem linhas vazias nas pontas)', async () => {
    await serve({ send: () => ok(SENT) })
    const r = await orq(['send', 'revisor', '-'], { io: { stdin: '\nlinha 1 — ação\r\n  linha 2\r\n\r\n' } })
    expect(r.code).toBe(0)
    expect(api!.of('send')[0]!.body['text']).toBe('linha 1 — ação\n  linha 2')
  })

  it('sem mensagem e stdin de pipe → lê do stdin', async () => {
    await serve({ send: () => ok(SENT) })
    await orq(['send', 'revisor'], { io: { stdin: 'via pipe\n', stdinIsTTY: false } })
    expect(api!.of('send')[0]!.body['text']).toBe('via pipe')
  })

  it('stdin vazio ou teclado sem mensagem → uso incorreto sem enviar', async () => {
    await serve({ send: () => ok(SENT) })
    const empty = await orq(['send', 'revisor'], { io: { stdin: '' } })
    expect(empty.code).toBe(2)
    expect(empty.stderr).toContain('nada chegou pelo stdin')
    const tty = await orq(['send', 'revisor'], { io: { stdinIsTTY: true } })
    expect(tty.code).toBe(2)
    expect(tty.stderr).toContain('falta a mensagem')
    expect(tty.io.stdinReads).toBe(0)
    expect(api!.calls).toHaveLength(0)
  })

  it('--file lê a mensagem de um arquivo', async () => {
    await serve({ send: () => ok(SENT) })
    await orq(['send', 'revisor', '--file', 'msg.md'], { io: { files: { 'msg.md': 'do arquivo\n' } } })
    expect(api!.of('send')[0]!.body['text']).toBe('do arquivo')
    const missing = await orq(['send', 'revisor', '--file=nao.md'])
    expect(missing.code).toBe(4)
    expect(missing.stderr).toContain('arquivo não encontrado: "nao.md"')
    expect(missing.stderr).not.toContain('orq peers')
  })

  it('"--" permite mensagem que começa com "--"', async () => {
    await serve({ send: () => ok(SENT) })
    await orq(['send', 'revisor', '--', '--force', 'é perigoso'])
    expect(api!.of('send')[0]!.body['text']).toBe('--force é perigoso')
  })

  it('opção desconhecida no meio do texto → código 2 com dica do "--"', async () => {
    await serve({ send: () => ok(SENT) })
    const r = await orq(['send', 'revisor', 'use', '--force', 'agora'])
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('opção desconhecida "--force" em "orq send"')
    expect(r.stderr).toContain('use "--" antes dele')
    expect(api!.calls).toHaveLength(0)
  })

  it('--timeout/--lines sem --wait → código 2', async () => {
    await serve({ send: () => ok(SENT) })
    expect((await orq(['send', 'revisor', 'oi', '--timeout', '30'])).code).toBe(2)
    expect((await orq(['send', 'revisor', 'oi', '--lines', '30'])).code).toBe(2)
    expect(api!.calls).toHaveLength(0)
  })

  it('mensagem grande demais → código 7 sem enviar', async () => {
    await serve({ send: () => ok(SENT) })
    const r = await orq(['send', 'revisor', '-'], { io: { stdin: 'x'.repeat(200_001) } })
    expect(r.code).toBe(7)
    expect(r.stderr).toContain('orq: a mensagem excede o limite: 200.001 caracteres (máximo 200.000).')
    expect(api!.calls).toHaveLength(0)
  })

  it('sem conexão no canvas → código 3 com a mensagem do servidor e dica', async () => {
    await serve({ send: () => fail('forbidden', 'o terminal "x" não está conectado a você.') })
    const r = await orq(['send', 'x', 'oi'])
    expect(r.code).toBe(3)
    expect(r.stderr).toBe(
      'orq: o terminal "x" não está conectado a você.\n' +
        'dica: você só alcança o que está conectado a você no canvas: veja "orq peers".\n'
    )
    expect(r.stdout).toBe('')
  })

  it('--json: erro em JSON no stderr', async () => {
    await serve({ send: () => fail('unavailable', 'o processo de "revisor" não está rodando.') })
    const r = await orq(['send', 'revisor', 'oi', '--json'])
    expect(r.code).toBe(6)
    expect(r.stdout).toBe('')
    expect(JSON.parse(r.stderr)).toEqual({
      ok: false,
      error: {
        code: 'unavailable',
        message: 'o processo de "revisor" não está rodando.',
        hint: 'o processo do destino não está rodando (encerrado ou parado); peça ao usuário para reiniciá-lo.',
        exitCode: 6
      }
    })
  })

  it('app fechado → código 1 com a porta', async () => {
    const port = await closedPort()
    const r = await orq(['send', 'revisor', 'oi'], { env: { ORQ_PORT: String(port), ORQ_TOKEN: TEST_TOKEN } })
    expect(r.code).toBe(1)
    expect(r.stderr).toContain(`Não consegui falar com o Maestrinho (porta ${port}). O app está aberto?`)
  })
})

describe('send --wait (long-poll)', () => {
  it('repete wait até done e mostra as últimas linhas', async () => {
    let polls = 0
    await serve({
      send: () => ok(SENT),
      wait: () =>
        ++polls < 2
          ? ok({ done: false, to: 'revisor' })
          : ok({ done: true, reason: 'idle', output: 'feito ✓\n', to: 'revisor' })
    })
    const r = await orq(['send', 'revisor', 'faça', '--wait', '--lines', '30'])
    expect(r.code).toBe(0)
    expect(r.stdout).toBe('Resposta de "revisor" (ficou ocioso; últimas linhas da tela):\nfeito ✓\n')
    expect(api!.of('send')[0]!.body).toEqual({ to: 'revisor', text: 'faça', wait: true })
    const waits = api!.of('wait')
    expect(waits).toHaveLength(2)
    for (const w of waits) expect(w.body).toEqual({ messageId: 'm1', pollMs: 20_000, lines: 30 })
  })

  it('--json junta envio e resposta', async () => {
    await serve({ send: () => ok(SENT), wait: () => ok({ done: true, reason: 'idle', output: 'ok', to: 'revisor' }) })
    const r = await orq(['send', 'revisor', 'faça', '--wait', '--json'])
    expect(JSON.parse(r.stdout)).toEqual({ ...SENT, done: true, reason: 'idle', output: 'ok' })
  })

  it('tempo total esgotado: cancela a espera no app e sai com 5', async () => {
    await serve({
      send: () => ok(SENT),
      wait: async (call) => {
        if (call.body['cancel'] === true) return ok({ done: true, reason: 'cancelled', to: 'revisor' })
        await delay(Number(call.body['pollMs']))
        return ok({ done: false, to: 'revisor' })
      }
    })
    const started = Date.now()
    const r = await orq(['send', 'revisor', 'faça', '--wait', '--timeout', '0.3'])
    expect(r.code).toBe(5)
    expect(Date.now() - started).toBeLessThan(5000)
    expect(r.stderr).toContain('orq: tempo esgotado (0,3 s) esperando a resposta de "revisor"')
    expect(r.stderr).toContain('dica: veja a tela dele depois com: orq read revisor')
    const waits = api!.of('wait')
    const cancel = waits[waits.length - 1]!
    expect(cancel.body).toEqual({ messageId: 'm1', pollMs: 0, cancel: true })
    for (const w of waits.slice(0, -1)) expect(Number(w.body['pollMs'])).toBeLessThanOrEqual(300)
  })

  it('--json no tempo esgotado: erro JSON com código timeout', async () => {
    await serve({
      send: () => ok(SENT),
      wait: async (call) => {
        if (call.body['cancel'] === true) return ok({ done: true, reason: 'cancelled', to: 'revisor' })
        await delay(Number(call.body['pollMs']))
        return ok({ done: false, to: 'revisor' })
      }
    })
    const r = await orq(['send', 'revisor', 'faça', '--wait', '--timeout=0.2', '--json'])
    expect(r.code).toBe(5)
    expect(JSON.parse(r.stderr)).toMatchObject({ ok: false, error: { code: 'timeout', exitCode: 5 } })
  })

  it('destino encerrou → mostra a saída e sai com 6', async () => {
    await serve({
      send: () => ok(SENT),
      wait: () => ok({ done: true, reason: 'exited', output: 'Segmentation fault', to: 'revisor' })
    })
    const r = await orq(['send', 'revisor', 'faça', '--wait'])
    expect(r.code).toBe(6)
    expect(r.stdout).toContain('Segmentation fault')
    expect(r.stderr).toContain('encerrou antes de ficar ocioso')
  })

  it('espera cancelada no app → código 1', async () => {
    await serve({ send: () => ok(SENT), wait: () => ok({ done: true, reason: 'cancelled', to: 'revisor' }) })
    const r = await orq(['send', 'revisor', 'faça', '--wait'])
    expect(r.code).toBe(1)
    expect(r.stdout).toBe('')
    expect(r.stderr).toContain('foi cancelada')
  })

  it('Ctrl+C durante a espera: avisa o app e sai com 130', async () => {
    await serve({
      send: () => ok(SENT),
      wait: (call) =>
        call.body['cancel'] === true ? ok({ done: true, reason: 'cancelled', to: 'revisor' }) : { hang: true }
    })
    const ac = new AbortController()
    setTimeout(() => ac.abort(), 150)
    const r = await orq(['send', 'revisor', 'faça', '--wait'], { io: { signal: ac.signal } })
    expect(r.code).toBe(130)
    expect(r.stderr).toContain('interrompido')
    expect(api!.of('wait').some((w) => w.body['cancel'] === true)).toBe(true)
  })

  it('erro durante a espera mapeia o código (ex.: 4) e tenta cancelar', async () => {
    await serve({
      send: () => ok(SENT),
      wait: (call) =>
        call.body['cancel'] === true ? ok({ done: true, to: 'revisor' }) : fail('not_found', 'mensagem m1 não encontrada.')
    })
    const r = await orq(['send', 'revisor', 'faça', '--wait'])
    expect(r.code).toBe(4)
    expect(api!.of('wait').some((w) => w.body['cancel'] === true)).toBe(true)
  })

  it('--lines fora da faixa é recusado antes de enviar', async () => {
    await serve({ send: () => ok(SENT) })
    const r = await orq(['send', 'revisor', 'faça', '--wait', '--lines', '5000'])
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('--lines deve ser no máximo 2.000')
    expect(api!.calls).toHaveLength(0)
  })

  it('--timeout aceita unidades e recusa lixo', async () => {
    expect(parseTimeout('300')).toBe(300_000)
    expect(parseTimeout('0.5')).toBe(500)
    expect(parseTimeout('1,5')).toBe(1500)
    expect(parseTimeout('90s')).toBe(90_000)
    expect(parseTimeout('5m')).toBe(300_000)
    expect(parseTimeout('10min')).toBe(600_000)
    expect(parseTimeout('1h')).toBe(3_600_000)
    expect(parseTimeout('0')).toBe(0)
    expect(() => parseTimeout('-5')).toThrow(/--timeout/)
    expect(() => parseTimeout('8d')).toThrow(/--timeout/)
    expect(() => parseTimeout('9999h')).toThrow(/máximo 7 dias/)
    await serve({ send: () => ok(SENT) })
    expect((await orq(['send', 'revisor', 'faça', '--wait', '--timeout', 'logo'])).code).toBe(2)
    expect(api!.calls).toHaveLength(0)
  })

  it('--lines: inteiro dentro da faixa do protocolo', () => {
    expect(parseLines('40', 'wait')).toBe(40)
    expect(parseLines(' 7 ', 'read')).toBe(7)
    expect(() => parseLines('1.5', 'read')).toThrow(/número inteiro/)
    expect(() => parseLines('0', 'read')).toThrow('--lines deve ser no mínimo 1.')
    expect(() => parseLines('2001', 'wait')).toThrow('--lines deve ser no máximo 2.000.')
  })
})

describe('read', () => {
  it('mostra a tela com estado', async () => {
    await serve({ read: () => ok({ name: 'revisor', text: 'linha a\nlinha b', status: 'running', activity: 'busy' }) })
    const r = await orq(['read', 'revisor', '--lines', '10'])
    expect(r.code).toBe(0)
    expect(api!.of('read')[0]!.body).toEqual({ peer: 'revisor', lines: 10 })
    expect(r.stdout).toBe('Tela de "revisor" (ocupado):\nlinha a\nlinha b\n')
  })

  it('valida --lines e argumentos', async () => {
    await serve({ read: () => ok({}) })
    expect((await orq(['read', 'revisor', '--lines', 'abc'])).code).toBe(2)
    expect((await orq(['read', 'revisor', 'outro'])).code).toBe(2)
    expect((await orq(['read'])).code).toBe(2)
    expect(api!.calls).toHaveLength(0)
  })
})

describe('notas', () => {
  it('note list', async () => {
    const now = Date.now()
    const notes = [{ id: 'n1', file: 'spec.md', size: 2048, mtimeMs: now - 120_000 }]
    await serve({ 'note.list': () => ok({ notes }) })
    const r = await orq(['note', 'list'], { io: { now: () => now } })
    expect(r.stdout).toBe('Notas conectadas (1):\n  spec.md  2 KB  alterada há 2 min\n')
  })

  it('note read devolve o conteúdo exato (ou com quebra final num terminal)', async () => {
    await serve({ 'note.read': () => ok({ id: 'n1', file: 'spec.md', content: '# Spec\nação', revision: 'abc123' }) })
    expect((await orq(['note', 'read', 'spec.md'])).stdout).toBe('# Spec\nação')
    expect((await orq(['note', 'read', 'spec.md'], { io: { stdoutIsTTY: true } })).stdout).toBe('# Spec\nação\n')
    const json = await orq(['note', 'read', 'spec.md', '--json'])
    expect(JSON.parse(json.stdout)).toMatchObject({ revision: 'abc123' })
    expect(api!.of('note.read')[0]!.body).toEqual({ note: 'spec.md' })
  })

  it('note read de nota vazia avisa no stderr', async () => {
    await serve({ 'note.read': () => ok({ id: 'n1', file: 'vazia.md', content: '', revision: 'e3b0' }) })
    const r = await orq(['note', 'read', 'vazia.md'])
    expect(r).toMatchObject({ code: 0, stdout: '' })
    expect(r.stderr).toContain('está vazia')
  })

  it('note write: argumentos ganham quebra final; "" esvazia', async () => {
    await serve({ 'note.write': (call) => ok({ id: 'n1', file: String(call.body['note']), revision: 'r2' }) })
    const r = await orq(['note', 'write', 'spec.md', '#', 'Título'])
    expect(r.stdout).toBe('Nota "spec.md" gravada (revisão r2).\n')
    expect(api!.of('note.write')[0]!.body).toEqual({ note: 'spec.md', content: '# Título\n' })
    await orq(['note', 'write', 'spec.md', ''])
    expect(api!.of('note.write')[1]!.body).toEqual({ note: 'spec.md', content: '' })
  })

  it('note write - (heredoc) e --if-revision', async () => {
    await serve({ 'note.write': () => ok({ id: 'n1', file: 'spec.md', revision: 'r3' }) })
    await orq(['note', 'write', 'spec.md', '-', '--if-revision', 'r2'], { io: { stdin: '# Spec\r\n\r\n- item\r\n' } })
    expect(api!.of('note.write')[0]!.body).toEqual({ note: 'spec.md', content: '# Spec\n\n- item\n', ifRevision: 'r2' })
  })

  it('note write sem conteúdo no stdin não apaga a nota', async () => {
    await serve({ 'note.write': () => ok({}) })
    const r = await orq(['note', 'write', 'spec.md'], { io: { stdin: '' } })
    expect(r.code).toBe(2)
    expect(api!.calls).toHaveLength(0)
  })

  it('revisão divergente → código 7 com dica', async () => {
    await serve({ 'note.write': () => fail('precondition', 'a nota spec.md mudou (revisão atual: r9).') })
    const r = await orq(['note', 'write', 'spec.md', 'x', '--if-revision=r2'])
    expect(r.code).toBe(7)
    expect(r.stderr).toContain('orq: a nota spec.md mudou (revisão atual: r9).')
    expect(r.stderr).toContain('orq note read <nota> --json')
  })

  it('note append', async () => {
    await serve({ 'note.append': () => ok({ id: 'n1', file: 'progresso.md', revision: 'r4' }) })
    const r = await orq(['note', 'append', 'progresso.md', '- [x]', 'parser'])
    expect(r.stdout).toBe('Texto anexado à nota "progresso.md" (revisão r4).\n')
    expect(api!.of('note.append')[0]!.body).toEqual({ note: 'progresso.md', content: '- [x] parser\n' })
    expect((await orq(['note', 'append', 'progresso.md', ''])).code).toBe(2)
  })

  it('nota inexistente → código 4 com dica de note list', async () => {
    await serve({ 'note.read': () => fail('not_found', 'nota "x.md" não está conectada a você.') })
    const r = await orq(['note', 'read', 'x.md'])
    expect(r.code).toBe(4)
    expect(r.stderr).toContain('orq note list')
  })
})

describe('notify e status', () => {
  it('notify com --title', async () => {
    await serve({ notify: () => ok({}) })
    const r = await orq(['notify', 'Testes', 'ok', '--title', 'Build'])
    expect(r.stdout).toBe('Notificação enviada.\n')
    expect(api!.of('notify')[0]!.body).toEqual({ text: 'Testes ok', title: 'Build' })
    expect((await orq(['notify'])).code).toBe(2)
  })

  it('status define e limpa', async () => {
    await serve({ status: () => ok({}) })
    expect((await orq(['status', 'revisando', 'PR'])).stdout).toBe('Status atualizado: "revisando PR".\n')
    expect((await orq(['status'])).stdout).toBe('Status removido.\n')
    expect(api!.of('status').map((c) => c.body)).toEqual([{ text: 'revisando PR' }, { text: '' }])
    expect((await orq(['status', 'x'.repeat(201)])).code).toBe(7)
  })
})

describe('comandos de gerente', () => {
  it('recruit com --note repetido', async () => {
    const result = { id: 't5', name: 'testador', preset: 'codex', role: 'Testador', notes: ['spec.md', 'plano.md'] }
    await serve({ recruit: () => ok(result) })
    const r = await orq([
      'recruit',
      '--name',
      'testador',
      '--agent=codex',
      '--note',
      'spec.md',
      '--role',
      'testador',
      '--note',
      'plano.md',
      '--floor',
      'f1'
    ])
    expect(r.code).toBe(0)
    expect(api!.of('recruit')[0]!.body).toEqual({
      name: 'testador',
      agent: 'codex',
      role: 'testador',
      notes: ['spec.md', 'plano.md'],
      floor: 'f1'
    })
    expect(r.stdout).toContain('Recruta "testador" criado (agente codex, papel Testador) e conectado a você.')
  })

  it('recruit aceita o nome como argumento e exige um nome', async () => {
    await serve({ recruit: () => ok({ id: 't6', name: 'revisor', preset: 'claude', role: null, notes: [] }) })
    await orq(['recruit', 'revisor'])
    expect(api!.of('recruit')[0]!.body).toEqual({ name: 'revisor' })
    expect((await orq(['recruit'])).code).toBe(2)
    expect((await orq(['recruit', 'a', 'b'])).code).toBe(2)
    expect((await orq(['recruit', 'a', '--name', 'b'])).code).toBe(2)
  })

  it('terminal comum → código 3 com dica do modo gerente', async () => {
    await serve({ recruit: () => fail('forbidden', 'somente terminais em modo gerente podem recrutar.') })
    const r = await orq(['recruit', '--name', 'x'])
    expect(r.code).toBe(3)
    expect(r.stderr).toContain('modo gerente ligado')
  })

  it('dismiss, role set, connect', async () => {
    await serve({
      dismiss: () => ok({}),
      'role.set': () => ok({}),
      connect: () => ok({ edgeId: 'e1', a: 'testador', b: 'spec.md' })
    })
    expect((await orq(['dismiss', 'testador'])).stdout).toBe('Recruta "testador" dispensado (terminal fechado).\n')
    expect(api!.of('dismiss')[0]!.body).toEqual({ name: 'testador' })
    const set = await orq(['role', 'set', 'construtor', 'revisor'])
    expect(set.stdout).toBe('Papel de "construtor" agora é "revisor".\n')
    expect(api!.of('role.set')[0]!.body).toEqual({ name: 'construtor', role: 'revisor' })
    expect((await orq(['connect', 'testador', 'spec.md'])).stdout).toBe('Conexão criada: "testador" ↔ "spec.md".\n')
    expect(api!.of('connect')[0]!.body).toEqual({ a: 'testador', b: 'spec.md' })
    expect((await orq(['role', 'set', 'construtor'])).code).toBe(2)
  })

  it('role list', async () => {
    await serve({ 'role.list': () => ok({ roles: [{ id: 'lider', name: 'Líder', instructions: 'Coordena.' }] }) })
    const r = await orq(['role', 'list'])
    expect(r.stdout).toBe('Papéis (1):\n  ID     NOME   INSTRUÇÕES\n  lider  Líder  Coordena.\n')
  })

  it('role edit: --instructions - lê do stdin; --create; texto direto', async () => {
    await serve({ 'role.edit': () => ok({ role: { id: 'revisor', name: 'Revisor' } }) })
    const r = await orq(['role', 'edit', 'revisor', '--create', '--instructions', '-'], {
      io: { stdin: 'Revise com foco em segurança.\n' }
    })
    expect(r.stdout).toBe('Instruções do papel "Revisor" (id revisor) salvas.\n')
    expect(api!.of('role.edit')[0]!.body).toEqual({
      role: 'revisor',
      instructions: 'Revise com foco em segurança.',
      create: true
    })
    await orq(['role', 'edit', 'revisor', '--instructions=Seja breve.'])
    expect(api!.of('role.edit')[1]!.body).toEqual({ role: 'revisor', instructions: 'Seja breve.' })
  })

  it('role edit sem instruções ou com texto solto → código 2', async () => {
    await serve({ 'role.edit': () => ok({}) })
    expect((await orq(['role', 'edit', 'revisor'])).code).toBe(2)
    const loose = await orq(['role', 'edit', 'revisor', 'texto', 'solto'])
    expect(loose.code).toBe(2)
    expect(loose.stderr).toContain('--instructions')
    expect(api!.calls).toHaveLength(0)
  })
})
