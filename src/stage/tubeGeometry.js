import * as THREE from 'three'

/**
 * 变半径 3D 管线：平行移动标架（rotation-minimizing frame）逐点传输法线，
 * 因此不会出现扭转麻花。本模块只做几何，不读统计、不碰 DOM，可在 Node 里直接验证。
 *
 * 输入全部是渲染层已经换算好的世界坐标与视觉参数：
 *   positions: THREE.Vector3[]（数据 (x, y, alt) → 世界 (x, alt, -y)）
 *   radii:     number[]（每点半径，快细慢粗）
 *   colors:    THREE.Color[]（每点颜色，低空青 → 高空暖金）
 */

const EPS = 1e-9

function tangentsOf(positions) {
  const n = positions.length
  const tangents = new Array(n)
  for (let i = 0; i < n; i += 1) {
    const from = positions[Math.max(0, i - 1)]
    const to = positions[Math.min(n - 1, i + 1)]
    tangents[i] = new THREE.Vector3().subVectors(to, from)
  }
  // 重合点会让切线退化：沿用上一条有效切线，首尾再各补一次，保证标架不断链。
  // 切线必须全部归一化：setFromUnitVectors 只接受单位向量，否则传输四元数会退化成近 180° 翻转。
  let last = null
  for (let i = 0; i < n; i += 1) {
    if (tangents[i].lengthSq() > EPS) {
      tangents[i].normalize()
      last = tangents[i]
    } else if (last) {
      tangents[i].copy(last)
    }
  }
  let next = null
  for (let i = n - 1; i >= 0; i -= 1) {
    if (tangents[i].lengthSq() > EPS) next = tangents[i]
    else if (next) tangents[i].copy(next)
    else tangents[i].set(0, 0, 1)
  }
  return tangents
}

function perpendicularTo(tangent) {
  const helper = Math.abs(tangent.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)
  const normal = new THREE.Vector3().crossVectors(helper, tangent)
  if (normal.lengthSq() < EPS) normal.set(1, 0, 0)
  return normal.normalize()
}

export function buildTraceTube({ positions, radii, colors, radialSegments = 8 }) {
  const ringCount = positions.length
  if (ringCount < 2) return null

  const radial = Math.max(3, Math.min(10, Math.round(radialSegments)))
  const tangents = tangentsOf(positions)
  const normals = new Array(ringCount)
  const binormals = new Array(ringCount)

  normals[0] = perpendicularTo(tangents[0])
  binormals[0] = new THREE.Vector3().crossVectors(tangents[0], normals[0]).normalize()

  const rotation = new THREE.Quaternion()
  let minNormalDot = 1
  for (let i = 1; i < ringCount; i += 1) {
    rotation.setFromUnitVectors(tangents[i - 1], tangents[i])
    const transported = normals[i - 1].clone().applyQuaternion(rotation)
    // 重新正交化，抹掉浮点漂移，标架始终严格垂直于切线。
    transported.addScaledVector(tangents[i], -transported.dot(tangents[i]))
    if (transported.lengthSq() < EPS) transported.copy(perpendicularTo(tangents[i]))
    normals[i] = transported.normalize()
    binormals[i] = new THREE.Vector3().crossVectors(tangents[i], normals[i]).normalize()
    minNormalDot = Math.min(minNormalDot, normals[i].dot(normals[i - 1]))
  }

  const vertexCount = ringCount * radial
  const positionArray = new Float32Array(vertexCount * 3)
  const normalArray = new Float32Array(vertexCount * 3)
  const colorArray = new Float32Array(vertexCount * 3)
  const offset = new THREE.Vector3()
  let nonFinite = 0

  for (let i = 0; i < ringCount; i += 1) {
    const center = positions[i]
    const radius = Number.isFinite(radii[i]) && radii[i] > 0 ? radii[i] : 0
    const color = colors[i]
    for (let j = 0; j < radial; j += 1) {
      const angle = (Math.PI * 2 * j) / radial
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      offset
        .copy(normals[i])
        .multiplyScalar(cos)
        .addScaledVector(binormals[i], sin)
      const vertex = i * radial + j
      positionArray[vertex * 3] = center.x + offset.x * radius
      positionArray[vertex * 3 + 1] = center.y + offset.y * radius
      positionArray[vertex * 3 + 2] = center.z + offset.z * radius
      normalArray[vertex * 3] = offset.x
      normalArray[vertex * 3 + 1] = offset.y
      normalArray[vertex * 3 + 2] = offset.z
      colorArray[vertex * 3] = color.r
      colorArray[vertex * 3 + 1] = color.g
      colorArray[vertex * 3 + 2] = color.b
      if (!Number.isFinite(positionArray[vertex * 3]) || !Number.isFinite(colorArray[vertex * 3])) nonFinite += 1
    }
  }

  const quadCount = (ringCount - 1) * radial
  const IndexArray = vertexCount > 65535 ? Uint32Array : Uint16Array
  const indexArray = new IndexArray(quadCount * 6)
  let cursor = 0
  for (let i = 0; i < ringCount - 1; i += 1) {
    for (let j = 0; j < radial; j += 1) {
      const j1 = (j + 1) % radial
      const a = i * radial + j
      const b = i * radial + j1
      const c = (i + 1) * radial + j1
      const d = (i + 1) * radial + j
      indexArray[cursor] = a
      indexArray[cursor + 1] = b
      indexArray[cursor + 2] = d
      indexArray[cursor + 3] = b
      indexArray[cursor + 4] = c
      indexArray[cursor + 5] = d
      cursor += 6
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positionArray, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normalArray, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colorArray, 3))
  geometry.setIndex(new THREE.BufferAttribute(indexArray, 1))
  geometry.computeBoundingSphere()

  return {
    geometry,
    ringCount,
    radialSegments: radial,
    vertexCount,
    triangleCount: quadCount * 2,
    indexCount: indexArray.length,
    // 成型动画按整环步进：一环 = radial 个四边形 = radial × 6 个索引，绝不切半个环。
    indicesPerRing: radial * 6,
    frame: {
      ok: nonFinite === 0 && minNormalDot > 0,
      minNormalDot,
      nonFinite,
    },
  }
}

/** 已显现 ringCount 对应的 drawRange 索引数（整环对齐）。 */
export function ringDrawCount(rings, indicesPerRing, indexCount) {
  const count = Math.max(0, Math.min(rings, Math.floor(indexCount / indicesPerRing))) * indicesPerRing
  return Math.min(count, indexCount)
}