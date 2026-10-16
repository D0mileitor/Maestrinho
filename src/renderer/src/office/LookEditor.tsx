import { useEffect, useRef, useState } from 'react'
import { HAIR_COLORS, HAIR_STYLES, PANTS_COLORS, SHIRT_COLORS, SHOE_COLORS, SKIN_TONES, effectiveLook } from '@shared/office'
import type { Look } from '@shared/schemas'
import { sprite } from './sprites'
import { CustomCharacterPicker } from './CustomCharacterPicker'
import type { SpriteView } from './spriteData'
import { t } from '../i18n'
import { hint, hintOf } from '../hints/hint'
import { hintText } from '../i18n/hints'
import '../styles/office.css'

const L = t.look
type ColorKey = 'skin' | 'hair' | 'shirt' | 'pants' | 'shoes'
type AccKey = 'glasses' | 'headphones' | 'beard' | 'badge' | 'cap'
const ACCS: AccKey[] = ['glasses', 'headphones', 'beard', 'badge', 'cap']
const VIEWS: SpriteView[] = ['front', 'side', 'back', 'cheer']

interface Props {
  value: Look
  /** Cor do papel do terminal (camiseta, quando "usar a cor do papel"). */
  roleColor: string | undefined
  /** Semente do visual padrão (id do terminal). */
  seed: string
  onChange(look: Look): void
}

