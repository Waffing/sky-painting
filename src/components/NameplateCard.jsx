import { useMemo, useState } from 'react'
import { badgeSvgDataUrl } from '../utils/badgeSvg'

/* 章体配色只从 tokens.css 既有令牌解析，组件内不出现任何 hex。 */
const COLOR_TOKENS = {
  face: '--color-stage-deep',
  rim: '--color-trace-gold',
  ray: '--color-stage-line',
  icon: '--color-trace-cyan',
  accent: '--color-trace-gold',
  ink: '--color-ink-on-stage',
}

function readBadgeColors() {
  const styles = getComputedStyle(document.documentElement)
  const colors = {}
  for (const [key, name] of Object.entries(COLOR_TOKENS)) {
    colors[key] = styles.getPropertyValue(name).trim()
  }
  return colors
}

const CAPSULE_BASE =
  'rounded-full border px-3 py-1.5 text-sm transition-colors focus-visible:outline-ink'

export default function NameplateCard({
  badge,
  dominant,
  candidates,
  selectedName,
  rollIndex,
  title,
  custom,
  onPick,
  onReroll,
  onCustomChange,
}) {
  const [colors] = useState(readBadgeColors)
  const badgeUrl = useMemo(() => badgeSvgDataUrl(badge.id, colors), [badge.id, colors])

  return (
    <section aria-label="作品铭牌卡" className="rounded-card border border-rule bg-paper text-ink">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-rule px-4 py-2.5">
        <h3 className="font-display text-sm">作品铭牌</h3>
        <p className="min-w-0 text-xs break-all text-ink-muted">
          当前画名《<span className="text-ink">{title}</span>》
        </p>
      </header>

      <div className="grid gap-5 px-4 py-4 md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] md:gap-6">
        <div className="flex min-w-0 items-start gap-4">
          <img src={badgeUrl} alt={`${badge.name}勋章`} width={128} height={128} className="h-24 w-24 shrink-0" />
          <div className="min-w-0">
            <p className="font-mono text-[10px] tracking-[0.16em] text-ink-muted uppercase">飞行勋章</p>
            <h4 className="mt-1 font-display text-lg leading-tight">{badge.name}</h4>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">{badge.citation}</p>
            <p className="mt-2 text-[11px] text-ink-muted">
              主导特征 · <span className="text-ink">{dominant.label}</span>
            </p>
          </div>
        </div>

        <div className="min-w-0 md:border-l md:border-rule md:pl-6">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <p className="text-xs text-ink-muted">候选画名（点选即定名）</p>
            <button
              type="button"
              onClick={onReroll}
              className="shrink-0 rounded-full border border-rule bg-paper-shade px-3 py-1 text-xs text-ink-muted transition-colors hover:border-ink hover:text-ink focus-visible:outline-ink"
            >
              换一批
            </button>
          </div>

          <div className="mt-2.5 flex flex-wrap gap-2">
            {candidates.map((name) => (
              <button
                key={name}
                type="button"
                aria-pressed={name === selectedName}
                onClick={() => onPick(name)}
                className={`${CAPSULE_BASE} ${
                  name === selectedName
                    ? 'border-ink bg-ink text-paper'
                    : 'border-rule bg-paper-shade text-ink hover:border-ink-muted'
                }`}
              >
                {name}
              </button>
            ))}
          </div>

          <label htmlFor="artwork-title-input" className="mt-4 block text-xs text-ink-muted">
            自定义画名
          </label>
          <input
            id="artwork-title-input"
            type="text"
            maxLength={20}
            value={custom}
            onChange={(event) => onCustomChange(event.target.value)}
            placeholder="手改后以手改名为准"
            className="mt-1.5 w-full min-w-0 rounded-card border border-rule bg-paper-shade px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus-visible:outline-ink"
          />
          <p className="mt-1.5 text-[11px] text-ink-muted">
            第 {rollIndex + 1} 批 · 纯规则生成，零外部 AI 接口
          </p>
        </div>
      </div>
    </section>
  )
}