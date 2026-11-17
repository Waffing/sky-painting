/**
 * 轨迹数据层
 *
 * 边界（硬规格，改动前先读这几条）：
 *   1. 只有米制平面直角坐标：x 向东、y 向北、alt 为海拔高度（米）。本文件不出现
 *      Three.js / Canvas / 屏幕像素 / 视口归一化等任何渲染器概念，也不做任何缩放。
 *   2. 点结构冻结为 6 个字段 { x, y, alt, speed, t, isTurn }。真实时间戳走 timeMeta 旁路，
 *      不塞进点里；t 是时间序号（秒，相对起点）。
 *   3. 流水线顺序写死：解析/生成原始点列 → 原始点列上算统计 → 原始点列上判转弯 →
 *      抽稀 → 平移居中。里程、爬升、起伏度等一律以原始点列为准，抽稀后的点不参与统计。
 *      转弯判定与统计都只消费原始点列，因此二者的先后互换不改变任何数值；
 *      stats.turnCount 依赖转弯判定结果，故指标对象在转弯判定之后一次性组装。
 *   4. 本文件零 DOM、零 localStorage 读写，可被 node 直接 import 做纯逻辑测试。
 */

export const POINT_FIELDS = ['x', 'y', 'alt', 'speed', 't', 'isTurn']

/** 抽稀硬顶：单条轨迹入库点数上限。 */
export const MAX_STORED_POINTS = 240

/** 转弯判定：累计带符号航向转角阈值（度）。 */
export const TURN_THRESHOLD_DEG = 35

/** 转弯判定：相邻段距离小于该米数时不参与航向累计（防悬停 / GPS 抖动刷假转弯）。 */
export const MIN_TURN_SEGMENT_METERS = 1

/** 冻结的指标集，字段名与顺序都不得增删；后续步骤只许消费。 */
export const STATS_FIELDS = [
  'totalDistance',
  'maxAlt',
  'avgSpeed',
  'maxSpeed',
  'speedStd',
  'turnCount',
  'closure',
  'altStd',
  'totalClimb',
  'duration',
  'isEstimatedDuration',
]

/** 局部等距投影常数（米/度）。 */
export const METERS_PER_DEG_LAT = 110540
export const METERS_PER_DEG_LON_EQUATOR = 111320

/** 示例 CSV 反推经纬度时使用的起点：北部湾海岸附近。 */
export const SAMPLE_CSV_ORIGIN = { lat: 21.55, lon: 109.15 }

const DEG_TO_RAD = Math.PI / 180

/* ------------------------------------------------------------------ 数值工具 */

function toFinite(value, fallback = 0) {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : fallback
}

function round(value, digits = 4) {
  const n = toFinite(value, 0)
  const factor = 10 ** digits
  return Math.round(n * factor) / factor
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

/** 相邻点三维间距（含垂直分量）；里程与累计爬升都用这个口径。 */
function segmentDistance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y, b.alt - a.alt)
}

