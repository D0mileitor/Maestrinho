import type {
  BoardCardSummary,
  BoardListResult,
  BoardShowResult,
  NoteListResult,
  PeersResult,
  PeerTerminal,
  ReadResult,
  RecruitResult,
  RoleListResult,
  WaitResult,
  WhoamiResult
} from '@shared/api'
import { stripAnsi } from '@shared/ansi'
import { CLI_NAME } from '@shared/constants'
import { oneLine } from './errors'

/**
 * Saída legível (pt-BR) dos comandos. Compacta: quem mais lê isto é um agente de IA.
 * Todo texto vindo do servidor passa por `oneLine`/`cleanBlock`, que removem sequências de
 * terminal: um agente não consegue injetar escapes (ex.: OSC 52) no terminal de outro.
 */

/** Texto de várias linhas vindo de fora: sem ANSI/controles, CRLF → LF, sem \r soltos. */
export function cleanBlock(text: string): string {
  return stripAnsi(text).replace(/\r\n/g, '\n').replace(/\r/g, '')
}

function decimal(n: number, digits = 1): string {
  const s = n.toFixed(digits)
  return (s.includes('.') ? s.replace(/\.?0+$/, '') : s).replace('.', ',')
}

/** 600000 → "10 min", 90000 → "90 s", 1500 → "1,5 s", 3600000 → "1 h". */
export function fmtDuration(ms: number): string {
  if (ms >= 3_600_000 && ms % 3_600_000 === 0) return `${ms / 3_600_000} h`
  if (ms >= 60_000 && ms % 60_000 === 0) return `${ms / 60_000} min`
  return `${decimal(ms / 1000)} s`
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${decimal(n / 1024)} KB`
  return `${decimal(n / (1024 * 1024))} MB`
}

/** Tempo relativo curto: "agora", "há 12 s", "há 5 min", "há 3 h", "há 2 d". */
export function fmtAgo(thenMs: number, nowMs: number): string {
  const s = Math.max(0, Math.round((nowMs - thenMs) / 1000))
  if (s < 5) return 'agora'
  if (s < 60) return `há ${s} s`
  const m = Math.floor(s / 60)
  if (m < 60) return `há ${m} min`
  const h = Math.floor(m / 60)
  if (h < 48) return `há ${h} h`
  return `há ${Math.floor(h / 24)} d`
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/** Estado legível de um terminal. */
export function stateLabel(status: PeerTerminal['status'], activity: PeerTerminal['activity']): string {
  switch (status) {
    case 'running':
      return activity === 'busy' ? 'ocupado' : 'ocioso'
    case 'starting':
      return 'iniciando'
    case 'exited':
      return 'encerrado'
    case 'stopped':
      return 'parado'
    case 'error':
      return 'erro'
  }
}

function width(s: string): number {
  return [...s].length
}

/** Colunas alinhadas por espaços (sem espaços sobrando no fim das linhas). */
export function table(rows: readonly (readonly string[])[], indent = ''): string {
  const widths: number[] = []
  for (const row of rows) row.forEach((cell, i) => (widths[i] = Math.max(widths[i] ?? 0, width(cell))))
  const pad = (cell: string, i: number, last: boolean): string =>
    last ? cell : cell + ' '.repeat((widths[i] ?? 0) - width(cell) + 2)
  return rows.map((row) => (indent + row.map((cell, i) => pad(cell, i, i === row.length - 1)).join('')).trimEnd()).join('\n')
}

function truncate(text: string, max: number): string {
  const chars = [...text]
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`
}

function indentBlock(text: string, prefix = '  '): string {
  return text
    .split('\n')
    .map((l) => (l === '' ? '' : prefix + l))
    .join('\n')
}

function q(name: string): string {
  return `"${oneLine(name)}"`
}

// ------------------------------------------------------------------ comandos

