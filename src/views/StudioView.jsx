import { useCallback, useMemo, useRef, useState } from 'react'
import SourceBar from '../components/SourceBar'
import StatsStrip from '../components/StatsStrip'
import NameplateCard from '../components/NameplateCard'
import PosterPanel from '../components/PosterPanel'
import StageCanvas from '../stage/StageCanvas'
import { SAMPLE_FLIGHTS, buildSampleCsv, parseFlightCsv, processFlightData, processSampleFlight } from '../utils/flightData'
import { awardBadge } from '../utils/badges'
import { dominantFeature } from '../utils/flightFeatures'
import { makeNameCandidates } from '../utils/naming'

const FIRST_SAMPLE = SAMPLE_FLIGHTS[0]

function sampleFlight(sampleId) {
  const sample = SAMPLE_FLIGHTS.find((item) => item.id === sampleId) || FIRST_SAMPLE
  return {
    kind: 'sample',
    sampleId: sample.id,
    label: sample.name,
    blurb: sample.blurb,
    result: processSampleFlight(sample.id),
  }
}

/** 新轨迹一律从第 0 批重抽，默认选中第 1 个候选。 */
function namingFor(stats, rollIndex = 0, previous = []) {
  const candidates = makeNameCandidates(stats, rollIndex, previous)
  return { rollIndex, candidates, selected: candidates[0], custom: '' }
}

