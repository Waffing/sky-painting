import { useEffect, useRef, useState } from 'react'
import { posterDateText } from '../utils/poster'
import { PROJECTOR_THUMB } from '../utils/projector'
import { renderWorkPoster, workBadge } from '../utils/workPoster'

// 修订 5：缓存只存 360×480 级轻量缩略图；1200×1600 大 canvas 仅瞬时存在、用完即弃，绝不入 Map。
const thumbCache = new Map()

const SCULPTURE_FOR_THUMB = { width: 980, height: 628 }

export default function WorkCard({ work, selectable = false, selected = false, onToggleSelect, onOpen }) {
  const rootRef = useRef(null)
  const canvasRef = useRef(null)
  const [ready, setReady] = useState(() => thumbCache.has(work.id))
  const badge = workBadge(work)

  useEffect(() => {
    const root = rootRef.current
    const canvas = canvasRef.current
    if (!root || !canvas) return undefined
    let cancelled = false

    const paint = (thumb) => {
      const ctx = canvas.getContext('2d')
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(thumb, 0, 0, canvas.width, canvas.height)
      setReady(true)
    }

    const load = async () => {
      const cached = thumbCache.get(work.id)
      if (cached) {
        paint(cached)
        return
      }
      try {
        const full = await renderWorkPoster(work, { sculptureSize: SCULPTURE_FOR_THUMB })
        if (cancelled) return
        const thumb = document.createElement('canvas')
        thumb.width = PROJECTOR_THUMB.width
        thumb.height = PROJECTOR_THUMB.height
        thumb.getContext('2d').drawImage(full, 0, 0, thumb.width, thumb.height)
        thumbCache.set(work.id, thumb)
        paint(thumb)
      } catch {
        if (!cancelled) setReady(false)
      }
    }

    if (thumbCache.has(work.id)) {
      paint(thumbCache.get(work.id))
      return undefined
    }

    // 懒渲染：进入视口才画；画完即解除观察，10+ 卡片不卡顿。
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect()
          load()
        }
      },
      { threshold: 0.1 },
    )
    observer.observe(root)
    return () => {
      cancelled = true
      observer.disconnect()
    }
  }, [work])

  return (
    <li
      ref={rootRef}
      data-thumb={ready ? 'ready' : 'pending'}
      data-example={work.isExample ? 'true' : 'false'}
      className="relative rounded-card border border-rule bg-paper-shade p-3"
    >
      {work.isExample ? (
        <span className="absolute right-4 top-4 z-10 rounded-full border border-trace-gold bg-stage-void/85 px-2 py-0.5 font-mono text-[10px] tracking-[0.14em] text-trace-gold">
          示例
        </span>
      ) : null}

      {selectable ? (
        <label className="absolute left-4 top-4 z-10 flex items-center gap-1.5 rounded-full border border-rule bg-paper/90 px-2 py-1 text-[11px] text-ink">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect?.(work.id)}
            className="h-3.5 w-3.5 accent-ink"
            aria-label={`选择《${work.title}》加入拼墙`}
          />
          拼墙
        </label>
      ) : null}

      <button
        type="button"
        onClick={() => onOpen?.(work)}
        className="block w-full text-left focus-visible:outline-ink"
        aria-label={`打开《${work.title}》大图`}
      >
        <canvas
          ref={canvasRef}
          width={PROJECTOR_THUMB.width}
          height={PROJECTOR_THUMB.height}
          role="img"
          aria-label={`《${work.title}》缩略海报`}
          className="aspect-[3/4] w-full rounded-card border border-rule bg-paper"
        />
        <p className="mt-2.5 truncate font-display text-sm text-ink">{work.title}</p>
        <p className="mt-1 flex items-baseline justify-between gap-2 text-[11px] text-ink-muted">
          <span className="truncate">{badge.name}</span>
          <span className="shrink-0 font-mono">{posterDateText(new Date(work.createdAt))}</span>
        </p>
      </button>
    </li>
  )
}