import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'
import { altitudeColor, altitudeT, clamp01, makeGlowTexture, readPalette } from './palette.js'
import { buildTraceTube, ringDrawCount } from './tubeGeometry.js'
import { buildLineTrace, createBrush } from './lineTrace.js'
import { makeSpeedScale } from './speedScale.js'
import { DRAW_BOARD, buildHandFlight } from './handDraw.js'

/**
 * 3D 轨迹雕塑舞台。只消费 processFlightData() 的输出（points / bounds / stats），
 * 坐标映射 (x, y, alt) → (x, alt, -y)、缩放与居中 fit 全部在这里完成，渲染层不重算任何统计。
 */

const DEG = Math.PI / 180
const FOV = 45
const AZIMUTH = 45 * DEG
const ELEVATION = 35 * DEG
const FIT_MARGIN = 1.1
const FORMATION_SECONDS = 2
const REFLIGHT_SECONDS = 5
const AUTO_ROTATE_DELAY_MS = 3000
const AUTO_ROTATE_SPEED = 0.5
const MAX_DPR = 2
const TRAIL_SEGMENTS = 47
const LEVELS = ['tube', 'line', 'constant']
const LEVEL_LABELS = { tube: '①变径管线', line: '②宽线', constant: '③恒径管线' }
const WHITE = new THREE.Color(1, 1, 1)

const easeInOutCubic = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2)
const easeOutCubic = (k) => 1 - Math.pow(1 - k, 3)

function median(values) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

export class FlightScene {
  constructor(container, callbacks = {}) {
    this.container = container
    this.callbacks = callbacks
    this.disposed = false
    this.failed = null
    this.palette = readPalette()
    this.level = 'tube'
    this.quality = 'auto'
    this.degradeReason = ''
    this.radialSegments = 8
    this.dprCap = MAX_DPR
    this.result = null
    this.bounds = null
    this.stats = null
    this.worldPoints = []
    this.arc = []
    this.trace = null
    this.markers = []
    this.ringCount = 0
    this.revealedRings = 0
    this.fit = null
    this.boardFit = null
    this.hasFitted = false
    this.userOrbited = false
    this.tween = null
    this.formation = { active: false, start: 0, duration: FORMATION_SECONDS }
    this.reflightState = { active: false, parked: false, s: 0, fade: 1, history: [] }
    this.draw = { active: false, stroke: [], pointerId: null, before: null }
    this.lastInteraction = performance.now()
    this.frameTimes = []
    this.framesSinceVerdict = 0
    this.fpsVerdict = null
    this.diagnosticsDirty = true
    this.lastDiagnosticsEmit = 0
    this.paused = false
    this.onScreen = true
    this.raf = 0
    this.lastFrame = performance.now()
    this.cssW = 1
    this.cssH = 1
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    this.coarsePointer = window.matchMedia('(pointer: coarse)').matches

    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
    } catch (error) {
      this.failed = `这台设备或浏览器没能启用 WebGL，3D 舞台无法渲染：${error && error.message ? error.message : '未知原因'}。`
      return
    }

