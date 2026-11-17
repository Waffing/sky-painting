import { makePoint } from '../utils/flightData.js'

/**
 * 手绘笔迹 → 原始点列。只做「造数据」，不做任何统计：
 * 重采样后的点列直接交给 Step 1 的 processFlightData()，走同一套转弯/抽稀/指标流水线。
 * 空域写死 300m × 300m、基准 60m、正弦振幅 25m，不跟随上一条轨迹的 bounds 或视野缩放。
 */

export const DRAW_BOARD = {
  half: 150,
  baseAlt: 60,
  altAmplitude: 25,
  bounds: { minX: -150, maxX: 150, minY: -150, maxY: 150, minAlt: 35, maxAlt: 85, maxSpan: 300 },
}

export const MIN_STROKE_POINTS = 12
export const MIN_STROKE_METERS = 8

const clamp = (value, low, high) => (value < low ? low : value > high ? high : value)

export function strokeLength(stroke) {
  let total = 0
  for (let i = 1; i < stroke.length; i += 1) {
    total += Math.hypot(stroke[i].x - stroke[i - 1].x, stroke[i].y - stroke[i - 1].y)
  }
  return total
}

/** 均匀弧长重采样，首尾严格落在笔迹端点上。 */
export function resampleStroke(stroke, targetCount) {
  const count = Math.max(2, Math.round(targetCount))
  const segments = []
  let total = 0
  for (let i = 1; i < stroke.length; i += 1) {
    const length = Math.hypot(stroke[i].x - stroke[i - 1].x, stroke[i].y - stroke[i - 1].y)
    segments.push(length)
    total += length
  }
  if (!(total > 0)) return stroke.slice(0, count)

  const out = [{ x: stroke[0].x, y: stroke[0].y }]
  let walked = 0
  let index = 0
  for (let k = 1; k < count - 1; k += 1) {
    const target = (total * k) / (count - 1)
    while (index < segments.length - 1 && walked + segments[index] < target) {
      walked += segments[index]
      index += 1
    }
    const span = segments[index]
    const ratio = span > 0 ? (target - walked) / span : 0
    const a = stroke[index]
    const b = stroke[index + 1]
    out.push({ x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio })
  }
  const last = stroke[stroke.length - 1]
  out.push({ x: last.x, y: last.y })
  return out
}

export const TOO_SHORT_MESSAGE = `这一笔太短：至少画 ${MIN_STROKE_METERS} 米长、${MIN_STROKE_POINTS} 个采样点，请重画。`

/**
 * @returns {{ok: true, points: object[], meta: object} | {ok: false, error: string}}
 */
export function buildHandFlight(stroke) {
  const cleaned = (Array.isArray(stroke) ? stroke : [])
    .filter((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y))
    .map((point) => ({
      x: clamp(point.x, -DRAW_BOARD.half, DRAW_BOARD.half),
      y: clamp(point.y, -DRAW_BOARD.half, DRAW_BOARD.half),
    }))

  const length = strokeLength(cleaned)
  if (cleaned.length < MIN_STROKE_POINTS || !(length >= MIN_STROKE_METERS)) {
    return { ok: false, error: TOO_SHORT_MESSAGE }
  }

  const targetCount = clamp(Math.round(length / 3), 120, 240)
  const samples = resampleStroke(cleaned, targetCount)
  const distances = []
  let walked = 0
  for (let i = 1; i < samples.length; i += 1) {
    walked += Math.hypot(samples[i].x - samples[i - 1].x, samples[i].y - samples[i - 1].y)
    distances.push(walked)
  }

  // 弯道减速：与内置 8 字示例同一规律（局部转角 / 跨度，按最大值归一）。
  // 笔迹是粗折线：相邻三点转角只会在折线顶点处非零，速度随之锯齿化、管径渲染成一串珠子。
  // 改用跨约两个原始笔迹段的弦向切线，再取切线角差分——折线顶点被弦窗抹平，曲率连续。
  const stencil = Math.max(2, Math.round((2 * samples.length) / Math.max(1, cleaned.length)))
  const tangentAngle = samples.map((_, i) => {
    const a = samples[Math.max(0, i - stencil)]
    const c = samples[Math.min(samples.length - 1, i + stencil)]
    return Math.atan2(c.y - a.y, c.x - a.x)
  })
  const rawBendings = samples.map((_, i) => {
    if (i === 0 || i === samples.length - 1) return 0
    const prev = tangentAngle[i - 1]
    const next = tangentAngle[i + 1]
    let delta = next - prev
    while (delta > Math.PI) delta -= Math.PI * 2
    while (delta < -Math.PI) delta += Math.PI * 2
    const ds = Math.hypot(samples[i + 1].x - samples[i - 1].x, samples[i + 1].y - samples[i - 1].y)
    return ds > 0 ? Math.abs(delta) / ds : 0
  })
  // 宽窗滑动平均：窗长约两个原始笔迹段，把折线顶点频率的残余波纹压到不可见。
  const windowRadius = Math.max(3, Math.round((2 * samples.length) / Math.max(1, cleaned.length)))
  const bendings = rawBendings.map((_, i) => {
    let sum = 0
    let count = 0
    for (let k = i - windowRadius; k <= i + windowRadius; k += 1) {
      if (k < 1 || k >= rawBendings.length - 1) continue
      sum += rawBendings[k]
      count += 1
    }
    return count > 0 ? sum / count : 0
  })
  const smoothInner = bendings.slice(1, -1)
  const maxBending = smoothInner.length ? Math.max(...smoothInner) : 0

  const points = []
  let t = 0
  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i]
    const progress = walked > 0 ? (i === 0 ? 0 : distances[i - 1] / walked) : 0
    const alt = DRAW_BOARD.baseAlt + DRAW_BOARD.altAmplitude * Math.sin(Math.PI * 4 * progress)
    const speed = 13 - 7.5 * clamp(maxBending > 0 ? bendings[i] / maxBending : 0, 0, 1)
    if (i > 0) {
      const previous = points[i - 1]
      const velocity = (previous.speed + speed) / 2
      const ds = Math.hypot(sample.x - previous.x, sample.y - previous.y)
      t += velocity > 0 ? ds / velocity : 0
    }
    points.push(makePoint({ x: sample.x, y: sample.y, alt, speed, t, isTurn: false }))
  }

  return {
    ok: true,
    points,
    meta: { strokePoints: cleaned.length, strokeLength: length, resampledTo: points.length },
  }
}