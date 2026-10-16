/** Ícones de traço em grade de 16px (desenhados para o app, sem dependência externa). */

type IconProps = { size?: number; className?: string; title?: string }

function Svg({ size = 16, className, title, children }: IconProps & { children: React.ReactNode }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  )
}

export const IconTerminal = (p: IconProps) => (
  <Svg {...p}>
    <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
    <path d="M4.5 6.5l2 1.5-2 1.5M8.5 10h3" />
  </Svg>
)
export const IconNote = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 1.5h6l3 3v10h-9z" />
    <path d="M9.5 1.5v3h3M5.5 8h5M5.5 10.5h5" />
  </Svg>
)
export const IconText = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 3.5h10M8 3.5v9.5M6 13h4" />
  </Svg>
)
export const IconRect = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2" y="3.5" width="12" height="9" rx="1" />
  </Svg>
)
export const IconArrow = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 13.5l10-10M7 3.5h5.5V9" />
  </Svg>
)
export const IconPencil = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 13.5l.8-3.2L11 2.6a1.4 1.4 0 012 0l.4.4a1.4 1.4 0 010 2L5.7 12.7z" />
    <path d="M9.8 3.8l2.4 2.4" />
  </Svg>
)
export const IconGlobe = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="6.2" />
    <path d="M1.8 8h12.4M8 1.8c1.8 2 1.8 10.4 0 12.4M8 1.8c-1.8 2-1.8 10.4 0 12.4" />
  </Svg>
)
export const IconChat = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 3.5h11v7.5h-6l-3 2.5v-2.5h-2z" />
    <path d="M5 6.5h6M5 8.8h4" />
  </Svg>
)
export const IconPointer = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 2.5l9 4.6-4 1.2-1.6 4.2z" />
  </Svg>
)
export const IconSearch = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.4 10.4l3.6 3.6" />
  </Svg>
)
/** Engrenagem de 8 dentes (ponta r=6,7, base r=5) com o furo no meio. */
export const IconGear = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.71 3.17L7.01 1.37L8.99 1.37L9.29 3.17L10.50 3.67L11.99 2.61L13.39 4.01L12.33 5.50L12.83 6.71L14.63 7.01L14.63 8.99L12.83 9.29L12.33 10.50L13.39 11.99L11.99 13.39L10.50 12.33L9.29 12.83L8.99 14.63L7.01 14.63L6.71 12.83L5.50 12.33L4.01 13.39L2.61 11.99L3.67 10.50L3.17 9.29L1.37 8.99L1.37 7.01L3.17 6.71L3.67 5.50L2.61 4.01L4.01 2.61L5.50 3.67Z" />
    <circle cx="8" cy="8" r="2.1" />
  </Svg>
)
export const IconSun = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="3" />
    <path d="M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M3 3l1.1 1.1M11.9 11.9L13 13M3 13l1.1-1.1M11.9 4.1L13 3" />
  </Svg>
)
export const IconMoon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M13.2 10.2A5.6 5.6 0 015.8 2.8a5.6 5.6 0 107.4 7.4z" />
  </Svg>
)
export const IconSidebar = (p: IconProps) => (
  <Svg {...p}>
    <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
    <path d="M6 2.5v11" />
  </Svg>
)
export const IconPlus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 3v10M3 8h10" />
  </Svg>
)
export const IconClose = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Svg>
)
export const IconRestart = (p: IconProps) => (
  <Svg {...p}>
    <path d="M13 8a5 5 0 11-1.6-3.7" />
    <path d="M13 2.5v3h-3" />
  </Svg>
)
export const IconMore = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="3.5" cy="8" r=".6" fill="currentColor" />
    <circle cx="8" cy="8" r=".6" fill="currentColor" />
    <circle cx="12.5" cy="8" r=".6" fill="currentColor" />
  </Svg>
)
export const IconFolder = (p: IconProps) => (
  <Svg {...p}>
    <path d="M1.5 4.5a1 1 0 011-1h3.2l1.5 1.5h6.3a1 1 0 011 1v6.5a1 1 0 01-1 1h-11a1 1 0 01-1-1z" />
  </Svg>
)
export const IconUsers = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="6" cy="5.5" r="2.3" />
    <path d="M1.8 13.5c.5-2.3 2.2-3.6 4.2-3.6s3.7 1.3 4.2 3.6" />
    <path d="M10.6 3.4a2.2 2.2 0 010 4.2M12 9.9c1.2.5 2 1.7 2.2 3.6" />
  </Svg>
)
export const IconClock = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="6.2" />
    <path d="M8 4.5V8l2.5 1.6" />
  </Svg>
)
export const IconLayers = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 2l6.5 3.4L8 8.8 1.5 5.4z" />
    <path d="M1.5 8.2L8 11.6l6.5-3.4M1.5 11L8 14.4l6.5-3.4" />
  </Svg>
)
export const IconScore = (p: IconProps) => (
  <Svg {...p}>
    <path d="M1.5 4h13M1.5 6.5h13M1.5 9h13M1.5 11.5h13" opacity={0.55} />
    <path d="M10.5 12V3.2l2.8 1" />
    <ellipse cx="9.2" cy="12.2" rx="1.6" ry="1.2" fill="currentColor" stroke="none" />
  </Svg>
)
export const IconActivity = (p: IconProps) => (
  <Svg {...p}>
    <path d="M1.5 8.5h3l2-5 3 9 2-4h3" />
  </Svg>
)
export const IconBot = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.5" y="5" width="11" height="8" rx="2" />
    <path d="M8 5V2.5M6 9h.01M10 9h.01M6.5 11.2h3" />
    <circle cx="8" cy="2.2" r="0.9" fill="currentColor" stroke="none" />
  </Svg>
)
export const IconGauge = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.2 11.5a5.8 5.8 0 0 1 11.6 0" />
    <path d="M8 11.5l2.6-3.4" />
    <circle cx="8" cy="11.5" r="1.1" fill="currentColor" stroke="none" />
  </Svg>
)
export const IconHub = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2" y="2" width="5" height="5" rx="1" />
    <rect x="9" y="2" width="5" height="5" rx="1" />
    <rect x="2" y="9" width="5" height="5" rx="1" />
    <path d="M11.5 9v5M9 11.5h5" />
  </Svg>
)
export const IconLink = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.6 9.4l2.8-2.8M5.4 7L3.8 8.6a2.4 2.4 0 003.4 3.4l1.6-1.6M10.6 9l1.6-1.6a2.4 2.4 0 00-3.4-3.4L7.2 5.6" />
  </Svg>
)
export const IconEye = (p: IconProps) => (
  <Svg {...p}>
    <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z" />
    <circle cx="8" cy="8" r="2" />
  </Svg>
)
export const IconEdit = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 13.5h11M4 10.5l7-7 2 2-7 7H4z" />
  </Svg>
)
export const IconBack = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 3L5 8l5 5" />
  </Svg>
)
export const IconForward = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 3l5 5-5 5" />
  </Svg>
)
export const IconCrown = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2 12.5h12M2.5 11l-1-6.5 3.8 3L8 3l2.7 4.5 3.8-3-1 6.5z" />
  </Svg>
)
export const IconBaton = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 13.5L12 4" strokeWidth={1.6} />
    <circle cx="13" cy="3" r="1.3" fill="currentColor" stroke="none" />
    <path d="M2 12l2 2" />
  </Svg>
)
export const IconSleep = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 9.5h4l-4 4h4M8.5 3.5h5l-5 5h5" />
  </Svg>
)
export const IconBoard = (p: IconProps) => (
  <Svg {...p}>
    <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
    <path d="M6 2.5v11M10.5 2.5v11M3 5h1.5M7.5 5h1.5M7.5 7.5h1.5M12 5h1" />
  </Svg>
)
export const IconDiff = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 1.5v6M1.5 4.5h6M8.5 11.5h6" />
    <rect x="1.5" y="9.5" width="5" height="5" rx="1" />
    <path d="M11.5 1.5v6" />
  </Svg>
)
export const IconExport = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 10V1.5M5 4.5l3-3 3 3M2.5 9.5v4h11v-4" />
  </Svg>
)
export const IconImport = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 1.5V10M5 7l3 3 3-3M2.5 9.5v4h11v-4" />
  </Svg>
)
export const IconPopOut = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9.5 2.5h4v4M13.5 2.5l-6 6M11.5 9.5v3.5a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5V5a.5.5 0 0 1 .5-.5h3.5" />
  </Svg>
)
export const IconDock = (p: IconProps) => (
  <Svg {...p}>
    <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
    <path d="M9.5 2.5v11M5.5 6l-2 2 2 2" />
  </Svg>
)
