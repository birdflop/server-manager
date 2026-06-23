import type { ReactElement } from 'react'

/**
 * A tiny inline area/line chart. Scales `data` to [0, max] (or the data peak
 * when max is omitted) and fills the full SVG viewBox; the parent sizes it.
 */
export function Sparkline({
  data,
  max,
  color = 'var(--c-accent)',
  height = 40
}: {
  data: number[]
  max?: number
  color?: string
  height?: number
}): ReactElement {
  const W = 100
  const H = 100
  const peak = Math.max(max ?? 0, ...data, 1)
  const n = data.length

  let path = ''
  if (n === 1) {
    const y = H - (data[0] / peak) * H
    path = `M0,${y} L${W},${y}`
  } else if (n > 1) {
    path = data
      .map((v, i) => {
        const x = (i / (n - 1)) * W
        const y = H - (v / peak) * H
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`
      })
      .join(' ')
  }
  const area = path ? `${path} L${W},${H} L0,${H} Z` : ''

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="w-full"
      style={{ height }}
      role="img"
    >
      {area && <path d={area} fill={color} fillOpacity={0.12} />}
      {path && (
        <path
          d={path}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  )
}
