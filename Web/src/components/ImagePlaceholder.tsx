'use client'

/**
 * Stands in for real photography until the restaurant supplies it.
 * Pass `src` once a photo exists and this renders it instead — every
 * call site stays the same.
 */
export default function ImagePlaceholder({
  label,
  aspectRatio,
  src,
  alt,
  minHeight,
}: {
  label: string
  aspectRatio?: string
  src?: string
  alt?: string
  minHeight?: string
}) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={alt || label}
        style={{
          position: minHeight ? undefined : 'absolute',
          inset: minHeight ? undefined : 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          display: 'block',
        }}
      />
    )
  }

  return (
    <div
      aria-hidden="true"
      style={{
        position: minHeight ? 'relative' : 'absolute',
        inset: minHeight ? undefined : 0,
        minHeight,
        width: '100%',
        height: minHeight ? minHeight : '100%',
        aspectRatio,
        background:
          'repeating-linear-gradient(135deg, var(--gold-a12) 0px, var(--gold-a12) 1px, transparent 1px, transparent 14px), var(--bg-alt)',
        border: '1px solid var(--gold-a16)',
        display: 'flex',
        alignItems: 'flex-end',
        padding: '14px',
      }}
    >
      <span
        style={{
          fontFamily: "'Newsreader', serif",
          fontStyle: 'italic',
          fontSize: '12.5px',
          letterSpacing: '0.02em',
          color: 'var(--ink-a45)',
        }}
      >
        {label}
      </span>
    </div>
  )
}
