import { useCallback, useEffect, useRef, useState } from 'react'
import { posterFileName, templateById } from '../utils/poster'
import { renderWorkPoster, workBadge, workDateText } from '../utils/workPoster'

const PREVIEW_WIDTH = 600
const PREVIEW_HEIGHT = 800

export default function WorkDialog({ work, onClose, onDelete }) {
  const previewRef = useRef(null)
  const fullCanvasRef = useRef(null)
  const closeRef = useRef(null)
  const tokenRef = useRef(0)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const badge = workBadge(work)

  useEffect(() => {
    const token = ++tokenRef.current
    setReady(false)
    setError('')
    setNotice('')
    setConfirmDelete(false)
    const promise = (async () => {
      const canvas = await renderWorkPoster(work)
      if (token !== tokenRef.current) return
      fullCanvasRef.current = canvas
      const preview = previewRef.current
      if (preview) {
        const ctx = preview.getContext('2d')
        ctx.clearRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT)
        ctx.drawImage(canvas, 0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT)
      }
      setReady(true)
    })().catch((err) => {
      if (token !== tokenRef.current) return
      setError(err?.message ? String(err.message) : '海报绘制失败：请重试。')
    })
    return () => {
      tokenRef.current += 1
      void promise
    }
  }, [work])

  useEffect(() => {
    const previous = document.activeElement
    closeRef.current?.focus()
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      if (previous && typeof previous.focus === 'function') previous.focus()
    }
  }, [onClose])

  const handleDownload = useCallback(async () => {
    setNotice('')
    const canvas = fullCanvasRef.current
    if (!canvas) {
      setError('还没有可导出的预览：请等预览生成后再下载。')
      return
    }
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) {
      setError('导出失败：浏览器没能编码 PNG，请重试。')
      return
    }
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = posterFileName(work.title)
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1500)
    setNotice(`已重新导出 ${posterFileName(work.title)}（实际像素 1200×1600）`)
  }, [work.title])

  const handleDelete = useCallback(() => {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    onDelete?.(work.id)
  }, [confirmDelete, onDelete, work.id])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`作品大图：${work.title}`}
      className="fixed inset-0 z-50 overflow-y-auto bg-stage-void/85 p-4 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose?.()
      }}
    >
      <div className="mx-auto my-6 max-w-3xl rounded-card border border-rule bg-paper text-ink">
        <header className="flex items-start justify-between gap-3 border-b border-rule px-4 py-3">
          <div className="min-w-0">
            <h3 className="truncate font-display text-lg">{work.title}</h3>
            <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">
              {work.isExample ? '内置示例 · 只读' : '本地作品'} · {templateById(work.template).name} · {workDateText(work)}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-full border border-rule px-3 py-1 text-sm hover:border-ink focus-visible:outline-ink"
          >
            关闭
          </button>
        </header>

        <div className="grid gap-4 px-4 py-4 sm:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
          <canvas
            ref={previewRef}
            width={PREVIEW_WIDTH}
            height={PREVIEW_HEIGHT}
            role="img"
            aria-label="作品海报大图预览"
            className="aspect-[3/4] w-full rounded-card border border-rule bg-paper-shade"
          />
          <div className="min-w-0">
            <p className="text-sm font-semibold">{badge.name}</p>
            <p className="mt-1 text-xs leading-relaxed text-ink-muted">{badge.citation}</p>
            <p className="mt-3 text-xs text-ink-muted">飞手 · {work.pilot}</p>
            <p className="mt-1 text-xs text-ink-muted">{work.credit}</p>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!ready}
                onClick={handleDownload}
                className="rounded-full border border-ink bg-ink px-4 py-1.5 text-sm text-paper hover:bg-ink/85 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-45"
              >
                重新下载 PNG
              </button>
              {work.isExample ? null : (
                <button
                  type="button"
                  onClick={handleDelete}
                  className={
                    'rounded-full border px-4 py-1.5 text-sm focus-visible:outline-ink ' +
                    (confirmDelete
                      ? 'border-signal-danger bg-signal-danger/10 text-signal-danger'
                      : 'border-rule bg-paper-shade text-ink hover:border-signal-danger')
                  }
                >
                  {confirmDelete ? '确认删除（不可恢复）' : '删除'}
                </button>
              )}
              {confirmDelete ? (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="rounded-full border border-rule bg-paper-shade px-4 py-1.5 text-sm text-ink hover:border-ink focus-visible:outline-ink"
                >
                  取消
                </button>
              ) : null}
            </div>

            {confirmDelete ? (
              <p role="alert" className="mt-3 rounded-card border border-signal-danger/55 bg-signal-danger/10 px-3 py-2 text-xs leading-relaxed text-signal-danger">
                删除后不可恢复：这件作品的本地记录将被永久清除，无法找回。确认要继续吗？
              </p>
            ) : null}
            {work.isExample ? (
              <p className="mt-3 text-xs leading-relaxed text-ink-muted">
                内置示例只读：不写入本地存储、不可删除；可重新下载海报留作参考。
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="mt-3 rounded-card border border-signal-danger/55 bg-signal-danger/10 px-3 py-2 text-xs text-signal-danger">
                {error}
              </p>
            ) : null}
            {notice ? (
              <p role="status" className="mt-3 text-xs text-ink-muted">
                {notice}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}