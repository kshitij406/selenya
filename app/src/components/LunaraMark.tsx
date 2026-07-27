import { useId } from 'react'
import '../styles/brand.css'

interface LunaraMarkProps {
  className?: string
  decorative?: boolean
  label?: string
  size?: number
}

// Eight phase dots around a ring, each filled to how full that phase
// actually is — matches the app-icon "Phase Ring" mark. PHASE_WIDTHS is the
// visible-crescent fraction of each dot's diameter (9.4), mirrored around
// the ring; the mirrored index 4 (the top/full-moon position) is drawn as a
// plain solid circle instead of a clip.
const RING_RADIUS = 21
const DOT_RADIUS = 4.7
const PHASE_WIDTHS = [0.95, 2.92, 4.7, 6.73]

/**
 * The canonical Selenya brand mark: a ring of moon phases, drawn once in
 * `currentColor` so it themes correctly wherever it's placed (the rose
 * brand button, dark cards, plain screens).
 *
 * Keep the geometry in sync with the app-icon artwork (Phase Ring) when
 * native launcher assets are regenerated.
 */
export function LunaraMark({
  className = '',
  decorative = false,
  label = 'Selenya',
  size = 32,
}: LunaraMarkProps) {
  const uid = useId()
  const clipId = (i: number) => `lunara-mark-phase-${uid}-${i}`

  return (
    <svg
      className={`lunara-crescent${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      focusable="false"
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : label}
    >
      <g transform="translate(32,32)">
        {[0, 45, 90, 135, 180, 225, 270, 315].map((angle, i) => {
          const mirrored = i <= 4 ? i : 8 - i
          const full = mirrored === 4
          const phase = full ? 0 : PHASE_WIDTHS[mirrored]
          return (
            <g key={angle} transform={`rotate(${angle}) translate(0,${-RING_RADIUS})`}>
              <circle r={DOT_RADIUS} fill="none" stroke="currentColor" strokeWidth={0.6} opacity={0.35} />
              {full ? (
                <circle r={DOT_RADIUS} fill="currentColor" />
              ) : (
                <>
                  <clipPath id={clipId(i)}>
                    <rect x={-DOT_RADIUS} y={-DOT_RADIUS} width={phase} height={DOT_RADIUS * 2} />
                  </clipPath>
                  <circle r={DOT_RADIUS} fill="currentColor" clipPath={`url(#${clipId(i)})`} />
                </>
              )}
            </g>
          )
        })}
        <circle r={3.3} fill="currentColor" />
      </g>
    </svg>
  )
}