function mean(values) {
  if (!values.length) return 0
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

/** 总体标准差；空序列返回 0，绝不返回 NaN。 */
function populationStd(values) {
  if (!values.length) return 0
  const m = mean(values)
  const variance = mean(values.map((v) => (v - m) * (v - m)))
  return toFinite(Math.sqrt(variance), 0)
}

/* --------------------------------------------------------------- 点构造函数 */

/**
 * 生成合法轨迹点：字段固定 6 个，非有限值归零，数值保留 4 位小数。
 * @param {Partial<{x:number,y:number,alt:number,speed:number,t:number,isTurn:boolean}>} input
 */
export function makePoint(input = {}) {
  return {
    x: round(toFinite(input.x), 4),
    y: round(toFinite(input.y), 4),
    alt: round(toFinite(input.alt), 4),
    speed: round(toFinite(input.speed), 4),
    t: round(toFinite(input.t), 4),
    isTurn: input.isTurn === true,
  }
}

/** 只保留坐标可解析的点，并按原顺序重新编号。 */
function sanitizePoints(list) {
  const out = []
  for (const item of Array.isArray(list) ? list : []) {
    if (!item) continue
    const x = Number(item.x)
    const y = Number(item.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    out.push(makePoint({ ...item, x, y }))
  }
  return out
}

/* ------------------------------------------------------------- 内置示例航迹 */

// 速度基准为常规多旋翼量级：巡航 8–15 m/s、峰值不超过 18 m/s，弯道减速比例与几何无关地保留。

/**
 * 通用装配：给定等间隔的 {x,y,alt,speed} 序列，按「相邻段距离 / 相邻两点速度均值」
 * 累加出时间序号 t（秒）。示例的速度是假设值，因此示例时长一律走估算口径。
 */
function stampTime(sequence) {
  let t = 0
  return sequence.map((sample, index) => {
    if (index > 0) {
      const prev = sequence[index - 1]
      const velocity = (prev.speed + sample.speed) / 2
      t += velocity > 0 ? segmentDistance(makePoint(prev), makePoint(sample)) / velocity : 0
    }
    return makePoint({ ...sample, t })
  })
}

/** ① 环形绕飞：闭合整圆 + 高度四倍频正弦起伏。 */
function buildLoop(count = 216) {
  const radius = 150
  return stampTime(
    Array.from({ length: count }, (_, i) => {
      const theta = (Math.PI * 2 * i) / (count - 1)
      return {
        x: radius * Math.cos(theta),
        y: radius * Math.sin(theta),
        alt: 120 + 35 * Math.sin(4 * theta),
        speed: 11.5 + 1.7 * Math.sin(2 * theta),
      }
    }),
  )
}

/** ② 8 字盘旋：双环利萨如曲线，按三点局部转角算曲率，弯道自然减速。 */
function buildFigureEight(count = 224) {
  const amplitudeX = 260
  const amplitudeY = 170
  const step = (Math.PI * 2) / (count - 1)
  const at = (theta) => ({
    x: amplitudeX * Math.sin(theta),
    y: amplitudeY * Math.sin(2 * theta),
  })

  const samples = Array.from({ length: count }, (_, i) => at(i * step))

  // 先取全部局部转角幅度，再按最大值归一，保证弯道处确实慢下来而直道保持高速。
  const bendings = samples.map((_, i) => {
    if (i === 0 || i === samples.length - 1) return 0
    const a = samples[i - 1]
    const b = samples[i]
    const c = samples[i + 1]
    const angle = Math.abs(headingDelta(a, b, c))
    const ds = Math.min(Math.hypot(b.x - a.x, b.y - a.y), Math.hypot(c.x - b.x, c.y - b.y))
    return ds > 0 ? angle / ds : 0
  })
  const maxBending = Math.max(...bendingForStatsSafe(bendings)) || 1

  return stampTime(
    samples.map((p, i) => ({
      x: p.x,
      y: p.y,
      alt: 110 + 30 * Math.sin(2 * (i * step)),
      speed: 13 - 7.5 * clamp(bendings[i] / maxBending, 0, 1),
    })),
  )
}

function bendingForStatsSafe(values) {
  // 取中段样本估计最大值，避免首尾 0 值把尺度带偏。
  const inner = values.slice(1, -1)
  return inner.length ? inner : values
}

/** ③ 海岸巡航：大弧线航路 + 一次明显爬升与一次俯冲。 */
function buildCoastalCruise(count = 208) {
  const radius = 650
  const from = -0.9
  const to = 1.6
  const ease = (k) => k * k * (3 - 2 * k)

  const altitudeAt = (s) => {
    if (s < 0.15) return 90
    if (s < 0.42) return 90 + 170 * ease((s - 0.15) / 0.27) // 爬升到约 260 m
    if (s < 0.68) return 260 - 200 * ease((s - 0.42) / 0.26) // 俯冲降到约 60 m
    return 60 + 18 * Math.sin(6 * (s - 0.68)) // 低空收尾
  }

  return stampTime(
    Array.from({ length: count }, (_, i) => {
      const s = i / (count - 1)
      const u = from + (to - from) * s
      const wobble = 1 + 0.06 * Math.sin(3 * u)
      const alt = altitudeAt(s)
      const speed = s < 0.15 ? 11 : s < 0.42 ? 9.6 : s < 0.68 ? 14 : 11.5
      return {
        x: radius * wobble * Math.sin(u),
        y: radius * wobble * Math.cos(u),
        alt,
        speed: speed + 0.5 * Math.sin(9 * u),
      }
    }),
  )
}

/** 内置示例清单：名称与一句简介。点数均控制在 180–240。 */
export const SAMPLE_FLIGHTS = [
  {
    id: 'loop',
    name: '环形绕飞',
    blurb: '绕着一个圆心飞满一圈，高度按四个周期起伏，适合当闭合度接近 0 的基准样本。',
    build: () => buildLoop(),
  },
  {
    id: 'figure-eight',
    name: '8 字盘旋',
    blurb: '双环利萨如航线，左右各转一圈，弯道自动减速，用来验证转弯计数。',
    build: () => buildFigureEight(),
  },
  {
    id: 'coastal',
    name: '海岸巡航',
    blurb: '沿海岸大弧线一路推进，中段一次明显爬升、紧接一次俯冲，累计爬升与起伏度都会拉高。',
    build: () => buildCoastalCruise(),
  },
]

/* ---------------------------------------------------------------- 统计指标 */

/**
 * 在原始点列上计算 11 项冻结指标。
 * @param {object[]} rawPoints 原始点列（不得传抽稀后的点列）
 * @param {{timeMeta?: object|null, turnCount?: number}} options
 *   timeMeta.kind === 'real' 时用真实时长，否则按总距离 / 平均速度估算。
 *   turnCount 由流水线 c 步的转弯判定传入；省略时内部自行对原始点列判定一次。
 */
export function computeStats(rawPoints, options = {}) {
  const points = sanitizePoints(rawPoints)
  const empty = {
    totalDistance: 0,
    maxAlt: 0,
    avgSpeed: 0,
    maxSpeed: 0,
    speedStd: 0,
    turnCount: 0,
    closure: 0,
    altStd: 0,
    totalClimb: 0,
    duration: 0,
    isEstimatedDuration: true,
  }
  if (points.length < 2) return empty

  let totalDistance = 0
  let totalClimb = 0
  for (let i = 1; i < points.length; i += 1) {
    totalDistance += segmentDistance(points[i - 1], points[i])
    const dAlt = points[i].alt - points[i - 1].alt
    if (dAlt > 0) totalClimb += dAlt
  }

  const speeds = points.map((p) => p.speed)
  const alts = points.map((p) => p.alt)
  const avgSpeed = mean(speeds)
  // 大文件可达数万点，用循环求极值，避免 Math.max(...arr) 把调用栈撑爆。
  let maxAlt = alts[0]
  let maxSpeed = speeds[0]
  for (let i = 1; i < points.length; i += 1) {
    if (alts[i] > maxAlt) maxAlt = alts[i]
    if (speeds[i] > maxSpeed) maxSpeed = speeds[i]
  }
  const first = points[0]
  const last = points[points.length - 1]
  const straightLine = Math.hypot(last.x - first.x, last.y - first.y, last.alt - first.alt)

  const timeMeta = options.timeMeta
  const hasRealDuration =
    timeMeta &&
    timeMeta.kind === 'real' &&
    toFinite(timeMeta.realDurationSeconds, 0) > 0

  return {
    totalDistance: round(totalDistance, 2),
    maxAlt: round(maxAlt, 2),
    avgSpeed: round(avgSpeed, 3),
    maxSpeed: round(maxSpeed, 3),
    speedStd: round(populationStd(speeds), 3),
    turnCount:
      options.turnCount === undefined
        ? detectTurns(points).turnCount
        : Math.max(0, Math.round(toFinite(options.turnCount, 0))),
    closure: round(totalDistance > 0 ? straightLine / totalDistance : 0, 4),
    altStd: round(populationStd(alts), 2),
    totalClimb: round(totalClimb, 2),
    duration: round(hasRealDuration ? timeMeta.realDurationSeconds : avgSpeed > 0 ? totalDistance / avgSpeed : 0, 2),
    isEstimatedDuration: !hasRealDuration,
  }
}

/* ---------------------------------------------------------------- 转弯判定 */

/** 三段点之间的带符号航向变化：左转为正、右转为负，直线抖动会自然抵消。 */
function headingDelta(a, b, c) {
  const dx1 = b.x - a.x
  const dy1 = b.y - a.y
  const dx2 = c.x - b.x
  const dy2 = c.y - b.y
  const cross = dx1 * dy2 - dy1 * dx2
  const dot = dx1 * dx2 + dy1 * dy2
  if (cross === 0 && dot === 0) return 0
  return Math.atan2(cross, dot)
}

/**
 * 流水线 c：在原始点列上累计带符号航向转角，|累计| 达到阈值即记 1 次转弯、
 * 在触发点打 isTurn 标记并清零重新累计。
 *
 * 防噪口径：相邻段距离 < 1 米的段完全不参与航向累计（其角度永不进入累加器）。
 * 累计时以上一条「可信段」的航向为基准，因此角点两侧正好出现重复点或悬停抖动时，
 * 真实转弯仍然只记 1 次，而纯悬停（进出一条段航向相同）不会刷出假转弯。
 * 触发点取这条可信段的起点；两段相邻时它正是转弯顶点。
 * @returns {{ points: object[], turnCount: number, turnMagnitudes: Array<{index:number,magnitudeDeg:number}>, skippedShortSegments: number }}
 */
export function detectTurns(rawPoints, options = {}) {
  const thresholdDeg = toFinite(options.thresholdDeg, TURN_THRESHOLD_DEG)
  const minSegmentMeters = toFinite(options.minSegmentMeters, MIN_TURN_SEGMENT_METERS)
  const points = sanitizePoints(rawPoints)

  let accumulatedRad = 0
  let turnCount = 0
  let skippedShortSegments = 0
  let previousUnit = null
  const turnMagnitudes = []

  for (let k = 0; k + 1 < points.length; k += 1) {
    const dx = points[k + 1].x - points[k].x
    const dy = points[k + 1].y - points[k].y
    const length = Math.hypot(dx, dy)
    if (length < minSegmentMeters) {
      skippedShortSegments += 1
      continue
    }

    const unit = { x: dx / length, y: dy / length }
    if (previousUnit) {
      // 左转为正、右转为负；直线上的左右抖动在这一步自然抵消。
      const cross = previousUnit.x * unit.y - previousUnit.y * unit.x
      const dot = previousUnit.x * unit.x + previousUnit.y * unit.y
      accumulatedRad += Math.atan2(cross, dot)

      if (Math.abs(accumulatedRad / DEG_TO_RAD) >= thresholdDeg) {
        points[k].isTurn = true
        turnMagnitudes.push({ index: k, magnitudeDeg: round(Math.abs(accumulatedRad / DEG_TO_RAD), 2) })
        turnCount += 1
        accumulatedRad = 0
      }
    }
    previousUnit = unit
  }

  return { points, turnCount, turnMagnitudes, skippedShortSegments }
}

/* -------------------------------------------------------------------- 抽稀 */

/**
 * 流水线 d：抽稀到硬顶 240 点。关键点保底 + 剩余预算均匀采样。
 *   - 强制保留起点、终点与全部 isTurn 点；
 *   - isTurn 点本身放不下时，按触发时的累计转角幅度降序截断；
 *   - 其余名额按原数组下标均匀补采样；
 *   - 结果按原始数组下标升序排回（不按 t，避免时间戳相等或异常时乱序）。
 */
export function decimatePoints(points, options = {}) {
  const source = sanitizePoints(points)
  const n = source.length
  if (n === 0) return []

  const requested = Math.floor(toFinite(options.maxPoints, MAX_STORED_POINTS))
  const cap = requested >= 2 ? requested : MAX_STORED_POINTS
  if (n <= cap) return source

  const magnitudeByIndex = new Map()
  for (const turn of options.turnMagnitudes || []) {
    if (turn && typeof turn.index === 'number') magnitudeByIndex.set(turn.index, toFinite(turn.magnitudeDeg, 0))
  }

  const keep = new Set([0, n - 1])
  const turnIndices = source.reduce((acc, point, index) => (point.isTurn ? acc.concat(index) : acc), [])

  const turnBudget = cap - keep.size
  let selectedTurns = turnIndices
  if (turnIndices.length > turnBudget) {
    selectedTurns = turnIndices
      .map((index) => ({ index, magnitude: magnitudeByIndex.get(index) || 0 }))
      .sort((a, b) => b.magnitude - a.magnitude || a.index - b.index)
      .slice(0, Math.max(0, turnBudget))
      .map((item) => item.index)
  }
  for (const index of selectedTurns) keep.add(index)

  const remaining = cap - keep.size
  if (remaining > 0) {
    const candidates = []
    for (let i = 0; i < n; i += 1) if (!keep.has(i)) candidates.push(i)

    if (candidates.length <= remaining) {
      for (const index of candidates) keep.add(index)
    } else if (remaining === 1) {
      keep.add(candidates[Math.floor(candidates.length / 2)])
    } else {
      for (let k = 0; k < remaining; k += 1) {
        const position = Math.round((k * (candidates.length - 1)) / (remaining - 1))
        keep.add(candidates[clamp(position, 0, candidates.length - 1)])
      }
    }
  }

  return [...keep]
    .sort((a, b) => a - b)
    .map((index) => source[index])
}

/* ------------------------------------------------------------ 平移居中 */

const EMPTY_BOUNDS = {
  minX: 0,
  maxX: 0,
  minY: 0,
  maxY: 0,
  minAlt: 0,
  maxAlt: 0,
  maxSpan: 0,
}

/**
 * 流水线 e：对抽稀后的点列做质心平移（只平移，不缩放，缩放是渲染层的事）。
 * alt 保持绝对海拔不动，避免把真实高度搬成 0 上下波动、破坏 maxAlt / totalClimb 口径。
 * bounds 供渲染层居中 fit，maxSpan 含高度跨度，便于 3D 镜头一次算出适配距离。
 * @returns {{ points: object[], centroid: {x:number,y:number}, bounds: typeof EMPTY_BOUNDS }}
 */
export function centerWithBounds(points) {
  const source = sanitizePoints(points)
  if (!source.length) return { points: [], centroid: { x: 0, y: 0 }, bounds: { ...EMPTY_BOUNDS } }

  const centroid = { x: mean(source.map((p) => p.x)), y: mean(source.map((p) => p.y)) }
  const moved = source.map((p) => makePoint({ ...p, x: p.x - centroid.x, y: p.y - centroid.y }))

  const xs = moved.map((p) => p.x)
  const ys = moved.map((p) => p.y)
  const alts = moved.map((p) => p.alt)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const minAlt = Math.min(...alts)
  const maxAlt = Math.max(...alts)

  const bounds = {
    minX: round(minX, 3),
    maxX: round(maxX, 3),
    minY: round(minY, 3),
    maxY: round(maxY, 3),
    minAlt: round(minAlt, 3),
    maxAlt: round(maxAlt, 3),
  }

  // 用已取整的极值算跨度，保证渲染层拿到的 bounds 内部自洽。
  bounds.maxSpan = round(
    Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, bounds.maxAlt - bounds.minAlt),
    3,
  )

  return {
    points: moved,
    centroid: { x: round(centroid.x, 3), y: round(centroid.y, 3) },
    bounds,
  }
}

/* ---------------------------------------------------------------- 流水线 */

/**
 * a → b/c（均在原始点列上）→ d → e 的唯一入口。
 * @param {object[] | {ok:boolean, points?:object[], timeMeta?:object, notes?:string[]}} source
 *   原始点列数组，或 parseFlightCsv 的成功结果。
 */
export function processFlightData(source, options = {}) {
  let rawPoints = []
  let timeMeta = options.timeMeta || null
  const notes = []

  if (Array.isArray(source)) {
    rawPoints = sanitizePoints(source)
  } else if (source && source.ok === true) {
    rawPoints = sanitizePoints(source.points)
    timeMeta = source.timeMeta || null
    notes.push(...(source.notes || []))
    if (source.name) notes.unshift(`来自文件《${source.name}》。`)
  } else {
    return {
      ok: false,
      error:
        (source && source.error) ||
        '没读到有效航迹：请确认选中或生成的是带经纬度（或 x/y 平面坐标）的飞行记录文本。',
    }
  }

  if (rawPoints.length < 2) {
    return {
      ok: false,
      error: `航迹至少需要 2 个有效点才能算里程和转弯，这次只解析到 ${rawPoints.length} 个。`,
    }
  }

  // b / c：都只读原始点列。stats.turnCount 依赖转弯判定，故先跑判定再组装指标。
  const turn = detectTurns(rawPoints, options)
  const stats = computeStats(rawPoints, { timeMeta, turnCount: turn.turnCount })

  // d：抽稀只影响送去渲染与入库的点，不回灌任何统计。
  const decimated = decimatePoints(turn.points, {
    maxPoints: toFinite(options.maxPoints, MAX_STORED_POINTS),
    turnMagnitudes: turn.turnMagnitudes,
  })

  // e：平移居中。
  const centered = centerWithBounds(decimated)

  const isTurnCountRaw = turn.points.filter((p) => p.isTurn).length
  const isTurnCountDecimated = centered.points.filter((p) => p.isTurn).length

  if (isTurnCountRaw !== stats.turnCount) {
    notes.push(`异常：原始 isTurn 点数 ${isTurnCountRaw} 与 turnCount ${stats.turnCount} 不一致。`)
  }
  if (isTurnCountDecimated !== isTurnCountRaw) {
    notes.push(`抽稀时按转角幅度截断，丢弃了 ${isTurnCountRaw - isTurnCountDecimated} 个次要转弯点。`)
  }
  if (stats.isEstimatedDuration) {
    notes.push('时长为估算值：按总距离 / 平均速度算出，界面请显示「估算时长」。')
  }

  return {
    ok: true,
    stats,
    points: centered.points,
    bounds: centered.bounds,
    centroid: centered.centroid,
    rawPointCount: rawPoints.length,
    pointCount: centered.points.length,
    maxPoints: Math.floor(toFinite(options.maxPoints, MAX_STORED_POINTS)),
    isTurnCountRaw,
    isTurnCountDecimated,
    turnMagnitudes: turn.turnMagnitudes,
    skippedShortSegments: turn.skippedShortSegments,
    timeMeta,
    notes,
  }
}

/** 取内置示例并走完整流水线；示例速度是假设值，时长一律为估算。 */
export function processSampleFlight(id, options = {}) {
  const sample = SAMPLE_FLIGHTS.find((item) => item.id === id) || SAMPLE_FLIGHTS[0]
  const processed = processFlightData(sample.build(), options)
  if (!processed.ok) return processed

  return {
    ...processed,
    sampleId: sample.id,
    name: sample.name,
    blurb: sample.blurb,
    isSample: true,
    notes: ['内置示例：速度为假设值，无真实时间戳，时长走估算口径。', ...processed.notes],
  }
}

/* ------------------------------------------------- 真实飞行日志 CSV 解析 */

const HEADER_ALIASES = {
  lat: ['lat', 'latitude', '纬度', '北纬度'],
  lon: ['lon', 'lng', 'long', 'longitude', '经度', '东经度'],
  x: ['x', 'xe', 'east', '东向'],
  y: ['y', 'yn', 'north', '北向'],
  alt: ['alt', 'altitude', 'height', '高度', '高程'],
  speed: ['speed', 'vel', 'velocity', '速度'],
  time: ['time', 'datetime', 'timestamp', '时间', '时刻'],
}

function normalizeHeader(cell) {
  return String(cell ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_.\-'"']/g, '')
}

