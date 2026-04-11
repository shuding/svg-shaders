'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useMotionValue, useMotionValueEvent } from 'motion/react'

function texture(x, y) {
  return [x, y]
}

const canvasDPI = 1.75

function Shader({ width = 100, height = 100, debug, style, fragment }) {
  const id = useId().replace(/[#:]/g, '-')
  const canvasRef = useRef()
  const feImageRef = useRef()
  const feDisplacementMapRef = useRef()
  const debugRef = useRef()
  const rawValuesRef = useRef(null)
  const imageDataRef = useRef(null)
  const frameRef = useRef(0)

  useEffect(() => {
    frameRef.current = requestAnimationFrame(() => {
      const canvas = canvasRef.current
      if (!canvas || !feImageRef.current || !feDisplacementMapRef.current) {
        return
      }

      const context = canvas.getContext('2d')

      const w = width * canvasDPI
      const h = height * canvasDPI
      let imageData = imageDataRef.current
      if (!imageData || imageData.width !== w || imageData.height !== h) {
        imageData = new ImageData(w, h)
        imageDataRef.current = imageData
      }
      const data = imageData.data

      let rawValues = rawValuesRef.current
      if (!rawValues || rawValues.length !== w * h * 2) {
        rawValues = new Float32Array((w * h * 2) | 0)
        rawValuesRef.current = rawValues
      }

      let maxScale = 0
      let valueIndex = 0
      for (let i = 0; i < data.length; i += 4) {
        const x = (i / 4) % w
        const y = ~~(i / 4 / w)
        const pos = fragment({
          x: x / w,
          y: y / h,
        })
        const dx = pos[0] * w - x
        const dy = pos[1] * h - y
        maxScale = Math.max(maxScale, Math.abs(dx), Math.abs(dy))
        rawValues[valueIndex++] = dx
        rawValues[valueIndex++] = dy
      }

      maxScale = Math.max(maxScale, 1)

      let index = 0
      for (let i = 0; i < data.length; i += 4) {
        const r = rawValues[index++] / (maxScale * 2) + 0.5
        const g = rawValues[index++] / (maxScale * 2) + 0.5
        data[i] = r * 256
        data[i + 1] = g * 256
        data[i + 2] = 0
        data[i + 3] = 255
      }

      context.putImageData(imageData, 0, 0)

      feImageRef.current.setAttribute('href', canvas.toDataURL())
      feDisplacementMapRef.current.setAttribute(
        'scale',
        (maxScale * 2) / canvasDPI,
      )

      if (debugRef.current) {
        debugRef.current.textContent = `Displacement Map (scale = ${maxScale.toFixed(
          2,
        )})`
      }
    })

    return () => {
      cancelAnimationFrame(frameRef.current)
    }
  }, [width, height, fragment])

  return (
    <>
      <svg
        xmlns='http://www.w3.org/2000/svg'
        filterUnits='userSpaceOnUse'
        colorInterpolationFilters='sRGB'
        width={0}
        height={0}
        style={{ display: 'none' }}
      >
        <defs>
          <filter
            id={`${id}_filter`}
            filterUnits='userSpaceOnUse'
            colorInterpolationFilters='sRGB'
            x={0}
            y={0}
            width={width}
            height={height}
          >
            <feImage
              result='map'
              width={width}
              height={height}
              ref={feImageRef}
            />
            <feDisplacementMap
              in='SourceGraphic'
              in2='map'
              xChannelSelector='R'
              yChannelSelector='G'
              ref={feDisplacementMapRef}
            />
          </filter>
        </defs>
      </svg>
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            width,
            height,
            overflow: 'hidden',
            backdropFilter: `
              url(#${id}_filter)
              contrast(1.08)
              brightness(1.18)
              saturate(1.08)
            `,
            ...style,
          }}
        />
      </div>
      <canvas
        draggable={false}
        width={width * canvasDPI}
        height={height * canvasDPI}
        ref={canvasRef}
        style={{
          position: 'absolute',
          left: 0,
          bottom: 0,
          display: debug ? 'inline-block' : 'none',
          width,
          height,
          pointerEvents: 'none',
        }}
      />
      <div
        ref={debugRef}
        style={{
          pointerEvents: 'none',
          position: 'absolute',
          bottom: height + 10,
          display: debug ? 'block' : 'none',
          color: 'white',
          fontSize: 12,
          textShadow: '0 1px 4px rgba(0, 0, 0, 0.6)',
        }}
        draggable={false}
      />
    </>
  )
}

// 3D Math utilities
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function add3(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

function sub3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function mul3(a, scalar) {
  return [a[0] * scalar, a[1] * scalar, a[2] * scalar]
}

function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}

function length3(v) {
  return Math.hypot(v[0], v[1], v[2])
}

function normalize3(v) {
  const len = length3(v)
  if (!len) {
    return [0, 0, 0]
  }
  return [v[0] / len, v[1] / len, v[2] / len]
}

function softClampSigned(value, limit) {
  if (Math.abs(value) <= limit) {
    return value
  }
  return limit * Math.tanh(value / limit)
}

function stabilizeBackgroundDirection(direction, minZ) {
  if (direction[2] <= -minZ) {
    return direction
  }
  const adjusted = [direction[0], direction[1], -minZ]
  return normalize3(adjusted)
}

