import { describe, expect, it } from 'vitest'
import type { ConfigStore } from '../store/ConfigStore'
import type { WorkspaceManager } from '../store/WorkspaceManager'
import { SearchService } from './SearchService'

const ws = {
  dir: 'C:/proj',
  notesDir: 'C:/proj/.maestrinho/notes',
  doc: {
    name: 'proj',
    floors: [],
    nodes: [{ id: 't1', kind: 'terminal', name: 'construtor', presetId: 'claude', floorId: undefined }]
  }
}
const workspaces = { all: () => [ws], active: ws, list: () => [] } as unknown as WorkspaceManager
const config = { presets: [], roles: [] } as unknown as ConfigStore

describe('busca: saída dos terminais', () => {
  it('trechos da saída a partir de 3 letras, com o terminal e a linha', async () => {
    const queries: string[] = []
    const svc = new SearchService({
      workspaces,
      config,
      searchOutput: (q) => {
        queries.push(q)
        return [
          { id: 't1', text: 'Erro: o CPF 123 não passou na validação do formulário de cadastro', line: 840 },
          { id: 'sumiu', text: 'cpf de um terminal fechado', line: 3 }
        ]
      }
    })
    const r = (await svc.query('cpf')).filter((x) => x.kind === 'output')
    expect(r).toEqual([
      {
        kind: 'output',
        id: 't1#840',
        terminalId: 't1',
        line: 840,
        label: 'construtor',
        detail: expect.stringContaining('CPF 123'),
        dir: 'C:/proj',
        floorId: undefined,
        score: expect.any(Number)
      }
    ])
    expect(await svc.query('cp')).toEqual([])
    expect(queries).toEqual(['cpf'])
  })
})