function sniffDelimiter(line) {
  const candidates = [',', ';', '\t', '|']
  let best = ','
  let bestCount = 0
  for (const char of candidates) {
    const count = line.split(char).length - 1
    if (count > bestCount) {
      best = char
      bestCount = count
    }
  }
  return best
}

function splitRow(line, delimiter) {
  return line
    .split(delimiter)
    .map((cell) => cell.trim().replace(/^"([\s\S]*)"$/, '$1'))
}

/** 表头宽松匹配：忽略大小写、空格、下划线与连字符。 */
function matchColumns(headerCells) {
  const found = {}
  headerCells.forEach((cell, index) => {
    const key = normalizeHeader(cell)
    if (!key) return
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (found[field] === undefined && aliases.includes(key)) {
        found[field] = index
        break
      }
    }
  })

  const hasLatLng = found.lat !== undefined && found.lon !== undefined
  const hasPlane = found.x !== undefined && found.y !== undefined
  if (!hasLatLng && !hasPlane) return null

  return { ...found, mode: hasLatLng ? 'latlon' : 'xy' }
}

function toNumberCell(cell) {
  if (cell === undefined || cell === null) return null
  const raw = String(cell).trim().replace(/\s+/g, '').replace(',', '.')
  if (!raw || raw.toLowerCase() === 'nan' || raw.toLowerCase() === 'null' || raw.toLowerCase() === '-') return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

/** 时间列容错：ISO 字符串、Unix 秒、Unix 毫秒、相对秒数四种口径。 */
function parseTimeCell(cell) {
  if (cell === undefined || cell === null || String(cell).trim() === '') {
    return { ok: false, reason: 'empty' }
  }
  const raw = String(cell).trim()
  const numeric = toNumberCell(raw)
  if (numeric !== null && !/[a-z]/i.test(raw)) {
    if (numeric > 1e12) return { ok: true, seconds: numeric / 1000 } // Unix 毫秒
    if (numeric > 1e9) return { ok: true, seconds: numeric } // Unix 秒
    return { ok: true, seconds: numeric } // 相对秒数
  }
  const parsed = Date.parse(raw)
  if (Number.isFinite(parsed)) return { ok: true, seconds: parsed / 1000 }
  return { ok: false, reason: 'unparseable' }
}

/**
 * 时间轴只在整列可用且单调不减时才认定为真实时长；
 * 混用口径、无法解析、时间倒退或总时长非正，一律降级为估算，不抛错。
 */
function buildTimeline(timeCells) {
  const degraded = (badCount) => ({
    kind: 'unreliable',
    timestampsSeconds: [],
    realDurationSeconds: 0,
    badCount,
  })

  const parsed = timeCells.map(parseTimeCell)
  const badCount = parsed.filter((item) => !item.ok).length
  if (badCount) return degraded(badCount)
  if (parsed.length < 2) return degraded(0)

  const seconds = parsed.map((item) => item.seconds)
  const start = seconds[0]
  const relative = seconds.map((value) => value - start)
  for (let i = 1; i < relative.length; i += 1) {
    if (relative[i] < relative[i - 1]) return degraded(0) // 时间倒退
  }

  const realDurationSeconds = relative[relative.length - 1]
  if (!(realDurationSeconds > 0)) return degraded(0)

  return {
    kind: 'real',
    timestampsSeconds: relative.map((value) => round(value, 3)),
    realDurationSeconds: round(realDurationSeconds, 3),
    badCount: 0,
  }
}

/** 经纬度 → 以起点为原点的局部等距投影平面坐标（米，x 东 y 北）。 */
function latLonToLocalMeters(frames, origin) {
  const cosLat0 = Math.cos(origin.lat * DEG_TO_RAD) || 1e-9
  return frames.map((frame) => ({
    ...frame,
    x: (frame.lon - origin.lon) * METERS_PER_DEG_LON_EQUATOR * cosLat0,
    y: (frame.lat - origin.lat) * METERS_PER_DEG_LAT,
  }))
}

function csvFailure(error) {
  return { ok: false, error, points: [], notes: [] }
}

/**
 * 解析真实飞行日志 CSV。零崩溃：任何意外都转成友好中文报错。
 * @returns {{ok:boolean, points?:object[], timeMeta?:object, notes?:string[], source?:object, error?:string}}
 */
export function parseFlightCsv(text) {
  try {
    if (typeof text !== 'string' || text.trim() === '') {
      return csvFailure('CSV 内容是空的：请确认选中的是飞行记录文本文件，不是文件夹或其他格式。')
    }

    // BOM 用码位判断，避免源码里出现不可见字符。
    const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
    const lines = body
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '' && !line.trim().startsWith('#'))

    if (lines.length < 2) {
      return csvFailure('至少要有一行表头加一行数据：这份文件里没读到有效数据行。')
    }

    const delimiter = sniffDelimiter(lines[0])
    const header = splitRow(lines[0], delimiter)
    const columns = matchColumns(header)
    if (!columns) {
      return csvFailure(
        `没认出坐标列。表头需要成对的经纬度（lat / lon / 经度 / 纬度）或平面坐标（x / y），当前读到的表头是：${header.join(' | ')}。`,
      )
    }

    const notes = []
    const rawFrames = []
    let skippedRows = 0

    for (let i = 1; i < lines.length; i += 1) {
      const cells = splitRow(lines[i], delimiter)
      const frame = {}

      if (columns.mode === 'latlon') {
        const lat = toNumberCell(cells[columns.lat])
        const lon = toNumberCell(cells[columns.lon])
        if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
          skippedRows += 1
          continue
        }
        frame.lat = lat
        frame.lon = lon
      } else {
        const x = toNumberCell(cells[columns.x])
        const y = toNumberCell(cells[columns.y])
        if (x === null || y === null) {
          skippedRows += 1
          continue
        }
        frame.x = x
        frame.y = y
      }

      frame.alt = columns.alt === undefined ? 0 : toNumberCell(cells[columns.alt]) ?? 0
      frame.rawSpeed = columns.speed === undefined ? null : toNumberCell(cells[columns.speed])
      frame.timeCell = columns.time === undefined ? undefined : cells[columns.time]
      rawFrames.push(frame)
    }

    if (rawFrames.length === 0) {
      return csvFailure(
        columns.mode === 'latlon'
          ? '经纬度列找到了，但一行都没解析成功：请检查数值是否为空、是否为纯文本，或是否被写进了带单位的字符串。'
          : 'x / y 列找到了，但一行都没解析成功：请确认这两列是米制平面坐标数值。',
      )
    }

    // 平面坐标：经纬度先按起点做局部等距投影，x/y 列直接沿用。
    let metricFrames
    if (columns.mode === 'latlon') {
      metricFrames = latLonToLocalMeters(rawFrames, { lat: rawFrames[0].lat, lon: rawFrames[0].lon })
    } else {
      metricFrames = rawFrames.map((frame) => ({ ...frame, lat: undefined, lon: undefined }))
    }

    const timeline =
      columns.time === undefined
        ? { kind: 'absent', timestampsSeconds: [], realDurationSeconds: 0, badCount: 0 }
        : buildTimeline(metricFrames.map((frame) => frame.timeCell))

    if (columns.time === undefined) {
      notes.push('没有可用的时间列：时长按总距离 / 平均速度估算。')
    } else if (timeline.kind === 'unreliable') {
      notes.push('时间列里有无法解析、口径混用或时间倒退的数据：已降级为按里程与速度估算时长。')
    }

    if (columns.alt === undefined) notes.push('没有高度列：高度按 0 处理，累计爬升与起伏度会是 0。')

    const derivedSpeedCount = metricFrames.filter((frame) => frame.rawSpeed === null).length
    if (columns.speed === undefined) {
      notes.push('没有速度列：按相邻点距离与时间间隔推算速度。')
    } else if (derivedSpeedCount) {
      notes.push(`速度列有 ${derivedSpeedCount} 处空值：这些点按相邻点距离与时间间隔推算。`)
    }

    // 推算速度：有真实时间用时间间隔，否则按每点间隔 1 秒的点序假设；末点沿用前一点。
    let assumedPointStep = false
    const speeds = []
    for (let index = 0; index < metricFrames.length; index += 1) {
      const frame = metricFrames[index]
      if (frame.rawSpeed !== null && frame.rawSpeed !== undefined) {
        speeds[index] = Math.max(0, frame.rawSpeed)
        continue
      }
      const next = metricFrames[index + 1]
      if (!next) {
        speeds[index] = index > 0 ? speeds[index - 1] : 0
        continue
      }
      const distance = Math.hypot(next.x - frame.x, next.y - frame.y, next.alt - frame.alt)
      let delta =
        timeline.kind === 'real' ? timeline.timestampsSeconds[index + 1] - timeline.timestampsSeconds[index] : 0
      if (!(delta > 0)) {
        delta = 1
        assumedPointStep = true
      }
      speeds[index] = distance / delta
    }

    if (assumedPointStep) {
      notes.push('部分点没有可用时间间隔：这些处按每点间隔 1 秒的点序假设推算速度。')
    }

    const points =
      timeline.kind === 'real'
        ? metricFrames.map((frame, index) =>
            makePoint({ x: frame.x, y: frame.y, alt: frame.alt, speed: speeds[index], t: timeline.timestampsSeconds[index] }),
          )
        : stampTime(metricFrames.map((frame, index) => ({ x: frame.x, y: frame.y, alt: frame.alt, speed: speeds[index] })))

    if (skippedRows) notes.push(`跳过 ${skippedRows} 行坐标无法解析的数据。`)

    return {
      ok: true,
      points,
      timeMeta: {
        kind: timeline.kind,
        realDurationSeconds: timeline.realDurationSeconds,
        timeColumn: columns.time === undefined ? null : header[columns.time],
        badTimeCells: timeline.badCount,
      },
      notes,
      source: {
        kind: 'csv',
        coordinateMode: columns.mode,
        delimiter,
        columnsFound: Object.keys(columns)
          .filter((field) => field !== 'mode')
          .map((field) => `${field}→第 ${columns[field] + 1} 列(${header[columns[field]]})`),
        rowCount: points.length,
        skippedRows,
      },
    }
  } catch (error) {
    return csvFailure(`这份 CSV 没能读完：${error && error.message ? error.message : '文件格式不符合预期'}。`)
  }
}