// Pyramid geometry - 4-sided pyramid like Vercel logo
const WIDTH = 120
const HEIGHT = 120
const VIEWPORT_SCALE = 2.2
const CAMERA = [0, 0, 9.5]
const BACKGROUND_Z = -5.5
const IOR = 1.18
const MAX_DISTANCE = 12
const SURFACE_OFFSET = 0.008
const MIN_BACKGROUND_Z_COMPONENT = 0.08
const MAX_UV_OFFSET = 2
const MAX_EFFECTIVE_UV_OFFSET = 0.32
const MAX_INTERNAL_BOUNCES = 8
const EDGE_BULGE_PX = 8
const EDGE_BULGE_STRENGTH = 2
const LIQUID_WARP_STRENGTH = 0.14
const LIQUID_WARP_FREQUENCY_X = 11
const LIQUID_WARP_FREQUENCY_Y = 11

// Tetrahedron vertices - 4 faces, matches Vercel triangle
const PYRAMID_SCALE = 1.2
const PYRAMID_VERTICES = {
  apex: mul3([0, 1, 0], PYRAMID_SCALE),
  base: [
    mul3([0, -0.7, 1.2], PYRAMID_SCALE), // front
    mul3([-1.04, -0.7, -0.6], PYRAMID_SCALE), // back left
    mul3([1.04, -0.7, -0.6], PYRAMID_SCALE), // back right
  ],
}

const PYRAMID_INTERIOR = mul3([0, -0.1, 0], PYRAMID_SCALE)

function createPlane(a, b, c, interiorPoint) {
  let normal = normalize3(cross3(sub3(b, a), sub3(c, a)))
  if (dot3(sub3(interiorPoint, a), normal) > 0) {
    normal = mul3(normal, -1)
  }
  return { point: a, normal }
}

// 4 triangular faces (3 sides + 1 base)
const PYRAMID_FACES = [
  // 3 side faces
  {
    vertices: [
      PYRAMID_VERTICES.apex,
      PYRAMID_VERTICES.base[0],
      PYRAMID_VERTICES.base[1],
    ],
  },
  {
    vertices: [
      PYRAMID_VERTICES.apex,
      PYRAMID_VERTICES.base[1],
      PYRAMID_VERTICES.base[2],
    ],
  },
  {
    vertices: [
      PYRAMID_VERTICES.apex,
      PYRAMID_VERTICES.base[2],
      PYRAMID_VERTICES.base[0],
    ],
  },
  // Base (1 triangle)
  {
    vertices: [
      PYRAMID_VERTICES.base[0],
      PYRAMID_VERTICES.base[2],
      PYRAMID_VERTICES.base[1],
    ],
  },
].map((face) => {
  const plane = createPlane(
    face.vertices[0],
    face.vertices[1],
    face.vertices[2],
    PYRAMID_INTERIOR,
  )
  return { ...face, normal: plane.normal }
})

function rotatePointWithTransform(point, transform) {
  const yx = point[0] * transform.thetaCos + point[2] * transform.thetaSin
  const yz = -point[0] * transform.thetaSin + point[2] * transform.thetaCos
  return [
    yx,
    point[1] * transform.phiCos - yz * transform.phiSin,
    point[1] * transform.phiSin + yz * transform.phiCos,
  ]
}

function inverseRotatePointWithTransform(point, transform) {
  const xx = point[0]
  const xy = point[1] * transform.phiCos + point[2] * transform.phiSin
  const xz = -point[1] * transform.phiSin + point[2] * transform.phiCos
  return [
    xx * transform.thetaCos - xz * transform.thetaSin,
    xy,
    xx * transform.thetaSin + xz * transform.thetaCos,
  ]
}

function intersectRayTriangle(origin, direction, a, b, c, normal) {
  const edge1 = sub3(b, a)
  const edge2 = sub3(c, a)
  const pvec = cross3(direction, edge2)
  const det = dot3(edge1, pvec)

  if (Math.abs(det) < 1e-6) {
    return null
  }

  const invDet = 1 / det
  const tvec = sub3(origin, a)
  const u = dot3(tvec, pvec) * invDet
  if (u < 0 || u > 1) {
    return null
  }

  const qvec = cross3(tvec, edge1)
  const v = dot3(direction, qvec) * invDet
  if (v < 0 || u + v > 1) {
    return null
  }

  const t = dot3(edge2, qvec) * invDet
  if (t <= SURFACE_OFFSET || t > MAX_DISTANCE) {
    return null
  }

  return {
    t,
    point: add3(origin, mul3(direction, t)),
    normal,
  }
}

function intersectPyramidFaces(origin, direction, transform) {
  const localOrigin = inverseRotatePointWithTransform(origin, transform)
  const localDirection = inverseRotatePointWithTransform(direction, transform)
  let bestHit = null

  for (let i = 0; i < PYRAMID_FACES.length; i += 1) {
    const face = PYRAMID_FACES[i]
    const hit = intersectRayTriangle(
      localOrigin,
      localDirection,
      face.vertices[0],
      face.vertices[1],
      face.vertices[2],
      face.normal,
    )
    if (!hit) {
      continue
    }

    if (!bestHit || hit.t < bestHit.t) {
      bestHit = {
        t: hit.t,
        point: rotatePointWithTransform(hit.point, transform),
        normal: normalize3(rotatePointWithTransform(hit.normal, transform)),
      }
    }
  }

  return bestHit
}

