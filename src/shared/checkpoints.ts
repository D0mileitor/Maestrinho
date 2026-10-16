import { isAppFile } from './changes'

/**
 * Checkpoints: antes de cada turno de um agente, o app guarda o estado da pasta do repositório como um
 * commit numa referência própria (`refs/maestrinho/checkpoints/<instante>-<terminal>`), sem mexer no
 * índice, nas branches ou no histórico do usuário. Voltar a um checkpoint restaura os arquivos.
 */

export const CHECKPOINT_REF_PREFIX = 'refs/maestrinho/checkpoints/'
/** "Terminal" dos checkpoints de segurança gravados antes de uma restauração. */
export const SAFETY_TERMINAL = 'restauracao'

export interface Checkpoint {
  /** A referência (identifica o checkpoint). */
  id: string
  at: number
  terminalId: string
  /** Nome do terminal no momento do checkpoint. */
  name: string
  /** Gravado antes de voltar a outro checkpoint (permite desfazer a restauração). */
  safety: boolean
}

/** O que voltar a um checkpoint faz com os arquivos. */
export interface CheckpointPlan {
  /** Voltam ao conteúdo do checkpoint (mudaram ou foram apagados depois). */
  restore: string[]
  /** Foram criados depois do checkpoint: vão para a lixeira. */
  remove: string[]
}

export function checkpointRef(at: number, terminalId: string): string {
  return `${CHECKPOINT_REF_PREFIX}${String(Math.floor(at)).padStart(13, '0')}-${terminalId}`
}

export function checkpointSubject(name: string, safety: boolean): string {
  return safety ? 'Maestrinho: antes de voltar a um checkpoint' : `Maestrinho: antes do turno de ${name}`
}

/**
 * Saída de `git for-each-ref --format=%(refname)%00%(subject) refs/maestrinho/checkpoints/`, do mais
 * novo para o mais antigo. Linhas fora do formato são ignoradas.
 */
export function parseCheckpoints(out: string): Checkpoint[] {
  const list: Checkpoint[] = []
  for (const line of out.split('\n')) {
    const [ref, subject = ''] = line.replace(/\r$/, '').split('\0')
    if (!ref?.startsWith(CHECKPOINT_REF_PREFIX)) continue
    const m = /^(\d{13})-([A-Za-z0-9_-]{1,64})$/.exec(ref.slice(CHECKPOINT_REF_PREFIX.length))
    if (!m) continue
    const terminalId = m[2]!
    const safety = terminalId === SAFETY_TERMINAL
    const name = safety ? '' : (/^Maestrinho: antes do turno de (.+)$/.exec(subject)?.[1] ?? terminalId)
    list.push({ id: ref, at: Number(m[1]), terminalId, name, safety })
  }
  return list.sort((a, b) => b.at - a.at)
}

/** Checkpoints a apagar: além dos `keep` mais novos ou mais velhos que `maxAgeMs`. */
export function checkpointsToPrune(list: Checkpoint[], keep: number, maxAgeMs: number, now: number): string[] {
  return [...list]
    .sort((a, b) => b.at - a.at)
    .filter((c, i) => i >= keep || now - c.at > maxAgeMs)
    .map((c) => c.id)
}

/**
 * Plano de restauração a partir de `git diff --name-status -z --no-renames <checkpoint> <agora>`:
 * criado depois (A) sai; modificado ou apagado depois volta. Arquivos do próprio app nunca são tocados.
 */
export function checkpointPlan(nameStatusZ: string): CheckpointPlan {
  const parts = nameStatusZ.split('\0')
  const plan: CheckpointPlan = { restore: [], remove: [] }
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const status = parts[i]!.trim()
    const file = parts[i + 1]!
    if (!status || !file || isAppFile(file)) continue
    if (status.startsWith('A')) plan.remove.push(file)
    else if (/^[MDT]/.test(status)) plan.restore.push(file)
  }
  return plan
}
