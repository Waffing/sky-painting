/**
 * 纯 2D Canvas 等距投影器（Step 5）。画廊缩略图 / 大图重下载 / 拼墙共用，零 WebGL、零 Three 实例。
 *
 * 与舞台的一致性口径（六锁之①②③④⑤）：
 * - 方位角 / 俯角写死 45° / 35°，与 flightScene.js 的 AZIMUTH / ELEVATION 同源（源锁回归断言）。
 * - 视图基向量闭式与 flightScene.computeFit 的 direction 同公式；Canvas 竖轴取 -dot(P, up)。
 * - 线宽复用舞台同一 makeSpeedScale（慢粗快细），直径 = 2·radius·pxPerMeter，
 *   radius 比例源锁 flightScene.js 的 span·0.0035 / span·0.0125。
 * - 高度渐变低空青 → 高空暖金，端点精确等于注入的 cyan / gold 令牌色。
 * - 绘制顺序写死：各段按中点深度 dot(mid, d) 从远到近画家算法排序；isTurn 发光点末层柔光叠绘（同深度序）。
 * - 描边统一 lineCap / lineJoin = 'round'，避免立体交叉穿帮。
 *
 * 取景为「投影后 bbox + pad」，比舞台的透视包围球 fit 更满；属规格内在差异（等距平行投影），非缺陷。
 * 色值由调用方解析令牌注入，本文件不写任何 hex 字面量。
 */

import { makeSpeedScale } from '../stage/speedScale.js'

export const PROJECTOR_ANGLES = Object.freeze({ azimuthDeg: 45, elevationDeg: 35 })

// 源锁 flightScene.js:462-463（radiusMin = span*0.0035, radiusMax = span*0.0125）。
export const PROJECTOR_RADIUS_RATIO = Object.freeze({ min: 0.0035, max: 0.0125 })

export const PROJECTOR_PAD = 1.08

// 修订 5：WorkCard 缓存只允许这一级轻量缩略图，禁止大 canvas 长期驻留。
export const PROJECTOR_THUMB = Object.freeze({ width: 360, height: 480 })

const DEG = Math.PI / 180
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** 视图基向量：d 指向相机，right 水平，up = cross(d, right)。与舞台 direction 同公式。 */
export function viewBasis({ azimuthDeg, elevationDeg } = PROJECTOR_ANGLES) {
  const A = azimuthDeg * DEG
  const E = elevationDeg * DEG
  const d = [Math.cos(E) * Math.sin(A), Math.sin(E), Math.cos(E) * Math.cos(A)]
  const right = [Math.cos(A), 0, -Math.sin(A)]
  const up = [
    d[1] * right[2] - d[2] * right[1],
    d[2] * right[0] - d[0] * right[2],
    d[0] * right[1] - d[1] * right[0],
  ]
  return { d, right, up }
}

const dot = (p, v) => p[0] * v[0] + p[1] * v[1] + p[2] * v[2]

/** 世界坐标 (x, alt, -y) 相对包围盒中心投影到屏幕基；depth 越大越靠近相机。 */
export function projectPoints(points, bounds, angles = PROJECTOR_ANGLES) {
  const { d, right, up } = viewBasis(angles)
  const cx = (bounds.minX + bounds.maxX) / 2
  const cy = (bounds.minY + bounds.maxY) / 2
  const cz = (bounds.minAlt + bounds.maxAlt) / 2
  return points.map((p) => {
    const P = [p.x - cx, p.alt - cz, -(p.y - cy)]
    return {
      sx: dot(P, right),
      sy: dot(P, up),
      depth: dot(P, d),
      alt: p.alt,
      speed: p.speed,
      isTurn: p.isTurn === true,
    }
  })
}

/** 高度归一化：平飞退化取中位，杜绝除零。与舞台 palette.altitudeT 同口径。 */
export function altitudeT(alt, bounds) {
  const span = bounds.maxAlt - bounds.minAlt
  if (!(span > 0) || !Number.isFinite(alt)) return 0.5
  return clamp01((alt - bounds.minAlt) / span)
}

function hexToRgb(hex) {
  const h = String(hex).replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** 低空青 → 高空暖金连续插值；t=0 / t=1 精确等于端点令牌色。 */
export function mixTraceColor(cyan, gold, t) {
  const a = hexToRgb(cyan)
  const b = hexToRgb(gold)
  const k = clamp01(t)
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * k))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

