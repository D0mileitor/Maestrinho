import { describe, expect, it } from 'vitest'
import type { PeersResult, WhoamiResult } from '@shared/api'
import {
  cleanBlock,
  fmtAgo,
  fmtBytes,
  fmtDuration,
  formatNoteList,
  formatPeers,
  formatRead,
  formatRecruit,
  formatReply,
  formatRoleList,
  formatWhoami,
  stateLabel,
  table
} from './format'

describe('formatos básicos', () => {
  it('fmtDuration', () => {
    expect(fmtDuration(600_000)).toBe('10 min')
    expect(fmtDuration(90_000)).toBe('90 s')
    expect(fmtDuration(1_500)).toBe('1,5 s')
    expect(fmtDuration(300)).toBe('0,3 s')
    expect(fmtDuration(3_600_000)).toBe('1 h')
  })

  it('fmtBytes', () => {
    expect(fmtBytes(310)).toBe('310 B')
    expect(fmtBytes(1229)).toBe('1,2 KB')
    expect(fmtBytes(2048)).toBe('2 KB')
    expect(fmtBytes(5 * 1024 * 1024)).toBe('5 MB')
  })

  it('fmtAgo', () => {
    const now = 1_000_000_000
    expect(fmtAgo(now - 1000, now)).toBe('agora')
    expect(fmtAgo(now - 20_000, now)).toBe('há 20 s')
    expect(fmtAgo(now - 5 * 60_000, now)).toBe('há 5 min')
    expect(fmtAgo(now - 3 * 3_600_000, now)).toBe('há 3 h')
    expect(fmtAgo(now - 72 * 3_600_000, now)).toBe('há 3 d')
    expect(fmtAgo(now + 10_000, now)).toBe('agora')
  })

  it('stateLabel', () => {
    expect(stateLabel('running', 'idle')).toBe('ocioso')
    expect(stateLabel('running', 'busy')).toBe('ocupado')
    expect(stateLabel('starting', 'busy')).toBe('iniciando')
    expect(stateLabel('exited', 'idle')).toBe('encerrado')
    expect(stateLabel('stopped', 'idle')).toBe('parado')
    expect(stateLabel('error', 'idle')).toBe('erro')
  })

  it('table alinha colunas (acentos contam como 1) e não deixa espaços no fim', () => {
    expect(table([['NOME', 'PAPEL', 'X'], ['líder', 'é', ''], ['a', 'bb', 'c']], '  ')).toBe(
      ['  NOME   PAPEL  X', '  líder  é', '  a      bb     c'].join('\n')
    )
  })

  it('cleanBlock remove escapes e \\r soltos', () => {
    expect(cleanBlock('a\x1b[31mb\x1b[0m\r\nc\rd')).toBe('ab\ncd')
  })
})

const peers: PeersResult = {
  terminals: [
    {
      id: 't1',
      name: 'revisor',
      role: 'Revisor',
      preset: 'claude',
      status: 'running',
      activity: 'idle',
      badge: 'revisando PR #12'
    },
    { id: 't2', name: 'testador', role: null, preset: 'codex', status: 'running', activity: 'busy', waitingOn: 'revisor' },
    { id: 't3', name: 'líder', role: 'Líder', preset: 'claude', status: 'exited', activity: 'idle', manager: true }
  ],
  notes: [
    { id: 'n1', file: 'spec.md' },
    { id: 'n2', file: 'progresso.md' }
  ],
  portals: [{ id: 'p1', url: 'http://localhost:3000', title: 'App' }]
}

describe('formatPeers', () => {
  it('lista terminais alinhados, notas e portais', () => {
    expect(formatPeers(peers)).toBe(
      [
        'Terminais conectados (3):',
        '  NOME      PAPEL            AGENTE  ESTADO                       STATUS',
        '  revisor   Revisor          claude  ocioso                       revisando PR #12',
        '  testador  —                codex   ocupado, aguardando revisor',
        '  líder     Líder (gerente)  claude  encerrado',
        'Notas conectadas (2): spec.md, progresso.md',
        'Portais conectados (1): http://localhost:3000 (App)',
        'Portais: orq portal read|print|open (se o usuário liberou o portal para agentes).'
      ].join('\n')
    )
  })

  it('sem conexões', () => {
    expect(formatPeers({ terminals: [], notes: [], portals: [] })).toBe(
      'Nenhum terminal conectado a você.\nNotas conectadas: nenhuma'
    )
  })

  it('não repassa escapes de terminal vindos de outro agente', () => {
    const out = formatPeers({
      terminals: [{ ...peers.terminals[0]!, badge: 'ok\x1b]52;c;ZXZpbA==\x07\x1b[2J' }],
      notes: [],
      portals: []
    })
    expect(out).not.toContain('\x1b')
    expect(out).toContain('ok')
  })
})

