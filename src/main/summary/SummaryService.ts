import type { ConfigStore } from '../store/ConfigStore'
import type { PtyManager } from '../pty/PtyManager'
import { log } from '../util/log'

/** Linhas da tela enviadas ao modelo (o texto é truncado para caber em modelos locais pequenos). */
const INPUT_LINES = 120
const MAX_INPUT_CHARS = 12_000
const TIMEOUT_MS = 45_000

const SYSTEM_PROMPT = [
  'Você resume a atividade de um agente de IA de programação a partir da tela do terminal dele.',
  'Responda em português do Brasil, em no máximo 3 frases curtas: o que o agente fez, o estado atual',
  '(terminou, está esperando aprovação, deu erro) e o próximo passo sugerido. Não invente nada que',
  'não esteja na tela.'
].join(' ')

export function isLocalEndpoint(url: string): boolean {
  try {
    const u = new URL(url)
    return ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(u.hostname)
  } catch {
    return false
  }
}

/**
 * Assistente de resumo opcional (desligado por padrão). Usa um endpoint compatível com a API de
 * chat da OpenAI configurado pelo usuário (ex.: Ollama/LM Studio local). Nenhum dado sai da máquina
 * a menos que o usuário configure um endpoint remoto (a interface avisa).
 */
export class SummaryService {
  private readonly inflight = new Map<string, Promise<string>>()

  constructor(
    private readonly deps: { config: ConfigStore; ptys: PtyManager }
  ) {}

  get enabled(): boolean {
    const s = this.deps.config.settings
    return s.summaryEnabled && s.summaryEndpoint.trim() !== '' && s.summaryModel.trim() !== ''
  }

  summarize(terminalId: string, name: string): Promise<string> {
    const existing = this.inflight.get(terminalId)
    if (existing) return existing
    const p = this.run(terminalId, name).finally(() => this.inflight.delete(terminalId))
    this.inflight.set(terminalId, p)
    return p
  }

  private async run(terminalId: string, name: string): Promise<string> {
    const s = this.deps.config.settings
    if (!this.enabled) throw new Error('o assistente de resumo está desligado (Configurações > Assistente de resumo)')
    let base: URL
    try {
      base = new URL(s.summaryEndpoint.replace(/\/+$/, '') + '/')
    } catch {
      throw new Error('endpoint do assistente inválido')
    }
    if (base.protocol !== 'http:' && base.protocol !== 'https:') throw new Error('o endpoint precisa ser http(s)')
    const screen = (this.deps.ptys.readText(terminalId, INPUT_LINES) ?? '').slice(-MAX_INPUT_CHARS)
    if (!screen.trim()) throw new Error('o terminal ainda não tem saída para resumir')

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const res = await fetch(new URL('chat/completions', base), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(s.summaryApiKey ? { Authorization: `Bearer ${s.summaryApiKey}` } : {})
        },
        body: JSON.stringify({
          model: s.summaryModel,
          temperature: 0.2,
          max_tokens: 300,
          stream: false,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: `Terminal "${name}". Últimas linhas da tela:\n\n${screen}` }
          ]
        }),
        signal: controller.signal
      })
      if (!res.ok) throw new Error(`o endpoint respondeu ${res.status}`)
      const json = (await res.json()) as { choices?: { message?: { content?: unknown } }[] }
      const content = json.choices?.[0]?.message?.content
      if (typeof content !== 'string' || !content.trim()) throw new Error('resposta vazia do modelo')
      // Remove blocos de "raciocínio" de modelos que os emitem.
      return content.replace(/<think>[\s\S]*?<\/think>/g, '').trim().slice(0, 1200)
    } catch (err) {
      const msg = err instanceof Error ? (err.name === 'AbortError' ? 'tempo esgotado' : err.message) : String(err)
      log.warn('resumo falhou', { error: msg.slice(0, 120) })
      throw new Error(`não foi possível resumir: ${msg}`, { cause: err })
    } finally {
      clearTimeout(timer)
    }
  }
}