export function formatWhoami(r: WhoamiResult): string {
  const lines: string[] = []
  const agent = `${oneLine(r.preset.label)} (${oneLine(r.preset.id)})`
  lines.push(`Você é ${q(r.name)} (id ${oneLine(r.id)}) — agente ${agent}.`)
  if (r.role) {
    const instructions = cleanBlock(r.role.instructions).trim()
    const empty = instructions ? '' : ' — sem instruções'
    lines.push(`Papel: ${oneLine(r.role.name)} (id ${oneLine(r.role.id)})${empty}`)
    if (instructions) lines.push(indentBlock(instructions))
  } else {
    lines.push('Papel: nenhum')
  }
  lines.push(
    r.manager
      ? `Modo gerente: sim — você pode usar ${CLI_NAME} recruit, dismiss, role set/edit e connect.`
      : 'Modo gerente: não'
  )
  lines.push(`Workspace: ${oneLine(r.workspace.name)} — ${oneLine(r.workspace.dir)}`)
  lines.push(r.floor ? `Floor: ${oneLine(r.floor.name)} (branch ${oneLine(r.floor.branch)})` : 'Floor: principal')
  lines.push(`Diretório: ${oneLine(r.cwd)}`)
  lines.push(
    `Conexões: ${plural(r.peers.terminals, 'terminal', 'terminais')} e ${plural(r.peers.notes, 'nota', 'notas')}` +
      ` — veja "${CLI_NAME} peers".`
  )
  return lines.join('\n')
}

function terminalState(t: PeerTerminal): string {
  const state = stateLabel(t.status, t.activity)
  return t.waitingOn ? `${state}, aguardando ${oneLine(t.waitingOn)}` : state
}

export function formatPeers(r: PeersResult): string {
  const out: string[] = []
  if (r.terminals.length === 0) {
    out.push('Nenhum terminal conectado a você.')
  } else {
    out.push(`Terminais conectados (${r.terminals.length}):`)
    const rows = [['NOME', 'PAPEL', 'AGENTE', 'ESTADO', 'STATUS']]
    for (const t of r.terminals) {
      const role = (t.role ? oneLine(t.role) : '—') + (t.manager ? ' (gerente)' : '')
      const badge = t.badge ? truncate(oneLine(t.badge), 80) : ''
      rows.push([oneLine(t.name), role, oneLine(t.preset), terminalState(t), badge])
    }
    out.push(table(rows, '  '))
  }
  out.push(
    r.notes.length === 0
      ? 'Notas conectadas: nenhuma'
      : `Notas conectadas (${r.notes.length}): ${r.notes.map((n) => oneLine(n.file)).join(', ')}`
  )
  if (r.portals.length > 0) {
    const portals = r.portals.map((p) =>
      p.title ? `${oneLine(p.url)} (${truncate(oneLine(p.title), 60)})` : oneLine(p.url)
    )
    out.push(`Portais conectados (${r.portals.length}): ${portals.join(', ')}`)
    out.push(`Portais: ${CLI_NAME} portal read|print|open (se o usuário liberou o portal para agentes).`)
  }
  return out.join('\n')
}

/** Cabeçalho + bloco de texto da tela de um terminal. */
function screen(title: string, text: string): string {
  const body = cleanBlock(text).replace(/\n+$/, '')
  return body.trim() === '' ? `${title} (tela vazia)` : `${title}\n${body}`
}

export function formatRead(r: ReadResult): string {
  return screen(`Tela de ${q(r.name)} (${stateLabel(r.status, r.activity)}):`, r.text)
}

/** Resposta de `send --wait` quando o destino ficou ocioso (ou encerrou). */
export function formatReply(to: string, output: string | undefined, reason: WaitResult['reason']): string {
  const when =
    reason === 'exited' ? 'o processo encerrou' : reason === 'cancelled' ? 'a espera foi cancelada' : 'ficou ocioso'
  return screen(`Resposta de ${q(to)} (${when}; últimas linhas da tela):`, output ?? '')
}