export default function StudioView({ onWorksChanged, onGoGallery }) {
  const stageRef = useRef(null)
  const [flight, setFlight] = useState(() => sampleFlight(FIRST_SAMPLE.id))
  const [naming, setNaming] = useState(() => namingFor(flight.result.stats))
  const [title, setTitle] = useState(() => naming.candidates[0])
  const [quality, setQuality] = useState('auto')
  const [drawMode, setDrawMode] = useState(false)
  const [drawMessage, setDrawMessage] = useState('')
  const [importError, setImportError] = useState('')
  const [stageError, setStageError] = useState('')

  const leaveDraw = useCallback(() => {
    stageRef.current?.exitHandDraw()
    setDrawMode(false)
    setDrawMessage('')
  }, [])

  /** 切示例 / 导入 CSV / 完成手绘的唯一入口：轨迹与铭牌卡一起联动重置。 */
  const commitFlight = useCallback((next) => {
    setFlight(next)
    const fresh = namingFor(next.result.stats)
    setNaming(fresh)
    setTitle(fresh.candidates[0])
  }, [])

  const handleSelectSample = useCallback(
    (sampleId) => {
      if (drawMode) leaveDraw()
      setImportError('')
      commitFlight(sampleFlight(sampleId))
    },
    [commitFlight, drawMode, leaveDraw],
  )

  const handleImportFile = useCallback(
    async (file) => {
      if (drawMode) leaveDraw()
      setImportError('')
      let text = ''
      try {
        text = await file.text()
      } catch {
        setImportError(`没能读出《${file.name}》的内容：请确认它是文本格式的飞行记录，再试一次。`)
        return
      }
      const parsed = parseFlightCsv(text)
      if (!parsed.ok) {
        setImportError(parsed.error)
        return
      }
      const result = processFlightData({ ...parsed, name: file.name })
      if (!result.ok) {
        setImportError(result.error)
        return
      }
      commitFlight({ kind: 'csv', sampleId: '', label: file.name, blurb: '导入的飞行日志', result })
    },
    [commitFlight, drawMode, leaveDraw],
  )

  const handleDownloadSample = useCallback(() => {
    const sampleId = flight.kind === 'sample' ? flight.sampleId : FIRST_SAMPLE.id
    const sample = SAMPLE_FLIGHTS.find((item) => item.id === sampleId) || FIRST_SAMPLE
    const blob = new Blob([buildSampleCsv(sample.id)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `示例航迹-${sample.id}.csv`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1500)
  }, [flight.kind, flight.sampleId])

  const handleHandDraw = useCallback(() => {
    setDrawMessage('')
    setImportError('')
    if (stageRef.current?.enterHandDraw()) setDrawMode(true)
  }, [])

  const handleStrokePoints = useCallback(
    (points, meta) => {
      const result = processFlightData(points)
      if (!result.ok) {
        setDrawMessage(result.error)
        return
      }
      setDrawMessage('')
      setImportError('')
      commitFlight({
        kind: 'hand',
        sampleId: '',
        label: '手绘航线',
        blurb: `笔迹 ${meta.strokePoints} 点 · ${meta.strokeLength.toFixed(0)}m → 重采样 ${meta.resampledTo} 点`,
        result,
      })
    },
    [commitFlight],
  )

  const result = flight.result
  const stats = result.ok ? result.stats : null
  const badge = useMemo(() => (stats ? awardBadge(stats) : null), [stats])
  const dominant = useMemo(() => (stats ? dominantFeature(stats) : null), [stats])
  const summary = result.ok ? `原始 ${result.rawPointCount} 点 → 抽稀 ${result.pointCount} 点` : ''

  const handleReroll = useCallback(() => {
    const fresh = namingFor(stats, naming.rollIndex + 1, naming.candidates)
    setNaming({ ...fresh, custom: naming.custom })
    // 手改优先：手改非空时换批只刷新候选，不动画名。
    if (!naming.custom.trim()) setTitle(fresh.candidates[0])
  }, [stats, naming])

  const handlePickName = useCallback((name) => {
    setNaming((prev) => ({ ...prev, selected: name, custom: '' }))
    setTitle(name)
  }, [])

  const handleCustomName = useCallback(
    (value) => {
      setNaming({ ...naming, custom: value })
      setTitle(value.trim() || naming.selected)
    },
    [naming],
  )

  return (
    <section aria-labelledby="studio-title" className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <h2 id="studio-title" className="font-display text-2xl text-ink-on-stage">
            创作台
          </h2>
          <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-ink-on-stage-muted">
            挑一条示例、导入自己的飞行日志，或直接在空域里手绘一笔。轨迹会落成一件能转着看的雕塑：粗处慢、细处快，低空偏青、高空偏暖金。
          </p>
        </div>
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-on-stage-muted">
          拖动旋转 · 滚轮 / 双指缩放 · 静置 3 秒自动自转
        </p>
      </header>

      <div className="mt-4 space-y-4">
        <SourceBar
          samples={SAMPLE_FLIGHTS}
          activeSampleId={flight.sampleId}
          sourceKind={flight.kind}
          sourceLabel={flight.label}
          sourceBlurb={flight.blurb}
          summary={summary}
          error={importError}
          drawMode={drawMode}
          stageError={stageError}
          onSelectSample={handleSelectSample}
          onImportFile={handleImportFile}
          onDownloadSample={handleDownloadSample}
          onHandDraw={handleHandDraw}
        />

        <StageCanvas
          ref={stageRef}
          result={result.ok ? result : null}
          quality={quality}
          drawMode={drawMode}
          drawMessage={drawMessage}
          sourceLabel={flight.label}
          sourceKind={flight.kind}
          onQualityChange={setQuality}
          onDrawExit={() => {
            setDrawMode(false)
            setDrawMessage('')
          }}
          onStrokePoints={handleStrokePoints}
          onStrokeTooShort={setDrawMessage}
          onCancelDraw={leaveDraw}
          onFailed={setStageError}
        />

        <StatsStrip stats={result.ok ? result.stats : null} isEstimatedDuration={result.stats?.isEstimatedDuration} />

        {badge ? (
          <NameplateCard
            badge={badge}
            dominant={dominant}
            candidates={naming.candidates}
            selectedName={naming.selected}
            rollIndex={naming.rollIndex}
            title={title}
            custom={naming.custom}
            onPick={handlePickName}
            onReroll={handleReroll}
            onCustomChange={handleCustomName}
          />
        ) : null}

        <PosterPanel
          stageRef={stageRef}
          result={result.ok ? result : null}
          badge={badge}
          title={title}
          sourceKind={flight.kind}
          drawMode={drawMode}
          onSaved={onWorksChanged}
          onGoGallery={onGoGallery}
        />
      </div>
    </section>
  )
}