/** Aparência do personagem no escritório: prévia animada e escolhas de pele, cabelo, roupas e acessórios. */
export function LookEditor({ value, roleColor, seed, onChange }: Props): React.JSX.Element {
  const [view, setView] = useState<SpriteView>('front')
  const [walking, setWalking] = useState(true)
  const canvas = useRef<HTMLCanvasElement>(null)
  const shown = effectiveLook(value, seed, roleColor)
  const shownRef = useRef(shown)
  shownRef.current = shown

  useEffect(() => {
    const g = canvas.current?.getContext('2d')
    if (!g) return
    let raf = 0
    const start = performance.now()
    const draw = (now: number): void => {
      const time = (now - start) / 1000
      const moving = walking && view !== 'cheer'
      const frame = moving ? Math.floor(time * 8) % 4 : 0
      const cheer = view === 'cheer' && Math.floor(time * 3) % 2 === 1
      g.clearRect(0, 0, 32, 44)
      g.fillStyle = 'rgba(0,0,0,0.3)'
      g.beginPath()
      g.ellipse(16, 41, 8, 2, 0, 0, Math.PI * 2)
      g.fill()
      const bob = moving && frame % 2 === 1 ? 1 : 0
      const img = sprite(shownRef.current, view === 'cheer' ? (cheer ? 'cheer' : 'front') : view, view === 'cheer' ? 0 : frame, !moving && !cheer && Math.floor(time * 1.6) % 2 === 1, time % 3.2 < 0.14)
      g.drawImage(img, 8, 9 - bob - (cheer ? 2 : 0))
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [view, walking])

  const set = (patch: Partial<Look>): void => onChange({ ...value, ...patch })
  const randomize = (): void => {
    const pick = <T,>(l: readonly T[]): T => l[Math.floor(Math.random() * l.length)]!
    onChange({
      skin: pick(SKIN_TONES),
      hair: pick(HAIR_COLORS),
      hairStyle: pick(HAIR_STYLES),
      shirtFromRole: Math.random() < 0.5,
      shirt: pick(SHIRT_COLORS),
      pants: pick(PANTS_COLORS),
      shoes: pick(SHOE_COLORS),
      glasses: Math.random() < 0.35,
      headphones: Math.random() < 0.3,
      beard: Math.random() < 0.2,
      badge: Math.random() < 0.4,
      cap: Math.random() < 0.15
    })
  }

  const colorRow = (key: ColorKey, label: string, list: string[]): React.JSX.Element => {
    const current = key === 'shirt' ? shown.shirt : value[key]
    const lockedToRole = key === 'shirt' && value.shirtFromRole
    return (
      <div className="look-row">
        {list.map((c, i) => (
          <button
            key={c}
            type="button"
            className="look-sw"
            style={{ '--c': c } as React.CSSProperties}
            aria-label={L.option(label, i + 1)}
            {...hintOf({ title: L.option(label, i + 1), body: hintText['escritorio.aparencia.cor'].body })}
            aria-pressed={!lockedToRole && current.toLowerCase() === c.toLowerCase()}
            onClick={() => set(key === 'shirt' ? { shirt: c, shirtFromRole: false } : ({ [key]: c } as Partial<Look>))}
          />
        ))}
        <label className="look-custom" {...hint('escritorio.aparencia.outraCor')}>
          <input
            type="color"
            value={current}
            aria-label={L.otherColor(label)}
            onChange={(e) => set(key === 'shirt' ? { shirt: e.target.value, shirtFromRole: false } : ({ [key]: e.target.value } as Partial<Look>))}
          />
          {L.other}
        </label>
      </div>
    )
  }

  return (
    <div className="look-editor">
      <div className="look-preview">
        <div className="look-stage">
          <canvas ref={canvas} width={32} height={44} aria-label={L.preview} />
        </div>
        <div className="look-views" role="group" aria-label={L.preview}>
          {VIEWS.map((v) => (
            <button key={v} type="button" className="btn" aria-pressed={view === v} {...hint('escritorio.aparencia.vista')} onClick={() => setView(v)}>
              {L.views[v]}
            </button>
          ))}
        </div>
        <label className="check" {...hint('escritorio.aparencia.andando')}>
          <input type="checkbox" checked={walking} onChange={(e) => setWalking(e.target.checked)} />
          <span>{L.walking}</span>
        </label>
        <button type="button" className="btn" {...hint('escritorio.aparencia.sortear')} onClick={randomize}>
          {L.randomize}
        </button>
      </div>
      <div className="look-controls">
        <CustomCharacterPicker value={value.custom} onPick={(custom) => set({ custom })} />
        <div className="look-group">
          <b>{L.skin}</b>
          {colorRow('skin', L.skin, SKIN_TONES)}
        </div>
        <div className="look-group">
          <b>{L.hair}</b>
          <div className="look-row">
            {HAIR_STYLES.map((s) => (
              <button key={s} type="button" className="look-opt" aria-pressed={value.hairStyle === s} {...hint('escritorio.aparencia.penteado')} onClick={() => set({ hairStyle: s })}>
                {L.styles[s]}
              </button>
            ))}
          </div>
          {colorRow('hair', L.hair, HAIR_COLORS)}
        </div>
        <div className="look-group">
          <b>{L.shirt}</b>
          <label className="check" {...hint('escritorio.aparencia.camisetaPapel')}>
            <input type="checkbox" checked={value.shirtFromRole} onChange={(e) => set({ shirtFromRole: e.target.checked })} />
            <span>{L.shirtFromRole}</span>
          </label>
          {colorRow('shirt', L.shirt, SHIRT_COLORS)}
        </div>
        <div className="look-group">
          <b>{L.pants}</b>
          {colorRow('pants', L.pants, PANTS_COLORS)}
        </div>
        <div className="look-group">
          <b>{L.shoes}</b>
          {colorRow('shoes', L.shoes, SHOE_COLORS)}
        </div>
        <div className="look-group">
          <b>{L.monitors}</b>
          <div className="look-row">
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <button
                key={n}
                type="button"
                className="look-opt"
                aria-pressed={(value.monitors ?? 1) === n}
                {...hint('escritorio.aparencia.monitores')}
                onClick={() => set({ monitors: n })}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
        <div className="look-group">
          <b>{L.accessories}</b>
          <div className="look-row">
            {ACCS.map((k) => (
              <button key={k} type="button" className="look-opt" aria-pressed={value[k]} {...hint('escritorio.aparencia.acessorio')} onClick={() => set({ [k]: !value[k] } as Partial<Look>)}>
                {L.acc[k]}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
