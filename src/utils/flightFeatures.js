/**
 * 轨迹特征层 —— 命名与勋章共用的唯一一套阈值、打分与排序。
 *
 * 边界：只消费 Step 1 冻结的 11 项 stats，不新增统计字段、不做渲染层换算、零 DOM。
 * 勋章优先级链与命名取词优先级都从这里取数，任何一侧都不许再写第二份判定逻辑。
 */

const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value)

/** 勋章判定阈值（写死）。改动这里等于改动勋章规则，须先对照验收基准。 */
export const FEATURE_THRESHOLDS = {
  turnHeavy: 12,
  closureTight: 0.12,
  closureDistance: 800,
  reliefAltStd: 40,
  reliefClimb: 250,
  highAlt: 120,
  longDistance: 1500,
  lowAlt: 90,
  lowDistance: 800,
  steadyRatio: 0.08,
}

/** 规范顺序与勋章优先级链一致：同分时靠前的特征优先，命名与勋章才不会互相打架。 */
export const FEATURE_IDS = ['turns', 'closure', 'relief', 'cruise']

export const FEATURE_LABELS = {
  turns: '多转弯',
  closure: '高闭合',
  relief: '高起伏',
  cruise: '长直巡航',
}

/** 速度波动比：均速为 0 时退化取 0，绝不产生 NaN/Infinity。命名种子与⑦勋章共用。 */
export function speedRatio(stats) {
  return stats.avgSpeed > 0 ? stats.speedStd / stats.avgSpeed : 0
}

/**
 * 4 个特征桶的归一化打分（0–1），返回顺序即规范顺序。
 * 打分只用于「哪个特征主导」的排序，不参与勋章命中判定——命中一律走写死阈值。
 */
export function scoreFeatures(stats) {
  const distance = stats.totalDistance
  const turns = stats.turnCount
  const altStd = stats.altStd

  const scores = {
    turns: clamp01(turns / 14),
    closure: clamp01((0.35 - stats.closure) / 0.35) * clamp01(distance / 1200),
    relief: 0.6 * clamp01(altStd / 60) + 0.4 * clamp01(stats.totalClimb / 400),
    cruise: clamp01(distance / 1800) * clamp01(1 - turns / 8) * clamp01(1 - altStd / 60),
  }

  return FEATURE_IDS.map((id) => ({ id, label: FEATURE_LABELS[id], score: scores[id] }))
}

function byPriority(a, b) {
  return b.score - a.score || FEATURE_IDS.indexOf(a.id) - FEATURE_IDS.indexOf(b.id)
}

/** 按得分降序排特征；同分按规范顺序（与勋章优先级一致）。 */
export function rankFeatures(stats) {
  return scoreFeatures(stats).sort(byPriority).map((feature) => feature.id)
}

/** 主导特征：铭牌卡 eyebrow 与命名取词的第一优先桶。 */
export function dominantFeature(stats) {
  return scoreFeatures(stats).sort(byPriority)[0]
}