/**
 * 用内置示例反推合成经纬度，产出「下载示例 CSV（经纬度版）」用的文本。
 * 起点在北部湾海岸附近；数据是合成的，表头注释已写明「示例数据」。
 */
export function buildSampleCsv(sampleId = 'loop', origin = SAMPLE_CSV_ORIGIN) {
  const sample = SAMPLE_FLIGHTS.find((item) => item.id === sampleId) || SAMPLE_FLIGHTS[0]
  const frames = sample.build()
  const cosLat0 = Math.cos(origin.lat * DEG_TO_RAD) || 1e-9

  const rows = frames.map((frame) => {
    const lat = origin.lat + frame.y / METERS_PER_DEG_LAT
    const lon = origin.lon + frame.x / (METERS_PER_DEG_LON_EQUATOR * cosLat0)
    // 经纬度保留 7 位小数（约 1 厘米），避免往返换算的取整噪声把临界转弯挤偏。
    return [lat.toFixed(7), lon.toFixed(7), frame.alt.toFixed(1), frame.speed.toFixed(2), frame.t.toFixed(2)].join(',')
  })

  return [
    `# 示例数据：合成航迹，非真实飞行记录（由内置示例《${sample.name}》反推经纬度生成）`,
    'lat,lon,alt,speed,time',
    ...rows,
    '',
  ].join('\r\n')
}

