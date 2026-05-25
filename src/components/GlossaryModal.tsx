import { useEffect, useRef } from 'preact/hooks'
import { useFocusTrap } from './useFocusTrap'

// Cepheus / legacy 2d6 vocabulary reference. Opened from the panel header,
// dismissed by Escape, backdrop click, or close button. Definitions are
// concise enough to scan; the goal is "non-legacy 2d6 reader stops being
// confused", not "complete rules reference".

interface GlossaryModalProps {
  open: boolean
  onClose: () => void
}

interface GlossaryEntry {
  term: string
  defn: string
}

const ENTRIES: readonly GlossaryEntry[] = [
  {
    term: 'UWP',
    defn: 'Universal World Profile. A single line that captures a world in seven digits and a starport letter, eg. A867974-D.',
  },
  {
    term: 'Starport',
    defn: 'Quality of the orbital and ground facilities. A is excellent (shipyard, refined fuel), E is a frontier landing area, X is none.',
  },
  {
    term: 'Size',
    defn: 'Planetary diameter in thousands of miles. 8 is roughly Earth-sized; 0 is asteroid-belt scale.',
  },
  {
    term: 'Atmosphere',
    defn: 'Density and breathability. 0 = none, 6 = standard breathable, A+ = exotic, corrosive, or insidious.',
  },
  {
    term: 'Hydrographics',
    defn: 'Surface water coverage in tenths. 0 = desert, 7 = Earth-like, A = ocean world.',
  },
  {
    term: 'Population',
    defn: 'Order of magnitude of inhabitants. 7 = ten million, 9 = billion, C (12) = trillions.',
  },
  {
    term: 'Government',
    defn: 'Style of ruling authority - corporate, balkanised, theocracy, charismatic dictator, etc.',
  },
  {
    term: 'Law level',
    defn: 'How restrictive the local laws are, particularly around weapons. 0 = none, F (15) = oppressive.',
  },
  {
    term: 'Tech level',
    defn: 'Highest technology routinely available. 7 = late 20th century, A (10) = early interstellar, F+ = advanced jump tech.',
  },
  {
    term: 'Trade codes',
    defn: 'Two-letter labels derived from the UWP that flag commerce niches and hazards - Ag (agricultural), Hi (high-pop), Va (vacuum), and so on.',
  },
  {
    term: 'Habitable zone',
    defn: 'Orbital band where stellar flux can keep liquid water on a rocky surface. Narrows for cool stars, widens for hot ones.',
  },
  {
    term: 'Snow line',
    defn: 'Distance from the star beyond which water condenses as ice during planet formation - gas giants tend to live just outside it.',
  },
  {
    term: 'Main world',
    defn: 'The most settled or significant body in a system; what the UWP describes. Marked with main world marker in the planet table.',
  },
  {
    term: 'Bases',
    defn: 'Per-hex installations. Naval (military fleet), Scout (courier service courier base), Research (lab outpost), Aid (pilots Aid Society lounge).',
  },
  {
    term: 'Travel zone',
    defn: 'Per-hex safety advisory. Green is unmarked, Amber warns pilots off, Red is interdicted - typically a hot war or contagion.',
  },
  {
    term: 'Jump route',
    defn: 'A regular trade lane between two starports. Solid lines are jump-1 (one hex), dashed are jump-2 (two hexes) - long enough that only well-fitted ships can run them.',
  },
  {
    term: 'PBG',
    defn: 'Three-digit suffix on a Cepheus survey row: Population multiplier · Planetoid belts · Gas giants. Tells you what is fuelable on the way through.',
  },
]

export function GlossaryModal({ open, onClose }: GlossaryModalProps) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const modalRef = useRef<HTMLDivElement>(null)
  useFocusTrap(modalRef, open)

  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      class="glossary-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="glossary-title"
      onClick={onClose}
    >
      <div class="glossary-modal" ref={modalRef} onClick={(e) => e.stopPropagation()}>
        <header class="glossary-header">
          <h2 id="glossary-title">Glossary</h2>
          <button
            ref={closeRef}
            class="glossary-close"
            onClick={onClose}
            aria-label="Close glossary"
          >
            ✕
          </button>
        </header>
        <div class="glossary-body">
          <dl class="glossary-list">
            {ENTRIES.map((entry) => (
              <div class="glossary-entry" key={entry.term}>
                <dt>{entry.term}</dt>
                <dd>{entry.defn}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  )
}
