/**
 * 自动命名 —— 纯规则、确定性可复现，零外部 AI 接口。
 *
 * 句式池（分隔符统一用「·」）：
 *   main   {天象}·{意象}{动作}   例：初霁·镜湖归航
 *   shortA {天象}{意象}          例：晓雾回廊
 *   shortB {意象}·{天象}         例：云阶·流霞
 * 每批 3 个候选必混入短句式，绝不三句同式；长期主句式占比约半数。
 *
 * 选词两条硬标准：意象词须能独立成景，动作词须能自然接在意象后。
 * 取词优先级与勋章共用 flightFeatures.js 的同一套特征排序，这里不写第二份。
 */

import { rankFeatures, speedRatio } from './flightFeatures.js'

/** 4 个特征桶：意象 + 动作/形态，各 8 词。 */
export const FEATURE_WORDS = {
  turns: {
    imagery: ['折岸', '云脊', '曲水', '回廊', '雾巷', '叠嶂', '千帆', '迷宫'],
    motion: ['穿梭', '翻折', '游走', '盘绕', '绕行', '迂回', '交织', '回旋'],
  },
  closure: {
    imagery: ['银环', '潮湾', '玉璧', '回汀', '环礁', '镜湖', '素练', '圆丘'],
    motion: ['合拢', '归航', '环抱', '收束', '合围', '衔尾', '回环', '抱月'],
  },
  relief: {
    imagery: ['云阶', '浪脊', '危崖', '天梯', '峰线', '潮头', '悬瀑', '峻岭'],
    motion: ['攀升', '俯冲', '起伏', '跃升', '跌落', '翻涌', '攀越', '腾跃'],
  },
  cruise: {
    imagery: ['长堤', '平芜', '海门', '遥岸', '风道', '旷野', '远岫', '素空'],
    motion: ['巡航', '横渡', '滑翔', '直取', '缓行', '掠过', '徐行', '远涉'],
  },
}

/** 通用天象氛围池：18 词，前缀后缀两种位置都要读得通。 */
export const ATMOSPHERE_WORDS = [
  '初霁', '暮金', '晴岚', '微霜', '晓雾', '晚照', '澄空', '流霞', '淡月',
  '疏星', '薄暮', '新晴', '霁色', '苍烟', '素光', '暖霭', '清晓', '浮金',
]

export const NAME_PATTERNS = ['main', 'shortA', 'shortB']

/** 唯一的组句实现：页面、审计脚本都走这里，避免句式规则出现第二份。 */
export function composeName(pattern, imagery, motion, atmosphere) {
  if (pattern === 'main') return `${atmosphere}·${imagery}${motion}`
  if (pattern === 'shortA') return `${atmosphere}${imagery}`
  return `${imagery}·${atmosphere}`
}

/** 特征分桶 → 轻量 hash 种子。刻意不含时长字段：同一条几何不因时间列可信度变化而跳名。 */
export function nameSeed(stats) {
  const key = [
    Math.round(stats.totalDistance / 100),
    stats.turnCount,
    Math.round(stats.closure * 100),
    Math.round(stats.maxAlt / 10),
    Math.round(stats.altStd / 5),
    Math.round(stats.totalClimb / 50),
    Math.round(stats.avgSpeed),
    Math.round(speedRatio(stats) * 100),
  ].join('|')

  let hash = 0x811c9dc5
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/** mulberry32：纯整数运算的确定性伪随机，同种子同序列。 */
function mulberry32(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 两种版式等概率：主句式长期占比 ≈ 50%，且每批至少一个短句式。 */
function batchPatterns(rand) {
  const short = rand() < 0.5 ? 'shortA' : 'shortB'
  const layout = rand() < 0.5 ? ['main', 'shortA', 'shortB'] : ['main', 'main', short]
  for (let i = layout.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1))
    const swap = layout[i]
    layout[i] = layout[j]
    layout[j] = swap
  }
  return layout
}

const BUCKET_WEIGHTS = [0.5, 0.25, 0.15, 0.1]

/** 命中的特征桶优先：排序越靠前权重越高。 */
function pickBucket(rand, ranked) {
  const roll = rand()
  let accumulated = 0
  for (let i = 0; i < BUCKET_WEIGHTS.length; i += 1) {
    accumulated += BUCKET_WEIGHTS[i]
    if (roll < accumulated) return ranked[i]
  }
  return ranked[ranked.length - 1]
}

function sharesChar(a, b) {
  for (const char of a) if (b.includes(char)) return true
  return false
}

/** 同字回避：三个部件两两不许共用汉字，免得出现「回汀回环」「暮金·浮金」。 */
function partsConflict(parts) {
  for (let i = 0; i < parts.length; i += 1) {
    for (let j = i + 1; j < parts.length; j += 1) {
      if (sharesChar(parts[i], parts[j])) return true
    }
  }
  return false
}

function usableParts(pattern, imagery, motion, atmosphere) {
  return pattern === 'main' ? [imagery, motion, atmosphere] : [imagery, atmosphere]
}

const MAX_DRAW_ATTEMPTS = 12

/** 有界兜底：按特征排序穷举，取第一个既不通字也不撞名的组合。组合空间远大于禁用集，必然命中。 */
function exhaustCandidate(ranked, pattern, banned) {
  for (const id of ranked) {
    const pool = FEATURE_WORDS[id]
    const motions = pattern === 'main' ? pool.motion : ['']
    for (const imagery of pool.imagery) {
      for (const atmosphere of ATMOSPHERE_WORDS) {
        for (const motion of motions) {
          if (partsConflict(usableParts(pattern, imagery, motion, atmosphere))) continue
          const name = composeName(pattern, imagery, motion, atmosphere)
          if (!banned.has(name)) return name
        }
      }
    }
  }
}

function drawCandidate(rand, ranked, pattern, banned) {
  // 桶只抽一次：重抽只换桶内词，避免拒绝采样把取词优先级从声明的权重上带偏。
  const pool = FEATURE_WORDS[pickBucket(rand, ranked)]
  for (let attempt = 0; attempt < MAX_DRAW_ATTEMPTS; attempt += 1) {
    const imagery = pool.imagery[Math.floor(rand() * pool.imagery.length)]
    const atmosphere = ATMOSPHERE_WORDS[Math.floor(rand() * ATMOSPHERE_WORDS.length)]
    const motion = pattern === 'main' ? pool.motion[Math.floor(rand() * pool.motion.length)] : ''
    if (partsConflict(usableParts(pattern, imagery, motion, atmosphere))) continue
    const name = composeName(pattern, imagery, motion, atmosphere)
    if (!banned.has(name)) return name
  }
  return exhaustCandidate(ranked, pattern, banned)
}

/**
 * 抽一批 3 个候选名。
 * @param {object} stats Step 1 冻结指标
 * @param {number} rollIndex 批次序号，初始 0；+1 即换一批
 * @param {string[]} previous 上一批候选，新批与之零交集
 * @returns {string[]} 3 个互不相同、且不与上一批重复的画名
 */
export function makeNameCandidates(stats, rollIndex = 0, previous = []) {
  const rand = mulberry32((nameSeed(stats) ^ Math.imul(rollIndex, 0x9e3779b9)) >>> 0)
  const ranked = rankFeatures(stats)
  const banned = new Set(previous)
  const names = []

  for (const pattern of batchPatterns(rand)) {
    const name = drawCandidate(rand, ranked, pattern, banned)
    banned.add(name)
    names.push(name)
  }
  return names
}