import type { NodeTypes } from '@xyflow/react'
import { ShapeNode } from './ShapeNode'
import { NoteNode } from './NoteNode'
import { PortalNode } from './PortalNode'

/** Tipos de nó além do terminal (registrados no React Flow). */
export const nodeTypesExtra: NodeTypes = {
  shape: ShapeNode,
  note: NoteNode,
  portal: PortalNode
} as NodeTypes
