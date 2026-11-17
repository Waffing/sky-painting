import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CAPTURE_SIZE,
  TEMPLATES,
  posterDateText,
  posterFileName,
  readTemplateColors,
  renderPoster,
  templateById,
} from '../utils/poster'
import { listWorks, saveWork } from '../utils/storage'

const PREVIEW_WIDTH = 600
const PREVIEW_HEIGHT = 800
const DEFAULT_PILOT = '无名飞手'
const DEFAULT_CREDIT = '天上掉下一幅画 · 无人机飞行轨迹艺术'

const FIELD_CLASS =
  'mt-1.5 w-full min-w-0 rounded-card border border-rule bg-paper-shade px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus-visible:outline-ink'

export default function PosterPanel({ stageRef, result, badge, title, sourceKind, drawMode, onSaved, onGoGallery }) {
  const previewRef = useRef(null)
  const lastCanvasRef = useRef(null)
  const renderTokenRef = useRef(0)
  const renderPromiseRef = useRef(Promise.resolve())

  const [templateId, setTemplateId] = useState('clear')
  const [useCurrentAngle, setUseCurrentAngle] = useState(false)
  const [pilot, setPilot] = useState(DEFAULT_PILOT)
  const [credit, setCredit] = useState(DEFAULT_CREDIT)
  const [shot, setShot] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saved, setSaved] = useState(false)

  // 快照缓存失效只认三个时机：切轨迹、切视角开关、舞台交互防抖 300ms（见下方监听）。
  useEffect(() => {
    setShot(null)
  }, [result])
  useEffect(() => {
    setShot(null)
  }, [useCurrentAngle])

  useEffect(() => {
    const shell = document.querySelector('.stage-shell')
    if (!shell) return undefined
    let timer = 0
    const bump = () => {
      if (!useCurrentAngle || drawMode) return
      clearTimeout(timer)
      timer = setTimeout(() => setShot(null), 300)
    }
    shell.addEventListener('pointerup', bump)
    shell.addEventListener('wheel', bump, { passive: true })
    return () => {
      clearTimeout(timer)
      shell.removeEventListener('pointerup', bump)
      shell.removeEventListener('wheel', bump)
    }
  }, [useCurrentAngle, drawMode])

  useEffect(() => {
    const token = ++renderTokenRef.current
    setBusy(true)
    const promise = (async () => {
      if (!result || !badge) {
        lastCanvasRef.current = null
        previewRef.current?.getContext('2d').clearRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT)
        return
      }
      let url = shot && shot.key === result ? shot.url : null
      if (!url) {
        // 手绘期间冻结快照：绝不把画板状态截进海报。
        if (drawMode) {
          setError('手绘进行中：快照已冻结，完成或取消手绘后自动取图生成预览。')
          return
        }
        const captured = stageRef.current?.captureStagePng({
          width: CAPTURE_SIZE.width,
          height: CAPTURE_SIZE.height,
          useCurrentAngle,
        })
        if (!captured || !captured.dataUrl) {
          setError('舞台尚未就绪或 WebGL 不可用：取不到雕塑快照，海报暂不能生成。')
          return
        }
        setShot({ key: result, url: captured.dataUrl })
        return
      }
      const colors = readTemplateColors(templateId)
      const canvas = await renderPoster({
        title,
        badge,
        stats: result.stats,
        colors,
        pilot,
        credit,
        dateText: posterDateText(),
        stagePngUrl: url,
      })
      // 过期渲染直接丢弃，不许倒灌预览。
      if (token !== renderTokenRef.current) return
      lastCanvasRef.current = canvas
      const preview = previewRef.current
      if (preview) {
        const ctx = preview.getContext('2d')
        ctx.clearRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT)
        ctx.drawImage(canvas, 0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT)
      }
      setError('')
    })()
      .catch((err) => {
        if (token !== renderTokenRef.current) return
        setError(err?.message ? String(err.message) : '海报绘制失败：请重试。')
      })
      .finally(() => {
        if (token === renderTokenRef.current) setBusy(false)
      })
    renderPromiseRef.current = promise
  }, [result, badge, title, templateId, useCurrentAngle, pilot, credit, shot, drawMode, stageRef])

  const handleDownload = useCallback(async () => {
    setNotice('')
    // 渲染进行中则等当前帧落定；若期间又有新帧启动，继续等，保证与预览逐像素同源。
    let pending = renderPromiseRef.current
    await pending
    while (pending !== renderPromiseRef.current) {
      pending = renderPromiseRef.current
      await pending
    }
    const canvas = lastCanvasRef.current
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
    anchor.download = posterFileName(title)
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1500)
    setNotice(`已导出 ${posterFileName(title)}（实际像素 1200×1600）`)
  }, [title])

  const handleSave = useCallback(() => {
    if (!result || !badge) return
    setNotice('')
    const record = saveWork({
      title,
      pilot,
      credit,
      template: templateId,
      badgeId: badge.id,
      stats: result.stats,
      bounds: result.bounds,
      points: result.points,
      sourceKind,
    })
    if (!record.ok) {
      setError(record.error)
      return
    }
    setError('')
    setSaved(true)
    onSaved?.()
    const listed = listWorks()
    const count = listed.ok ? listed.works.length : 0
    setNotice(`已存入画廊：第 ${count} 件 · 本件约 ${(record.bytes / 1024).toFixed(1)} KB · 画廊共 ${(listed.bytes / 1024).toFixed(1)} KB`)
  }, [result, badge, title, pilot, credit, templateId, sourceKind, onSaved])

  const template = templateById(templateId)
  const ready = Boolean(result && badge)

  return (
    <section aria-label="海报工坊" className="rounded-card border border-rule bg-paper text-ink">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-rule px-4 py-2.5">
        <h3 className="font-display text-sm">海报工坊</h3>
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">
          1200×1600 · 预览与下载同源同版
        </p>
      </header>

      <div className="grid gap-5 px-4 py-4 md:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] md:gap-6">
        <div className="min-w-0">
          <canvas
            ref={previewRef}
            width={PREVIEW_WIDTH}
            height={PREVIEW_HEIGHT}
            role="img"
            aria-label="海报实时预览"
            className="aspect-[3/4] w-full rounded-card border border-rule bg-paper-shade"
          />
          <p className="mt-2 font-mono text-[10px] tracking-[0.14em] text-ink-muted">
            {template.name} · {useCurrentAngle ? '当前旋转角度' : '固定 45° 视角'} · {busy ? '绘制中…' : '预览就绪'}
          </p>
        </div>

        <div className="min-w-0 md:border-l md:border-rule md:pl-6">
          <div role="group" aria-label="海报模板" className="flex flex-wrap gap-1.5">
            {TEMPLATES.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={item.id === templateId}
                onClick={() => setTemplateId(item.id)}
                className={`rounded-full border px-3 py-1.5 text-sm transition-colors focus-visible:outline-ink ${
                  item.id === templateId
                    ? 'border-ink bg-ink text-paper'
                    : 'border-rule bg-paper-shade text-ink hover:border-ink-muted'
                }`}
              >
                {item.name}
              </button>
            ))}
          </div>

          <label className="mt-3 flex items-center gap-2 text-xs text-ink-muted">
            <input
              type="checkbox"
              checked={useCurrentAngle}
              onChange={(event) => setUseCurrentAngle(event.target.checked)}
              className="h-3.5 w-3.5 accent-ink focus-visible:outline-ink"
            />
            使用我当前旋转的角度
          </label>

          <label htmlFor="poster-pilot-input" className="mt-3 block text-xs text-ink-muted">
            飞手署名
          </label>
          <input
            id="poster-pilot-input"
            type="text"
            maxLength={16}
            value={pilot}
            onChange={(event) => setPilot(event.target.value)}
            placeholder={DEFAULT_PILOT}
            className={FIELD_CLASS}
          />

          <label htmlFor="poster-credit-input" className="mt-3 block text-xs text-ink-muted">
            底部落款
          </label>
          <input
            id="poster-credit-input"
            type="text"
            maxLength={40}
            value={credit}
            onChange={(event) => setCredit(event.target.value)}
            placeholder={DEFAULT_CREDIT}
            className={FIELD_CLASS}
          />

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!ready}
              onClick={handleDownload}
              className="rounded-full border border-ink bg-ink px-4 py-1.5 text-sm text-paper transition-colors hover:bg-ink/85 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-45"
            >
              下载海报 PNG
            </button>
            <button
              type="button"
              disabled={!ready}
              onClick={handleSave}
              className="rounded-full border border-rule bg-paper-shade px-4 py-1.5 text-sm text-ink transition-colors hover:border-ink focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-45"
            >
              存入画廊
            </button>
          </div>

          {error ? (
            <p role="alert" className="mt-3 rounded-card border border-signal-danger/55 bg-signal-danger/10 px-3 py-2 text-xs leading-relaxed text-signal-danger">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p role="status" className="mt-3 text-xs leading-relaxed text-ink-muted">
              {notice}
            </p>
          ) : null}
          {saved && onGoGallery ? (
            <button
              type="button"
              onClick={onGoGallery}
              className="mt-2 rounded-full border border-ink bg-paper-shade px-4 py-1.5 text-sm text-ink transition-colors hover:border-ink hover:bg-ink hover:text-paper focus-visible:outline-ink"
            >
              去画廊看看 →
            </button>
          ) : null}
        </div>
      </div>
    </section>
  )
}