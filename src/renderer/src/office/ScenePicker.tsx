import { useEffect, useState } from 'react'
import { BACKGROUND_PREFIX, OfficeSceneIdSchema, type OfficeSceneId, type OfficeSceneRef } from '@shared/schemas'
import { useApp } from '../store/appStore'
import { api, errorMessage } from '../lib/api'
import { t } from '../i18n'
import { hint } from '../hints/hint'

const O = t.office

/** Nome de um cenário para a interface (pronto ou imagem do usuário). */
export function sceneLabel(ref: OfficeSceneRef): string {
  if (ref.startsWith(BACKGROUND_PREFIX)) return ref.slice(BACKGROUND_PREFIX.length).replace(/\.\w+$/, '')
  return O.scenes[ref as OfficeSceneId] ?? ref
}

// Imagens já carregadas (data URL → <img>), por workspace e arquivo.
const images = new Map<string, Promise<HTMLImageElement>>()

function loadImage(dir: string, file: string): Promise<HTMLImageElement> {
  const key = `${dir}\n${file}`
  let p = images.get(key)
  if (!p) {
    p = api.invoke('office:readBackground', { dir, file }).then(
      (url) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image()
          img.onload = () => resolve(img)
          img.onerror = () => reject(new Error('imagem inválida'))
          img.src = url
        })
    )
    p.catch(() => images.delete(key))
    images.set(key, p)
  }
  return p
}

/**
 * Cenário efetivo de um workspace: o cenário pronto a desenhar e, se for uma imagem do usuário, a
 * imagem carregada (enquanto carrega ou se falhar, fica o Escritório).
 */
export function useSceneryChoice(dir: string, ref: OfficeSceneRef): { id: OfficeSceneId; image: HTMLImageElement | null } {
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const file = ref.startsWith(BACKGROUND_PREFIX) ? ref.slice(BACKGROUND_PREFIX.length) : null
  const toast = useApp((s) => s.toast)
  useEffect(() => {
    setImage(null)
    if (!file || !dir) return
    let alive = true
    loadImage(dir, file)
      .then((img) => alive && setImage(img))
      .catch(() => alive && toast('error', O.backgroundError))
    return () => {
      alive = false
    }
  }, [dir, file, toast])
  const builtin = OfficeSceneIdSchema.safeParse(ref)
  return { id: builtin.success ? builtin.data : 'escritorio', image: file ? image : null }
}

interface Props {
  dir: string
  /** Escolha deste workspace (ausente = padrão das configurações). */
  own: OfficeSceneRef | undefined
  fallback: OfficeSceneId
  open: boolean
  setOpen: (v: boolean) => void
}

/** Botão "Cenário" do escritório: cenários prontos, imagens do projeto e envio de imagem nova. */
export function ScenePicker({ dir, own, fallback, open, setOpen }: Props): React.JSX.Element {
  const applyOps = useApp((s) => s.applyOps)
  const toast = useApp((s) => s.toast)
  const [files, setFiles] = useState<string[]>([])
  const current = own ?? fallback

  useEffect(() => {
    if (!open) return
    void api
      .invoke('office:backgrounds', { dir })
      .then((list) => setFiles(list.map((b) => b.file)))
      .catch(() => setFiles([]))
  }, [open, dir])

  const choose = (scene: OfficeSceneRef | null): void => {
    setOpen(false)
    void applyOps([{ op: 'setOfficeScene', scene }])
  }

  const upload = async (): Promise<void> => {
    try {
      const file = await api.invoke('office:addBackground', { dir })
      if (!file) return
      toast('info', O.backgroundAdded(file))
      choose(`${BACKGROUND_PREFIX}${file}`)
    } catch (err) {
      toast('error', errorMessage(err))
    }
  }

  const remove = async (file: string): Promise<void> => {
    try {
      await api.invoke('office:removeBackground', { dir, file })
      images.delete(`${dir}\n${file}`)
      setFiles((f) => f.filter((x) => x !== file))
    } catch (err) {
      toast('error', errorMessage(err))
    }
  }

  return (
    <div className="office-scenes" onClick={(e) => e.stopPropagation()}>
      <button type="button" className="office-scene-btn" {...hint('escritorio.cenario')} aria-expanded={open} onClick={() => setOpen(!open)}>
        {O.scene}: {sceneLabel(current)}
      </button>
      {open && (
        <div className="office-menu office-scene-menu" role="menu">
          {OfficeSceneIdSchema.options.map((id) => (
            <button key={id} type="button" role="menuitemradio" aria-checked={id === current} {...hint('escritorio.cenario.opcao')} onClick={() => choose(id)}>
              <span className={`office-scene-swatch s-${id}`} aria-hidden="true" />
              {O.scenes[id]}
            </button>
          ))}
          {files.length > 0 && <span className="office-menu-label">{O.yourBackgrounds}</span>}
          {files.map((file) => {
            const ref = `${BACKGROUND_PREFIX}${file}` as OfficeSceneRef
            return (
              <div key={file} className="office-scene-file">
                <button type="button" role="menuitemradio" aria-checked={ref === current} {...hint('escritorio.cenario.opcao')} onClick={() => choose(ref)}>
                  <span className="office-scene-swatch s-image" aria-hidden="true" />
                  {sceneLabel(ref)}
                </button>
                <button type="button" className="office-scene-del" {...hint('escritorio.cenario.apagar')} aria-label={O.removeBackground(file)} onClick={() => void remove(file)}>
                  ×
                </button>
              </div>
            )
          })}
          <button type="button" role="menuitem" className="office-scene-upload" {...hint('escritorio.cenario.enviar')} onClick={() => void upload()}>
            {O.uploadBackground}
          </button>
          {own !== undefined && (
            <button type="button" role="menuitem" className="office-scene-default" {...hint('escritorio.cenario.padrao')} onClick={() => choose(null)}>
              {O.sceneDefault(sceneLabel(fallback))}
            </button>
          )}
          <span className="office-menu-hint">{O.uploadHint}</span>
        </div>
      )}
    </div>
  )
}
