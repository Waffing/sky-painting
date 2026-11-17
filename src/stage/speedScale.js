/**
 * 速度 → 视觉粗细的归一化。只消费冻结指标里的 avgSpeed / speedStd / maxSpeed，
 * 不在渲染层重算任何统计：慢端基准取「平均速度 − 一个标准差」，快端取 maxSpeed，
 * 于是最慢的点吃满最粗、最快的点吃满最细，三级降级共用同一条口径。
 */
export function makeSpeedScale(stats) {
  const maxSpeed = Number.isFinite(stats?.maxSpeed) ? stats.maxSpeed : 0
  const avgSpeed = Number.isFinite(stats?.avgSpeed) ? stats.avgSpeed : 0
  const speedStd = Number.isFinite(stats?.speedStd) ? stats.speedStd : 0
  const slowRef = Math.max(0, avgSpeed - speedStd)
  const span = maxSpeed - slowRef
  if (!(span > 0)) return () => 0.5
  return (speed) => {
    const value = Number.isFinite(speed) ? speed : slowRef
    const t = (value - slowRef) / span
    return t < 0 ? 0 : t > 1 ? 1 : t
  }
}