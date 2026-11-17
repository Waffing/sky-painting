import { badgeSvgDataUrl } from './badgeSvg.js'

/* 海报只消费现成积木：captureStagePng 的透明底 PNG、badgeSvgDataUrl、冻结 stats。
 * 本文件不出现任何 hex：所有色值经 readTemplateColors 从 tokens.css 解析后传入。 */

export const POSTER_WIDTH = 1200
export const POSTER_HEIGHT = 1600

const MARGIN = 84
const INNER_WIDTH = POSTER_WIDTH - MARGIN * 2
const WINDOW = { x: MARGIN, y: 320, w: INNER_WIDTH, h: 680 }
const WINDOW_PAD = 26

/** 雕塑承托区：画窗内衬 26px；取图按 2× 超采样再缩绘，边缘更锐。 */
export const SCULPTURE_RECT = {
  x: WINDOW.x + WINDOW_PAD,
  y: WINDOW.y + WINDOW_PAD,
  w: WINDOW.w - WINDOW_PAD * 2,
  h: WINDOW.h - WINDOW_PAD * 2,
}
export const CAPTURE_SIZE = { width: SCULPTURE_RECT.w * 2, height: SCULPTURE_RECT.h * 2 }

const TITLE_BLOCK = { top: 140, singleBaseline: 240, firstBaseline: 196, lineHeight: 1.18 }
const BADGE_BLOCK = { x: MARGIN, y: 1040, size: 240, textX: 364, nameBaseline: 1096, citationBaseline: 1146, citationStep: 36 }
const DATA_ROW = { x: MARGIN, labelBaseline: 1330, valueBaseline: 1378, cellWidth: INNER_WIDTH / 4, ruleTop: 1310, ruleBottom: 1392 }
const SIGN_BASELINE = 1450
const CREDIT_BASELINE = 1502
const CREDIT_STEP = 28

/** 版式坐标冻结表：供 Node 断言与后续步骤复用，改坐标必须同步改这里。 */
export const POSTER_LAYOUT = Object.freeze({
  margin: MARGIN,
  innerWidth: INNER_WIDTH,
  window: WINDOW,
  windowPad: WINDOW_PAD,
  sculpture: SCULPTURE_RECT,
  title: TITLE_BLOCK,
  badge: BADGE_BLOCK,
  data: DATA_ROW,
  signBaseline: SIGN_BASELINE,
  creditBaseline: CREDIT_BASELINE,
  creditStep: CREDIT_STEP,
})

export const TITLE_FONT_MAX = 96
export const TITLE_FONT_MIN = 48
export const TITLE_FONT_STEP = 4
const TITLE_WRAP_FLOOR = 24
const CREDIT_FONT = 20
const CREDIT_FONT_SMALL = 16

/** 三模板共用同一版式骨架，只换纸底 / 画窗 / 文字色；轨迹配色一律不改。 */
export const TEMPLATES = [
  {
    id: 'clear',
    name: '晴空',
    surface: {
      paper: '--color-paper',
      window: '--color-stage-deep',
      frame: '--color-rule',
      ink: '--color-ink',
      muted: '--color-ink-muted',
      rule: '--color-rule',
    },
    medal: {
      face: '--color-stage-deep',
      rim: '--color-trace-gold',
      ray: '--color-stage-line',
      icon: '--color-trace-cyan',
      accent: '--color-trace-gold',
      ink: '--color-ink-on-stage',
    },
  },
  {
    id: 'dusk',
    name: '黄昏',
    surface: {
      paper: '--color-poster-paper-dusk',
      window: '--color-poster-window-dusk',
      frame: '--color-poster-ray-dusk',
      ink: '--color-poster-ink-dusk',
      muted: '--color-poster-ink-dusk-muted',
      rule: '--color-poster-rule-dusk',
    },
    medal: {
      face: '--color-poster-window-dusk',
      rim: '--color-trace-gold',
      ray: '--color-poster-ray-dusk',
      icon: '--color-trace-cyan',
      accent: '--color-trace-gold',
      ink: '--color-ink-on-stage',
    },
  },
  {
    id: 'night',
    name: '夜航',
    surface: {
      paper: '--color-stage-void',
      window: null,
      frame: null,
      ink: '--color-ink-on-stage',
      muted: '--color-ink-on-stage-muted',
      rule: '--color-stage-line',
    },
    medal: {
      face: '--color-stage-deep',
      rim: '--color-trace-gold',
      ray: '--color-stage-line',
      icon: '--color-trace-cyan',
      accent: '--color-trace-gold',
      ink: '--color-ink-on-stage',
    },
  },
]

