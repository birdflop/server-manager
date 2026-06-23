import { useId, type ReactElement } from 'react'
import { BIRDFLOP_LOGO_PATH, BIRDFLOP_LOGO_TRANSFORM, BIRDFLOP_LOGO_VIEWBOX } from '@shared/logo'

/** The Birdflop brand mark (cyan→indigo gradient bird). */
export function BirdflopLogo({
  size = 32,
  className
}: {
  size?: number
  className?: string
}): ReactElement {
  const gid = useId()
  return (
    <svg
      width={size}
      height={size}
      viewBox={BIRDFLOP_LOGO_VIEWBOX}
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Birdflop"
    >
      <defs>
        <linearGradient id={gid} x1="0.5" x2="0.5" y2="1" gradientUnits="objectBoundingBox">
          <stop offset="0" stopColor="#54daf4" />
          <stop offset="1" stopColor="#545eb6" />
        </linearGradient>
      </defs>
      <path d={BIRDFLOP_LOGO_PATH} transform={BIRDFLOP_LOGO_TRANSFORM} fill={`url(#${gid})`} />
    </svg>
  )
}
