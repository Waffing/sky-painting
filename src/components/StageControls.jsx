const ICONS = {
  reflight: 'M2 12c4-1 6-3 7-6 1 3 3 5 7 6-4 1-6 3-7 6-1-3-3-5-7-6Z',
  reset: 'M3 3h4M3 3v4M13 3H9M13 3v4M3 13h4M3 13v-4M13 13H9M13 13v-4',
  replay: 'M13 8A5 5 0 1 1 8 3h3M11 1l2 2-2 2',
}

function Glyph({ name }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0" fill="none">
      <path
        d={ICONS[name]}
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill={name === 'reflight' ? 'currentColor' : 'none'}
      />
    </svg>
  )
}

export default function StageControls({ disabled = false, busy = false, onReflight, onResetView, onReplayFormation }) {
  return (
    <div className="pointer-events-auto flex flex-wrap gap-2">
      <button type="button" className="stage-btn stage-btn-accent" disabled={disabled || busy} onClick={onReflight}>
        <Glyph name="reflight" />
        重飞
      </button>
      <button type="button" className="stage-btn" disabled={disabled} onClick={onResetView}>
        <Glyph name="reset" />
        视角重置
      </button>
      <button type="button" className="stage-btn" disabled={disabled || busy} onClick={onReplayFormation}>
        <Glyph name="replay" />
        重播成型
      </button>
    </div>
  )
}