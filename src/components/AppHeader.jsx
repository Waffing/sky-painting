export default function AppHeader({ views, active, onChange, counts = {} }) {
  return (
    <header className="border-b border-stage-line bg-stage-deep">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-5 sm:flex-row sm:items-end sm:justify-between sm:gap-6 sm:px-6 sm:py-6">
        <div className="min-w-0">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-on-stage-muted">
            Qoder 高校创造力大赛 2026 · LifeHack
          </p>
          <h1 className="mt-2 font-display text-[1.75rem] leading-tight text-ink-on-stage sm:text-3xl lg:text-4xl">
            天上掉下一幅画
          </h1>
          <p className="mt-1.5 text-sm text-ink-on-stage-muted">在深空里随手一划，接住从天上掉下来的一幅画。</p>
        </div>

        <nav aria-label="视图切换" className="w-full sm:w-auto">
          <ul className="flex gap-1 overflow-x-auto rounded-full border border-stage-line bg-stage-void p-1">
            {views.map((item) => {
              const isActive = item.id === active

              return (
                <li key={item.id} className="flex-1 sm:flex-none">
                  <button
                    type="button"
                    onClick={() => onChange(item.id)}
                    aria-current={isActive ? 'page' : undefined}
                    className={
                      'min-h-11 w-full whitespace-nowrap rounded-full px-4 py-2 text-sm transition-colors ' +
                      (isActive
                        ? 'bg-stage-mid text-ink-on-stage'
                        : 'text-ink-on-stage-muted hover:text-ink-on-stage')
                    }
                  >
                    {item.label}
                    {item.id === 'gallery' && counts.gallery > 0 ? (
                      <span
                        aria-label={`真实作品 ${counts.gallery} 件`}
                        className="ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-trace-gold px-1.5 font-mono text-[10px] leading-4 text-stage-void"
                      >
                        {counts.gallery}
                      </span>
                    ) : null}
                  </button>
                </li>
              )
            })}
          </ul>
        </nav>
      </div>
    </header>
  )
}