function boundsSpan(bounds) {
  if (bounds.maxSpan > 0) return bounds.maxSpan
  return Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, bounds.maxAlt - bounds.minAlt, 1)
}

/** 各段按中点深度从远到近排序（画家算法）；线宽 = 2·radius（米），与舞台同口径。 */
export function buildSegments(proj, stats, bounds) {
  const span = boundsSpan(bounds)
  const radiusMin = span * PROJECTOR_RADIUS_RATIO.min
  const radiusMax = span * PROJECTOR_RADIUS_RATIO.max
  const speedNorm = makeSpeedScale(stats)
  const segments = []
  for (let i = 0; i < proj.length - 1; i += 1) {
    const a = proj[i]
    const b = proj[i + 1]
    const t = altitudeT((a.alt + b.alt) / 2, bounds)
    const sn = speedNorm((a.speed + b.speed) / 2)
    const radius = radiusMax + (radiusMin - radiusMax) * sn
    segments.push({
      ax: a.sx,
      ay: a.sy,
      bx: b.sx,
      by: b.sy,
      depth: (a.depth + b.depth) / 2,
      t,
      widthM: 2 * radius,
    })
  }
  segments.sort((p, q) => p.depth - q.depth)
  return segments
}

/** isTurn 发光点，按深度同序（末层柔光叠绘时保持远→近）。 */
export function buildGlows(proj) {
  return proj
    .filter((p) => p.isTurn)
    .map((p) => ({ sx: p.sx, sy: p.sy, depth: p.depth }))
    .sort((p, q) => p.depth - q.depth)
}

/** 投影 bbox 适配到画布；竖轴取 -sy。返回 scale 与偏移。 */
export function fitProjection(proj, width, height, pad = PROJECTOR_PAD) {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const p of proj) {
    if (p.sx < minX) minX = p.sx
    if (p.sx > maxX) maxX = p.sx
    if (p.sy < minY) minY = p.sy
    if (p.sy > maxY) maxY = p.sy
  }
  const spanX = maxX - minX > 0 ? maxX - minX : 1
  const spanY = maxY - minY > 0 ? maxY - minY : 1
  const scale = Math.min(width / spanX, height / spanY) / pad
  const ox = width / 2 - ((minX + maxX) / 2) * scale
  const oy = height / 2 + ((minY + maxY) / 2) * scale
  return { scale, ox, oy }
}

/**
 * 渲染透明底雕塑图。colors = { cyan, gold } 由调用方解析令牌注入。
 * @returns {HTMLCanvasElement}
 */
export function renderSculpture({ points, bounds, stats, width, height, colors, pad = PROJECTOR_PAD }) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  const proj = projectPoints(points, bounds)
  const segments = buildSegments(proj, stats, bounds)
  const glows = buildGlows(proj)
  const fit = fitProjection(proj, width, height, pad)
  const px = (sx, sy) => [sx * fit.scale + fit.ox, -sy * fit.scale + fit.oy]

  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const seg of segments) {
    const [x1, y1] = px(seg.ax, seg.ay)
    const [x2, y2] = px(seg.bx, seg.by)
    ctx.strokeStyle = mixTraceColor(colors.cyan, colors.gold, seg.t)
    ctx.lineWidth = Math.max(0.5, seg.widthM * fit.scale)
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
  }

  // 末层柔光：发光点叠在最上，按深度远→近，避免与线段交叉穿帮。
  const glowBase = Math.max(3, boundsSpan(bounds) * PROJECTOR_RADIUS_RATIO.max * fit.scale * 2.2)
  const [gr, gg, gb] = hexToRgb(colors.gold)
  for (const g of glows) {
    const [x, y] = px(g.sx, g.sy)
    const halo = ctx.createRadialGradient(x, y, 0, x, y, glowBase)
    halo.addColorStop(0, `rgba(${gr},${gg},${gb},0.85)`)
    halo.addColorStop(0.4, `rgba(${gr},${gg},${gb},0.28)`)
    halo.addColorStop(1, `rgba(${gr},${gg},${gb},0)`)
    ctx.fillStyle = halo
    ctx.beginPath()
    ctx.arc(x, y, glowBase, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = colors.gold
    ctx.beginPath()
    ctx.arc(x, y, glowBase * 0.34, 0, Math.PI * 2)
    ctx.fill()
  }

  return canvas
}