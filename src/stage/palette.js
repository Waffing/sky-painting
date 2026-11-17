import * as THREE from 'three'

/**
 * 渲染层的唯一取色入口：所有色值都从 tokens.css 的 CSS 变量读，
 * 这里不写任何 hex 字面量，改主题时 3D 舞台与界面自动跟随。
 */

const TOKENS = {
  stageVoid: '--color-stage-void',
  stageDeep: '--color-stage-deep',
  stageMid: '--color-stage-mid',
  stageLine: '--color-stage-line',
  traceCyan: '--color-trace-cyan',
  traceGold: '--color-trace-gold',
  inkOnStage: '--color-ink-on-stage',
  inkOnStageMuted: '--color-ink-on-stage-muted',
  signalOk: '--color-signal-ok',
  // 警示色按约定复用暖金轨迹色，不另立令牌。
  signalWarn: '--color-trace-gold',
  signalDanger: '--color-signal-danger',
  signalInfo: '--color-signal-info',
}

export function readPalette(element = document.documentElement) {
  const styles = getComputedStyle(element)
  const read = (name) => styles.getPropertyValue(name).trim()
  const hex = {}
  for (const [key, name] of Object.entries(TOKENS)) {
    // 令牌缺失时退回舞台文字色，绝不引入第二处色值来源。
    hex[key] = read(name) || read(TOKENS.inkOnStage)
  }
  const color = {}
  for (const [key, value] of Object.entries(hex)) color[key] = new THREE.Color(value)
  return { hex, color }
}

export const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value)

/** 高度归一化：平飞（maxAlt === minAlt）时退化取渐变中位，杜绝除零与 NaN 进顶点色。 */
export function altitudeT(alt, bounds) {
  const span = bounds.maxAlt - bounds.minAlt
  if (!(span > 0) || !Number.isFinite(alt)) return 0.5
  return clamp01((alt - bounds.minAlt) / span)
}

/** 低空青 → 高空暖金的连续插值，返回新的 Color（调用方持有）。 */
export function altitudeColor(palette, t) {
  return palette.color.traceCyan.clone().lerp(palette.color.traceGold, clamp01(t))
}

/** 加色光晕用的径向衰减贴图：白色 alpha 斜坡，着色交给材质 color。 */
export function makeGlowTexture(size = 128) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.25, 'rgba(255,255,255,0.55)')
  gradient.addColorStop(0.6, 'rgba(255,255,255,0.12)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}