function refractVector(incident, normal, ratio) {
  const orientedNormal = dot3(incident, normal) < 0 ? normal : mul3(normal, -1)
  const cosTheta = dot3(orientedNormal, incident)
  const k = 1 - ratio * ratio * (1 - cosTheta * cosTheta)
  if (k < 0) {
    return null
  }
  return normalize3(
    sub3(
      mul3(incident, ratio),
      mul3(orientedNormal, ratio * cosTheta + Math.sqrt(k)),
    ),
  )
}

function reflectVector(incident, normal) {
  const orientedNormal = dot3(incident, normal) < 0 ? normal : mul3(normal, -1)
  return normalize3(
    sub3(incident, mul3(orientedNormal, 2 * dot3(incident, orientedNormal))),
  )
}

function traceToPlane(origin, direction, planeZ) {
  if (Math.abs(direction[2]) < 1e-5) {
    return null
  }
  const t = (planeZ - origin[2]) / direction[2]
  if (t <= 0) {
    return null
  }
  return add3(origin, mul3(direction, t))
}

function uvToScreenPoint(uv) {
  return [
    (uv.x - 0.5) * 2 * VIEWPORT_SCALE,
    (0.5 - uv.y) * 2 * VIEWPORT_SCALE,
    0,
  ]
}

function screenPointToUv(point) {
  return {
    x: point[0] / (2 * VIEWPORT_SCALE) + 0.5,
    y: 0.5 - point[1] / (2 * VIEWPORT_SCALE),
  }
}

function projectPoint(point) {
  const depth = CAMERA[2] - point[2]
  const factor = CAMERA[2] / depth
  return [point[0] * factor, point[1] * factor]
}

function buildDisplacementTrace(
  uv,
  origin,
  direction,
  entryPoint,
  exitPoint = entryPoint,
) {
  const stableDirection = stabilizeBackgroundDirection(
    direction,
    MIN_BACKGROUND_Z_COMPONENT,
  )
  const hit = traceToPlane(origin, stableDirection, BACKGROUND_Z)
  if (!hit) {
    return { displacedUv: { x: uv.x, y: uv.y } }
  }

  const displacedUv = screenPointToUv(hit)
  let offsetX = displacedUv.x - uv.x
  let offsetY = displacedUv.y - uv.y
  offsetX = Math.max(Math.min(offsetX, MAX_UV_OFFSET), -MAX_UV_OFFSET)
  offsetY = Math.max(Math.min(offsetY, MAX_UV_OFFSET), -MAX_UV_OFFSET)

  const strength = clamp(
    0.9 + length3(sub3(exitPoint, entryPoint)) * 0.14,
    0.85,
    1.25,
  )
  const centerX = uv.x - 0.5
  const centerY = uv.y - 0.5
  const radialWeight = 1 - clamp(Math.hypot(centerX, centerY) / 0.72, 0, 1)
  const liquidWeight = radialWeight * radialWeight * strength
  const warpX =
    Math.sin(uv.y * LIQUID_WARP_FREQUENCY_Y + entryPoint[1] * 1.7) *
    Math.cos(uv.x * LIQUID_WARP_FREQUENCY_X - exitPoint[0] * 1.4)
  const warpY =
    Math.sin(uv.x * (LIQUID_WARP_FREQUENCY_X - 2) + entryPoint[0] * 1.5) *
    Math.cos(uv.y * (LIQUID_WARP_FREQUENCY_Y + 1) - exitPoint[1] * 1.3)

  return {
    displacedUv: {
      x:
        uv.x +
        softClampSigned(offsetX * strength, MAX_EFFECTIVE_UV_OFFSET) +
        warpX * LIQUID_WARP_STRENGTH * liquidWeight,
      y:
        uv.y +
        softClampSigned(offsetY * strength, MAX_EFFECTIVE_UV_OFFSET) +
        warpY * LIQUID_WARP_STRENGTH * liquidWeight,
    },
  }
}

function tracePyramidRay(uv, context) {
  const screenPoint = uvToScreenPoint(uv)
  const rayDirection = normalize3(sub3(screenPoint, CAMERA))
  const firstHit = intersectPyramidFaces(CAMERA, rayDirection, context)
  if (!firstHit) {
    return null
  }
  const entryPoint = firstHit.point

  const insideDirection = refractVector(rayDirection, firstHit.normal, 1 / IOR)
  if (!insideDirection) {
    return buildDisplacementTrace(
      uv,
      add3(entryPoint, mul3(rayDirection, SURFACE_OFFSET)),
      reflectVector(rayDirection, firstHit.normal),
      entryPoint,
    )
  }

  let insideOrigin = add3(entryPoint, mul3(insideDirection, SURFACE_OFFSET))
  let currentDirection = insideDirection
  let exitPoint = null
  let outsideDirection = null

  for (let bounce = 0; bounce < MAX_INTERNAL_BOUNCES; bounce += 1) {
    const insideHit = intersectPyramidFaces(
      insideOrigin,
      currentDirection,
      context,
    )
    if (!insideHit) {
      return buildDisplacementTrace(
        uv,
        insideOrigin,
        currentDirection,
        entryPoint,
      )
    }

    exitPoint = insideHit.point
    outsideDirection = refractVector(currentDirection, insideHit.normal, IOR)
    if (outsideDirection) {
      break
    }

    currentDirection = reflectVector(currentDirection, insideHit.normal)
    insideOrigin = add3(exitPoint, mul3(currentDirection, SURFACE_OFFSET))
  }

  if (!exitPoint || !outsideDirection) {
    return buildDisplacementTrace(
      uv,
      insideOrigin,
      currentDirection,
      entryPoint,
    )
  }

  const outgoingOrigin = add3(exitPoint, mul3(outsideDirection, SURFACE_OFFSET))
  return buildDisplacementTrace(
    uv,
    outgoingOrigin,
    outsideDirection,
    entryPoint,
    exitPoint,
  )
}