const me: WhoamiResult = {
  id: 't9',
  name: 'construtor',
  role: { id: 'construtor', name: 'Construtor', instructions: 'Implemente as tarefas.\n\nRode os testes.' },
  manager: false,
  preset: { id: 'claude', label: 'Claude Code' },
  workspace: { dir: 'C:\\proj', name: 'proj' },
  floor: null,
  cwd: 'C:\\proj',
  peers: { terminals: 1, notes: 2 }
}

describe('formatWhoami', () => {
  it('resume identidade, papel com instruções e conexões', () => {
    expect(formatWhoami(me)).toBe(
      [
        'Você é "construtor" (id t9) — agente Claude Code (claude).',
        'Papel: Construtor (id construtor)',
        '  Implemente as tarefas.',
        '',
        '  Rode os testes.',
        'Modo gerente: não',
        'Workspace: proj — C:\\proj',
        'Floor: principal',
        'Diretório: C:\\proj',
        'Conexões: 1 terminal e 2 notas — veja "orq peers".'
      ].join('\n')
    )
  })

  it('gerente, sem papel, em floor', () => {
    const out = formatWhoami({ ...me, role: null, manager: true, floor: { id: 'f1', name: 'exp', branch: 'orq/exp' } })
    expect(out).toContain('Papel: nenhum')
    expect(out).toContain('Modo gerente: sim — você pode usar orq recruit')
    expect(out).toContain('Floor: exp (branch orq/exp)')
  })
})

describe('outros formatos', () => {
  it('formatRead e formatReply', () => {
    expect(formatRead({ name: 'revisor', text: 'linha 1\nlinha 2\n\n', status: 'running', activity: 'busy' })).toBe(
      'Tela de "revisor" (ocupado):\nlinha 1\nlinha 2'
    )
    expect(formatRead({ name: 'revisor', text: '  \n', status: 'running', activity: 'idle' })).toBe(
      'Tela de "revisor" (ocioso): (tela vazia)'
    )
    expect(formatReply('revisor', 'ok, revisado', 'idle')).toBe(
      'Resposta de "revisor" (ficou ocioso; últimas linhas da tela):\nok, revisado'
    )
    expect(formatReply('revisor', 'x', 'exited')).toContain('o processo encerrou')
  })

  it('formatNoteList', () => {
    const now = 10_000_000
    expect(
      formatNoteList(
        {
          notes: [
            { id: 'n1', file: 'spec.md', size: 1229, mtimeMs: now - 5 * 60_000 },
            { id: 'n2', file: 'progresso.md', size: 310, mtimeMs: now - 20_000 }
          ]
        },
        now
      )
    ).toBe(
      [
        'Notas conectadas (2):',
        '  spec.md       1,2 KB  alterada há 5 min',
        '  progresso.md  310 B   alterada há 20 s'
      ].join('\n')
    )
    expect(formatNoteList({ notes: [] }, now)).toBe('Nenhuma nota conectada a você.')
  })

  it('formatRoleList mostra a primeira linha das instruções', () => {
    const out = formatRoleList({
      roles: [
        { id: 'revisor', name: 'Revisor', instructions: '\n  Revisa o código com foco em bugs.\nDepois responde.' },
        { id: 'vazio', name: 'Vazio', instructions: '' }
      ]
    })
    expect(out).toBe(
      [
        'Papéis (2):',
        '  ID       NOME     INSTRUÇÕES',
        '  revisor  Revisor  Revisa o código com foco em bugs.',
        '  vazio    Vazio    (sem instruções)'
      ].join('\n')
    )
  })

  it('formatRecruit', () => {
    expect(formatRecruit({ id: 't5', name: 'testador', preset: 'codex', role: 'Testador', notes: ['spec.md'] })).toBe(
      [
        'Recruta "testador" criado (agente codex, papel Testador) e conectado a você.',
        'Notas ligadas a ele: spec.md',
        'Envie a primeira tarefa com: orq send testador "<tarefa>"'
      ].join('\n')
    )
  })
})
