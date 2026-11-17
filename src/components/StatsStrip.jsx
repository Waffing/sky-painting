const CELLS = [
  { key: 'totalDistance', label: '总距离', unit: 'm', digits: 1, accent: 'bg-trace-cyan' },
  { key: 'maxAlt', label: '最高高度', unit: 'm', digits: 1, accent: 'bg-trace-gold' },
  { key: 'turnCount', label: '转弯次数', unit: '次', digits: 0, accent: 'bg-signal-info' },
]

function Cell({ label, value, unit, accent }) {
  return (
    <div className="min-w-0 bg-stage-deep px-4 py-3">
      <span aria-hidden="true" className={`block h-0.5 w-6 rounded-full ${accent}`} />
      <dt className="mt-2 text-[11px] tracking-wide text-ink-on-stage-muted">{label}</dt>
      <dd className="mt-0.5 truncate font-mono text-lg text-ink-on-stage">
        {value}
        <span className="ml-1 text-xs text-ink-on-stage-muted">{unit}</span>
      </dd>
    </div>
  )
}

export default function StatsStrip({ stats, isEstimatedDuration }) {
  if (!stats) return null

  return (
    <section aria-label="轨迹数据条" className="overflow-hidden rounded-stage border border-stage-line">
      <dl className="grid grid-cols-2 gap-px bg-stage-line sm:grid-cols-4">
        {CELLS.map((cell) => (
          <Cell
            key={cell.key}
            label={cell.label}
            value={stats[cell.key].toFixed(cell.digits)}
            unit={cell.unit}
            accent={cell.accent}
          />
        ))}
        <Cell
          label={isEstimatedDuration ? '估算时长' : '飞行时长'}
          value={stats.duration.toFixed(1)}
          unit="s"
          accent="bg-signal-ok"
        />
      </dl>
      <p className="border-t border-stage-line bg-stage-deep px-4 py-2 text-[11px] leading-relaxed text-ink-on-stage-muted">
        {isEstimatedDuration
          ? '估算时长 = 总距离 ÷ 平均速度：这条轨迹没有可信时间戳，速度为假设值。'
          : '飞行时长 = 日志首尾时间戳之差，直接取自导入记录。'}
        <span className="ml-2 font-mono text-[10px]">数值全部来自数据层，舞台不做二次计算。</span>
      </p>
    </section>
  )
}