export function templateById(id) {
  return TEMPLATES.find((item) => item.id === id) || TEMPLATES[0]
}

/** 调用方在浏览器里解析令牌；章体色随后交给 badgeSvgDataUrl（含 var( 会抛错）。 */
export function readTemplateColors(templateId) {
  const template = templateById(templateId)
  const styles = getComputedStyle(document.documentElement)
  const resolve = (name) => styles.getPropertyValue(name).trim()
  const surface = {}
  for (const [key, name] of Object.entries(template.surface)) {
    surface[key] = name ? resolve(name) : null
  }
  const medal = {}
  for (const [key, name] of Object.entries(template.medal)) medal[key] = resolve(name)
  const fonts = {
    display: resolve('--font-display'),
    sans: resolve('--font-sans'),
    mono: resolve('--font-mono'),
  }
  return { template, surface, medal, fonts }
}

/** 贪心逐字折行：不截断、不省略号。measure(text, fontSize) 由调用方注入。 */
export function wrapText(measure, text, maxWidth, fontSize) {
  const lines = []
  let current = ''
  for (const char of text) {
    const next = current + char
    if (current && measure(next, fontSize) > maxWidth) {
      lines.push(current)
      current = char
    } else {
      current = next
    }
  }
  if (current) lines.push(current)
  return lines
}

/** 先缩字（96→48），最小字号仍放不下才双行折行；折行后再放不下继续缩到 24 兜底。 */
export function layoutTitle(measure, text, maxWidth) {
  for (let fontSize = TITLE_FONT_MAX; fontSize >= TITLE_FONT_MIN; fontSize -= TITLE_FONT_STEP) {
    if (measure(text, fontSize) <= maxWidth) return { fontSize, lines: [text] }
  }
  for (let fontSize = TITLE_FONT_MIN; fontSize >= TITLE_WRAP_FLOOR; fontSize -= TITLE_FONT_STEP) {
    const lines = wrapText(measure, text, maxWidth, fontSize)
    if (lines.length <= 2) return { fontSize, lines }
  }
  return { fontSize: TITLE_WRAP_FLOOR, lines: wrapText(measure, text, maxWidth, TITLE_WRAP_FLOOR) }
}

/** 四数据格：数值直取冻结 stats；时长按 isEstimatedDuration 诚实标注。 */
export function formatPosterCells(stats) {
  return [
    { label: '总航程', value: `${stats.totalDistance.toFixed(1)} m` },
    { label: '最高高度', value: `${stats.maxAlt.toFixed(1)} m` },
    { label: '转弯次数', value: `${stats.turnCount} 次` },
    {
      label: stats.isEstimatedDuration ? '估算时长' : '飞行时长',
      value: `${stats.duration.toFixed(1)} s`,
    },
  ]
}

