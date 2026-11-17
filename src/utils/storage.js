/**
 * 本地存储真实读写（Step 4 落地）。
 *
 * 契约（Step 4 定版）：
 * - 键名 sky-painting:works:v1、STORAGE_SCHEMA_VERSION = 1 保持不变；
 *   Steps 0–3 从未写入真实数据，无迁移对象，typedef 直接改写为冻结结构。
 * - 只存轻量 JSON：元数据 + 抽稀后点列（≤240，4 位小数由数据层保证）。
 * - 严禁海报 PNG / 任何 base64 / data:image 字符串入库：写入前序列化自检直接拒绝。
 * - 写入前校验 STORAGE_LIMITS 三护栏：单件字节、总软预算、点数硬顶。
 * - 写入失败（配额超限、隐私模式）显式中文报错，不触碰内存里的创作状态。
 * - listWorks() 契约：按 createdAt 降序返回（最新在前）。
 */

import { POINT_FIELDS, STATS_FIELDS } from './flightData.js'

/** localStorage 键名统一在此声明，组件内不得手写键名字符串。 */
export const STORAGE_KEYS = {
  works: 'sky-painting:works:v1',
  draft: 'sky-painting:draft:v1',
  settings: 'sky-painting:settings:v1',
}

/** 数据结构版本号。字段变化时递增并提供迁移，不得静默覆盖用户已有作品。 */
export const STORAGE_SCHEMA_VERSION = 1

/** 容量护栏，写入前的自检基准（浏览器配额约 5MB）。 */
export const STORAGE_LIMITS = {
  browserQuotaBytes: 5 * 1024 * 1024,
  softBudgetBytes: 4 * 1024 * 1024,
  perWorkBytes: 64 * 1024,
  // 与 flightData.js 的 MAX_STORED_POINTS 抽稀硬顶保持一致。
  maxPointsPerTrajectory: 240,
}

export const SOURCE_KIND_LABELS = {
  sample: '内置示例',
  csv: '导入日志',
  hand: '手绘',
}

const BOUNDS_FIELDS = ['minX', 'maxX', 'minY', 'maxY', 'minAlt', 'maxAlt', 'maxSpan']

/**
 * @typedef {Object} TrajectoryPoint 轨迹点，字段与 flightData.js 的 POINT_FIELDS 一一对应
 * @property {number} x 东向平面坐标（米）
 * @property {number} y 北向平面坐标（米）
 * @property {number} alt 海拔高度（米，保持绝对值不做平移）
 * @property {number} speed 速度（m/s）
 * @property {number} t 时间序号（秒，相对起点）
 * @property {boolean} isTurn 转弯标记
 */

/**
 * @typedef {Object} Work 一条作品（Step 4 冻结结构 + schemaVersion 元字段）
 * @property {string} id
 * @property {number} schemaVersion
 * @property {number} createdAt 毫秒时间戳
 * @property {string} title 画名（消费创作台单一画名状态）
 * @property {string} pilot 飞手署名
 * @property {string} credit 底部落款
 * @property {string} template 海报模板 id（clear / dusk / night）
 * @property {string} badgeId 勋章 id
 * @property {object} stats 冻结 11 项指标 + isEstimatedDuration
 * @property {object} bounds 居中后的包围盒
 * @property {TrajectoryPoint[]} points 抽稀后点列（≤240）
 * @property {string} sourceKind 来源代码（sample / csv / hand）
 */

const utf8Bytes = (text) => new TextEncoder().encode(text).length

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value)

function readRaw() {
  try {
    return localStorage.getItem(STORAGE_KEYS.works)
  } catch {
    return null
  }
}

function parseWorks(raw) {
  if (raw === null || raw === '') return []
  const parsed = JSON.parse(raw)
  if (!Array.isArray(parsed)) throw new Error('not an array')
  return parsed
}

function pickPoint(point) {
  const out = {}
  for (const field of POINT_FIELDS) {
    if (field === 'isTurn') out.isTurn = point.isTurn === true
    else out[field] = point[field]
  }
  return out
}

function validateDraft(input) {
  if (!input || typeof input !== 'object') return '作品记录为空：无法写入画廊。'
  for (const field of ['title', 'pilot', 'credit', 'template', 'badgeId', 'sourceKind']) {
    if (typeof input[field] !== 'string' || input[field].trim() === '') return `作品字段「${field}」缺失或为空：无法写入画廊。`
  }
  if (!input.stats || typeof input.stats !== 'object') return '缺少 stats：无法写入画廊。'
  for (const field of STATS_FIELDS) {
    if (field === 'isEstimatedDuration') continue
    if (!isFiniteNumber(input.stats[field])) return `stats 字段「${field}」不是有限数值：拒绝写入。`
  }
  if (typeof input.stats.isEstimatedDuration !== 'boolean') return 'stats.isEstimatedDuration 必须是布尔值：拒绝写入。'
  if (!input.bounds || typeof input.bounds !== 'object') return '缺少 bounds：无法写入画廊。'
  for (const field of BOUNDS_FIELDS) {
    if (!isFiniteNumber(input.bounds[field])) return `bounds 字段「${field}」不是有限数值：拒绝写入。`
  }
  if (!Array.isArray(input.points) || input.points.length === 0) return '轨迹点列为空：无法写入画廊。'
  if (input.points.length > STORAGE_LIMITS.maxPointsPerTrajectory) {
    return `轨迹点 ${input.points.length} 个，超过 ${STORAGE_LIMITS.maxPointsPerTrajectory} 点硬顶：请先抽稀再存。`
  }
  for (const point of input.points) {
    if (!point || typeof point !== 'object') return '轨迹点格式损坏：拒绝写入。'
    for (const field of POINT_FIELDS) {
      if (field === 'isTurn') continue
      if (!isFiniteNumber(point[field])) return `轨迹点字段「${field}」不是有限数值：拒绝写入。`
    }
  }
  return ''
}

