import { useCallback, useEffect, useMemo, useState } from 'react'
import WorkCard from '../components/WorkCard'
import WorkDialog from '../components/WorkDialog'
import { SAMPLE_FLIGHTS, processSampleFlight } from '../utils/flightData'
import { makeNameCandidates } from '../utils/naming'
import { deleteWork, listWorks } from '../utils/storage'
import { WALL_MAX, WALL_MIN, renderWall, wallFileName } from '../utils/wall'

// 修订 1：预置 3 条示例依次配晴空 / 黄昏 / 夜航。
const EXAMPLE_TEMPLATES = ['clear', 'dusk', 'night']
const DEFAULT_PILOT = '无名飞手'
const DEFAULT_CREDIT = '天上掉下一幅画 · 无人机飞行轨迹艺术'

/** 内置示例：实时生成、只读、不写入 localStorage。 */
function buildExamples() {
  return SAMPLE_FLIGHTS.map((sample, index) => {
    const result = processSampleFlight(sample.id)
    const candidates = makeNameCandidates(result.stats, 0, [])
    return {
      id: `example-${sample.id}`,
      isExample: true,
      title: candidates[0],
      pilot: DEFAULT_PILOT,
      credit: DEFAULT_CREDIT,
      template: EXAMPLE_TEMPLATES[index % EXAMPLE_TEMPLATES.length],
      stats: result.stats,
      bounds: result.bounds,
      points: result.points,
      sourceKind: 'sample',
      createdAt: Date.now(),
    }
  })
}

export default function GalleryView({ worksVersion = 0, onWorksChanged }) {
  const [listed, setListed] = useState(() => listWorks())
  const [openWork, setOpenWork] = useState(null)
  const [wallMode, setWallMode] = useState(false)
  const [selected, setSelected] = useState([])
  const [wallTitle, setWallTitle] = useState('')
  const [wallNotice, setWallNotice] = useState('')
  const examples = useMemo(() => buildExamples(), [])

  useEffect(() => {
    setListed(listWorks())
  }, [worksVersion])

  const realWorks = listed.ok ? listed.works : []
  const examplesInMain = realWorks.length === 0
  const pool = useMemo(() => [...realWorks, ...examples], [realWorks, examples])

  const handleDelete = useCallback(
    (id) => {
      const removed = deleteWork(id)
      if (!removed.ok) {
        setListed((prev) => ({ ...prev, ok: false, error: removed.error }))
        return
      }
      setSelected((prev) => prev.filter((x) => x !== id))
      setOpenWork(null)
      onWorksChanged?.()
    },
    [onWorksChanged],
  )

  const toggleSelect = useCallback((id) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id)
      if (prev.length >= WALL_MAX) return prev
      return [...prev, id]
    })
  }, [])

  const handleWallExport = useCallback(async () => {
    setWallNotice('')
    const works = pool.filter((w) => selected.includes(w.id))
    if (works.length < WALL_MIN || works.length > WALL_MAX) return
    const canvas = renderWall({ works, title: wallTitle })
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) {
      setWallNotice('拼墙导出失败：浏览器没能编码 PNG，请重试。')
      return
    }
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = wallFileName(wallTitle, works.length)
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1500)
    setWallNotice(`已导出拼墙 ${wallFileName(wallTitle, works.length)}（实际像素 1600×1600）`)
  }, [pool, selected, wallTitle])

  const mainWorks = examplesInMain ? examples : realWorks
  const cardProps = {
    selectable: wallMode,
    onToggleSelect: toggleSelect,
    onOpen: setOpenWork,
  }

  return (
    <section aria-labelledby="gallery-title" className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="rounded-card border border-rule bg-paper px-5 py-6 text-ink sm:px-8 sm:py-9">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-muted">Gallery</p>
            <h2 id="gallery-title" className="mt-2 font-display text-2xl sm:text-3xl">
              画廊
            </h2>
          </div>
          <button
            type="button"
            data-action="wall-toggle"
            aria-pressed={wallMode}
            onClick={() => {
              setWallMode((v) => !v)
              setWallNotice('')
            }}
            className={
              'rounded-full border px-4 py-1.5 text-sm focus-visible:outline-ink ' +
              (wallMode ? 'border-ink bg-ink text-paper' : 'border-rule bg-paper-shade text-ink hover:border-ink')
            }
          >
            {wallMode ? '退出拼墙' : '拼墙'}
          </button>
        </div>
        <p className="mt-2 max-w-prose text-sm text-ink-muted">
          这里陈列你存在这台设备上的画。作品只留在浏览器本地，不上传、不共享。
        </p>

        {wallMode ? (
          <div data-region="wall-bar" className="mt-4 rounded-card border border-rule bg-paper-shade px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span data-wall-count className="font-mono text-[11px] text-ink-muted">
                已选 {selected.length}/{WALL_MAX}
              </span>
              <input
                id="wall-title"
                type="text"
                maxLength={20}
                value={wallTitle}
                onChange={(e) => setWallTitle(e.target.value)}
                placeholder="拼墙大标题（可空，兜底「飞行轨迹作品墙」）"
                className="min-w-0 flex-1 rounded-card border border-rule bg-paper px-3 py-1.5 text-sm text-ink placeholder:text-ink-muted focus-visible:outline-ink"
              />
              <button
                type="button"
                data-action="wall-export"
                disabled={selected.length < WALL_MIN || selected.length > WALL_MAX}
                onClick={handleWallExport}
                className="rounded-full border border-ink bg-ink px-4 py-1.5 text-sm text-paper hover:bg-ink/85 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-45"
              >
                导出拼墙 PNG
              </button>
            </div>
            <p className="mt-2 text-[11px] text-ink-muted">
              勾选 {WALL_MIN}–{WALL_MAX} 张本地作品或内置示例拼成一张 1600×1600 作品墙；不导入任何外部图片。
              {selected.length >= WALL_MAX ? ' 已达上限 9 张。' : ''}
            </p>
            {wallNotice ? (
              <p role="status" className="mt-2 text-xs text-ink-muted">
                {wallNotice}
              </p>
            ) : null}
          </div>
        ) : null}

        {!listed.ok ? (
          <p role="alert" className="mt-4 rounded-card border border-signal-danger/55 bg-signal-danger/10 px-3 py-2 text-xs leading-relaxed text-signal-danger">
            {listed.error}
          </p>
        ) : null}

        {examplesInMain ? (
          <p className="mt-4 text-xs text-ink-muted">
            还没有存入的作品：先看看三张内置示例（只读，不占本地存储）。去创作台存一件，它们就会收进下方折叠区。
          </p>
        ) : null}

        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {mainWorks.map((work) => (
            <WorkCard key={work.id} work={work} selected={selected.includes(work.id)} {...cardProps} />
          ))}
        </ul>

        {!examplesInMain ? (
          <details className="mt-6 rounded-card border border-rule bg-paper-shade px-4 py-3">
            <summary className="cursor-pointer text-sm text-ink-muted focus-visible:outline-ink">
              内置示例（{examples.length}）· 只读
            </summary>
            <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {examples.map((work) => (
                <WorkCard key={work.id} work={work} selected={selected.includes(work.id)} {...cardProps} />
              ))}
            </ul>
          </details>
        ) : null}
      </div>

      {openWork ? (
        <WorkDialog work={openWork} onClose={() => setOpenWork(null)} onDelete={handleDelete} />
      ) : null}
    </section>
  )
}