export function posterDateText(date = new Date()) {
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`
}

export function posterFileName(title) {
  const safe = String(title ?? '')
    .replace(/[\\/:*?"<>|\s]+/g, '')
    .slice(0, 20)
  return `${safe || '无名画作'}-海报-1200x1600.png`
}

function loadImage(url, label) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`海报素材加载失败：${label}没能解码。`))
    img.src = url
  })
}

/**
 * 唯一绘制入口：预览与下载共用本函数同一参数，保证同源同版。
 * @returns {Promise<HTMLCanvasElement>} 1200×1600 离屏画布
 */
export async function renderPoster({ title, badge, stats, colors, pilot, credit, dateText, stagePngUrl }) {
  const { template, surface, medal, fonts } = colors
  const canvas = document.createElement('canvas')
  canvas.width = POSTER_WIDTH
  canvas.height = POSTER_HEIGHT
  const ctx = canvas.getContext('2d')

  const [stage, medalImg] = await Promise.all([
    loadImage(stagePngUrl, '雕塑快照'),
    loadImage(badgeSvgDataUrl(badge.id, medal, 240), '勋章图'),
  ])

  const setFont = (size, family, weight = '') => {
    ctx.font = `${weight ? `${weight} ` : ''}${size}px ${family}`
  }
  const measureWith = (family) => (text, size) => {
    setFont(size, family)
    return ctx.measureText(text).width
  }

  ctx.fillStyle = surface.paper
  ctx.fillRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT)

  // 眉线
  setFont(22, fonts.mono)
  ctx.letterSpacing = '3px'
  ctx.fillStyle = surface.muted
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText('SKY PAINTING · 飞行轨迹雕塑', MARGIN, 112)
  ctx.textAlign = 'right'
  ctx.fillText(`模板 · ${template.name}`, POSTER_WIDTH - MARGIN, 112)
  ctx.letterSpacing = '0px'

  // 画名：动态缩字 + 双行兜底
  const titleLayout = layoutTitle(measureWith(fonts.display), title, INNER_WIDTH)
  setFont(titleLayout.fontSize, fonts.display)
  ctx.fillStyle = surface.ink
  ctx.textAlign = 'left'
  if (titleLayout.lines.length === 1) {
    ctx.fillText(titleLayout.lines[0], MARGIN, TITLE_BLOCK.singleBaseline)
  } else {
    titleLayout.lines.forEach((line, index) => {
      ctx.fillText(line, MARGIN, TITLE_BLOCK.firstBaseline + index * titleLayout.fontSize * TITLE_BLOCK.lineHeight)
    })
  }

  // 画窗：夜航无框，雕塑直接浮在暗底上
  if (surface.window) {
    ctx.fillStyle = surface.window
    ctx.fillRect(WINDOW.x, WINDOW.y, WINDOW.w, WINDOW.h)
    ctx.strokeStyle = surface.frame
    ctx.lineWidth = 1.5
    ctx.strokeRect(WINDOW.x + 12, WINDOW.y + 12, WINDOW.w - 24, WINDOW.h - 24)
  }
  ctx.drawImage(stage, SCULPTURE_RECT.x, SCULPTURE_RECT.y, SCULPTURE_RECT.w, SCULPTURE_RECT.h)

  // 勋章 + 勋章名 + 颁奖词
  ctx.drawImage(medalImg, BADGE_BLOCK.x, BADGE_BLOCK.y, BADGE_BLOCK.size, BADGE_BLOCK.size)
  const textWidth = POSTER_WIDTH - MARGIN - BADGE_BLOCK.textX
  setFont(46, fonts.display)
  ctx.fillStyle = surface.ink
  ctx.fillText(badge.name, BADGE_BLOCK.textX, BADGE_BLOCK.nameBaseline)
  let citationSize = 26
  let citationLines = wrapText(measureWith(fonts.sans), badge.citation, textWidth, citationSize)
  if (citationLines.length > 4) {
    citationSize = 22
    citationLines = wrapText(measureWith(fonts.sans), badge.citation, textWidth, citationSize)
  }
  setFont(citationSize, fonts.sans)
  ctx.fillStyle = surface.muted
  citationLines.forEach((line, index) => {
    ctx.fillText(line, BADGE_BLOCK.textX, BADGE_BLOCK.citationBaseline + index * (citationSize === 26 ? BADGE_BLOCK.citationStep : 30))
  })

  // 四数据格
  const cells = formatPosterCells(stats)
  cells.forEach((cell, index) => {
    const x = DATA_ROW.x + index * DATA_ROW.cellWidth
    setFont(20, fonts.sans)
    ctx.fillStyle = surface.muted
    ctx.fillText(cell.label, x, DATA_ROW.labelBaseline)
    setFont(40, fonts.mono)
    ctx.fillStyle = surface.ink
    ctx.fillText(cell.value, x, DATA_ROW.valueBaseline)
    if (index > 0) {
      ctx.strokeStyle = surface.rule
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x - 20, DATA_ROW.ruleTop)
      ctx.lineTo(x - 20, DATA_ROW.ruleBottom)
      ctx.stroke()
    }
  })

  // 日期 + 飞手署名
  setFont(24, fonts.sans)
  ctx.fillStyle = surface.ink
  ctx.textAlign = 'left'
  ctx.fillText(`生成于 ${dateText}`, MARGIN, SIGN_BASELINE)
  ctx.textAlign = 'right'
  ctx.fillText(`飞手 · ${pilot}`, POSTER_WIDTH - MARGIN, SIGN_BASELINE)

  // 底部落款：最后一行距画布底边 ≥60px
  let creditSize = CREDIT_FONT
  let creditLines = wrapText(measureWith(fonts.sans), credit, INNER_WIDTH, creditSize)
  if (creditLines.length > 2) {
    creditSize = CREDIT_FONT_SMALL
    creditLines = wrapText(measureWith(fonts.sans), credit, INNER_WIDTH, creditSize)
  }
  setFont(creditSize, fonts.sans)
  ctx.fillStyle = surface.muted
  ctx.textAlign = 'left'
  creditLines.forEach((line, index) => {
    ctx.fillText(line, MARGIN, CREDIT_BASELINE + index * CREDIT_STEP)
  })

  return canvas
}