import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import type { IdleTransition } from '@shared/idle'
import type { AgentPreset, TerminalNodeData, WorkspaceDoc } from '@shared/schemas'
import type { PtyManager } from '../pty/PtyManager'
import type { ConfigStore } from '../store/ConfigStore'
import { log } from '../util/log'
import { AgentsMdManager } from './agentsMd'
import { BriefingQueue, DEFAULT_BRIEFING_TIMEOUTS, type BriefingTimeouts } from './briefing'
import { ClaudeSkillManager } from './claudeSkill'
import {
  buildAgentsMdSection,
  buildFirstMessage,
  buildInstructions,
  buildRolePrompt,
  buildSkillBody,
  skillDescription,
  type FirstMessageReference,
  type InstructionsInput
} from './text'

/**
 * Como cada agente aprende quem é, seu papel, suas conexões e o CLI, conforme o
 * `instructionsTarget` do preset:
 *  - claude-system-prompt: briefing completo no argumento {instructions} (system prompt);
 *  - claude-skill: skill em .claude/skills/<cli>/SKILL.md + papel/identidade em {instructions};
 *  - agents-md: seção genérica no AGENTS.md + primeira mensagem se houver papel ou modo gerente;
 *  - first-message: briefing completo como primeira mensagem quando o agente fica pronto;
 *  - none: nada.
 * Se o arquivo não puder ser preparado (ou o preset não tiver {instructions}), cai para a primeira
 * mensagem com a referência completa, para o agente nunca ficar sem saber usar o CLI.
 * Presets de shell nunca recebem briefing por mensagem (o texto seria executado como comandos).
 */

export interface InstructionsDeps {
  config: Pick<ConfigStore, 'role' | 'presets' | 'roles'>
  /** Diretório (em userData) dos registros que permitem limpar arquivos após um crash. */
  registryDir: string
  workspaceOf(nodeId: string): { doc: WorkspaceDoc } | undefined
  ptys: Pick<PtyManager, 'inject' | 'info' | 'readText'>
  /** Padrão: process.platform (no Windows os exemplos incluem PowerShell). */
  platform?: NodeJS.Platform
  briefingTimeouts?: BriefingTimeouts
}

export interface InstructionsService {
  /** Texto do placeholder {instructions} dos args do preset. */
  instructionsFor(node: TerminalNodeData, preset: AgentPreset): string
  /** Antes de iniciar o processo: arquivos no diretório de trabalho e/ou briefing agendado. */
  /** `resuming`: o agente retomou uma conversa (o briefing só vai de novo se o papel/conexões mudaram). */
  prepare(node: TerminalNodeData, preset: AgentPreset, cwd: string, resuming?: boolean): void
  /** Depois de encerrar o processo: desfaz o que `prepare` criou. */
  cleanup(node: TerminalNodeData, cwd: string): void
  /** Ligar ao evento 'activity' do PtyManager (entrega o briefing na primeira ociosidade). */
  handleActivity(terminalId: string, t: IdleTransition): void
  /** No início do app, antes de iniciar terminais: limpa o que uma sessão anterior deixou. */
  cleanupOrphans(): void
}

/** Terminais e notas conectados ao nó (arestas valem nos dois sentidos). */
export function peersOf(doc: WorkspaceDoc, nodeId: string): InstructionsInput['peers'] {
  const ids = new Set<string>()
  for (const e of doc.edges) {
    if (e.source === nodeId) ids.add(e.target)
    else if (e.target === nodeId) ids.add(e.source)
  }
  const terminals: string[] = []
  const notes: string[] = []
  for (const n of doc.nodes) {
    if (!ids.has(n.id)) continue
    if (n.kind === 'terminal') terminals.push(n.name)
    else if (n.kind === 'note') notes.push(n.file)
  }
  return { terminals, notes }
}

function hasPlaceholder(preset: AgentPreset): boolean {
  return preset.args.some((a) => a.includes('{instructions}'))
}