function makeId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `work-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * 写入一条作品。失败返回 { ok:false, error }（中文），绝不抛异常、绝不丢内存状态。
 * @returns {{ok:true, work:Work, bytes:number}|{ok:false, error:string}}
 */
export function saveWork(input) {
  const invalid = validateDraft(input)
  if (invalid) return { ok: false, error: invalid }

  const work = {
    id: makeId(),
    schemaVersion: STORAGE_SCHEMA_VERSION,
    createdAt: Date.now(),
    title: input.title,
    pilot: input.pilot,
    credit: input.credit,
    template: input.template,
    badgeId: input.badgeId,
    stats: {},
    bounds: {},
    points: input.points.map(pickPoint),
    sourceKind: input.sourceKind,
  }
  for (const field of STATS_FIELDS) work.stats[field] = input.stats[field]
  work.stats.isEstimatedDuration = input.stats.isEstimatedDuration
  for (const field of BOUNDS_FIELDS) work.bounds[field] = input.bounds[field]

  const json = JSON.stringify(work)
  if (/data:image|base64/i.test(json)) {
    return { ok: false, error: '检测到图片编码字符串：海报与任何 Base64 一律不许入库，已拒绝写入。' }
  }
  const bytes = utf8Bytes(json)
  if (bytes > STORAGE_LIMITS.perWorkBytes) {
    return { ok: false, error: `单件作品约 ${(bytes / 1024).toFixed(1)} KB，超过 ${STORAGE_LIMITS.perWorkBytes / 1024} KB 护栏：拒绝写入。` }
  }
  const raw = readRaw()
  const totalBytes = utf8Bytes(raw ?? '') + bytes + 1
  if (totalBytes > STORAGE_LIMITS.softBudgetBytes) {
    return { ok: false, error: `画廊总占用将超过 ${STORAGE_LIMITS.softBudgetBytes / 1024 / 1024} MB 软预算：请先在画廊清理旧作品（Step 5 提供）。` }
  }

  let list
  try {
    list = parseWorks(raw)
  } catch {
    return { ok: false, error: '画廊已有数据损坏，无法追加：为保住旧数据已拒绝写入，请在画廊页处理（Step 5 提供）。' }
  }
  list.push(work)
  try {
    localStorage.setItem(STORAGE_KEYS.works, JSON.stringify(list))
  } catch {
    return { ok: false, error: '写入失败：浏览器存储空间已满或隐私模式禁用了本地存储。当前创作仍保留在页面上，可先下载海报 PNG。' }
  }
  return { ok: true, work, bytes }
}

/**
 * 读回全部作品。契约：按 createdAt 降序（最新在前）；同时间戳按 id 降序保证稳定。
 * 解析失败返回 { ok:false, error }，不抛异常。
 * @returns {{ok:true, works:Work[], bytes:number}|{ok:false, error:string}}
 */
export function listWorks() {
  const raw = readRaw()
  if (raw === null || raw === '') return { ok: true, works: [], bytes: 0 }
  let list
  try {
    list = parseWorks(raw)
  } catch {
    return { ok: false, error: '画廊数据损坏：无法解析本地记录。为免误删，未做任何覆盖。' }
  }
  const works = list
    .filter((item) => item && typeof item === 'object' && typeof item.id === 'string')
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
  return { ok: true, works, bytes: utf8Bytes(raw) }
}

/** @returns {{ok:true, work:Work}|{ok:false, error:string}} */
export function getWork(id) {
  const listed = listWorks()
  if (!listed.ok) return listed
  const work = listed.works.find((item) => item.id === id)
  if (!work) return { ok: false, error: '没有这件作品：它可能已被清理。' }
  return { ok: true, work }
}

/**
 * 删除一件作品（Step 5）。读→过滤→写回；不存在 / 损坏 / 写失败均返回中文 error，不抛异常。
 * 损坏时拒绝覆盖以保住旧数据；删除不可恢复，调用方须先做二次确认。
 * @returns {{ok:true, bytes:number}|{ok:false, error:string}}
 */
export function deleteWork(id) {
  const raw = readRaw()
  if (raw === null || raw === '') return { ok: false, error: '没有这件作品：它可能已被清理。' }
  let list
  try {
    list = parseWorks(raw)
  } catch {
    return { ok: false, error: '画廊数据损坏：为免误删其余作品，已拒绝本次删除。' }
  }
  const next = list.filter((item) => item && typeof item === 'object' && item.id !== id)
  if (next.length === list.length) return { ok: false, error: '没有这件作品：它可能已被清理。' }
  const json = JSON.stringify(next)
  try {
    localStorage.setItem(STORAGE_KEYS.works, json)
  } catch {
    return { ok: false, error: '删除失败：浏览器存储不可写（隐私模式或已满）。作品仍保留在本地。' }
  }
  return { ok: true, bytes: utf8Bytes(json) }
}

/** 当前画廊键的原始序列化字节数（UTF-8），供容量汇报与状态行。 */
export function workStorageBytes() {
  const raw = readRaw()
  return raw === null ? 0 : utf8Bytes(raw)
}