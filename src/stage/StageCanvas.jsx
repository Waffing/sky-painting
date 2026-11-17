import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { FlightScene } from './flightScene'
import StageControls from '../components/StageControls'

const QUALITY_OPTIONS = [
  { value: 'auto', label: '自动' },
  { value: 'tube', label: '管线' },
  { value: 'line', label: '宽线' },
  { value: 'constant', label: '恒径' },
]

const KIND_LABELS = { sample: '内置示例', csv: '导入日志', hand: '手绘' }

const StageCanvas = forwardRef(function StageCanvas(
  {
    result,
    quality = 'auto',
    drawMode = false,
    drawMessage = '',
    sourceLabel = '',
    sourceKind = 'sample',
    onDrawExit,
    onStrokePoints,
    onStrokeTooShort,
    onCancelDraw,
    onQualityChange,
    onFailed,
  },
  ref,
) {
  const mountRef = useRef(null)
  const sceneRef = useRef(null)
  const handlersRef = useRef({})
  const failedNotifiedRef = useRef(false)
  const [diag, setDiag] = useState(null)

  handlersRef.current = { onDrawExit, onStrokePoints, onStrokeTooShort, onQualityChange, onFailed }

  useEffect(() => {
    const scene = new FlightScene(mountRef.current, {
      onDiagnostics: (next) => {
        setDiag(next)
        if (next.failed && !failedNotifiedRef.current) {
          failedNotifiedRef.current = true
          handlersRef.current.onFailed?.(next.failed)
        }
      },
      onDrawExit: () => handlersRef.current.onDrawExit?.(),
      onStrokePoints: (points, meta) => handlersRef.current.onStrokePoints?.(points, meta),
      onStrokeTooShort: (message) => handlersRef.current.onStrokeTooShort?.(message),
    })
    sceneRef.current = scene
    return () => {
      scene.dispose()
      sceneRef.current = null
    }
  }, [])

  useEffect(() => {
    if (result) sceneRef.current?.setResult(result)
  }, [result])

  useEffect(() => {
    const scene = sceneRef.current
    if (scene && scene.quality !== quality) scene.setQuality(quality)
  }, [quality])

  useEffect(() => {
    if (!drawMode) return undefined
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onCancelDraw?.()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [drawMode, onCancelDraw])

  useImperativeHandle(
    ref,
    () => ({
      captureStagePng: (options) => sceneRef.current?.captureStagePng(options) ?? null,
      replayFormation: () => sceneRef.current?.replayFormation(),
      reflight: () => sceneRef.current?.reflight(),
      resetView: () => sceneRef.current?.resetView(),
      enterHandDraw: () => sceneRef.current?.enterHandDraw() ?? false,
      exitHandDraw: () => sceneRef.current?.exitHandDraw(),
      getMarkerCount: () => sceneRef.current?.getMarkerCount() ?? 0,
      getDiagnostics: () => sceneRef.current?.getDiagnostics() ?? null,
    }),
    [],
  )

  const failed = diag?.failed || ''
  const markerCount = diag?.markerCount ?? 0
  const isTurnCount = diag?.isTurnCount ?? 0

  return (
    <div
      className="stage-shell aspect-[4/5] w-full rounded-stage border border-stage-line sm:aspect-[16/10] lg:aspect-auto lg:min-h-[32rem]"
      data-draw={drawMode ? 'true' : 'false'}
      data-level={diag?.level || 'tube'}
    >
      {/* canvas 由 FlightScene 直接挂载，React 不管理这个容器的子节点 */}
      <div ref={mountRef} className="absolute inset-0" />

      <div className="stage-overlay flex flex-col justify-between gap-3 p-3 sm:p-4">
        <div className="pointer-events-none flex items-start justify-between gap-3">
          <p className="max-w-[60%] truncate rounded-full border border-stage-line bg-stage-void/75 px-3 py-1.5 text-xs text-ink-on-stage">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-trace-cyan">
              {KIND_LABELS[sourceKind] || '轨迹'}
            </span>
            <span className="ml-2">{sourceLabel}</span>
          </p>
          <p className="shrink-0 text-right font-mono text-[10px] leading-relaxed text-ink-on-stage-muted">
            {diag ? `${diag.levelLabel} · ${diag.fps}fps` : '正在点亮舞台…'}
            <br />
            <span className={markerCount === isTurnCount ? 'text-signal-ok' : 'text-signal-danger'}>
              转弯标记 {markerCount}/{isTurnCount}
            </span>
          </p>
        </div>

        {failed ? (
          <p
            role="alert"
            className="pointer-events-auto mx-auto max-w-md rounded-stage border border-signal-danger/60 bg-stage-void/90 px-4 py-3 text-center text-sm text-signal-danger"
          >
            {failed}
          </p>
        ) : null}

        {drawMode ? (
          <div className="pointer-events-none flex flex-col gap-2">
            <p aria-live="polite" className="text-center text-xs text-signal-danger empty:hidden">
              {drawMessage}
            </p>
            <div className="pointer-events-auto mx-auto flex max-w-full flex-wrap items-center justify-center gap-x-3 gap-y-2 rounded-stage border border-stage-line bg-stage-void/85 px-3 py-2">
              <p className="text-xs text-ink-on-stage">
                按住拖动画一条航线
                <span className="ml-2 font-mono text-[10px] text-ink-on-stage-muted">
                  300m × 300m 空域 · 基准 60m · 已采样 {diag?.strokePoints ?? 0} 点
                </span>
              </p>
              <button type="button" className="stage-btn" onClick={onCancelDraw}>
                取消
              </button>
            </div>
          </div>
        ) : (
          <div className="pointer-events-none flex flex-wrap items-end justify-between gap-3">
            <StageControls
              disabled={Boolean(failed) || !result}
              busy={Boolean(diag?.formationActive)}
              onReflight={() => sceneRef.current?.reflight()}
              onResetView={() => sceneRef.current?.resetView()}
              onReplayFormation={() => sceneRef.current?.replayFormation()}
            />
            <label className="stage-select-wrap pointer-events-auto">
              <span className="mr-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-on-stage-muted">
                画质
              </span>
              <select
                className="stage-select"
                value={quality}
                disabled={Boolean(failed)}
                onChange={(event) => handlersRef.current.onQualityChange?.(event.target.value)}
              >
                {QUALITY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </div>
    </div>
  )
})

export default StageCanvas