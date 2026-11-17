import * as THREE from 'three'
import { Line2 } from 'three/addons/lines/Line2.js'
import { LineGeometry } from 'three/addons/lines/LineGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'

/**
 * 降级梯子②：宽线渲染。按段平均速度分慢/中/快三档，每档一个 LineSegments2，
 * 整条轨迹最多 3 个对象（严禁逐段建独立 Mesh）。逐段顶点色仍按高度青→金插值。
 */

const TIERS = [
  { name: 'slow', max: 0.62, widthScale: 2 },
  { name: 'mid', max: 0.85, widthScale: 1.25 },
  { name: 'fast', max: Infinity, widthScale: 0.7 },
]

export function buildLineTrace({ positions, colors, speedNorm, baseWidth = 3.2 }) {
  const segmentCount = positions.length - 1
  if (segmentCount < 1) return null

  const buckets = TIERS.map(() => ({ positions: [], colors: [], startRings: [] }))
  for (let i = 0; i < segmentCount; i += 1) {
    const normalized = (speedNorm[i] + speedNorm[i + 1]) / 2
    const tier = TIERS.findIndex((item) => normalized < item.max)
    const bucket = buckets[tier < 0 ? TIERS.length - 1 : tier]
    const a = positions[i]
    const b = positions[i + 1]
    bucket.positions.push(a.x, a.y, a.z, b.x, b.y, b.z)
    bucket.colors.push(colors[i].r, colors[i].g, colors[i].b, colors[i + 1].r, colors[i + 1].g, colors[i + 1].b)
    bucket.startRings.push(i)
  }

  const group = new THREE.Group()
  group.name = 'line-trace'
  const objects = []

  buckets.forEach((bucket, index) => {
    if (!bucket.startRings.length) return
    const geometry = new LineSegmentsGeometry()
    geometry.setPositions(new Float32Array(bucket.positions))
    geometry.setColors(new Float32Array(bucket.colors))
    const material = new LineMaterial({
      vertexColors: true,
      linewidth: baseWidth * TIERS[index].widthScale,
      worldUnits: false,
      transparent: true,
      depthWrite: false,
      dashed: false,
      alphaToCoverage: false,
    })
    const line = new LineSegments2(geometry, material)
    line.frustumCulled = false
    line.name = `trace-${TIERS[index].name}`
    group.add(line)
    objects.push({ line, geometry, material, startRings: bucket.startRings, tier: TIERS[index].name })
  })

  const totalSegments = objects.reduce((sum, item) => sum + item.startRings.length, 0)

  return {
    group,
    objects,
    segmentCount: totalSegments,
    vertexCount: totalSegments * 2,
    setResolution(width, height) {
      for (const item of objects) item.material.resolution.set(width, height)
    },
    /** 成型动画：只显现起点环号小于 rings 的段，三档各自推进，整体仍沿点序。 */
    setReveal(rings) {
      for (const item of objects) {
        let visible = 0
        while (visible < item.startRings.length && item.startRings[visible] < rings) visible += 1
        item.geometry.instanceCount = visible
      }
    },
    revealAll() {
      for (const item of objects) item.geometry.instanceCount = item.startRings.length
    },
    dispose() {
      for (const item of objects) {
        item.geometry.dispose()
        item.material.dispose()
      }
    },
  }
}

/** 手绘笔迹：一条 Line2 实时画笔，像素宽度不随镜头缩放变化。 */
export function createBrush({ color, width = 4 }) {
  const geometry = new LineGeometry()
  geometry.setPositions(new Float32Array(6))
  const material = new LineMaterial({
    color,
    linewidth: width,
    worldUnits: false,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
    depthWrite: false,
    dashed: false,
  })
  const line = new Line2(geometry, material)
  line.frustumCulled = false
  line.visible = false
  line.renderOrder = 10

  return {
    line,
    update(points) {
      if (points.length < 2) {
        line.visible = false
        return
      }
      const flat = new Float32Array(points.length * 3)
      points.forEach((point, index) => {
        flat[index * 3] = point.x
        flat[index * 3 + 1] = point.y
        flat[index * 3 + 2] = point.z
      })
      geometry.setPositions(flat)
      line.visible = true
    },
    clear() {
      line.visible = false
    },
    setResolution(width, height) {
      material.resolution.set(width, height)
    },
    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}