import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, it } from 'vitest'
import { detectPendingChoice } from '../src/shared/chat'

/**
 * Telas REAIS das perguntas (Claude Code 2.1.296 e Codex 0.162.1), capturadas num terminal igual ao do app
 * (node-pty + @xterm/headless, lidas linha a linha até a largura) em 74x22 (nó padrão do canvas) e 56x18.
 * Se uma versão nova mudar o desenho, estes testes avisam.
 */
const DIR = path.join(__dirname, 'fixtures', 'perguntas')
const tela = (nome: string): string => fs.readFileSync(path.join(DIR, nome), 'utf8')

const ESPERADO: Record<string, { question: string; labels: string[]; cursor?: number; multi?: boolean; progress?: string }> = {
  'claude-confianca': {
    question: 'Quick safety check: Is this a project you created or one you trust?',
    labels: ['No, exit', 'Yes, I trust this folder'],
    cursor: 0
  },
  'claude-plano': {
    question: 'Claude has written up a plan and is ready to execute. Would you like to proceed?',
    labels: ['Yes, and use auto mode', 'Yes, manually approve edits', 'Tell Claude what to change']
  },
  'claude-ask-q1': {
    question: 'A busca deve aceitar o CPF com e sem pontuação, ou só os 11 dígitos sem nenhum separador?',
    labels: ['Aceitar os dois formatos (Recomendado)', 'Só números', 'Type something.', 'Chat about this'],
    progress: '☐ Formato · ☐ Validação · ✔ Submit'
  },
  'claude-ask-q2-multi': {
    question: 'Quais campos devem ser validados antes de salvar?',
    labels: ['CPF', 'Nome completo', 'Data de nascimento', 'Type something', 'Submit', 'Chat about this'],
    multi: true
  },
  'claude-ask-preview': {
    question: 'Qual layout usar na tela de busca?',
    labels: ['Lista simples', 'Grade de cartões', 'Tabela com filtros']
  },
  'codex-aprovacao': {
    question: 'Would you like to run the following command?',
    labels: ['Yes, proceed (y)', "Yes, and don't ask again for commands that start with `git init` (p)", 'No, and tell Codex what to do differently (esc)'],
    cursor: 0
  },
  'codex-menu-permissoes': {
    question: 'Update Model Permissions',
    labels: ['Ask for approval', 'Approve for me', 'Full Access', 'Read Only (current)']
  }
}

describe('telas reais de perguntas', () => {
  for (const [nome, esperado] of Object.entries(ESPERADO)) {
    for (const tamanho of ['74x22', '56x18']) {
      it(`${nome} (${tamanho})`, () => {
        const c = detectPendingChoice(tela(`${nome}-${tamanho}.txt`))
        expect(c).not.toBeNull()
        expect(c!.question).toBe(esperado.question)
        // lista rolada (tela baixa): as primeiras opções podem ter subido para fora da tela
        expect(esperado.labels.slice(-c!.options.length)).toEqual(c!.options.map((o) => o.label))
        expect(c!.cursorKnown).toBe(true)
        if (esperado.cursor !== undefined) expect(c!.cursor).toBe(esperado.cursor)
        if (esperado.multi) expect(c!.multi).toBe(true)
        if (esperado.progress) expect(c!.progress).toBe(esperado.progress)
        // nada de moldura, painel de prévia ou duas opções grudadas no rótulo
        for (const o of c!.options) expect(o.label).not.toMatch(/[│┌└├┐┘]|\s{3,}|\d\.\s/)
      })
    }
  }
})