export function createInstructions(deps: InstructionsDeps): InstructionsService {
  const windows = (deps.platform ?? process.platform) === 'win32'
  const agentsMd = new AgentsMdManager(path.join(deps.registryDir, 'agents-md.json'))
  const skills = new ClaudeSkillManager(path.join(deps.registryDir, 'claude-skills.json'))
  const briefings = new BriefingQueue(
    {
      inject: (id, text, opts) => deps.ptys.inject(id, text, opts),
      isRunning: (id) => deps.ptys.info(id)?.status === 'running',
      screen: (id) => deps.ptys.readText(id, 30) ?? ''
    },
    deps.briefingTimeouts ?? DEFAULT_BRIEFING_TIMEOUTS
  )

  const inputFor = (node: TerminalNodeData): InstructionsInput => {
    const doc = deps.workspaceOf(node.id)?.doc
    const role = node.roleId ? deps.config.role(node.roleId) : undefined
    const floor = node.floorId ? doc?.floors.find((f) => f.id === node.floorId) : undefined
    return {
      name: node.name,
      role: role ? { name: role.name, instructions: role.instructions } : undefined,
      manager: Boolean(node.manager),
      presets: deps.config.presets.map((p) => ({ id: p.id, label: p.label })),
      roles: deps.config.roles.map((r) => ({ name: r.name })),
      peers: doc ? peersOf(doc, node.id) : { terminals: [], notes: [] },
      workspaceName: doc?.name ?? '',
      floor: floor ? { name: floor.name, branch: floor.branch } : undefined,
      windows
    }
  }

  // Último briefing entregue a cada terminal (só a impressão digital do texto, nunca o conteúdo).
  const briefedFile = path.join(deps.registryDir, 'briefings.json')
  let briefed: Record<string, string> = {}
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(briefedFile, 'utf8'))
    if (raw && typeof raw === 'object') briefed = Object.fromEntries(Object.entries(raw).filter((e): e is [string, string] => typeof e[1] === 'string'))
  } catch {
    // ainda não existe
  }
  const rememberBriefing = (id: string, key: string): void => {
    briefed[id] = key
    try {
      fs.mkdirSync(path.dirname(briefedFile), { recursive: true })
      fs.writeFileSync(briefedFile, JSON.stringify(briefed))
    } catch {
      // sem registro: na próxima retomada o briefing vai de novo (inofensivo)
    }
  }

  const queueBriefing = (node: TerminalNodeData, preset: AgentPreset, reference: FirstMessageReference, resuming = false): void => {
    if (preset.isShell) {
      log.info('briefing por mensagem ignorado: o preset é um shell', { id: node.id, preset: preset.id })
      return
    }
    const text = buildFirstMessage(inputFor(node), { reference })
    const key = createHash('sha256').update(text).digest('hex').slice(0, 16)
    // Conversa retomada que já recebeu este mesmo briefing: não repete. Se o papel ou as conexões
    // mudaram, o texto muda e o briefing vai de novo.
    if (resuming && briefed[node.id] === key) {
      log.info('briefing já entregue nesta conversa; não repete', { id: node.id })
      return
    }
    briefings.queue(
      node.id,
      text,
      { inputMode: preset.inputMode, submitDelayMs: preset.submitDelayMs, isShell: preset.isShell },
      () => rememberBriefing(node.id, key)
    )
  }

  return {
    instructionsFor(node, preset) {
      switch (preset.instructionsTarget) {
        case 'none':
          return ''
        case 'claude-skill':
          return buildRolePrompt(inputFor(node))
        default:
          return buildInstructions(inputFor(node))
      }
    },

    prepare(node, preset, cwd, resuming = false) {
      // Um briefing pendente de um início anterior nunca deve ir para o processo novo.
      briefings.cancel(node.id)
      // O arquivo (AGENTS.md/skill) é genérico: papel e modo gerente só chegam pela mensagem.
      const role = node.roleId ? deps.config.role(node.roleId) : undefined
      const needsBriefing = Boolean(role) || Boolean(node.manager)
      switch (preset.instructionsTarget) {
        case 'claude-system-prompt':
          if (!hasPlaceholder(preset)) queueBriefing(node, preset, 'full', resuming)
          break
        case 'claude-skill': {
          const ok = skills.acquire(cwd, node.id, skillDescription(), buildSkillBody({ windows }))
          if (!ok) queueBriefing(node, preset, 'full', resuming)
          else if (!hasPlaceholder(preset) && needsBriefing) queueBriefing(node, preset, 'skill', resuming)
          break
        }
        case 'agents-md': {
          const ok = agentsMd.acquire(cwd, node.id, buildAgentsMdSection({ windows }))
          if (!ok) queueBriefing(node, preset, 'full', resuming)
          else if (needsBriefing) queueBriefing(node, preset, 'agents-md', resuming)
          break
        }
        case 'first-message':
          queueBriefing(node, preset, 'full', resuming)
          break
        case 'none':
          break
      }
    },

    cleanup(node, cwd) {
      briefings.cancel(node.id)
      agentsMd.release(cwd, node.id)
      skills.release(cwd, node.id)
    },

    handleActivity(terminalId, t) {
      briefings.handleActivity(terminalId, t)
    },

    cleanupOrphans() {
      agentsMd.cleanupOrphans()
      skills.cleanupOrphans()
    }
  }
}
