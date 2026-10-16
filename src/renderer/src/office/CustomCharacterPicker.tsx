import { useEffect, useState } from 'react'
import { SHEET_COLS, SHEET_VIEWS, characterPrompt } from '@shared/characterSheet'
import { defaultLook } from '@shared/office'
import { useApp } from '../store/appStore'
import { api, errorMessage } from '../lib/api'
import { invalidateCharacters } from './customSprites'
import { sprite } from './sprites'
import { lookCustomText as C } from '../i18n/lookCustom'
import { hint } from '../hints/hint'

/** Folha-modelo 64×160 (o formato exato), preenchida com um personagem desenhado de exemplo. */
function templateDataUrl(): string {
  const c = document.createElement('canvas')
  c.width = 16 * SHEET_COLS
  c.height = 32 * SHEET_VIEWS.length
  const g = c.getContext('2d')!
  const look = defaultLook('modelo')
  SHEET_VIEWS.forEach((view, row) => {
    const frames = view === 'sit' ? [0, 1] : view === 'cheer' ? [0] : [0, 1, 2, 3]
    for (const f of frames) g.drawImage(sprite(look, view, f, false, false), f * 16, row * 32)
  })
  return c.toDataURL('image/png')
}

/**
 * Personagem próprio do terminal: uma folha de sprites importada para o workspace (dá para pedir a um
 * agente que desenhe, com o modelo e as instruções daqui).
 */
export function CustomCharacterPicker({ value, onPick }: { value: string | undefined; onPick(file: string | undefined): void }): React.JSX.Element {
  const dir = useApp((s) => s.active?.dir ?? '')
  const toast = useApp((s) => s.toast)
  const [files, setFiles] = useState<string[]>([])
  const [description, setDescription] = useState('')

  const reload = (): void => {
    if (!dir) return
    void api
      .invoke('office:characters', { dir })
      .then((list) => setFiles(list.map((c) => c.file)))
      .catch(() => setFiles([]))
  }
  // Recarrega ao trocar de workspace.
  useEffect(reload, [dir])

  const importOne = async (): Promise<void> => {
    try {
      const file = await api.invoke('office:addCharacter', { dir })
      if (!file) return
      invalidateCharacters()
      reload()
      onPick(file)
      toast('info', C.imported(file))
    } catch (err) {
      toast('error', errorMessage(err))
    }
  }

  const saveTemplate = async (): Promise<void> => {
    try {
      const saved = await api.invoke('office:saveCharacterTemplate', { dataUrl: templateDataUrl() })
      if (saved) toast('info', C.templateSaved(saved))
    } catch (err) {
      toast('error', errorMessage(err))
    }
  }

  const copyPrompt = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(characterPrompt(description.trim()))
      toast('info', C.copied)
    } catch {
      toast('error', C.copyFailed)
    }
  }

  return (
    <div className="look-group look-own">
      <b>{C.title}</b>
      <div className="look-row">
        <select className="select" value={value ?? ''} {...hint('escritorio.aparencia.proprio')} onChange={(e) => onPick(e.target.value || undefined)}>
          <option value="">{C.none}</option>
          {files.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <button type="button" className="btn" disabled={!dir} {...hint('escritorio.aparencia.importar')} onClick={() => void importOne()}>
          {C.import}
        </button>
      </div>
      {value && <small className="muted">{C.overrides}</small>}
      <details className="look-own-help">
        <summary>{C.howTo}</summary>
        <p>{C.format}</p>
        <input className="input" value={description} placeholder={C.describe} onChange={(e) => setDescription(e.target.value)} />
        <div className="look-row">
          <button type="button" className="btn" {...hint('escritorio.aparencia.modelo')} onClick={() => void saveTemplate()}>
            {C.saveTemplate}
          </button>
          <button type="button" className="btn" {...hint('escritorio.aparencia.instrucoes')} onClick={() => void copyPrompt()}>
            {C.copyPrompt}
          </button>
        </div>
      </details>
    </div>
  )
}
