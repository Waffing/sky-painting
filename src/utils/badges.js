/**
 * 飞行勋章 —— 8 枚，优先级链写死，命中第一枚即颁发（每条轨迹只颁 1 枚）。
 *
 * 边界：只消费 Step 1 冻结的 11 项 stats；阈值一律取自 flightFeatures.js，
 * 与命名共用同一套特征逻辑，这里不出现第二份阈值。
 * 诚实口径：isEstimatedDuration 为 true 时，颁奖词绝不出现具体秒数。
 */

import { FEATURE_THRESHOLDS as T, speedRatio } from './flightFeatures.js'

const meters = (value) => value.toFixed(1)
const percent = (value) => `${(value * 100).toFixed(1)}%`

/** 数组顺序即优先级顺序，不许重排。test 为命中判定，citation 用真实 stats 填充。 */
export const BADGES = [
  {
    id: 'orbit-master',
    name: '盘旋大师',
    rank: 1,
    feature: 'turns',
    test: (s) => s.turnCount >= T.turnHeavy,
    citation: (s) => `累计 ${s.turnCount} 次转弯，在 ${meters(s.totalDistance)} 米航程里把方向反复折回。`,
  },
  {
    id: 'perfect-loop',
    name: '完美闭环',
    rank: 2,
    feature: 'closure',
    test: (s) => s.closure <= T.closureTight && s.totalDistance >= T.closureDistance,
    citation: (s) => `闭合度 ${s.closure.toFixed(3)}，${meters(s.totalDistance)} 米飞成一个几乎合拢的环。`,
  },
  {
    id: 'rollercoaster',
    name: '过山车手',
    rank: 3,
    feature: 'relief',
    test: (s) => s.altStd >= T.reliefAltStd && s.totalClimb >= T.reliefClimb,
    citation: (s) => `高度起伏 ${meters(s.altStd)} 米、累计爬升 ${meters(s.totalClimb)} 米，一路上下翻飞。`,
  },
  {
    id: 'cloud-climber',
    name: '登云者',
    rank: 4,
    feature: 'relief',
    test: (s) => s.maxAlt >= T.highAlt,
    citation: (s) => `最高爬到 ${meters(s.maxAlt)} 米，用 ${meters(s.totalClimb)} 米累计爬升换来一次登云。`,
  },
  {
    id: 'long-voyager',
    name: '远行者',
    rank: 5,
    feature: 'cruise',
    test: (s) => s.totalDistance >= T.longDistance,
    // 只有拿到真实时间戳才报秒数；估算口径整句省略时间子句。
    citation: (s) =>
      `${meters(s.totalDistance)} 米一路推进，航迹拉得又直又远。${s.isEstimatedDuration ? '' : `历时 ${s.duration.toFixed(1)} 秒。`}`,
  },
  {
    id: 'low-skimmer',
    name: '低空掠影',
    rank: 6,
    feature: 'cruise',
    test: (s) => s.maxAlt <= T.lowAlt && s.totalDistance >= T.lowDistance,
    citation: (s) => `全程压在 ${meters(s.maxAlt)} 米以下，贴着地物飞完 ${meters(s.totalDistance)} 米。`,
  },
  {
    id: 'steady-rock',
    name: '稳如磐石',
    rank: 7,
    feature: 'cruise',
    test: (s) => s.avgSpeed > 0 && speedRatio(s) <= T.steadyRatio,
    citation: (s) =>
      `均速 ${s.avgSpeed.toFixed(1)} m/s、速度标准差仅 ${s.speedStd.toFixed(2)} m/s（波动 ${percent(speedRatio(s))}），全程没忽快忽慢。`,
  },
  {
    id: 'zen-cruise',
    name: '佛系巡航',
    rank: 8,
    feature: 'cruise',
    test: () => true,
    citation: (s) =>
      `${meters(s.totalDistance)} 米、${s.turnCount} 次转弯、最高 ${meters(s.maxAlt)} 米，不争不抢，飞完就好。`,
  },
]

/**
 * 沿优先级链自上而下判定，命中第一枚即返回。链尾⑧为兜底，故必有返回值。
 * @returns {{id:string,name:string,rank:number,feature:string,citation:string}}
 */
export function awardBadge(stats) {
  for (const badge of BADGES) {
    if (badge.test(stats)) {
      return {
        id: badge.id,
        name: badge.name,
        rank: badge.rank,
        feature: badge.feature,
        citation: badge.citation(stats),
      }
    }
  }
}