export function formatNoteList(r: NoteListResult, nowMs: number): string {
  if (r.notes.length === 0) return 'Nenhuma nota conectada a você.'
  const rows = r.notes.map((n) => [oneLine(n.file), fmtBytes(n.size), `alterada ${fmtAgo(n.mtimeMs, nowMs)}`])
  return `Notas conectadas (${r.notes.length}):\n${table(rows, '  ')}`
}

export function formatRoleList(r: RoleListResult): string {
  if (r.roles.length === 0) return 'Nenhum papel cadastrado.'
  const rows = [['ID', 'NOME', 'INSTRUÇÕES']]
  for (const role of r.roles) {
    const first = cleanBlock(role.instructions)
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l !== '')
    rows.push([oneLine(role.id), oneLine(role.name), first ? truncate(first, 70) : '(sem instruções)'])
  }
  return `Papéis (${r.roles.length}):\n${table(rows, '  ')}`
}

export function formatRecruit(r: RecruitResult): string {
  const details = [`agente ${oneLine(r.preset)}`, r.role ? `papel ${oneLine(r.role)}` : 'sem papel']
  const lines = [`Recruta ${q(r.name)} criado (${details.join(', ')}) e conectado a você.`]
  if (r.notes.length > 0) lines.push(`Notas ligadas a ele: ${r.notes.map(oneLine).join(', ')}`)
  lines.push(`Envie a primeira tarefa com: ${CLI_NAME} send ${oneLine(r.name)} "<tarefa>"`)
  return lines.join('\n')
}

// ------------------------------------------------------------------ quadro de chamados

function cardLine(c: BoardCardSummary): string[] {
  const extra = [c.ticket ? `chamado ${oneLine(c.ticket)}` : '', c.assignee ? `com ${oneLine(c.assignee)}` : '', c.note ? oneLine(c.note) : '']
    .filter(Boolean)
    .join(' · ')
  return [`#${c.seq}`, truncate(oneLine(c.title), 60), extra]
}

export function formatBoardList(r: BoardListResult): string {
  const lines: string[] = []
  if (r.cards.length === 0) {
    lines.push('Nenhum cartão no quadro com esse filtro.')
  } else {
    for (const col of r.columns) {
      const cards = r.cards.filter((c) => c.column === col.id)
      if (cards.length === 0) continue
      lines.push(`${oneLine(col.name)} (${col.id}):`)
      lines.push(table(cards.map(cardLine), '  '))
    }
  }
  if (r.hiddenDone > 0) lines.push(`(${r.hiddenDone} concluído(s) oculto(s); veja com --all)`)
  lines.push(`Colunas: ${r.columns.map((c) => `${oneLine(c.name)} (${c.id})`).join(', ')}`)
  return lines.join('\n')
}

export function formatBoardShow(r: BoardShowResult): string {
  const lines = [`#${r.seq} ${q(r.title)} — coluna ${oneLine(r.columnName)}`]
  if (r.ticket) lines.push(`Chamado: ${oneLine(r.ticket)}`)
  if (r.assignee) lines.push(`Responsável: ${oneLine(r.assignee)}`)
  if (r.note) lines.push(`Nota: ${oneLine(r.note)} (leia com: ${CLI_NAME} note read ${oneLine(r.note)})`)
  lines.push(`Criado por ${oneLine(r.createdBy)} em ${oneLine(r.createdAt)}`)
  const desc = cleanBlock(r.description).trim()
  if (desc) lines.push('Descrição:', indentBlock(desc))
  if (r.log.length > 0) {
    lines.push('Histórico:')
    for (const l of r.log.slice(-15)) lines.push(`  ${oneLine(l.at.slice(0, 16).replace('T', ' '))}  ${oneLine(l.by)}: ${oneLine(l.text)}`)
  }
  return lines.join('\n')
}

export function formatBoardCard(verb: string, c: BoardCardSummary): string {
  return `Cartão #${c.seq} ${q(c.title)} ${verb} (coluna ${oneLine(c.columnName)}).`
}
