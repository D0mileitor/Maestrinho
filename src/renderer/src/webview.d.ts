import type { DetailedHTMLProps, HTMLAttributes } from 'react'

/** Tag <webview> do Electron (usada pelos portais). */
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      webview: DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string
        partition?: string
        useragent?: string
        allowpopups?: string
      }
    }
  }
}

export {}
