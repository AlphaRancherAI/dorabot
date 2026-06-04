/**
 * Animated jarvis mascot.
 * Uses a single APNG (animated PNG) with a 25s loop:
 * idle with blinks, think, sleep
 */

interface Props {
  size?: number
  className?: string
  onClick?: () => void
}

export function JarvisSprite({ size = 96, className = '', onClick }: Props) {
  const aspectRatio = 182 / 133
  const displayH = Math.round(size * aspectRatio)

  return (
    <img
      src="./sprites/jarvis.png"
      width={size}
      height={displayH}
      className={className}
      onClick={onClick}
      draggable={false}
      style={{
        width: size,
        height: displayH,
        imageRendering: 'pixelated',
        cursor: onClick ? 'pointer' : undefined,
        objectFit: 'contain',
      }}
    />
  )
}