    const renderer = this.renderer
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.dprCap))
    renderer.setClearColor(0x000000, 0)
    renderer.toneMapping = THREE.NeutralToneMapping
    renderer.toneMappingExposure = 1
    const canvas = renderer.domElement
    canvas.className = 'stage-canvas'
    canvas.tabIndex = 0
    canvas.setAttribute('role', 'img')
    canvas.setAttribute('aria-label', '3D 轨迹雕塑舞台：拖动旋转，滚轮或双指缩放，静置三秒后自动缓慢自转')
    container.appendChild(canvas)
    this.canvas = canvas

    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 20000)
    this.camera.up.set(0, 1, 0)

    this.raycaster = new THREE.Raycaster()
    this.drawPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -DRAW_BOARD.baseAlt)
    this.glowTexture = makeGlowTexture()

    this.traceGroup = new THREE.Group()
    this.markerGroup = new THREE.Group()
    this.transientGroup = new THREE.Group()
    this.boardGroup = new THREE.Group()
    this.boardGroup.visible = false
    this.scene.add(this.traceGroup, this.markerGroup, this.transientGroup, this.boardGroup)

    this.ambient = new THREE.AmbientLight(this.palette.color.traceCyan.clone().lerp(WHITE, 0.72), 0.9)
    this.key = new THREE.DirectionalLight(this.palette.color.traceGold.clone().lerp(WHITE, 0.82), 1.5)
    this.keyTarget = new THREE.Object3D()
    this.key.target = this.keyTarget
    this.scene.add(this.ambient, this.key, this.keyTarget)

    const gridColor = this.palette.color.stageLine.clone().lerp(this.palette.color.traceCyan, 0.45)
    this.grid = new THREE.GridHelper(1, 24, this.palette.color.traceCyan, gridColor)
    this.grid.material.transparent = true
    this.grid.material.opacity = 0.16
    this.grid.material.depthWrite = false
    this.scene.add(this.grid)

    this.floorGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: this.glowTexture,
        color: this.palette.color.traceCyan,
        transparent: true,
        opacity: 0.13,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    )
    this.floorGlow.rotation.x = -Math.PI / 2
    this.scene.add(this.floorGlow)

    this.markerGeometry = new THREE.SphereGeometry(1, 12, 10)
    this.markerMaterial = new THREE.MeshBasicMaterial({ color: this.palette.color.traceGold, toneMapped: false })

    this.headSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.glowTexture,
        color: this.palette.color.traceGold,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    )
    this.headCore = new THREE.Mesh(this.markerGeometry, this.markerMaterial)
    this.headSprite.visible = false
    this.headCore.visible = false
    this.transientGroup.add(this.headSprite, this.headCore)

    const trailGeometry = new LineSegmentsGeometry()
    trailGeometry.setPositions(new Float32Array(TRAIL_SEGMENTS * 6))
    trailGeometry.setColors(new Float32Array(TRAIL_SEGMENTS * 6))
    this.trailMaterial = new LineMaterial({
      vertexColors: true,
      linewidth: 3,
      worldUnits: false,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    this.trail = new LineSegments2(trailGeometry, this.trailMaterial)
    this.trail.frustumCulled = false
    this.trail.visible = false
    this.transientGroup.add(this.trail)

    this.boardGrid = new THREE.GridHelper(DRAW_BOARD.half * 2, 12, this.palette.color.traceCyan, gridColor)
    this.boardGrid.material.transparent = true
    this.boardGrid.material.opacity = 0.22
    this.boardGrid.material.depthWrite = false
    this.boardGrid.position.y = DRAW_BOARD.baseAlt
    const half = DRAW_BOARD.half
    const borderPoints = [
      new THREE.Vector3(-half, DRAW_BOARD.baseAlt, -half),
      new THREE.Vector3(half, DRAW_BOARD.baseAlt, -half),
      new THREE.Vector3(half, DRAW_BOARD.baseAlt, half),
      new THREE.Vector3(-half, DRAW_BOARD.baseAlt, half),
    ]
    this.boardBorder = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(borderPoints),
      new THREE.LineBasicMaterial({ color: this.palette.color.signalInfo, transparent: true, opacity: 0.55 }),
    )
    this.brush = createBrush({ color: this.palette.color.traceCyan, width: 4 })
    this.boardGroup.add(this.boardGrid, this.boardBorder, this.brush.line)

    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.06
    this.controls.enablePan = false
    this.controls.rotateSpeed = 0.8
    this.controls.zoomSpeed = 0.85
    this.controls.autoRotate = false
    this.controls.autoRotateSpeed = AUTO_ROTATE_SPEED
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE }
    this.onUserOrbit = () => {
      this.userOrbited = true
      this.noteInteraction()
    }
    this.controls.addEventListener('start', this.onUserOrbit)

    this.onPointerDown = this.handlePointerDown.bind(this)
    this.onPointerMove = this.handlePointerMove.bind(this)
    this.onPointerUp = this.handlePointerUp.bind(this)
    this.onPointerCancel = this.handlePointerCancel.bind(this)
    this.onWheel = () => this.onUserOrbit()
    this.onVisibility = () => this.setPaused(document.hidden || !this.onScreen)
    this.onContextLost = (event) => {
      event.preventDefault()
      this.failed = 'WebGL 上下文丢失（显卡驱动重置或标签页长时间后台）。请刷新页面重建舞台。'
      this.markDirty()
    }
    canvas.addEventListener('pointerdown', this.onPointerDown)
    canvas.addEventListener('pointermove', this.onPointerMove)
    canvas.addEventListener('pointerup', this.onPointerUp)
    canvas.addEventListener('pointercancel', this.onPointerCancel)
    canvas.addEventListener('wheel', this.onWheel, { passive: true })
    canvas.addEventListener('webglcontextlost', this.onContextLost)
    document.addEventListener('visibilitychange', this.onVisibility)

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        this.onScreen = entries.some((entry) => entry.isIntersecting)
        this.setPaused(document.hidden || !this.onScreen)
      },
      { threshold: 0 },
    )
    this.intersectionObserver.observe(container)

    this.tick = this.tick.bind(this)
    this.resize()
    this.raf = requestAnimationFrame(this.tick)
  }

  /* ------------------------------------------------------------ 尺寸与相机 */

  resize() {
    if (this.disposed || !this.renderer) return
    const rect = this.container.getBoundingClientRect()
    const width = Math.max(1, Math.round(rect.width))
    const height = Math.max(1, Math.round(rect.height))
    this.cssW = width
    this.cssH = height
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.dprCap))
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    if (this.trace?.kind === 'line') this.trace.lineTrace.setResolution(width, height)
    this.trailMaterial.resolution.set(width, height)
    this.brush.setResolution(width, height)
    if (this.bounds) {
      this.fit = this.computeFit(this.bounds, width / height)
      this.applyFitLimits(this.fit)
      // 用户还没手动转过镜头时，尺寸变化后重新贴合，避免横竖屏切换切边。
      if (!this.userOrbited && !this.tween && !this.draw.active) {
        this.camera.position.copy(this.fit.position)
        this.camera.up.copy(this.fit.up)
        this.controls.target.copy(this.fit.center)
        this.camera.lookAt(this.fit.center)
        this.controls.update()
      }
    }
    if (this.draw.active) {
      this.boardFit = this.computeBoardFit(width / height)
      this.applyFitLimits(this.boardFit)
      this.camera.position.copy(this.boardFit.position)
      this.controls.target.copy(this.boardFit.center)
      this.camera.up.set(0, 0, -1)
      this.camera.lookAt(this.boardFit.center)
      this.tween = null
      this.updateFog(this.boardFit)
    }
    // 缓冲尺寸一变就同步重绘：留着未渲染的新尺寸缓冲会被合成器读回，触发驱动 blit 反馈环告警。
    this.renderer.render(this.scene, this.camera)
    this.markDirty()
  }

  computeFit(bounds, aspect) {
    const center = new THREE.Vector3(
      (bounds.minX + bounds.maxX) / 2,
      (bounds.minAlt + bounds.maxAlt) / 2,
      -(bounds.minY + bounds.maxY) / 2,
    )
    const spanX = bounds.maxX - bounds.minX
    const spanY = bounds.maxY - bounds.minY
    const spanAlt = bounds.maxAlt - bounds.minAlt
    const span = bounds.maxSpan > 0 ? bounds.maxSpan : Math.max(spanX, spanY, spanAlt, 1)
    const radius = Math.max(1, 0.5 * Math.hypot(spanX, spanAlt, spanY) + span * 0.026)
    const safeAspect = aspect > 0 ? aspect : 1
    // 竖画布时水平视场更窄，改用水平 fov 参与 fit，保证扁平轨迹左右也不切边。
    const fovEff = safeAspect < 1 ? 2 * Math.atan(Math.tan((FOV * DEG) / 2) * safeAspect) : FOV * DEG
    const distance = (radius / Math.sin(fovEff / 2)) * FIT_MARGIN
    const direction = new THREE.Vector3(
      Math.cos(ELEVATION) * Math.sin(AZIMUTH),
      Math.sin(ELEVATION),
      Math.cos(ELEVATION) * Math.cos(AZIMUTH),
    )
    return {
      center,
      radius,
      distance,
      fovEff,
      position: center.clone().addScaledVector(direction, distance),
      up: new THREE.Vector3(0, 1, 0),
      near: Math.max(0.05, distance / 500),
      far: distance * 6 + radius * 6,
    }
  }

  computeBoardFit(aspect) {
    const fit = this.computeFit(DRAW_BOARD.bounds, aspect)
    const direction = new THREE.Vector3(0, 1, 0)
    return {
      ...fit,
      position: fit.center.clone().addScaledVector(direction, fit.distance),
      up: new THREE.Vector3(0, 0, -1),
    }
  }

  applyFitLimits(fit) {
    this.camera.near = fit.near
    this.camera.far = fit.far
    this.camera.updateProjectionMatrix()
    this.controls.minDistance = fit.distance * 0.3
    this.controls.maxDistance = fit.distance * 4
    this.updateFog(fit)
    this.keyTarget.position.copy(fit.center)
    this.key.position.copy(fit.center).add(new THREE.Vector3(-0.55, 0.95, 0.42).multiplyScalar(fit.distance))
  }

  updateFog(fit) {
    const color = this.palette.color.stageVoid
    this.scene.fog = new THREE.Fog(color, fit.distance * 0.95, fit.distance * 2.1)
  }

  applyFit(fit, { tween = false } = {}) {
    this.applyFitLimits(fit)
    if (tween && this.hasFitted) {
      this.tweenCamera(fit.position, fit.center, fit.up, 0.6)
    } else {
      this.tween = null
      this.camera.position.copy(fit.position)
      this.camera.up.copy(fit.up)
      this.controls.target.copy(fit.center)
      this.controls.enabled = !this.draw.active
      this.camera.lookAt(fit.center)
      this.controls.update()
    }
    this.hasFitted = true
    this.userOrbited = false
    this.noteInteraction()
  }

  tweenCamera(position, target, up, seconds) {
    this.tween = {
      fromPosition: this.camera.position.clone(),
      toPosition: position.clone(),
      fromTarget: this.controls.target.clone(),
      toTarget: target.clone(),
      fromUp: this.camera.up.clone(),
      toUp: up.clone(),
      start: performance.now(),
      duration: this.reducedMotion ? 0.01 : seconds,
    }
    this.controls.enabled = false
    this.controls.autoRotate = false
  }

  updateTween(now) {
    if (!this.tween) return
    const tween = this.tween
    const k = clamp01((now - tween.start) / (tween.duration * 1000))
    const eased = easeInOutCubic(k)
    this.camera.position.lerpVectors(tween.fromPosition, tween.toPosition, eased)
    this.controls.target.lerpVectors(tween.fromTarget, tween.toTarget, eased)
    this.camera.up.lerpVectors(tween.fromUp, tween.toUp, eased).normalize()
    this.camera.lookAt(this.controls.target)
    if (k >= 1) {
      this.tween = null
      this.controls.enabled = !this.draw.active
      this.controls.update()
      this.markDirty()
    }
  }

  resetView() {
    if (!this.fit || this.draw.active) return
    this.applyFit(this.fit, { tween: true })
  }

  noteInteraction = () => {
    this.lastInteraction = performance.now()
    if (this.controls) this.controls.autoRotate = false
  }

  /* ---------------------------------------------------------------- 数据接入 */

  setResult(result, { animate = true } = {}) {
    if (this.disposed || this.failed || !result || !result.ok) return
    if (this.draw.active) this.exitHandDraw({ silent: true })
    this.result = result
    this.bounds = result.bounds
    this.stats = result.stats
    this.worldPoints = result.points.map((point) => new THREE.Vector3(point.x, point.alt, -point.y))
    this.ringCount = this.worldPoints.length
    this.arc = [0]
    for (let i = 1; i < this.worldPoints.length; i += 1) {
      this.arc.push(this.arc[i - 1] + this.worldPoints[i].distanceTo(this.worldPoints[i - 1]))
    }
    this.disposeTrace()
    this.disposeMarkers()
    this.buildTrace()
    this.buildMarkers()
    this.reflightState = { active: false, parked: false, s: 0, fade: 1, history: [] }
    this.trail.visible = false
    this.headSprite.visible = false
    this.headCore.visible = false
    const aspect = this.cssW / Math.max(1, this.cssH)
    this.fit = this.computeFit(this.bounds, aspect)
    this.applyFit(this.fit, { tween: animate })
    this.updateEnvironment()
    this.startFormation()
    this.frameTimes = []
    this.framesSinceVerdict = 0
    this.fpsVerdict = null
    this.markDirty()
  }

  updateEnvironment() {
    const bounds = this.bounds
    const span = bounds.maxSpan > 0 ? bounds.maxSpan : 1
    const altSpan = bounds.maxAlt - bounds.minAlt
    // 参考网格常开极淡：有高度跨度时置于 minAlt 下方 2% 跨度处，平飞时紧贴下方 0.5m。
    const gridY = altSpan > 0 ? bounds.minAlt - altSpan * 0.02 : bounds.minAlt - 0.5
    this.grid.scale.setScalar(span * 1.9)
    this.grid.position.set((bounds.minX + bounds.maxX) / 2, gridY, -(bounds.minY + bounds.maxY) / 2)
    this.floorGlow.scale.setScalar(span * 2.4)
    this.floorGlow.position.set(this.grid.position.x, gridY + span * 0.001, this.grid.position.z)
  }

  buildTrace() {
    if (this.ringCount < 2) return
    const span = this.bounds.maxSpan > 0 ? this.bounds.maxSpan : 1
    const radiusMin = span * 0.0035
    const radiusMax = span * 0.0125
    const points = this.result.points
    const speedScale = makeSpeedScale(this.stats)
    const speedNorm = points.map((point) => speedScale(point.speed))
    const colors = points.map((point) => altitudeColor(this.palette, altitudeT(point.alt, this.bounds)))

    if (this.level === 'line') {
      const lineTrace = buildLineTrace({
        positions: this.worldPoints,
        colors,
        speedNorm,
        baseWidth: 3.2,
      })
      if (!lineTrace) return
      lineTrace.setResolution(this.cssW, this.cssH)
      this.traceGroup.add(lineTrace.group)
      this.trace = { kind: 'line', lineTrace }
      return
    }

    const constant = this.level === 'constant'
    const radii = points.map((point, i) => {
      if (constant) return (radiusMin + radiusMax) / 2
      return radiusMax + (radiusMin - radiusMax) * speedNorm[i]
    })
    // ③恒径级：速度改由颜色明暗表达，高度色相渐变保持不变。
    const tubeColors = constant
      ? colors.map((color, i) => color.clone().multiplyScalar(0.5 + 0.65 * speedNorm[i]))
      : colors

    const tube = buildTraceTube({ positions: this.worldPoints, radii, colors: tubeColors, radialSegments: this.radialSegments })
    if (!tube) return
    if (!tube.frame.ok) {
      tube.geometry.dispose()
      this.degrade(`标架自检未通过（minNormalDot=${tube.frame.minNormalDot.toFixed(3)}，非法值 ${tube.frame.nonFinite}）`)
      return
    }
    const core = new THREE.Mesh(
      tube.geometry,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.06 }),
    )
    const haloTube = buildTraceTube({
      positions: this.worldPoints,
      radii: radii.map((radius) => radius * 2.1),
      colors: tubeColors,
      radialSegments: this.radialSegments,
    })
    const halo = new THREE.Mesh(
      haloTube.geometry,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.16,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    )
    halo.renderOrder = 2
    this.traceGroup.add(core, halo)
    this.trace = {
      kind: 'tube',
      tube,
      haloTube,
      core,
      halo,
      radiusRange: { min: Math.min(...radii), max: Math.max(...radii) },
    }
  }

  buildMarkers() {
    const span = this.bounds.maxSpan > 0 ? this.bounds.maxSpan : 1
    const radius = Math.min(14, Math.max(0.4, span * 0.008))
    const glowSize = span * 0.06
    this.result.points.forEach((point, index) => {
      if (!point.isTurn) return
      const position = this.worldPoints[index]
      const core = new THREE.Mesh(this.markerGeometry, this.markerMaterial)
      core.position.copy(position)
      core.scale.setScalar(radius)
      const material = new THREE.SpriteMaterial({
        map: this.glowTexture,
        color: altitudeColor(this.palette, altitudeT(point.alt, this.bounds)),
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      })
      const sprite = new THREE.Sprite(material)
      sprite.position.copy(position)
      sprite.scale.setScalar(glowSize)
      sprite.renderOrder = 3
      this.markerGroup.add(core, sprite)
      this.markers.push({ ring: index, core, sprite, material })
    })
  }

  setReveal(rings) {
    this.revealedRings = rings
    if (this.trace?.kind === 'tube') {
      const count = ringDrawCount(rings, this.trace.tube.indicesPerRing, this.trace.tube.indexCount)
      this.trace.core.geometry.setDrawRange(0, count)
      this.trace.halo.geometry.setDrawRange(0, count)
    } else if (this.trace?.kind === 'line') {
      this.trace.lineTrace.setReveal(rings)
    }
    for (const marker of this.markers) {
      const visible = marker.ring < rings
      marker.core.visible = visible
      marker.sprite.visible = visible
    }
  }

  startFormation() {
    if (this.ringCount < 2) return
    this.formation = {
      active: true,
      start: performance.now(),
      duration: this.reducedMotion ? 0.35 : FORMATION_SECONDS,
    }
    this.setReveal(0)
    this.markDirty()
  }

  replayFormation() {
    if (this.draw.active) return
    this.reflightState.active = false
    this.reflightState.parked = false
    this.trail.visible = false
    this.headSprite.visible = false
    this.headCore.visible = false
    this.startFormation()
    this.noteInteraction()
  }

  updateFormation(now) {
    if (!this.formation.active) return
    const k = clamp01((now - this.formation.start) / (this.formation.duration * 1000))
    const rings = Math.floor(easeOutCubic(k) * this.ringCount)
    this.setReveal(rings)
    if (rings > 0 && rings < this.ringCount) {
      const index = Math.min(this.ringCount - 1, rings - 1)
      const position = this.worldPoints[index]
      const span = this.bounds.maxSpan > 0 ? this.bounds.maxSpan : 1
      this.headCore.position.copy(position)
      this.headCore.scale.setScalar(span * 0.006)
      this.headCore.visible = true
      this.headSprite.position.copy(position)
      this.headSprite.scale.setScalar(span * 0.05)
      this.headSprite.material.color.copy(altitudeColor(this.palette, altitudeT(this.result.points[index].alt, this.bounds)))
      this.headSprite.visible = true
    }
    if (k >= 1) {
      this.formation.active = false
      this.setReveal(this.ringCount)
      this.headSprite.visible = false
      this.headCore.visible = false
      this.markDirty()
    }
  }

  /* -------------------------------------------------------------------- 重飞 */

  reflight() {
    if (this.draw.active || this.ringCount < 2 || this.formation.active) return
    this.reflightState = { active: true, parked: false, s: 0, fade: 1, history: [] }
    this.trail.visible = true
    this.trailMaterial.opacity = 1
    this.headSprite.visible = true
    this.headCore.visible = true
    this.noteInteraction()
    this.markDirty()
  }

  sampleAt(distance) {
    const total = this.arc[this.arc.length - 1]
    const s = Math.max(0, Math.min(distance, total))
    let low = 0
    let high = this.arc.length - 1
    while (low < high - 1) {
      const middle = (low + high) >> 1
      if (this.arc[middle] <= s) low = middle
      else high = middle
    }
    const span = this.arc[high] - this.arc[low]
    const ratio = span > 0 ? (s - this.arc[low]) / span : 0
    const position = this.worldPoints[low].clone().lerp(this.worldPoints[high], clamp01(ratio))
    const speed =
      this.result.points[low].speed + (this.result.points[high].speed - this.result.points[low].speed) * clamp01(ratio)
    return { position, speed, index: low }
  }

  updateReflight(dt) {
    const state = this.reflightState
    if (state.parked) {
      state.fade = Math.max(0, state.fade - dt / 0.9)
      this.trailMaterial.opacity = state.fade
      if (state.fade <= 0) {
        this.trail.visible = false
        state.parked = false
        this.markDirty()
      }
      return
    }
    if (!state.active) return
    const total = this.arc[this.arc.length - 1]
    const average = this.stats.avgSpeed > 0 ? this.stats.avgSpeed : 1
    const scale = total > 0 ? total / (REFLIGHT_SECONDS * average) : 1
    const here = this.sampleAt(state.s)
    state.s += here.speed * dt * scale
    if (state.s >= total) {
      state.s = total
      state.active = false
      state.parked = true
      this.markDirty()
    }
    const sample = this.sampleAt(state.s)
    const span = this.bounds.maxSpan > 0 ? this.bounds.maxSpan : 1
    this.headCore.position.copy(sample.position)
    this.headCore.scale.setScalar(span * 0.007)
    this.headSprite.position.copy(sample.position)
    this.headSprite.scale.setScalar(span * 0.055)
    this.headSprite.material.color.copy(altitudeColor(this.palette, altitudeT(this.result.points[sample.index].alt, this.bounds)))

    state.history.push(sample.position.clone())
    if (state.history.length > TRAIL_SEGMENTS + 1) state.history.shift()
    this.writeTrail(state.history, this.headSprite.material.color)
  }

  writeTrail(history, color) {
    const geometry = this.trail.geometry
    const segments = Math.min(history.length - 1, TRAIL_SEGMENTS)
    if (segments < 1) {
      geometry.instanceCount = 0
      return
    }
    const positionArray = geometry.attributes.instanceStart.data.array
    const colorArray = geometry.attributes.instanceColorStart.data.array
    const start = history.length - 1 - segments
    for (let k = 0; k < segments; k += 1) {
      const a = history[start + k]
      const b = history[start + k + 1]
      positionArray[k * 6] = a.x
      positionArray[k * 6 + 1] = a.y
      positionArray[k * 6 + 2] = a.z
      positionArray[k * 6 + 3] = b.x
      positionArray[k * 6 + 4] = b.y
      positionArray[k * 6 + 5] = b.z
      const fade = Math.pow((k + 1) / segments, 1.6)
      colorArray[k * 6] = color.r * fade
      colorArray[k * 6 + 1] = color.g * fade
      colorArray[k * 6 + 2] = color.b * fade
      colorArray[k * 6 + 3] = color.r * fade
      colorArray[k * 6 + 4] = color.g * fade
      colorArray[k * 6 + 5] = color.b * fade
    }
    geometry.attributes.instanceStart.data.needsUpdate = true
    geometry.attributes.instanceColorStart.data.needsUpdate = true
    geometry.instanceCount = segments
  }

  /* ------------------------------------------------------------------ 手绘 */

  enterHandDraw() {
    if (this.disposed || this.failed || this.draw.active) return false
    this.draw.active = true
    this.draw.stroke = []
    this.draw.pointerId = null
    this.draw.before = {
      position: this.camera.position.clone(),
      target: this.controls.target.clone(),
      up: this.camera.up.clone(),
    }
    this.controls.enabled = false
    this.controls.autoRotate = false
    this.traceGroup.visible = false
    this.markerGroup.visible = false
    this.transientGroup.visible = false
    this.boardGroup.visible = true
    this.brush.clear()
    this.boardFit = this.computeBoardFit(this.cssW / Math.max(1, this.cssH))
    this.applyFitLimits(this.boardFit)
    this.tweenCamera(this.boardFit.position, this.boardFit.center, this.boardFit.up, 0.7)
    this.markDirty()
    return true
  }

  exitHandDraw({ silent = false } = {}) {
    if (!this.draw.active) return
    const before = this.draw.before
    this.draw.active = false
    this.draw.stroke = []
    this.draw.pointerId = null
    this.brush.clear()
    this.boardGroup.visible = false
    this.traceGroup.visible = true
    this.markerGroup.visible = true
    this.transientGroup.visible = true
    this.controls.enabled = true
    if (this.fit) this.updateFog(this.fit)
    if (!silent && before) {
      this.tweenCamera(before.position, before.target, before.up, 0.6)
    } else {
      this.camera.up.set(0, 1, 0)
    }
    this.markDirty()
    this.callbacks.onDrawExit?.()
  }

  appendStroke(event) {
    const rect = this.canvas.getBoundingClientRect()
    if (!(rect.width > 0) || !(rect.height > 0)) return
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(ndc, this.camera)
    const hit = this.raycaster.ray.intersectPlane(this.drawPlane, new THREE.Vector3())
    if (!hit) return
    const x = Math.max(-DRAW_BOARD.half, Math.min(DRAW_BOARD.half, hit.x))
    const y = Math.max(-DRAW_BOARD.half, Math.min(DRAW_BOARD.half, -hit.z))
    const stroke = this.draw.stroke
    const last = stroke[stroke.length - 1]
    if (last && Math.hypot(x - last.x, y - last.y) < 0.35) return
    if (stroke.length >= 4000) return
    stroke.push({ x, y })
    this.brush.update(stroke.map((point) => new THREE.Vector3(point.x, DRAW_BOARD.baseAlt, -point.y)))
  }

  handlePointerDown(event) {
    this.noteInteraction()
    if (!this.draw.active) return
    if (event.pointerType === 'mouse' && event.button !== 0) return
    this.draw.pointerId = event.pointerId
    this.draw.stroke = []
    if (this.canvas.setPointerCapture) this.canvas.setPointerCapture(event.pointerId)
    this.appendStroke(event)
    event.preventDefault()
  }

  handlePointerMove(event) {
    if (!this.draw.active || this.draw.pointerId !== event.pointerId) return
    this.appendStroke(event)
    event.preventDefault()
  }

  handlePointerUp(event) {
    if (!this.draw.active || this.draw.pointerId !== event.pointerId) return
    if (this.canvas.releasePointerCapture && this.canvas.hasPointerCapture?.(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId)
    }
    this.draw.pointerId = null
    const built = buildHandFlight(this.draw.stroke)
    if (!built.ok) {
      this.draw.stroke = []
      this.brush.clear()
      this.callbacks.onStrokeTooShort?.(built.error)
      this.markDirty()
      return
    }
    this.brush.clear()
    this.callbacks.onStrokePoints?.(built.points, built.meta)
  }

  handlePointerCancel(event) {
    if (!this.draw.active || this.draw.pointerId !== event.pointerId) return
    this.draw.pointerId = null
    this.draw.stroke = []
    this.brush.clear()
  }

  /* ------------------------------------------------------------ 降级梯子 */

  degrade(reason) {
    const index = LEVELS.indexOf(this.level)
    this.degradeReason = reason
    if (index >= LEVELS.length - 1) {
      // 已到梯子末端：只降一次 DPR 与径向分段，之后不再反复重建。
      if (this.dprCap === 1 && this.radialSegments === 6) return
      this.radialSegments = 6
      this.dprCap = 1
      this.degradeReason = `${reason}；已到③仍不达标，降 DPR=1、径向分段=6`
      this.resize()
      this.rebuildTrace()
      this.markDirty()
      return
    }
    this.level = LEVELS[index + 1]
    this.rebuildTrace()
    this.markDirty()
  }

  rebuildTrace() {
    if (!this.result) return
    this.disposeTrace()
    this.buildTrace()
    this.setReveal(this.formation.active ? this.revealedRings : this.ringCount)
    this.frameTimes = []
    this.framesSinceVerdict = 0
  }

  setQuality(mode) {
    if (this.disposed || this.failed) return
    this.quality = mode
    this.frameTimes = []
    this.framesSinceVerdict = 0
    this.fpsVerdict = null
    if (mode === 'auto') {
      this.level = 'tube'
      this.degradeReason = ''
      this.radialSegments = 8
      this.dprCap = MAX_DPR
    } else {
      this.level = mode
      this.degradeReason = '手动指定，用于降级梯子验收'
      // 手动指定即按该级完整画质渲染：把自动梯子压下去的径向分段与 DPR 一并还原。
      this.radialSegments = 8
      this.dprCap = MAX_DPR
    }
    this.resize()
    this.rebuildTrace()
    this.markDirty()
  }

  sampleFps(dt) {
    if (this.formation.active || this.draw.active || this.tween) return
    if (!(dt > 0.0005) || dt > 0.1) return
    this.frameTimes.push(dt)
    if (this.frameTimes.length > 120) this.frameTimes.shift()
    this.framesSinceVerdict += 1
    if (this.quality !== 'auto' || this.framesSinceVerdict < 120 || this.frameTimes.length < 60) return
    const fps = 1 / median(this.frameTimes)
    this.fpsVerdict = fps
    this.framesSinceVerdict = 0
    const threshold = this.coarsePointer ? 24 : 30
    if (fps < threshold) this.degrade(`实测中位 ${fps.toFixed(1)}fps 低于阈值 ${threshold}fps`)
    this.markDirty()
  }

  /* ---------------------------------------------------------------- 截图钩子 */

  captureStagePng({ width = 1080, height = 1350, useCurrentAngle = false } = {}) {
    if (this.disposed || this.failed || !this.renderer || !this.result) return null
    const renderer = this.renderer
    const camera = this.camera
    const targetWidth = Math.max(2, Math.round(width))
    const targetHeight = Math.max(2, Math.round(height))

    const previous = {
      pixelRatio: renderer.getPixelRatio(),
      size: renderer.getSize(new THREE.Vector2()),
      aspect: camera.aspect,
      near: camera.near,
      far: camera.far,
      position: camera.position.clone(),
      up: camera.up.clone(),
      target: this.controls.target.clone(),
      fog: this.scene.fog,
      rings: this.revealedRings,
      headSprite: this.headSprite.visible,
      headCore: this.headCore.visible,
      trail: this.trail.visible,
      autoRotate: this.controls.autoRotate,
      grid: this.grid.visible,
      floorGlow: this.floorGlow.visible,
    }

    // 强制全程显现，关掉雾与动画临时件，保证导出的是完整雕塑而不是半截成型。
    this.setReveal(this.ringCount)
    this.headSprite.visible = false
    this.headCore.visible = false
    this.trail.visible = false
    // 参考网格与地面光晕属于舞台背景，导出透明底雕塑时一并隐藏，四角才是干净的 alpha=0。
    this.grid.visible = false
    this.floorGlow.visible = false
    this.scene.fog = null
    this.controls.autoRotate = false

    renderer.setPixelRatio(1)
    renderer.setSize(targetWidth, targetHeight, false)
    camera.aspect = targetWidth / targetHeight
    if (!useCurrentAngle) {
      const fit = this.computeFit(this.draw.active ? DRAW_BOARD.bounds : this.bounds, camera.aspect)
      camera.near = fit.near
      camera.far = fit.far
      camera.up.copy(fit.up)
      camera.position.copy(fit.position)
      this.controls.target.copy(fit.center)
      camera.lookAt(fit.center)
    }
    camera.updateProjectionMatrix()
    renderer.setClearColor(0x000000, 0)
    renderer.render(this.scene, camera)
    // 读回前先把命令流跑完，避免驱动把同一帧缓冲既当读源又当写目标。
    renderer.getContext().finish()
    // 同一同步帧内取图：不依赖 preserveDrawingBuffer，也不截 DOM。
    const dataUrl = renderer.domElement.toDataURL('image/png')

    this.scene.fog = previous.fog
    renderer.setPixelRatio(previous.pixelRatio)
    renderer.setSize(previous.size.x, previous.size.y, false)
    camera.aspect = previous.aspect
    camera.near = previous.near
    camera.far = previous.far
    camera.position.copy(previous.position)
    camera.up.copy(previous.up)
    this.controls.target.copy(previous.target)
    camera.updateProjectionMatrix()
    this.controls.update()
    this.setReveal(previous.rings)
    this.headSprite.visible = previous.headSprite
    this.headCore.visible = previous.headCore
    this.trail.visible = previous.trail
    this.grid.visible = previous.grid
    this.floorGlow.visible = previous.floorGlow
    this.controls.autoRotate = previous.autoRotate
    renderer.render(this.scene, camera)

    return {
      dataUrl,
      width: targetWidth,
      height: targetHeight,
      bytes: Math.round((dataUrl.length - 'data:image/png;base64,'.length) * 0.75),
      level: this.level,
      useCurrentAngle,
    }
  }

  /* -------------------------------------------------------------- 循环与诊断 */

  setPaused(paused) {
    if (paused === this.paused || this.disposed) return
    this.paused = paused
    if (paused) {
      if (this.raf) cancelAnimationFrame(this.raf)
      this.raf = 0
    } else if (!this.raf) {
      this.lastFrame = performance.now()
      this.raf = requestAnimationFrame(this.tick)
    }
    this.markDirty()
  }

  tick(now) {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.tick)
    const dt = Math.min((now - this.lastFrame) / 1000, 0.05)
    this.lastFrame = now
    if (!this.paused && !this.failed) {
      this.updateTween(now)
      this.updateFormation(now)
      this.updateReflight(dt)
      if (!this.tween) {
        this.controls.autoRotate =
          !this.reducedMotion &&
          !this.draw.active &&
          !this.formation.active &&
          now - this.lastInteraction > AUTO_ROTATE_DELAY_MS
        this.controls.update()
      }
      this.renderer.render(this.scene, this.camera)
      this.sampleFps(dt)
    }
    this.emitDiagnostics(now)
  }

  markDirty() {
    this.diagnosticsDirty = true
  }

  emitDiagnostics(now) {
    if (!this.diagnosticsDirty || now - this.lastDiagnosticsEmit < 250) return
    this.diagnosticsDirty = false
    this.lastDiagnosticsEmit = now
    this.callbacks.onDiagnostics?.(this.getDiagnostics())
  }

  /** 实时镜头读数：方位角 / 俯角 / 距离 / 是否自转，供验收与后续步骤对齐视角。 */
  cameraReadout() {
    if (!this.controls) return null
    const offset = this.camera.position.clone().sub(this.controls.target)
    const distance = offset.length()
    if (!(distance > 0)) return null
    return {
      azimuthDeg: Math.round(Math.atan2(offset.x, offset.z) / DEG),
      elevationDeg: Math.round(Math.asin(Math.max(-1, Math.min(1, offset.y / distance))) / DEG),
      distance: Math.round(distance),
      autoRotate: this.controls.autoRotate,
      enabled: this.controls.enabled,
    }
  }

  getDiagnostics() {
    const recent = this.frameTimes.slice(-30)
    const fps = recent.length ? 1 / median(recent) : 0
    const tube = this.trace?.kind === 'tube' ? this.trace.tube : null
    return {
      failed: this.failed,
      level: this.level,
      levelLabel: LEVEL_LABELS[this.level],
      quality: this.quality,
      degradeReason: this.degradeReason,
      radialSegments: this.radialSegments,
      dpr: this.renderer ? this.renderer.getPixelRatio() : 0,
      vertexCount: tube ? tube.vertexCount + this.trace.haloTube.vertexCount : this.trace?.lineTrace?.vertexCount || 0,
      triangleCount: tube ? tube.triangleCount + this.trace.haloTube.triangleCount : 0,
      segmentCount: this.trace?.lineTrace?.segmentCount || 0,
      lineObjects: this.trace?.lineTrace?.objects.length || 0,
      ringCount: this.ringCount,
      revealedRings: this.revealedRings,
      markerCount: this.markers.length,
      isTurnCount: this.result ? this.result.isTurnCountDecimated : 0,
      turnCount: this.stats ? this.stats.turnCount : 0,
      frameCheck: tube ? tube.frame : null,
      radiusRange: this.trace?.radiusRange || null,
      fps: Math.round(fps),
      fpsVerdict: this.fpsVerdict ? Math.round(this.fpsVerdict) : null,
      formationActive: this.formation.active,
      reflightActive: this.reflightState.active,
      reflightParked: this.reflightState.parked,
      drawActive: this.draw.active,
      strokePoints: this.draw.stroke.length,
      paused: this.paused,
      canvas: { cssW: this.cssW, cssH: this.cssH },
      camera: this.cameraReadout(),
      fit: this.fit
        ? {
            distance: Math.round(this.fit.distance),
            radius: Math.round(this.fit.radius),
            fovEffDeg: Math.round(this.fit.fovEff / DEG),
            azimuthDeg: 45,
            elevationDeg: 35,
          }
        : null,
    }
  }

  getMarkerCount() {
    return this.markers.length
  }

  /* ------------------------------------------------------------------ 清理 */

  disposeTrace() {
    if (!this.trace) return
    if (this.trace.kind === 'tube') {
      this.trace.core.geometry.dispose()
      this.trace.core.material.dispose()
      this.trace.halo.geometry.dispose()
      this.trace.halo.material.dispose()
      this.traceGroup.remove(this.trace.core, this.trace.halo)
    } else {
      this.traceGroup.remove(this.trace.lineTrace.group)
      this.trace.lineTrace.dispose()
    }
    this.trace = null
  }

  disposeMarkers() {
    for (const marker of this.markers) {
      marker.material.dispose()
      this.markerGroup.remove(marker.core, marker.sprite)
    }
    this.markers = []
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
    this.resizeObserver?.disconnect()
    this.intersectionObserver?.disconnect()
    document.removeEventListener('visibilitychange', this.onVisibility)
    if (this.canvas) {
      this.canvas.removeEventListener('pointerdown', this.onPointerDown)
      this.canvas.removeEventListener('pointermove', this.onPointerMove)
      this.canvas.removeEventListener('pointerup', this.onPointerUp)
      this.canvas.removeEventListener('pointercancel', this.onPointerCancel)
      this.canvas.removeEventListener('wheel', this.onWheel)
      this.canvas.removeEventListener('webglcontextlost', this.onContextLost)
    }
    this.controls?.removeEventListener('start', this.noteInteraction)
    this.controls?.dispose()
    this.disposeTrace()
    this.disposeMarkers()
    this.brush?.dispose()
    this.trail?.geometry.dispose()
    this.trailMaterial?.dispose()
    this.headSprite?.material.dispose()
    this.markerGeometry?.dispose()
    this.markerMaterial?.dispose()
    this.grid?.geometry.dispose()
    this.grid?.material.dispose()
    this.boardGrid?.geometry.dispose()
    this.boardGrid?.material.dispose()
    this.boardBorder?.geometry.dispose()
    this.boardBorder?.material.dispose()
    this.floorGlow?.geometry.dispose()
    this.floorGlow?.material.dispose()
    this.glowTexture?.dispose()
    this.renderer?.dispose()
    this.canvas?.remove()
    this.scene?.clear()
  }
}