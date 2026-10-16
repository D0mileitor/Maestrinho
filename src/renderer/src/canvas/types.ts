import type { Edge, Node } from '@xyflow/react'
import type { NoteNodeData, PortalNodeData, ShapeNodeData, TerminalNodeData } from '@shared/schemas'

export type TerminalRFNode = Node<{ node: TerminalNodeData }, 'terminal'>
export type NoteRFNode = Node<{ node: NoteNodeData }, 'note'>
export type PortalRFNode = Node<{ node: PortalNodeData }, 'portal'>
export type ShapeRFNode = Node<{ node: ShapeNodeData }, 'shape'>
export type AppRFNode = TerminalRFNode | NoteRFNode | PortalRFNode | ShapeRFNode

export type ConnectionRFEdge = Edge<Record<string, never>, 'connection'>

export const HEADER_H = 30
