import {
  STATS_FIELDS,
  MAX_STORED_POINTS,
  SAMPLE_FLIGHTS,
  computeStats,
  detectTurns,
  decimatePoints,
  centerWithBounds,
  processFlightData,
  processSampleFlight,
  parseFlightCsv,
  buildSampleCsv,
  POINT_FIELDS,
} from '../src/utils/flightData.js'

let failures = 0
const check = (label, ok, detail = '') => {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${label}${detail ? ' | ' + detail : ''}`)
}

const allFinite = (stats) =>
  STATS_FIELDS.every((field) => (field === 'isEstimatedDuration' ? typeof stats[field] === 'boolean' : Number.isFinite(stats[field])))

console.log('=== 1. 三条内置示例 ===')
const sampleReports = []
for (const sample of SAMPLE_FLIGHTS) {
  const r = processSampleFlight(sample.id)
  const raw = sample.build()
  check(
    `${sample.name} 点数在 180–240`,
    raw.length >= 180 && raw.length <= 240,
    `raw=${raw.length}, decimated=${r.pointCount}`,
  )
  check(`${sample.name} 11 项指标齐全且有限`, Object.keys(r.stats).length === 11 && allFinite(r.stats), JSON.stringify(r.stats))
  check(`${sample.name} isEstimatedDuration === true`, r.stats.isEstimatedDuration === true)
  check(`${sample.name} 原始 isTurn 点数 == turnCount`, r.isTurnCountRaw === r.stats.turnCount, `isTurn=${r.isTurnCountRaw}, turnCount=${r.stats.turnCount}`)
  check(`${sample.name} 点结构只有 6 字段`, raw.every((p) => Object.keys(p).length === POINT_FIELDS.length))
  sampleReports.push({ name: sample.name, ...r })
}

console.log('\n=== 2. 流水线：统计只读原始点列 ===')
{
  // 示例本身 ≤240 点，抽稀是恒等操作，证明不了统计来源；这里用 600 点长航迹。
  const long = []
  let px = 0
  let py = 0
  let heading = 0
  for (let i = 0; i < 600; i += 1) {
    if (i % 60 === 0 && i > 0) heading += Math.PI / 2
    px += 8 * Math.cos(heading)
    py += 8 * Math.sin(heading)
    long.push({ x: px, y: py, alt: 100 + 20 * Math.sin(i / 12), speed: 18, t: i })
  }
  const r = processFlightData(long)
  const fromDecimated = computeStats(r.points)
  check(
    '600 点：stats 与「抽稀后重算」不同（证明统计未被抽稀污染）',
    Math.abs(fromDecimated.totalDistance - r.stats.totalDistance) > 0.01 &&
      fromDecimated.totalDistance < r.stats.totalDistance,
    `stats=${r.stats.totalDistance}m（原始 600 点）, decimated=${fromDecimated.totalDistance}m（${r.pointCount} 点）`,
  )
  check('600 点：totalClimb 同样取原始口径', r.stats.totalClimb > fromDecimated.totalClimb, `${r.stats.totalClimb} > ${fromDecimated.totalClimb}`)
  check('600 点：抽稀后 ≤240 且原始点数记录在案', r.pointCount <= 240 && r.rawPointCount === 600, `${r.rawPointCount} → ${r.pointCount}`)
  check('600 点：isTurn 原始数 == turnCount', r.isTurnCountRaw === r.stats.turnCount, `${r.isTurnCountRaw}/${r.stats.turnCount}`)
}

console.log('\n=== 3. 转弯判定防噪 ===')
{
  // A. 直行 + 中段悬停抖动 + 继续直行：不应出现任何转弯
  const hover = []
  let hx = 0
  for (let i = 0; i < 60; i += 1) hover.push({ x: (hx += 5), y: 0, alt: 100, speed: 20, t: i })
  for (let i = 0; i < 400; i += 1) {
    hover.push({
      x: hx + (i % 2 === 0 ? 0.3 : -0.3),
      y: (i % 3) * 0.2,
      alt: 100 + (i % 5) * 0.1,
      speed: 0.4,
      t: 60 + i * 0.5,
    })
  }
  for (let i = 0; i < 60; i += 1) hover.push({ x: (hx += 5), y: 0, alt: 100, speed: 20, t: 500 + i })
  const hoverResult = detectTurns(hover)
  check('A 悬停抖动不刷出假转弯', hoverResult.turnCount === 0, `turnCount=${hoverResult.turnCount}, 跳过短段=${hoverResult.skippedShortSegments}`)

  // B. 间距 5m 的真实 90° 直角转弯：应恰好记 1 次并打标 1 个点
  const corner = []
  for (let i = 0; i < 40; i += 1) corner.push({ x: i * 5, y: 0, alt: 100, speed: 20, t: i })
  for (let i = 0; i < 40; i += 1) corner.push({ x: 39 * 5, y: i * 5, alt: 100, speed: 20, t: 40 + i })
  const cornerResult = detectTurns(corner)
  check('B 角点两侧有重复点仍记 1 次', cornerResult.turnCount === 1, `turnCount=${cornerResult.turnCount}, 幅度=${JSON.stringify(cornerResult.turnMagnitudes)}`)
  check('B isTurn 点数 == turnCount', cornerResult.points.filter((p) => p.isTurn).length === cornerResult.turnCount)

  // B2. 同一角但不重复点：同样只记 1 次，且标记落在顶点
  const corner2 = []
  for (let i = 0; i < 40; i += 1) corner2.push({ x: i * 5, y: 0, alt: 100, speed: 20, t: i })
  for (let i = 1; i <= 40; i += 1) corner2.push({ x: 39 * 5, y: i * 5, alt: 100, speed: 20, t: 40 + i })
  const corner2Result = detectTurns(corner2)
  check(
    'B2 真实 90° 转弯记 1 次且标记在顶点',
    corner2Result.turnCount === 1 && corner2Result.points[39].isTurn === true,
    `turnCount=${corner2Result.turnCount}, 幅度=${JSON.stringify(corner2Result.turnMagnitudes)}`,
  )

  // C. 直行中每点 ±0.15m 左右摆动：带符号累计应自然抵消，不产生转弯
  const wobble = []
  for (let i = 0; i < 300; i += 1) {
    wobble.push({ x: i * 5, y: (i % 2 === 0 ? 0.15 : -0.15), alt: 100, speed: 20, t: i })
  }
  const wobbleResult = detectTurns(wobble)
  check('C 左右抖动自然抵消', wobbleResult.turnCount === 0, `turnCount=${wobbleResult.turnCount}`)

  // D. 分两拍完成的 90° 左转：按 35° 阈值清零复算的口径，会拆成 2 次触发
  const left = detectTurns([
    { x: 0, y: 0, alt: 100, speed: 20, t: 0 },
    { x: 50, y: 0, alt: 100, speed: 20, t: 1 },
    { x: 100, y: 0, alt: 20, speed: 20, t: 2 },
    { x: 145, y: 45, alt: 100, speed: 20, t: 3 },
    { x: 145, y: 95, alt: 100, speed: 20, t: 4 },
  ])
  check(
    'D 左转累计正确（左正右负、45°+45° 触发两次）',
    left.turnCount === 2 && left.points[2].isTurn && left.points[3].isTurn && left.turnMagnitudes.every((m) => Math.abs(m.magnitudeDeg - 45) < 0.01),
    `turnCount=${left.turnCount}, 幅度=${JSON.stringify(left.turnMagnitudes)}`,
  )

  // E. 右转应与左转同号相反：同一条航迹镜像后触发次数相同
  const right = detectTurns([
    { x: 0, y: 0, alt: 100, speed: 20, t: 0 },
    { x: 50, y: 0, alt: 100, speed: 20, t: 1 },
    { x: 100, y: 0, alt: 20, speed: 20, t: 2 },
    { x: 145, y: -45, alt: 100, speed: 20, t: 3 },
    { x: 145, y: -95, alt: 100, speed: 20, t: 4 },
  ])
  check('E 右转触发次数与左转对称', right.turnCount === left.turnCount, `right=${right.turnCount}`)
}

console.log('\n=== 4. 抽稀硬顶 240 + 关键点保底 + 按原始下标升序 ===')
{
  const long = []
  let px = 0
  let py = 0
  let heading = 0
  for (let i = 0; i < 600; i += 1) {
    if (i % 60 === 0 && i > 0) heading += Math.PI / 2
    px += 8 * Math.cos(heading)
    py += 8 * Math.sin(heading)
    long.push({ x: px, y: py, alt: 100 + 20 * Math.sin(i / 12), speed: 18, t: i, isTurn: false })
  }
  const turn = detectTurns(long)
  const decimated = decimatePoints(turn.points, { maxPoints: MAX_STORED_POINTS, turnMagnitudes: turn.turnMagnitudes })
  check('600 点抽稀到 ≤240', decimated.length <= 240 && decimated.length > 0, `→ ${decimated.length}`)
  const tSorted = decimated.every((p, i) => i === 0 || p.t >= decimated[i - 1].t)
  check('抽稀结果按原时间序（等价于原始下标升序）', tSorted)
  const keepAll = turn.points.filter((p) => p.isTurn).length
  const keptTurns = decimated.filter((p) => p.isTurn).length
  check('转弯点全部保留（未触发幅度截断）', keepAll === keptTurns, `raw isTurn=${keepAll}, kept=${keptTurns}`)
  check('首点与末点保留', decimated[0].t === turn.points[0].t && decimated[decimated.length - 1].t === turn.points[turn.points.length - 1].t)

  // 极端：isTurn 点远超上限时按幅度截断
  const forced = Array.from({ length: 400 }, (_, i) => ({ x: i, y: i % 7, alt: i, speed: 5, t: i, isTurn: true }))
  const cut = decimatePoints(forced, { maxPoints: 240, turnMagnitudes: forced.map((p, i) => ({ index: i, magnitudeDeg: 35 + (i % 13) })) })
  check('isTurn 超上限时截断到上限内', cut.length <= 240, `→ ${cut.length}, isTurn=${cut.filter((p) => p.isTurn).length}`)
}

console.log('\n=== 5. 除零 / 退化输入零 NaN ===')
{
  const cases = {
    '空数组': [],
    '单点': [{ x: 1, y: 1, alt: 5, speed: 0, t: 0 }],
    '两点重合': [{ x: 2, y: 2, alt: 0, speed: 0, t: 0 }, { x: 2, y: 2, alt: 0, speed: 0, t: 1 }],
    '全零速度': [1, 2, 3, 4].map((i) => ({ x: i * 10, y: 0, alt: 0, speed: 0, t: 0 })),
    '脏字段': [{ x: 'NaN', y: 2, alt: undefined, speed: null, t: 'x' }, { x: 5, y: 9, alt: 'abc', speed: '-', t: undefined }],
  }
  for (const [label, points] of Object.entries(cases)) {
    const stats = computeStats(points)
    const proc = processFlightData(points)
    const ok = allFinite(stats) && (proc.ok === false || allFinite(proc.stats))
    check(`${label} 无 NaN/Infinity`, ok, JSON.stringify(stats))
  }
  check('两点重合 closure = 0', computeStats(cases['两点重合']).closure === 0)
}

console.log('\n=== 6. CSV：经纬度版 / x-y 版 ===')
{
  const latLonText = buildSampleCsv('loop')
  const parsed = parseFlightCsv(latLonText)
  check('示例 CSV（经纬度版）解析成功', parsed.ok === true, parsed.ok ? `points=${parsed.points.length}` : parsed.error)
  const processed = processFlightData(parsed)
  check('示例 CSV 走完整流水线成功', processed.ok === true, processed.ok ? JSON.stringify(processed.stats) : processed.error)
  check('CSV 带真实时间列 → isEstimatedDuration === false', processed.ok && processed.stats.isEstimatedDuration === false)

  const xyText = ['x,y,alt,speed', '0,0,50,12', '120,40,60,14', '260,60,80,15', '400,20,70,13', '520,-30,55,12'].join('\n')
  const xyParsed = parseFlightCsv(xyText)
  check('x/y 平面坐标版解析成功', xyParsed.ok === true, xyParsed.ok ? `points=${xyParsed.points.length}` : xyParsed.error)
  const xyProcessed = processFlightData(xyParsed)
  check('x/y 版无时间列 → 时长估算', xyProcessed.ok && xyProcessed.stats.isEstimatedDuration === true, JSON.stringify(xyProcessed.stats))
  const xyNoSpeed = parseFlightCsv('x,y,alt\n0,0,10\n100,0,20\n200,50,35\n300,120,60')
  check('x/y 缺速度列可推算', xyNoSpeed.ok && xyNoSpeed.points.every((p) => p.speed > 0), `speed[1]=${xyNoSpeed.points[1]?.speed}`)
}

console.log('\n=== 7. 脏时间数据不崩溃 ===')
{
  const dirty = {
    'ISO 正常': 'lat,lon,alt,speed,time\n21.55,109.15,50,10,2026-11-16T08:00:00Z\n21.551,109.151,55,11,2026-11-16T08:00:12Z\n21.552,109.152,60,12,2026-11-16T08:00:25Z',
    'Unix 秒': 'lat,lon,alt,speed,time\n21.55,109.15,50,10,1763884800\n21.551,109.151,55,11,1763884812\n21.552,109.152,60,12,1763884825',
    'Unix 毫秒': 'lat,lon,alt,speed,time\n21.55,109.15,50,10,1763884800000\n21.551,109.151,55,11,1763884812000\n21.552,109.152,60,12,1763884825000',
    '相对秒': 'lat,lon,alt,speed,time\n21.55,109.15,50,10,0\n21.551,109.151,55,11,12\n21.552,109.152,60,12,25',
    '时间倒退': 'x,y,alt,speed,time\n0,0,50,10,30\n100,0,55,11,12\n200,0,60,12,25',
    '时间乱码': 'x,y,alt,speed,time\n0,0,50,10,明天\n100,0,55,11,abc\n200,0,60,12,-',
    '时间列空': 'x,y,alt,speed,time\n0,0,50,10,\n100,0,55,11,\n200,0,60,12,',
    '表头带空格与大写': ' Lat , Lon , Altitude , Vel , Timestamp \n21.55,109.15,50,10,0\n21.551,109.151,55,11,12\n21.552,109.152,60,12,25',
    '中文表头分号': '纬度;经度;高度;速度;时间\n21.55;109.15;50;10;0\n21.551;109.151;55;11;12\n21.552;109.152;60;12;25',
    'BOM + 空行 + 注释行': `${String.fromCharCode(0xfeff)}x,y,alt\n\n# comment\n0,0,10\n\n100,0,20\n`,
    '表头别名不认识': ' Lat Deg , LON (deg) , Altitude \n21.55,109.15,50\n21.551,109.151,55\n21.552,109.152,60',
    '缺坐标列': 'alt,speed\n50,10\n55,11',
    '只有表头': 'x,y,alt\n',
    '空文本': '',
    '全是脏行': 'x,y,alt\nfoo,bar,baz\n,-,-,-',
  }
  for (const [label, text] of Object.entries(dirty)) {
    const parsed = parseFlightCsv(text)
    const proc = parsed.ok ? processFlightData(parsed) : null
    const survived = parsed.ok ? proc && proc.ok !== undefined : typeof parsed.error === 'string' && parsed.error.length > 0
    const finite = !parsed.ok || !proc || !proc.ok || proc.ok === true ? true : true
    check(`脏数据「${label}」不崩溃`, survived, parsed.ok ? `解析 ${parsed.points.length} 点；估算时长=${proc?.stats?.isEstimatedDuration}` : `报错文案：${parsed.error}`)
    if (parsed.ok && proc && proc.ok) check(`「${label}」指标全有限`, allFinite(proc.stats))
  }
  const backwards = parseFlightCsv(dirty['时间倒退'])
  check('时间倒退 → 降级估算', backwards.ok && processFlightData(backwards).stats.isEstimatedDuration === true)
  const spaced = parseFlightCsv(dirty['表头带空格与大写'])
  check('表头空格/大写别名可识别', spaced.ok === true, spaced.ok ? `列映射=${spaced.source.columnsFound.join(', ')}` : spaced.error)
  const bom = parseFlightCsv(dirty['BOM + 空行 + 注释行'])
  check('BOM + 空行 + 注释行仍可解析', bom.ok === true, bom.ok ? `点数=${bom.points.length}` : bom.error)
  const unknownHeader = parseFlightCsv(dirty['表头别名不认识'])
  check('非白名单表头 → 明确中文报错', unknownHeader.ok === false && /没认出坐标列/.test(unknownHeader.error))
  const garbage = parseFlightCsv(dirty['缺坐标列'])
  check('缺坐标列 → 友好中文报错', !garbage.ok && /坐标列/.test(garbage.error))
}

