import { useMemo, useState } from 'react'
import { fontChoice, installedFonts, OTHER_FONT } from '../lib/fonts'
import { settingsText as S } from '../i18n/settings'
import { hint } from '../hints/hint'

/**
 * Fonte da interface: lista com a padrão, as fontes sugeridas que estão instaladas e "Outra fonte…",
 * que abre um campo para digitar qualquer nome. A lista mostra todas as opções sempre (um <datalist>
 * filtraria pelo texto já escrito).
 */
export function UiFontField({ value, onChange }: { value: string; onChange(value: string): void }): React.JSX.Element {
  const listed = useMemo(() => installedFonts(S.uiFontSuggestions), [])
  const [typing, setTyping] = useState(false)
  const choice = typing ? OTHER_FONT : fontChoice(value, listed)
  return (
    <label className="field" {...hint('dialogo.config.fonteInterface')}>
      <span>{S.uiFont}</span>
      <select
        className="select"
        value={choice}
        onChange={(e) => {
          const v = e.target.value
          setTyping(v === OTHER_FONT)
          if (v !== OTHER_FONT) onChange(v)
        }}
      >
        <option value="">{S.uiFontDefault}</option>
        {listed.map((f) => (
          <option key={f} value={f} style={{ fontFamily: `"${f}"` }}>
            {f}
          </option>
        ))}
        <option value={OTHER_FONT}>{S.uiFontOther}</option>
      </select>
      {choice === OTHER_FONT && (
        <input
          className="input"
          value={value}
          placeholder={S.uiFontOtherPlaceholder}
          spellCheck={false}
          autoFocus={typing}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  )
}