// 2D utilities
function comparePoints(a, b) {
  if (a.x !== b.x) return a.x - b.x
  return a.y - b.y
}

function cross2(o, a, b) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
}

function length2(x, y) {
  return Math.hypot(x, y)
}

function centroid2(points) {
  let x = 0,
    y = 0
  for (let i = 0; i < points.length; i += 1) {
    x += points[i].x
    y += points[i].y
  }
  return { x: x / points.length, y: y / points.length }
}

function bounds2(points) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i]
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
}

function selectBloomAnchors(points) {
  let top = points[0],
    lowerLeft = points[0],
    lowerRight = points[0]
  for (let i = 1; i < points.length; i += 1) {
    const point = points[i]
    if (point.y < top.y) top = point
    if (point.x + point.y < lowerLeft.x + lowerLeft.y) lowerLeft = point
    if (point.x - point.y > lowerRight.x - lowerRight.y) lowerRight = point
  }
  return { top, lowerLeft, lowerRight }
}

function buildHullEdges(hull) {
  const edges = []
  for (let i = 0; i < hull.length; i += 1) {
    const a = hull[i]
    const b = hull[(i + 1) % hull.length]
    const abx = b.x - a.x
    const aby = b.y - a.y
    edges.push({ a, abx, aby, ab2: abx * abx + aby * aby })
  }
  return edges
}

function pointEdgeDistance(point, edge) {
  if (!edge.ab2) return length2(point.x - edge.a.x, point.y - edge.a.y)
  const apx = point.x - edge.a.x
  const apy = point.y - edge.a.y
  const t = clamp((apx * edge.abx + apy * edge.aby) / edge.ab2, 0, 1)
  const closestX = edge.a.x + edge.abx * t
  const closestY = edge.a.y + edge.aby * t
  return length2(point.x - closestX, point.y - closestY)
}

function smoothStep(a, b, t) {
  const x = clamp((t - a) / (b - a), 0, 1)
  return x * x * (3 - 2 * x)
}

function convexHull(points) {
  const sorted = [...points].sort(comparePoints)
  if (sorted.length <= 1) return sorted

  const lower = []
  for (const point of sorted) {
    while (
      lower.length >= 2 &&
      cross2(lower.at(-2), lower.at(-1), point) <= 0
    ) {
      lower.pop()
    }
    lower.push(point)
  }

  const upper = []
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const point = sorted[i]
    while (
      upper.length >= 2 &&
      cross2(upper.at(-2), upper.at(-1), point) <= 0
    ) {
      upper.pop()
    }
    upper.push(point)
  }

  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

function createProjectedHull(transform) {
  const allVertices = [PYRAMID_VERTICES.apex, ...PYRAMID_VERTICES.base]
  const projected = allVertices.map((vertex) => {
    const rotated = rotatePointWithTransform(vertex, transform)
    const [x, y] = projectPoint(rotated)
    return {
      x: (x / VIEWPORT_SCALE) * (WIDTH / 2) + WIDTH / 2,
      y: HEIGHT / 2 - (y / VIEWPORT_SCALE) * (HEIGHT / 2),
    }
  })
  return convexHull(projected)
}

function createProjectedFaces(transform) {
  return PYRAMID_FACES.map((face) => {
    const worldVertices = face.vertices.map((vertex) =>
      rotatePointWithTransform(vertex, transform),
    )
    const points = worldVertices.map((vertex) => {
      const [x, y] = projectPoint(vertex)
      return {
        x: (x / VIEWPORT_SCALE) * (WIDTH / 2) + WIDTH / 2,
        y: HEIGHT / 2 - (y / VIEWPORT_SCALE) * (HEIGHT / 2),
      }
    })
    const centroid = mul3(
      add3(add3(worldVertices[0], worldVertices[1]), worldVertices[2]),
      1 / 3,
    )
    const rotatedNormal = normalize3(
      rotatePointWithTransform(face.normal, transform),
    )
    const viewDirection = normalize3(sub3(CAMERA, centroid))
    const facing = Math.abs(dot3(rotatedNormal, viewDirection))

    return {
      points,
      strokeOpacity: 0.08 + facing * 0.12,
      fillOpacity: 0.01 + facing * 0.025,
    }
  })
}

function createPyramidContext(theta, phi) {
  const transform = {
    theta,
    phi,
    thetaCos: Math.cos(theta),
    thetaSin: Math.sin(theta),
    phiCos: Math.cos(phi),
    phiSin: Math.sin(phi),
  }
  const hull = createProjectedHull(transform)
  const projectedFaces = createProjectedFaces(transform)
  const hullCenter = centroid2(hull)
  const hullBounds = bounds2(hull)
  const bloomAnchors = selectBloomAnchors(hull)
  const hullEdges = buildHullEdges(hull)
  const clipPath = `polygon(${hull
    .map((point) => `${point.x.toFixed(2)}px ${point.y.toFixed(2)}px`)
    .join(', ')})`

  return {
    ...transform,
    hull,
    projectedFaces,
    hullCenter,
    hullBounds,
    bloomAnchors,
    hullEdges,
    clipPath,
  }
}