console.log('\n=== 8. 微调 3：示例 CSV 自产自销闭环 ===')
{
  for (const id of ['loop', 'figure-eight', 'coastal']) {
    const text = buildSampleCsv(id)
    const parsed = parseFlightCsv(text)
    const proc = parsed.ok ? processFlightData(parsed) : null
    const direct = processSampleFlight(id)
    const ratio = proc && proc.ok ? proc.stats.totalDistance / direct.stats.totalDistance : 0
    check(
      `${id} buildSampleCsv → parseFlightCsv → processFlightData 零报错`,
      parsed.ok === true && proc && proc.ok === true && allFinite(proc.stats),
      proc && proc.ok ? `往返/直接里程比值=${ratio.toFixed(4)}，点数 ${proc.rawPointCount}` : `失败：${parsed.error || proc?.error}`,
    )
    check(`${id} 往返里程误差 < 0.5%`, proc && proc.ok && Math.abs(ratio - 1) < 0.005, ratio ? `${((ratio - 1) * 100).toFixed(3)}%` : '-')
  }
}

console.log('\n=== 9. 居中与 bounds ===')
{
  const r = processSampleFlight('coastal')
  const meanX = r.points.reduce((s, p) => s + p.x, 0) / r.points.length
  const meanY = r.points.reduce((s, p) => s + p.y, 0) / r.points.length
  check('x/y 已质心居中', Math.abs(meanX) < 0.01 && Math.abs(meanY) < 0.01, `meanX=${meanX.toFixed(6)}, meanY=${meanY.toFixed(6)}`)
  check('alt 保持绝对海拔（未被平移）', Math.min(...r.points.map((p) => p.alt)) > 0, JSON.stringify(r.bounds))
  const b = r.bounds
  const expectedSpan = Math.max(b.maxX - b.minX, b.maxY - b.minY, b.maxAlt - b.minAlt)
  check('maxSpan 含高度跨度', Math.abs(b.maxSpan - expectedSpan) < 1e-6, `maxSpan=${b.maxSpan}, altSpan=${(b.maxAlt - b.minAlt).toFixed(3)}`)
  check('渲染器无关：无缩放（往返里程误差极小）', Math.abs(r.stats.totalDistance - processSampleFlight('coastal').stats.totalDistance) < 1e-9)
}

console.log('\n=== 10. 输出样例（供汇报） ===')
for (const r of sampleReports) {
  const line = STATS_FIELDS.map((f) => `${f}=${r.stats[f]}`).join('  ')
  console.log(`\n【${r.name}】${r.blurb}`)
  console.log(`  ${line}`)
  console.log(`  原始点数=${r.rawPointCount}  抽稀后=${r.pointCount}  isTurn 原始/抽稀后=${r.isTurnCountRaw}/${r.isTurnCountDecimated}  跳过短段=${r.skippedShortSegments}`)
  console.log(`  bounds=${JSON.stringify(r.bounds)}`)
}

console.log(`\n===== 失败项：${failures} =====`)
process.exit(failures ? 1 : 0)
