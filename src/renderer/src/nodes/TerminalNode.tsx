import { memo, useCallback, useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import { TerminalNameSchema } from '@shared/schemas'
import { agentFamily, effectiveModelEffort } from '@shared/agentModels'
import { useApp } from '../store/appStore'
import { useSettledZoom } from '../canvas/bridge'
import { HEADER_H, type TerminalRFNode } from '../canvas/types'
import { TerminalHost } from '../terminal/TerminalHost'
import { NodeFrame } from './NodeFrame'
import { EditableName } from './EditableName'
import { TerminalMenu } from './TerminalMenu'
import { IconChat, IconClose, IconCrown, IconRestart, IconSleep } from '../lib/icons'
import { api, errorMessage } from '../lib/api'
import { t } from '../i18n'
import { useUi } from '../store/uiStore'
import { useChat } from '../store/chatStore'
import { hint, hintOf, type HintAttrs } from '../hints/hint'
import type { HintText } from '../hints/content'
import { hintText, type HintKey } from '../i18n/hints'

type DotState = 'starting' | 'busy' | 'idle' | 'attention' | 'off' | 'error' | 'sleeping'

const DOT_HINT: Record<DotState, HintKey> = {
  starting: 'no.terminal.estado.starting',
  busy: 'no.terminal.estado.busy',
  idle: 'no.terminal.estado.idle',
  attention: 'no.terminal.estado.attention',
  off: 'no.terminal.estado.off',
  error: 'no.terminal.estado.error',
  sleeping: 'no.terminal.estado.sleeping'
}

/** Hint com título variável (nome, selo, agente) e a explicação do registro. */
function hintWith(key: HintKey, title: string, detail?: string): HintAttrs {
  const h: HintText = hintText[key]
  return hintOf({ title, body: [detail, h.body].filter(Boolean).join('\n') })
}

function TerminalNodeImpl({ id, data, selected, width, height }: NodeProps<TerminalRFNode>): React.JSX.Element {
  const node = data.node
  const info = useApp((s) => s.runtime[id])
  const attention = useApp((s) => Boolean(s.attention[id]))
  const preset = useApp((s) => s.config?.presets.find((p) => p.id === node.presetId))
  const role = useApp((s) => (node.roleId ? s.config?.roles.find((r) => r.id === node.roleId) : undefined))
  const recruiter = useApp((s) =>
    node.recruitedBy ? s.active?.doc.nodes.find((n) => n.id === node.recruitedBy) : undefined
  )
  const names = useApp((s) => s.active?.doc.nodes)
  const updateNode = useApp((s) => s.updateNode)
  const confirmRemove = useApp((s) => s.confirmRemoveNodes)
  const setFocused = useApp((s) => s.setFocusedTerminal)
  const toast = useApp((s) => s.toast)
  const zoom = useSettledZoom((s) => s.zoom)
  const renameRequest = useUi((s) => (s.renameRequest?.id === id ? s.renameRequest.at : undefined))
  const jumpBadge = useUi((s) => (s.showJumpBadges ? s.jumpOrder.indexOf(id) : -1))
  const linkedToChat = useChat((s) => s.open && s.tab === id)

  const me = preset ? effectiveModelEffort(node, role, agentFamily(preset)) : null
  const modelInfo = [me?.model, me?.effort].filter(Boolean).join(' · ')

  const w = width ?? node.size.w
  const h = height ?? node.size.h

  let dot: DotState
  if (node.hibernated) dot = 'sleeping'
  else if (!info || info.status === 'starting') dot = 'starting'
  else if (info.status === 'error') dot = 'error'
  else if (info.status === 'exited') dot = 'off'
  else if (info.activity === 'busy') dot = 'busy'
  else if (attention) dot = 'attention'
  else dot = 'idle'
  const dotLabel = {
    starting: t.terminal.status.starting,
    busy: t.terminal.status.busy,
    idle: t.terminal.status.idle,
    attention: t.terminal.status.attention,
    off: t.terminal.status.exited,
    error: t.terminal.status.error,
    sleeping: t.hibernate.status
  }[dot]

  const validateName = useCallback(
    (v: string): string | null => {
      const parsed = TerminalNameSchema.safeParse(v)
      if (!parsed.success) return parsed.error.issues[0]?.message ?? 'nome inválido'
      const taken = (names ?? []).some(
        (n) => n.kind === 'terminal' && n.id !== id && n.name.toLowerCase() === v.toLowerCase()
      )
      return taken ? 'já existe um terminal com esse nome' : null
    },
    [names, id]
  )

  const [waking, setWaking] = useState(false)
  const wake = (): void => {
    setWaking(true)
    void api
      .invoke('pty:wake', { id })
      .catch((err) => toast('error', errorMessage(err)))
      .finally(() => setWaking(false))
  }

  const restart = (): void => {
    void api.invoke('pty:restart', { id }).catch((err) => toast('error', errorMessage(err)))
  }

  const header = (
    <>
      <span className={`status-dot ${dot}`} {...hint(DOT_HINT[dot])} aria-label={dotLabel} />
      {jumpBadge >= 0 && jumpBadge < 9 && <span className="jump-badge">{jumpBadge + 1}</span>}
      <EditableName
        value={node.name}
        hintAttrs={hint('no.terminal.nome')}
        validate={validateName}
        onCommit={(name) => updateNode(id, { name })}
        editRequest={renameRequest}
      />
      {node.manager && (
        <span className="chip chip-manager" {...hint('no.terminal.gerente')}>
          <IconCrown size={12} />
          {t.terminal.manager}
        </span>
      )}
      {role && (
        <span
          className="chip chip-role"
          style={role.color ? ({ '--chip': role.color } as React.CSSProperties) : undefined}
          {...hintWith('no.terminal.papel', `${hintText['no.terminal.papel'].title}: ${role.name}`)}
        >
          {role.name}
        </span>
      )}
      <span className="node-sub" {...hintWith('no.terminal.agente', preset?.label ?? node.presetId, modelInfo)}>
        {preset?.label ?? node.presetId}
        {modelInfo && ` · ${modelInfo}`}
      </span>
      {linkedToChat && (
        <span className="chip chip-chat" {...hint('no.terminal.chat')}>
          <IconChat size={12} />
          chat
        </span>
      )}
      {info?.badge && (
        <span className="chip chip-badge" {...hintWith('no.terminal.selo', info.badge)}>
          {info.badge}
        </span>
      )}
      {recruiter && recruiter.kind === 'terminal' && (
        <span className="node-sub" {...hintWith('no.terminal.recrutado', t.terminal.recruitedBy(recruiter.name))}>
          ← {recruiter.name}
        </span>
      )}
      <span className="node-header-spacer" />
      <TerminalMenu id={id} name={node.name} />
      <button className="icon-btn nodrag" {...hint('no.terminal.reiniciar')} aria-label={t.terminal.restart} onClick={restart}>
        <IconRestart size={14} />
      </button>
      <button
        className="icon-btn danger nodrag"
        {...hint('no.terminal.fechar')}
        aria-label={t.terminal.close}
        onClick={() => confirmRemove([id])}
      >
        <IconClose size={14} />
      </button>
    </>
  )

  const bodyW = Math.max(40, w - 2)
  const bodyH = Math.max(40, h - HEADER_H - 2)
  const ended = !node.hibernated && info && (info.status === 'exited' || info.status === 'error')

  return (
    <NodeFrame
      id={id}
      kind="terminal"
      selected={selected}
      minWidth={280}
      minHeight={160}
      header={header}
      className={`${dot === 'attention' ? 'has-attention' : ''}${dot === 'busy' ? ' is-busy' : ''}`}
    >
      {node.hibernated ? (
        <div className="term-viewport term-sleeping nodrag" style={{ width: bodyW, height: bodyH }}>
          <IconSleep size={28} />
          <strong>{t.hibernate.title}</strong>
          <span>{t.hibernate.body}</span>
          <button className="btn btn-primary" {...hint('no.terminal.acordar')} disabled={waking} onClick={wake}>
            {waking ? t.hibernate.waking : t.hibernate.wake}
          </button>
        </div>
      ) : (
        <TerminalHost
          id={id}
          width={bodyW}
          height={bodyH}
          onFocusChange={(focused) => {
            if (focused) setFocused(id)
            else if (useApp.getState().focusedTerminal === id) setFocused(null)
          }}
        />
      )}
      {ended && (
        <div className="term-ended nodrag">
          <span>{info.status === 'error' ? (info.error ?? t.terminal.status.error) : t.terminal.exitedWith(info.exitCode ?? 0)}</span>
          <button className="btn" {...hint('no.terminal.reiniciar')} onClick={restart}>
            <IconRestart size={13} /> {t.terminal.restartAction}
          </button>
        </div>
      )}
      {zoom < 0.4 && (
        <div className="term-lowzoom">
          <span>{node.name}</span>
        </div>
      )}
    </NodeFrame>
  )
}

export const TerminalNode = memo(TerminalNodeImpl)
