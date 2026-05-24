import type { JSX } from 'preact'
import type { BodyType } from '../domain/system'

// Single icon kit for the panel — keep these simple geometric SVGs that use
// `currentColor` so they inherit chip/row color, and a 16x16 viewBox so they
// align with adjacent monospace digits.

type IconSize = 'sm' | 'md' | 'lg'
const SIZE_PX: Record<IconSize, number> = { sm: 12, md: 16, lg: 20 }

interface IconBaseProps {
  size?: IconSize
  title?: string
  class?: string
}

function svgProps({ size = 'md', title, class: cls }: IconBaseProps): JSX.SVGAttributes<SVGSVGElement> {
  const px = SIZE_PX[size]
  return {
    width: px,
    height: px,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 1.25,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    class: `icon ${cls ?? ''}`.trim(),
    role: title ? 'img' : 'presentation',
    'aria-label': title,
    'aria-hidden': title ? undefined : 'true',
  }
}

// --- Body type icons ---------------------------------------------------

export function BodyTypeIcon({ body, ...rest }: IconBaseProps & { body: BodyType }) {
  switch (body) {
    case 'GasGiant':
      return (
        <svg {...svgProps(rest)}>
          <circle cx="8" cy="8" r="6" />
          <path d="M2.5 6.5h11M2.2 9h11.6M3.5 11.5h9" />
        </svg>
      )
    case 'IceGiant':
      return (
        <svg {...svgProps(rest)}>
          <circle cx="8" cy="8" r="6" />
          <path d="M3 8h10M8 3v10M4.5 4.5l7 7M11.5 4.5l-7 7" stroke-width="0.9" />
        </svg>
      )
    case 'MiniNeptune':
      return (
        <svg {...svgProps(rest)}>
          <circle cx="8" cy="8" r="5" />
          <path d="M3.5 7h9M3.5 9h9" stroke-width="0.9" />
        </svg>
      )
    case 'SuperEarth':
      return (
        <svg {...svgProps(rest)}>
          <circle cx="8" cy="8" r="6" />
          <path d="M3 9q2.5-2 5 0t5 0" />
        </svg>
      )
    case 'Terrestrial':
      return (
        <svg {...svgProps(rest)}>
          <circle cx="8" cy="8" r="5" />
          <path d="M4 9q2-2 4 0t4 0" />
        </svg>
      )
    case 'Rocky':
      return (
        <svg {...svgProps(rest)}>
          <circle cx="8" cy="8" r="4.5" />
          <circle cx="6.5" cy="7.5" r="0.6" fill="currentColor" stroke="none" />
          <circle cx="9.5" cy="9" r="0.5" fill="currentColor" stroke="none" />
          <circle cx="8" cy="6" r="0.4" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'Frozen':
      return (
        <svg {...svgProps(rest)}>
          <circle cx="8" cy="8" r="4.5" />
          <path d="M8 4.5v7M5 6.5l6 3M5 9.5l6-3" stroke-width="0.9" />
        </svg>
      )
    case 'Inferno':
      return (
        <svg {...svgProps(rest)}>
          <circle cx="8" cy="8" r="4.5" />
          <path d="M5.5 7q1 2 2.5 1.5T11 6.5" />
          <path d="M5 10q1.5-1 3 0t3 0" />
        </svg>
      )
  }
}

export function bodyTypeLabel(body: BodyType): string {
  switch (body) {
    case 'GasGiant': return 'Gas giant'
    case 'IceGiant': return 'Ice giant'
    case 'MiniNeptune': return 'Mini-Neptune'
    case 'SuperEarth': return 'Super-Earth'
    case 'Terrestrial': return 'Terrestrial'
    case 'Rocky': return 'Rocky'
    case 'Frozen': return 'Frozen'
    case 'Inferno': return 'Inferno'
  }
}

// --- Starport icons ----------------------------------------------------
// Tower-and-pad silhouettes. A=excellent, X=ruin. The mark scales with
// quality: more pads/runways for better ports, a single rubble line for X.

export function StarportIcon({ code, ...rest }: IconBaseProps & { code: string }) {
  const props = svgProps(rest)
  switch (code) {
    case 'A':
      return (
        <svg {...props}>
          <path d="M3 12h10" />
          <path d="M5 12V5l3-2 3 2v7" />
          <path d="M8 12V8" />
          <circle cx="8" cy="3" r="0.7" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'B':
      return (
        <svg {...props}>
          <path d="M3 12h10" />
          <path d="M5.5 12V6l2.5-2 2.5 2v6" />
          <path d="M8 12V9" />
        </svg>
      )
    case 'C':
      return (
        <svg {...props}>
          <path d="M3 12h10" />
          <path d="M6 12V7h4v5" />
          <path d="M8 12V9.5" />
        </svg>
      )
    case 'D':
      return (
        <svg {...props}>
          <path d="M3 12h10" />
          <path d="M5 12v-3h6v3" />
        </svg>
      )
    case 'E':
      return (
        <svg {...props}>
          <path d="M2 12h12" stroke-dasharray="2 1.5" />
        </svg>
      )
    case 'X':
    default:
      return (
        <svg {...props}>
          <path d="M3 12h10" />
          <path d="M4 12l3-4M9 8l-1.5 4M9 9l1.5 3M11 9l-1 3" stroke-width="0.8" />
        </svg>
      )
  }
}

export function starportLabel(code: string): string {
  switch (code) {
    case 'A': return 'Class A — Excellent (shipyard, refined fuel)'
    case 'B': return 'Class B — Good (shipyard for small craft, refined fuel)'
    case 'C': return 'Class C — Routine (unrefined fuel, minor repairs)'
    case 'D': return 'Class D — Poor (unrefined fuel only)'
    case 'E': return 'Class E — Frontier (landing area, no facilities)'
    case 'X': return 'No starport (interdicted or unsurveyed)'
    default: return 'Starport'
  }
}
