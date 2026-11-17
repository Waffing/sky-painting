/**
 * 本地拼墙（Step 5 · P1）。1600×1600 正方形深空底（修订 1）。
 * 仅消费本地作品与内置示例的 projector 雕塑，零 WebGL、绝不导入外部图片。
 * 版式护栏（修订 5）：格子锁定统一 3:4 高宽比；网格块在 y220–1440 内垂直居中；
 * 末行不满时水平居中；标题为空兜底「飞行轨迹作品墙」。
 * computeWallLayout / wallFileName 为纯函数，Node 可测。
 */

import { layoutTitle } from './poster.js'
import { renderSculpture } from './projector.js'

export const WALL_SIZE = 1600
export const WALL_MARGIN = 84
export const WALL_GRID_TOP = 220
export const WALL_GRID_BOTTOM = 1440
export const WALL_GAP = 24
export const WALL_CELL_ASPECT = 3 / 4
export const WALL_TITLE_BASELINE = 150
export const WALL_CREDIT_BASELINE = 1520
export const WALL_TITLE_FALLBACK = '飞行轨迹作品墙'
export const WALL_CREDIT = '天上掉下一幅画 · 无人机飞行轨迹艺术'
export const WALL_MIN = 2
export const WALL_MAX = 9

/** 纯版式：cols/rows、等比格子、垂直居中、末行水平居中。 */
export function computeWallLayout(n) {
  const cols = n <= 4 ? 2 : 3
  const rows = Math.ceil(n / cols)
  const gridH = WALL_GRID_BOTTOM - WALL_GRID_TOP
  const availW = WALL_SIZE - WALL_MARGIN * 2 - WALL_GAP * (cols - 1)
  let cellW = availW / cols
  let cellH = cellW / WALL_CELL_ASPECT
  let totalH = rows * cellH + WALL_GAP * (rows - 1)
  if (totalH > gridH) {
    cellH = (gridH - WALL_GAP * (rows - 1)) / rows
    cellW = cellH * WALL_CELL_ASPECT
    totalH = rows * cellH + WALL_GAP * (rows - 1)
  }
  const gridY = WALL_GRID_TOP + (gridH - totalH) / 2
  const cells = []
  for (let r = 0; r < rows; r += 1) {
    const count = Math.min(cols, n - r * cols)
    const rowW = count * cellW + WALL_GAP * (count - 1)
    const rowX = (WALL_SIZE - rowW) / 2
    for (let c = 0; c < count; c += 1) {
      cells.push({ x: rowX + c * (cellW + WALL_GAP), y: gridY + r * (cellH + WALL_GAP), w: cellW, h: cellH })
    }
  }
  return { cols, rows, cellW, cellH, gap: WALL_GAP, gridY, cells }
}

export function wallFileName(title, n) {
  const safe = String(title ?? '')
    .replace(/[\\/:*?"<>|\s]+/g, '')
    .slice(0, 20)
  return `${safe || WALL_TITLE_FALLBACK}-拼墙-${n}张-1600x1600.png`
}

function readWallColors() {
  const s = getComputedStyle(document.documentElement)
  const get = (name) => s.getPropertyValue(name).trim()
  return {
    void: get('--color-stage-void'),
    deep: get('--color-stage-deep'),
    line: get('--color-stage-line'),
    ink: get('--color-ink-on-stage'),
    muted: get('--color-ink-on-stage-muted'),
    cyan: get('--color-trace-cyan'),
    gold: get('--color-trace-gold'),
    display: get('--font-display'),
    sans: get('--font-sans'),
  }
}

/**
 * 渲染拼墙 canvas。works 为已选作品（2–9），title 可空（兜底）。
 * @returns {HTMLCanvasElement} 1600×1600
 */
export function renderWall({ works, title }) {
  const colors = readWallColors()
  const canvas = document.createElement('canvas')
  canvas.width = WALL_SIZE
  canvas.height = WALL_SIZE
  const ctx = canvas.getContext('2d')
  const innerW = WALL_SIZE - WALL_MARGIN * 2

  ctx.fillStyle = colors.void
  ctx.fillRect(0, 0, WALL_SIZE, WALL_SIZE)

  const text = String(title ?? '').trim() || WALL_TITLE_FALLBACK
  const setFont = (size, family) => {
    ctx.font = `${size}px ${family}`
  }
  const measure = (t, size) => {
    setFont(size, colors.display)
    return ctx.measureText(t).width
  }
  const titleLayout = layoutTitle(measure, text, innerW)
  setFont(titleLayout.fontSize, colors.display)
  ctx.fillStyle = colors.ink
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  if (titleLayout.lines.length === 1) {
    ctx.fillText(titleLayout.lines[0], WALL_MARGIN, WALL_TITLE_BASELINE)
  } else {
    titleLayout.lines.forEach((line, i) => {
      ctx.fillText(line, WALL_MARGIN, 110 + i * titleLayout.fontSize * 1.18)
    })
  }

  const layout = computeWallLayout(works.length)
  const captionH = 44
  const pad = 16
  works.forEach((work, i) => {
    const cell = layout.cells[i]
    ctx.fillStyle = colors.deep
    ctx.fillRect(cell.x, cell.y, cell.w, cell.h)
    ctx.strokeStyle = colors.line
    ctx.lineWidth = 1.5
    ctx.strokeRect(cell.x + 10, cell.y + 10, cell.w - 20, cell.h - 20)

    const sculptW = Math.max(2, Math.round(cell.w - pad * 2))
    const sculptH = Math.max(2, Math.round(cell.h - captionH - pad * 2))
    const sculpture = renderSculpture({
      points: work.points,
      bounds: work.bounds,
      stats: work.stats,
      width: sculptW,
      height: sculptH,
      colors: { cyan: colors.cyan, gold: colors.gold },
    })
    ctx.drawImage(sculpture, cell.x + pad, cell.y + pad)

    let capSize = 24
    while (capSize > 12 && measure(work.title, capSize) > cell.w - pad * 2) capSize -= 2
    setFont(capSize, colors.display)
    ctx.fillStyle = colors.ink
    ctx.fillText(work.title, cell.x + pad, cell.y + cell.h - 14)

    if (work.isExample) {
      setFont(16, colors.sans)
      ctx.fillStyle = colors.gold
      ctx.textAlign = 'right'
      ctx.fillText('示例', cell.x + cell.w - pad, cell.y + pad + 16)
      ctx.textAlign = 'left'
    }
  })

  setFont(24, colors.sans)
  ctx.fillStyle = colors.muted
  ctx.fillText(WALL_CREDIT, WALL_MARGIN, WALL_CREDIT_BASELINE)

  return canvas
}