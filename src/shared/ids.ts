/** Geração de ids curtos (base36) usando crypto, disponível tanto no Node quanto no navegador. */
export function newId(prefix = ''): string {
  const bytes = new Uint8Array(10)
  globalThis.crypto.getRandomValues(bytes)
  let out = ''
  for (const b of bytes) out += (b % 36).toString(36)
  return prefix ? `${prefix}-${out}` : out
}

/** Gera um nome único (case-insensitive) a partir de uma base: "revisor", "revisor-2", ... */
export function uniqueName(base: string, taken: Iterable<string>): string {
  const set = new Set([...taken].map((t) => t.toLowerCase()))
  const clean = slugifyName(base) || 'terminal'
  if (!set.has(clean.toLowerCase())) return clean
  // O sufixo "-N" não pode estourar o limite de 40 caracteres do nome.
  const withSuffix = (suffix: string): string => `${clean.slice(0, 40 - suffix.length).replace(/[._-]+$/, '')}${suffix}`
  for (let i = 2; i < 10_000; i++) {
    const candidate = withSuffix(`-${i}`)
    if (!set.has(candidate.toLowerCase())) return candidate
  }
  return withSuffix(`-${newId().slice(0, 8)}`)
}

/** Normaliza um texto livre para um nome de terminal válido (sem espaços). */
export function slugifyName(input: string): string {
  return input
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}._-]/gu, '')
    .replace(/^[._-]+/, '')
    .slice(0, 40)
}
