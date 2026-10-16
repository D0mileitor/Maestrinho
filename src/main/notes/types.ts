/**
 * Contrato do serviço de notas consumido pela API local (orq note ...) e pelo IPC.
 * `dir` é sempre a pasta do workspace (a raiz do projeto); `file` é relativo a
 * `<dir>/.maestrinho/notes` (ex.: "spec.md", "planos/sprint-1.md").
 */
export interface NoteEntry {
  file: string
  size: number
  mtimeMs: number
}

export interface NoteContent {
  content: string
  /** 16 primeiros caracteres hex do SHA-256 do conteúdo em UTF-8. */
  revision: string
}

export interface NotesApi {
  list(dir: string): Promise<NoteEntry[]>
  exists(dir: string, file: string): Promise<boolean>
  read(dir: string, file: string): Promise<NoteContent>
  /** Lança ApiError('precondition') se `ifRevision` não bater com o conteúdo atual. */
  write(dir: string, file: string, content: string, ifRevision?: string): Promise<{ revision: string }>
  append(dir: string, file: string, content: string): Promise<{ revision: string }>
  /** Cria a nota (nome único: "x.md", "x-2.md"...) e devolve o nome final. */
  create(dir: string, desired: string, content?: string): Promise<string>
}