function applyEdgeBulge(trace, uv, context) {
  const pixelPoint = { x: uv.x * WIDTH, y: uv.y * HEIGHT }
  let edgeDistance = Infinity
  for (let i = 0; i < context.hullEdges.length; i += 1) {
    edgeDistance = Math.min(
      edgeDistance,
      pointEdgeDistance(pixelPoint, context.hullEdges[i]),
    )
  }

  const edgeWeight = 1 - smoothStep(0, EDGE_BULGE_PX, edgeDistance)
  if (edgeWeight <= 0) return trace

  const centerUv = {
    x: context.hullCenter.x / WIDTH,
    y: context.hullCenter.y / HEIGHT,
  }

  return {
    displacedUv: {
      x:
        trace.displacedUv.x +
        (centerUv.x - uv.x) * edgeWeight * EDGE_BULGE_STRENGTH,
      y:
        trace.displacedUv.y +
        (centerUv.y - uv.y) * edgeWeight * EDGE_BULGE_STRENGTH,
    },
  }
}

const bloomStyle = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
  transition: 'filter 3s ease, background 3s ease',
}

function LiquidPyramid({ debug, theta, phi, isDark, isSnapped }) {
  const context = useMemo(() => createPyramidContext(theta, phi), [theta, phi])
  const centerX = (context.hullCenter.x / WIDTH) * 100
  const centerY = (context.hullCenter.y / HEIGHT) * 100
  const topX = (context.bloomAnchors.top.x / WIDTH) * 100
  const topY = (context.bloomAnchors.top.y / HEIGHT) * 100
  const leftX = (context.bloomAnchors.lowerLeft.x / WIDTH) * 100
  const leftY = (context.bloomAnchors.lowerLeft.y / HEIGHT) * 100
  const rightX = (context.bloomAnchors.lowerRight.x / WIDTH) * 100
  const rightY = (context.bloomAnchors.lowerRight.y / HEIGHT) * 100
  const bloomScaleX = (context.hullBounds.width / WIDTH) * 100
  const bloomScaleY = (context.hullBounds.height / HEIGHT) * 100

  return (
    <div
      style={{
        position: 'relative',
        width: WIDTH,
        height: HEIGHT,
        overflow: 'visible',
      }}
      draggable={false}
    >
      <div
        aria-hidden
        style={{
          ...bloomStyle,
          clipPath: context.clipPath,
          opacity: isSnapped ? 0 : 1,
          transition: 'background 1s ease, opacity 1s ease',
          transform: 'scale(1.04)',
          transformOrigin: `${centerX}% ${centerY}%`,
          filter: 'blur(20px) saturate(1.1) brightness(1.1)',
          background: isDark
            ? `
            radial-gradient(${bloomScaleX * 0.2}% ${bloomScaleY * 0.24}% at ${topX}% ${topY}%, rgba(80, 80, 80, 0.7), rgba(40, 40, 40, 0.4) 34%, rgba(20, 20, 20, 0.15) 62%, transparent 100%),
            radial-gradient(${bloomScaleX * 0.18}% ${bloomScaleY * 0.2}% at ${leftX}% ${leftY}%, rgba(60, 60, 60, 0.4), rgba(30, 30, 30, 0.2) 48%, transparent 100%),
            radial-gradient(${bloomScaleX * 0.16}% ${bloomScaleY * 0.18}% at ${rightX}% ${rightY}%, rgba(50, 50, 50, 0.3), rgba(25, 25, 25, 0.1) 50%, transparent 100%),
            radial-gradient(${bloomScaleX * 0.44}% ${bloomScaleY * 0.32}% at ${centerX}% ${Math.max(centerY - 8, 12)}%, rgba(45, 45, 45, 0.2), rgba(30, 30, 30, 0.08) 54%, transparent 100%)
          `
            : `
            radial-gradient(${bloomScaleX * 0.2}% ${bloomScaleY * 0.24}% at ${topX}% ${topY}%, rgba(255, 255, 255, 0.98), rgba(186, 244, 255, 0.68) 34%, rgba(108, 224, 255, 0.5) 62%, rgba(255, 225, 255, 0.2) 100%),
            radial-gradient(${bloomScaleX * 0.18}% ${bloomScaleY * 0.2}% at ${leftX}% ${leftY}%, rgba(214, 247, 255, 0.58), rgba(110, 221, 255, 0.24) 48%, rgba(110, 221, 255, 0) 100%),
            radial-gradient(${bloomScaleX * 0.16}% ${bloomScaleY * 0.18}% at ${rightX}% ${rightY}%, rgba(208, 244, 255, 0.34), rgba(110, 221, 255, 0.54) 50%, rgba(110, 221, 255, 0) 100%),
            radial-gradient(${bloomScaleX * 0.44}% ${bloomScaleY * 0.32}% at ${centerX}% ${Math.max(centerY - 8, 12)}%, rgba(160, 236, 255, 0.22), rgba(160, 236, 255, 0.28) 54%, rgba(160, 236, 255, 0) 100%)
          `,
        }}
        draggable={false}
      />
      <div
        aria-hidden
        style={{
          ...bloomStyle,
          clipPath: context.clipPath,
          opacity: isSnapped ? 0 : 1,
          transition: 'background 1s ease, opacity 1s ease',
          background: isDark
            ? 'linear-gradient(145deg, rgba(100, 100, 100, 0.5), rgba(40, 40, 40, 0.15) 42%, rgba(60, 60, 60, 0.08) 78%, rgba(80, 80, 80, 0.2))'
            : 'linear-gradient(145deg, rgba(255, 255, 255, 0.72), rgba(205, 246, 255, 0.18) 42%, rgba(255, 255, 255, 0.04) 78%, rgba(255, 255, 255, 0.24))',
        }}
        draggable={false}
      />
      <svg
        aria-hidden
        width={WIDTH}
        height={HEIGHT}
        draggable={false}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        style={{
          position: 'absolute',
          inset: 0,
          overflow: 'visible',
          pointerEvents: 'none',
          opacity: isSnapped ? 0 : 1,
          transition: 'background 1s ease, opacity 1s ease',
        }}
      >
        {context.projectedFaces.map((face, index) => (
          <polygon
            key={index}
            points={face.points
              .map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`)
              .join(' ')}
            fill={
              isDark
                ? `rgba(60, 60, 60, ${face.fillOpacity.toFixed(3)})`
                : `rgba(188, 232, 247, ${face.fillOpacity.toFixed(3)})`
            }
            stroke={
              isDark
                ? `rgba(100, 100, 100, ${face.strokeOpacity.toFixed(3)})`
                : `rgba(126, 176, 198, ${face.strokeOpacity.toFixed(3)})`
            }
            strokeWidth='1'
            strokeLinejoin='round'
            vectorEffect='non-scaling-stroke'
          />
        ))}
      </svg>
      <Shader
        draggable={false}
        width={WIDTH}
        height={HEIGHT}
        debug={debug}
        fragment={(uv) => {
          const trace = tracePyramidRay(uv, context)
          if (!trace) {
            return texture(uv.x, uv.y)
          }
          const bulgedTrace = applyEdgeBulge(trace, uv, context)
          return texture(bulgedTrace.displacedUv.x, bulgedTrace.displacedUv.y)
        }}
        style={{
          clipPath: context.clipPath,
          transition: isSnapped
            ? 'background 1s ease, opacity 1s ease'
            : 'background .3s ease, opacity .3s ease',
          background: isSnapped
            ? `rgba(255, 255, 255, 1)`
            : `linear-gradient(140deg, rgba(255, 255, 255, 0.22), rgba(255, 255, 255, 0.03) 38%, rgba(255, 255, 255, 0.1) 68%, rgba(255, 255, 255, 0.28))`,
          opacity: isSnapped ? 0 : 1,
        }}
      />
    </div>
  )
}

// Magnetic snap constants
const MAGNET_RADIUS = 6000
const SNAP_RADIUS = 100
const SPRING_STIFFNESS = 90
const SPRING_DAMPING = 0.99
const RADIAL_DAMPING = 0.594
const SPRING_BOOST = 0.01
const MAX_SPRING_DT = 1 / 30
const REST_DISTANCE = 1
const REST_SPEED = 6
const MAX_DRAG_VELOCITY = 1800
// const DRAG_ELASTIC = 0.18
// const BOUND_SPRING = 0.18
// const BOUND_DAMPING = 0.82
const ANCHOR_OFFSET_X = 54
const ANCHOR_OFFSET_Y = 21

// function elasticPosition(value, min, max) {
//   if (value < min) {
//     return min + (value - min) * DRAG_ELASTIC
//   }
//   if (value > max) {
//     return max + (value - max) * DRAG_ELASTIC
//   }
//   return value
// }

function clampMagnitude(value, max) {
  return Math.max(-max, Math.min(max, value))
}

export default function Page() {
  const [showDebug, setShowDebug] = useState(false)
  const [isSnapped, setIsSnapped] = useState(true)
  const [isSnapAnimationDone, setIsSnapAnimationDone] = useState(true)
  const isDraggingRef = useRef(false)
  const isSnappedRef = useRef(true)
  const springVelocityRef = useRef({ x: 0, y: 0 })
  const containerRef = useRef(null)
  const animationRef = useRef(null)
  const pointerIdRef = useRef(null)
  const dragStateRef = useRef({
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
    lastX: 0,
    lastY: 0,
    lastTime: 0,
  })

  const x = useMotionValue(0)
  const y = useMotionValue(0)

  // phi tilts to make back face (apex + back-left + back-right) face camera
  const basePhiRef = useRef(-0.33)
  const baseThetaRef = useRef(0)
  const [phi, setPhi] = useState(-0.33)
  const [theta, setTheta] = useState(0)

  // Continuous magnetic effect loop
  useEffect(() => {
    let lastTime = performance.now()

    const getBounds = () => {
      const container = containerRef.current
      if (!container) {
        return {
          minX: -Infinity,
          maxX: Infinity,
          minY: -Infinity,
          maxY: Infinity,
        }
      }

      const rect = container.getBoundingClientRect()
      const anchorX = rect.width / 2 - ANCHOR_OFFSET_X
      const anchorY = rect.height / 2 - ANCHOR_OFFSET_Y

      return {
        minX: WIDTH / 2 - anchorX,
        maxX: rect.width - WIDTH / 2 - anchorX,
        minY: HEIGHT / 2 - anchorY,
        maxY: rect.height - HEIGHT / 2 - anchorY,
      }
    }

    const runMagneticLoop = (time) => {
      const dt = Math.min((time - lastTime) / 1000 || 0, MAX_SPRING_DT)
      lastTime = time

      if (!isDraggingRef.current) {
        let currentX = x.get()
        let currentY = y.get()
        let velocityX = springVelocityRef.current.x
        let velocityY = springVelocityRef.current.y
        const distance = Math.hypot(currentX, currentY)
        const normalizedDist = Math.min(distance / MAGNET_RADIUS, 1)
        const springScale = 1 + Math.pow(1 - normalizedDist, 2) * SPRING_BOOST

        velocityX += -currentX * SPRING_STIFFNESS * springScale * dt
        velocityY += -currentY * SPRING_STIFFNESS * springScale * dt

        const distanceSafe = Math.max(distance, 0.0001)
        const radialUnitX = currentX / distanceSafe
        const radialUnitY = currentY / distanceSafe
        const radialVelocity = velocityX * radialUnitX + velocityY * radialUnitY
        const tangentVelocityX = velocityX - radialVelocity * radialUnitX
        const tangentVelocityY = velocityY - radialVelocity * radialUnitY
        const dampedRadialVelocity = radialVelocity * RADIAL_DAMPING

        velocityX =
          tangentVelocityX * SPRING_DAMPING + dampedRadialVelocity * radialUnitX
        velocityY =
          tangentVelocityY * SPRING_DAMPING + dampedRadialVelocity * radialUnitY
        currentX += velocityX * dt
        currentY += velocityY * dt

        // const bounds = getBounds()

        // if (currentX < bounds.minX) {
        //   velocityX += (bounds.minX - currentX) * BOUND_SPRING
        //   velocityX *= BOUND_DAMPING
        // } else if (currentX > bounds.maxX) {
        //   velocityX += (bounds.maxX - currentX) * BOUND_SPRING
        //   velocityX *= BOUND_DAMPING
        // }

        // if (currentY < bounds.minY) {
        //   velocityY += (bounds.minY - currentY) * BOUND_SPRING
        //   velocityY *= BOUND_DAMPING
        // } else if (currentY > bounds.maxY) {
        //   velocityY += (bounds.maxY - currentY) * BOUND_SPRING
        //   velocityY *= BOUND_DAMPING
        // }

        const speed = Math.hypot(velocityX, velocityY)

        if (
          Math.hypot(currentX, currentY) < REST_DISTANCE &&
          speed < REST_SPEED * 1.5
        ) {
          currentX = 0
          currentY = 0
          velocityX = 0
          velocityY = 0
        }

        springVelocityRef.current = { x: velocityX, y: velocityY }
        x.set(currentX)
        y.set(currentY)

        if (
          Math.hypot(currentX, currentY) < SNAP_RADIUS &&
          speed < REST_SPEED
        ) {
          if (!isSnappedRef.current) {
            isSnappedRef.current = true
            setIsSnapped(true)
            setIsSnapAnimationDone(false)
            setTimeout(() => {
              setIsSnapAnimationDone(true)
            }, 300)
          }
        } else {
          if (isSnappedRef.current) {
            isSnappedRef.current = false
            setIsSnapped(false)
          }
        }
      }

      animationRef.current = requestAnimationFrame(runMagneticLoop)
    }

    animationRef.current = requestAnimationFrame(runMagneticLoop)
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [x, y])

  useMotionValueEvent(x, 'change', () => {
    setTheta(baseThetaRef.current + x.get() * 0.012)
    // setPhi(basePhiRef.current - y.get() * 0.008)
  })

  useMotionValueEvent(y, 'change', () => {
    // setTheta(baseThetaRef.current + x.get() * 0.012)
    setPhi(basePhiRef.current - y.get() * 0.0075)
  })

  const handleDragStart = () => {
    isDraggingRef.current = true
    springVelocityRef.current = { x: 0, y: 0 }
    isSnappedRef.current = false
    setIsSnapped(false)
  }

  const handleDragEnd = () => {
    isDraggingRef.current = false
  }

  useEffect(() => {
    const node = containerRef.current
    if (!node) {
      return
    }

    // const getBounds = () => {
    //   const rect = node.getBoundingClientRect()
    //   const anchorX = rect.width / 2 - ANCHOR_OFFSET_X
    //   const anchorY = rect.height / 2 - ANCHOR_OFFSET_Y

    //   return {
    //     minX: WIDTH / 2 - anchorX,
    //     maxX: rect.width - WIDTH / 2 - anchorX,
    //     minY: HEIGHT / 2 - anchorY,
    //     maxY: rect.height - HEIGHT / 2 - anchorY,
    //   }
    // }

    const onPointerMove = (event) => {
      if (
        !isDraggingRef.current ||
        pointerIdRef.current == null ||
        event.pointerId !== pointerIdRef.current
      ) {
        return
      }

      const drag = dragStateRef.current
      // const bounds = getBounds()
      const nextX = drag.originX + (event.clientX - drag.startX)
      const nextY = drag.originY + (event.clientY - drag.startY)

      // x.set(elasticPosition(nextX, bounds.minX, bounds.maxX))
      // y.set(elasticPosition(nextY, bounds.minY, bounds.maxY))
      x.set(nextX)
      y.set(nextY)

      const now = performance.now()
      const dt = Math.max(now - drag.lastTime, 1)
      springVelocityRef.current = {
        x: clampMagnitude(
          ((event.clientX - drag.lastX) / dt) * 1000,
          MAX_DRAG_VELOCITY,
        ),
        y: clampMagnitude(
          ((event.clientY - drag.lastY) / dt) * 1000,
          MAX_DRAG_VELOCITY,
        ),
      }
      drag.lastX = event.clientX
      drag.lastY = event.clientY
      drag.lastTime = now
    }

    const endPointer = (event) => {
      if (
        !isDraggingRef.current ||
        pointerIdRef.current == null ||
        event.pointerId !== pointerIdRef.current
      ) {
        return
      }

      if (node.hasPointerCapture(pointerIdRef.current)) {
        node.releasePointerCapture(pointerIdRef.current)
      }

      pointerIdRef.current = null
      handleDragEnd()
    }

    node.addEventListener('pointermove', onPointerMove)
    node.addEventListener('pointerup', endPointer)
    node.addEventListener('pointercancel', endPointer)

    return () => {
      node.removeEventListener('pointermove', onPointerMove)
      node.removeEventListener('pointerup', endPointer)
      node.removeEventListener('pointercancel', endPointer)
    }
  }, [x, y])

  const handlePointerDown = (event) => {
    pointerIdRef.current = event.pointerId
    dragStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: x.get(),
      originY: y.get(),
      lastX: event.clientX,
      lastY: event.clientY,
      lastTime: performance.now(),
    }
    handleDragStart()
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  return (
    <>
      <style>{`
#ship {
  animation: ship 2s ease;
}
@keyframes ship {
  0% { opacity: 0; filter: brightness(1) blur(40px) }
  10% { opacity: 0.8; filter: brightness(2) blur(10px) }
  100% { opacity: 1; filter: brightness(1.2) blur(0) }
}
      `}</style>
      <div
        id='ship'
        style={{
          margin: 'auto',
          width: 636,
          maxWidth: '100%',
          maxHeight: '100%',
          aspectRatio: 0.8002059732,
          // width: '100dvw',
          // height: '100dvh',
          padding: 20,
          background: '#000',
          backgroundImage:
            isSnapped && isSnapAnimationDone
              ? '-webkit-cross-fade(url("/ship.jpg"), url("/mask.jpg"), 0%)'
              : '-webkit-cross-fade(url("/ship.jpg"), url("/mask.jpg"), 100%)',
          backgroundSize: 'contain',
          backgroundPosition: 'center center',
          backgroundRepeat: 'no-repeat',
          borderRadius: 3,
          boxShadow: '0 5px 20px 0 rgba(0, 0, 0, 0.2)',
          position: 'relative',
          filter: 'brightness(1.2) blur(0)',
        }}
        draggable={false}
      >
        <a
          href='https://www.vercel.com'
          target='_blank'
          rel='noopener noreferrer'
          style={{
            position: 'absolute',
            top: '72%',
            left: '51%',
            transform: 'translate(-50%, -50%)',
            width: '14%',
            height: '4%',
            zIndex: 100,
            opacity: 0,
          }}
        ></a>
        {/* <Image
          src={sampleImage}
          alt='Sample'
          quality={100}
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'none',
            opacity: 0.4,
          }}
        /> */}

        <div
          ref={containerRef}
          style={{
            width: '100%',
            height: '100%',
            position: 'relative',
            margin: 'auto',
          }}
          draggable={false}
        >
          <div
            onPointerDown={handlePointerDown}
            style={{
              position: 'absolute',
              top: '55%',
              left: '51%',
              width: WIDTH,
              height: HEIGHT,
              transform: `translate(-50%, -50%) translate(${x.get()}px, ${y.get()}px)`,
              touchAction: 'none',
              cursor: isDraggingRef.current ? 'grabbing' : 'grab',
            }}
            draggable={false}
          >
            <LiquidPyramid
              debug={showDebug}
              theta={theta}
              phi={phi}
              isDark={false}
              isSnapped={isSnapped}
            />
          </div>

          {/* Magnetic field indicator */}
          {/* <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: MAGNET_RADIUS * 2,
              height: MAGNET_RADIUS * 2,
              borderRadius: '50%',
              border: `1px solid rgba(255, 255, 255, ${isSnapped ? 0.15 : 0.05})`,
              pointerEvents: 'none',
              transition: 'border-color 0.3s ease',
            }}
          /> */}
        </div>
      </div>

      {/* Controls */}
      <div
        style={{
          position: 'fixed',
          top: 10,
          left: 10,
          // display: 'flex',
          display: 'none',
          gap: 10,
          alignItems: 'center',
          fontSize: '.85em',
          zIndex: 100,
        }}
        draggable={false}
      >
        <label
          style={{
            display: 'flex',
            gap: 5,
            alignItems: 'center',
            userSelect: 'none',
            color: '#666',
          }}
        >
          <input
            type='checkbox'
            onChange={(e) => setShowDebug(e.target.checked)}
          />
          <span>Debug</span>
        </label>
      </div>
    </>
  )
}
