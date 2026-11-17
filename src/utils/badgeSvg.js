/**
 * 勋章章体 —— 纯函数生成标准 SVG 字符串，页面 <img> 与 Step 4 海报共用同一份输出。
 *
 * 硬约束：零 DOM、零 CSS 变量、零外部字体、零 hex 字面量。颜色一律由调用方先经
 * getComputedStyle 解析成真实色值再传入；传入 var(--*) 直接抛错，绝不默默画黑章。
 * 8 枚共用同一枚章体骨架（圆章 + 环纹 + 星芒），以中央抽象图标与章面中文名区分。
 */

import { BADGES } from './badges.js'

const COLOR_KEYS = ['face', 'rim', 'ray', 'icon', 'accent', 'ink']
const VIEW_BOX = '0 0 128 128'
const FONT_STACK = "system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif"

const f = (value) => value.toFixed(1)

function polar(cx, cy, r, deg) {
  const rad = ((deg - 90) * Math.PI) / 180
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)]
}

function arcPath(cx, cy, r, fromDeg, toDeg) {
  const [x1, y1] = polar(cx, cy, r, fromDeg)
  const [x2, y2] = polar(cx, cy, r, toDeg)
  const large = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0
  return `M${f(x1)} ${f(y1)}A${f(r)} ${f(r)} 0 ${large} 1 ${f(x2)} ${f(y2)}`
}

function toPoints(list) {
  return list.map(([x, y]) => `${f(x)},${f(y)}`).join(' ')
}

function wave(x0, x1, y, amplitude, cycles, samples = 48) {
  const list = []
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples
    list.push([x0 + (x1 - x0) * t, y - amplitude * Math.sin(cycles * 2 * Math.PI * t)])
  }
  return toPoints(list)
}

function spiral(cx, cy, r0, r1, turns, samples = 72) {
  const list = []
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples
    const angle = t * turns * 2 * Math.PI
    const r = r0 + (r1 - r0) * t
    list.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)])
  }
  return toPoints(list)
}

/** 中央抽象图标：都画在 x 42–86 / y 30–74 的图标区内，只用 icon 与 accent 两色。 */
const ICONS = {
  'orbit-master': (c) =>
    `<polyline points="${spiral(64, 54, 2.5, 19, 2.6)}" fill="none" stroke="${c.icon}" stroke-width="2.4" stroke-linecap="round"/>`,
  'perfect-loop': (c) =>
    `<circle cx="64" cy="54" r="17" fill="none" stroke="${c.icon}" stroke-width="2.4"/><circle cx="64" cy="37" r="3" fill="${c.accent}"/>`,
  'rollercoaster': (c) =>
    `<polyline points="${wave(42, 86, 54, 13, 2)}" fill="none" stroke="${c.icon}" stroke-width="2.4" stroke-linecap="round"/><circle cx="47.5" cy="41" r="2.6" fill="${c.accent}"/>`,
  'cloud-climber': (c) =>
    `<path d="M44 70H54V58H64V46H78" fill="none" stroke="${c.icon}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M60 40q3 -7 10 -5q5 -5 10 1q5 0 4 4z" fill="none" stroke="${c.accent}" stroke-width="2" stroke-linejoin="round"/>`,
  'long-voyager': (c) =>
    `<path d="M42 54H82M75 47L83 54L75 61" fill="none" stroke="${c.icon}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M48 60V65M58 60V65M68 60V65" stroke="${c.accent}" stroke-width="1.8" stroke-linecap="round"/>`,
  'low-skimmer': (c) =>
    `<path d="M42 50Q64 62 86 50" fill="none" stroke="${c.icon}" stroke-width="2.4" stroke-linecap="round"/><path d="M42 68H86" stroke="${c.accent}" stroke-width="2" stroke-linecap="round"/><path d="M48 68L44 73M58 68L54 73M68 68L64 73M78 68L74 73" stroke="${c.accent}" stroke-width="1.4" opacity="0.8" stroke-linecap="round"/>`,
  'steady-rock': (c) =>
    `<polyline points="${wave(42, 86, 46, 1.1, 3)}" fill="none" stroke="${c.icon}" stroke-width="2.2" stroke-linecap="round"/><path d="M50 70L57 58H71L78 70Z" fill="none" stroke="${c.accent}" stroke-width="2.2" stroke-linejoin="round"/>`,
  'zen-cruise': (c) =>
    `<path d="${arcPath(64, 54, 17, 25, 335)}" fill="none" stroke="${c.icon}" stroke-width="2.6" stroke-linecap="round"/><circle cx="64" cy="37" r="2.4" fill="${c.accent}"/>`,
}

/** 共用骨架：章面 + 8 道星芒 + 16 点环纹 + 三道环。 */
function skeleton(c) {
  const rays = []
  for (let k = 0; k < 8; k += 1) {
    const [x1, y1] = polar(64, 64, 52, k * 45)
    const [x2, y2] = polar(64, 64, 60, k * 45)
    rays.push(`<path d="M${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}"/>`)
  }
  const dots = []
  for (let k = 0; k < 16; k += 1) {
    const [x, y] = polar(64, 64, 55.5, 11.25 + k * 22.5)
    dots.push(`<circle cx="${f(x)}" cy="${f(y)}" r="0.9"/>`)
  }
  return [
    `<circle cx="64" cy="64" r="62" fill="${c.face}"/>`,
    `<g stroke="${c.accent}" stroke-width="1.6" opacity="0.85" stroke-linecap="round">${rays.join('')}</g>`,
    `<g fill="${c.ray}">${dots.join('')}</g>`,
    `<circle cx="64" cy="64" r="61" fill="none" stroke="${c.rim}" stroke-width="1.4"/>`,
    `<circle cx="64" cy="64" r="51" fill="none" stroke="${c.rim}" stroke-width="1.8"/>`,
    `<circle cx="64" cy="64" r="47" fill="none" stroke="${c.rim}" stroke-width="0.7" opacity="0.5"/>`,
  ].join('')
}

/**
 * @param {string} badgeId badges.js 里的勋章 id
 * @param {{face:string,rim:string,ray:string,icon:string,accent:string,ink:string}} colors 已解析的真实色值
 * @param {number} size 输出 width/height（viewBox 恒为 0 0 128 128）
 * @returns {string} 完整标准 SVG 字符串
 */
export function getBadgeSvgString(badgeId, colors, size = 128) {
  for (const key of COLOR_KEYS) {
    const value = colors ? colors[key] : undefined
    if (typeof value !== 'string' || value.trim() === '' || value.includes('var(')) {
      throw new Error(
        `勋章配色「${key}」必须是 getComputedStyle 解析后的真实色值，收到：${String(value)}。不许传 var(--*) 或空值。`,
      )
    }
  }

  const badge = BADGES.find((item) => item.id === badgeId)
  if (!badge) throw new Error(`没有这枚勋章：${String(badgeId)}。`)

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${VIEW_BOX}" role="img" aria-label="${badge.name}勋章">`,
    skeleton(colors),
    ICONS[badge.id](colors),
    `<path d="M46 80H82" stroke="${colors.rim}" stroke-width="0.8" opacity="0.45"/>`,
    `<text x="64" y="97" text-anchor="middle" font-family="${FONT_STACK}" font-size="12.5" letter-spacing="0.8" fill="${colors.ink}">${badge.name}</text>`,
    '</svg>',
  ].join('')
}

/** SVG → Image 用的 data URL。章面含中文，必须 encodeURIComponent，严禁 btoa()。 */
export function badgeSvgDataUrl(badgeId, colors, size = 128) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(getBadgeSvgString(badgeId, colors, size))}`
}