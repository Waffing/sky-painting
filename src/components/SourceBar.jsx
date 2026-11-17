import { useRef } from 'react'

export default function SourceBar({
  samples,
  activeSampleId,
  sourceKind,
  sourceLabel,
  sourceBlurb = '',
  summary = '',
  error = '',
  drawMode = false,
  stageError = '',
  onSelectSample,
  onImportFile,
  onDownloadSample,
  onHandDraw,
}) {
  const fileRef = useRef(null)

  return (
    <section aria-label="轨迹来源" className="rounded-stage border border-stage-line bg-stage-deep/70 p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-on-stage-muted">轨迹来源</h3>

        <div role="group" aria-label="内置示例轨迹" className="flex flex-wrap gap-1.5">
          {samples.map((sample) => {
            const isActive = sourceKind === 'sample' && sample.id === activeSampleId
            return (
              <button
                key={sample.id}
                type="button"
                title={sample.blurb}
                aria-pressed={isActive}
                onClick={() => onSelectSample(sample.id)}
                className={
                  'stage-btn ' +
                  (isActive ? 'border-trace-cyan bg-stage-mid text-ink-on-stage' : 'text-ink-on-stage-muted')
                }
              >
                {sample.name}
              </button>
            )
          })}
        </div>

        <span aria-hidden="true" className="hidden h-5 w-px bg-stage-line sm:block" />

        <div className="flex flex-wrap gap-1.5">
          <button type="button" className="stage-btn" onClick={() => fileRef.current?.click()}>
            导入 CSV
          </button>
          <button type="button" className="stage-btn" onClick={onDownloadSample}>
            下载示例 CSV
          </button>
          <button
            type="button"
            className="stage-btn stage-btn-accent"
            disabled={drawMode || Boolean(stageError)}
            onClick={onHandDraw}
          >
            {drawMode ? '正在手绘…' : '手绘一条'}
          </button>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv,text/plain"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) onImportFile(file)
          }}
        />
      </div>

      <p className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-ink-on-stage-muted">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-trace-cyan">当前</span>
        <strong className="text-sm font-normal text-ink-on-stage">{sourceLabel}</strong>
        {sourceBlurb ? <span className="min-w-0">{sourceBlurb}</span> : null}
        {summary ? <span className="font-mono text-[10px]">{summary}</span> : null}
      </p>

      {error ? (
        <p
          role="alert"
          className="mt-2 rounded-card border border-signal-danger/55 bg-signal-danger/10 px-3 py-2 text-xs leading-relaxed text-signal-danger"
        >
          {error}
        </p>
      ) : null}
    </section>
  )
}