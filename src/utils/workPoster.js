/**
 * 画廊 / 弹窗 / 重下载共用的「作品 → 海报」入口（Step 5）。
 * 修订 4：勋章名与颁奖词一律由 work.stats 经 awardBadge() 现算（与创作台同口径），
 * 绝不读静态 BADGES 字典出空模板；重下载与原版信息完整一致。
 * 雕塑一律走纯 2D 投影器（零 WebGL），再交 Step 4 的 renderPoster 同一入口。
 */

import { awardBadge } from './badges.js'
import { CAPTURE_SIZE, posterDateText, readTemplateColors, renderPoster } from './poster.js'
import { renderSculpture } from './projector.js'

/** 现算勋章（含动态颁奖词），与创作台 awardBadge(stats) 同口径。 */
export function workBadge(work) {
  return awardBadge(work.stats)
}

export function workDateText(work) {
  return posterDateText(new Date(work.createdAt))
}

/** 轨迹渐变令牌色（投影器注入用），本文件不写 hex。 */
export function traceColors() {
  const styles = getComputedStyle(document.documentElement)
  return {
    cyan: styles.getPropertyValue('--color-trace-cyan').trim(),
    gold: styles.getPropertyValue('--color-trace-gold').trim(),
  }
}

/**
 * 渲染一件作品的完整 1200×1600 海报 canvas。预览与重下载共用本函数同一参数 → 同源同版。
 * sculptureSize 供缩略图降采样（默认全分辨率 CAPTURE_SIZE）。
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function renderWorkPoster(work, { sculptureSize = CAPTURE_SIZE } = {}) {
  const badge = workBadge(work)
  const colors = readTemplateColors(work.template)
  const sculpture = renderSculpture({
    points: work.points,
    bounds: work.bounds,
    stats: work.stats,
    width: sculptureSize.width,
    height: sculptureSize.height,
    colors: traceColors(),
  })
  const stagePngUrl = sculpture.toDataURL('image/png')
  return renderPoster({
    title: work.title,
    badge,
    stats: work.stats,
    colors,
    pilot: work.pilot,
    credit: work.credit,
    dateText: workDateText(work),
    stagePngUrl,
  })
}