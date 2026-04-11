'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { motion, useMotionValue, useMotionValueEvent } from 'motion/react'
import Image from 'next/image'
import sampleImage from '../sample.jpg'

function texture(x, y) {
  return [x, y]
}

const canvasDPI = 1.25

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
              brightness(1.08)
              saturate(1.08)
            `,
            ...style,
          }}
        />
      </div>
      <canvas
        width={width * canvasDPI}
        height={height * canvasDPI}
        ref={canvasRef}
        style={{
          position: 'absolute',
          left: 10,
          bottom: 10,
          display: debug ? 'inline-block' : 'none',
          width,
          height,
        }}
      />
      <div
        ref={debugRef}
        style={{
          position: 'absolute',
          left: 10,
          bottom: height + 20,
          display: debug ? 'block' : 'none',
          color: 'white',
          fontSize: 12,
          textShadow: '0 1px 4px rgba(0, 0, 0, 0.6)',
        }}
      />
    </>
  )
}

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
    return {
      displacedUv: {
        x: uv.x,
        y: uv.y,
      },
    }
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

function createPlane(a, b, c, interiorPoint) {
  let normal = normalize3(cross3(sub3(b, a), sub3(c, a)))
  if (dot3(sub3(interiorPoint, a), normal) > 0) {
    normal = mul3(normal, -1)
  }
  return { point: a, normal }
}

function scaleVertices(vertices, scale) {
  return {
    apex: mul3(vertices.apex, scale),
    base: vertices.base.map((vertex) => mul3(vertex, scale)),
  }
}

const BASE_PYRAMID_VERTICES = {
  apex: [0, 1.18, 0],
  base: [
    [-1.04, -0.92, -1.04],
    [1.04, -0.92, -1.04],
    [1.04, -0.92, 1.04],
    [-1.04, -0.92, 1.04],
  ],
}
const SHAPE_SCALE = 0.9
const PYRAMID_VERTICES = scaleVertices(BASE_PYRAMID_VERTICES, SHAPE_SCALE)

const PYRAMID_INTERIOR = mul3([0, -0.3, 0], SHAPE_SCALE)
const PYRAMID_PLANES = [
  createPlane(
    PYRAMID_VERTICES.apex,
    PYRAMID_VERTICES.base[0],
    PYRAMID_VERTICES.base[1],
    PYRAMID_INTERIOR,
  ),
  createPlane(
    PYRAMID_VERTICES.apex,
    PYRAMID_VERTICES.base[1],
    PYRAMID_VERTICES.base[2],
    PYRAMID_INTERIOR,
  ),
  createPlane(
    PYRAMID_VERTICES.apex,
    PYRAMID_VERTICES.base[2],
    PYRAMID_VERTICES.base[3],
    PYRAMID_INTERIOR,
  ),
  createPlane(
    PYRAMID_VERTICES.apex,
    PYRAMID_VERTICES.base[3],
    PYRAMID_VERTICES.base[0],
    PYRAMID_INTERIOR,
  ),
  createPlane(
    PYRAMID_VERTICES.base[0],
    PYRAMID_VERTICES.base[3],
    PYRAMID_VERTICES.base[2],
    PYRAMID_INTERIOR,
  ),
]
const PYRAMID_FACES = [
  {
    vertices: [
      PYRAMID_VERTICES.apex,
      PYRAMID_VERTICES.base[0],
      PYRAMID_VERTICES.base[1],
    ],
    normal: PYRAMID_PLANES[0].normal,
  },
  {
    vertices: [
      PYRAMID_VERTICES.apex,
      PYRAMID_VERTICES.base[1],
      PYRAMID_VERTICES.base[2],
    ],
    normal: PYRAMID_PLANES[1].normal,
  },
  {
    vertices: [
      PYRAMID_VERTICES.apex,
      PYRAMID_VERTICES.base[2],
      PYRAMID_VERTICES.base[3],
    ],
    normal: PYRAMID_PLANES[2].normal,
  },
  {
    vertices: [
      PYRAMID_VERTICES.apex,
      PYRAMID_VERTICES.base[3],
      PYRAMID_VERTICES.base[0],
    ],
    normal: PYRAMID_PLANES[3].normal,
  },
  {
    vertices: [
      PYRAMID_VERTICES.base[0],
      PYRAMID_VERTICES.base[1],
      PYRAMID_VERTICES.base[2],
    ],
    normal: PYRAMID_PLANES[4].normal,
  },
  {
    vertices: [
      PYRAMID_VERTICES.base[0],
      PYRAMID_VERTICES.base[2],
      PYRAMID_VERTICES.base[3],
    ],
    normal: PYRAMID_PLANES[4].normal,
  },
]

const WIDTH = 220
const HEIGHT = 220
const VIEWPORT_SCALE = 1.7
const CAMERA = [0, 0.08, 4.2]
const BACKGROUND_Z = -5.5
const IOR = 1.18
const MAX_DISTANCE = 12
const SURFACE_OFFSET = 0.008
const FILTER_PADDING = 64
const MIN_BACKGROUND_Z_COMPONENT = 0.08
const MAX_UV_OFFSET = 2
const MAX_EFFECTIVE_UV_OFFSET = 0.32
const MAX_INTERNAL_BOUNCES = 8
const EDGE_BULGE_PX = 20
const EDGE_BULGE_STRENGTH = 0.04
const LIQUID_WARP_STRENGTH = 0.014
const LIQUID_WARP_FREQUENCY_X = 11
const LIQUID_WARP_FREQUENCY_Y = 9

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

function intersectCrystalFaces(origin, direction, transform) {
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

function comparePoints(a, b) {
  if (a.x !== b.x) {
    return a.x - b.x
  }
  return a.y - b.y
}

function cross2(o, a, b) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
}

function length2(x, y) {
  return Math.hypot(x, y)
}

function centroid2(points) {
  let x = 0
  let y = 0
  for (let i = 0; i < points.length; i += 1) {
    x += points[i].x
    y += points[i].y
  }
  return {
    x: x / points.length,
    y: y / points.length,
  }
}

function bounds2(points) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (let i = 0; i < points.length; i += 1) {
    const point = points[i]
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  }
}

function selectBloomAnchors(points) {
  let top = points[0]
  let lowerLeft = points[0]
  let lowerRight = points[0]

  for (let i = 1; i < points.length; i += 1) {
    const point = points[i]
    if (point.y < top.y) {
      top = point
    }
    if (point.x + point.y < lowerLeft.x + lowerLeft.y) {
      lowerLeft = point
    }
    if (point.x - point.y > lowerRight.x - lowerRight.y) {
      lowerRight = point
    }
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
    edges.push({
      a,
      abx,
      aby,
      ab2: abx * abx + aby * aby,
    })
  }
  return edges
}

function pointEdgeDistance(point, edge) {
  if (!edge.ab2) {
    return length2(point.x - edge.a.x, point.y - edge.a.y)
  }

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
  if (sorted.length <= 1) {
    return sorted
  }

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
  const projected = [PYRAMID_VERTICES.apex, ...PYRAMID_VERTICES.base].map(
    (vertex) => {
      const rotated = rotatePointWithTransform(vertex, transform)
      const [x, y] = projectPoint(rotated)
      return {
        x: (x / VIEWPORT_SCALE) * (WIDTH / 2) + WIDTH / 2,
        y: HEIGHT / 2 - (y / VIEWPORT_SCALE) * (HEIGHT / 2),
      }
    },
  )

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
    const rotatedNormal = normalize3(rotatePointWithTransform(face.normal, transform))
    const viewDirection = normalize3(sub3(CAMERA, centroid))
    const facing = Math.abs(dot3(rotatedNormal, viewDirection))

    return {
      points,
      strokeOpacity: 0.09 + facing * 0.14,
      fillOpacity: 0.012 + facing * 0.028,
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

function tracePyramidRay(uv, context) {
  const screenPoint = uvToScreenPoint(uv)
  const rayDirection = normalize3(sub3(screenPoint, CAMERA))
  const firstHit = intersectCrystalFaces(CAMERA, rayDirection, context)
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
    const insideHit = intersectCrystalFaces(
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

function applyEdgeBulge(trace, uv, context) {
  const pixelPoint = {
    x: uv.x * WIDTH,
    y: uv.y * HEIGHT,
  }

  let edgeDistance = Infinity
  for (let i = 0; i < context.hullEdges.length; i += 1) {
    edgeDistance = Math.min(
      edgeDistance,
      pointEdgeDistance(pixelPoint, context.hullEdges[i]),
    )
  }

  const edgeWeight = 1 - smoothStep(0, EDGE_BULGE_PX, edgeDistance)
  if (edgeWeight <= 0) {
    return trace
  }

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

function LiquidPyramid({ debug, theta, phi }) {
  const context = useMemo(() => createPyramidContext(theta, phi), [theta, phi])
  const centerX = (context.hullCenter.x / WIDTH) * 100
  const centerY = (context.hullCenter.y / HEIGHT) * 100
  const bloomStyle = {
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none',
  }
  const topX = (context.bloomAnchors.top.x / WIDTH) * 100
  const topY = (context.bloomAnchors.top.y / HEIGHT) * 100
  const leftX = (context.bloomAnchors.lowerLeft.x / WIDTH) * 100
  const leftY = (context.bloomAnchors.lowerLeft.y / HEIGHT) * 100
  const rightX = (context.bloomAnchors.lowerRight.x / WIDTH) * 100
  const rightY = (context.bloomAnchors.lowerRight.y / HEIGHT) * 100
  const bloomScaleX = Math.max((context.hullBounds.width / WIDTH) * 100, 68)
  const bloomScaleY = Math.max((context.hullBounds.height / HEIGHT) * 100, 78)

  return (
    <div
      style={{
        position: 'relative',
        width: WIDTH,
        height: HEIGHT,
        overflow: 'visible',
      }}
    >
      <div
        aria-hidden
        style={{
          ...bloomStyle,
          clipPath: context.clipPath,
          opacity: 1,
          transform: 'scale(1.03)',
          transformOrigin: `${centerX}% ${centerY}%`,
          filter: 'blur(30px) saturate(1.3) brightness(1.22)',
          background: `
            radial-gradient(${bloomScaleX * 0.2}% ${bloomScaleY * 0.24}% at ${topX}% ${topY}%, rgba(255, 255, 255, 0.98), rgba(186, 244, 255, 0.68) 34%, rgba(108, 224, 255, 0.2) 62%, rgba(108, 224, 255, 0) 100%),
            radial-gradient(${bloomScaleX * 0.18}% ${bloomScaleY * 0.2}% at ${leftX}% ${leftY}%, rgba(214, 247, 255, 0.58), rgba(110, 221, 255, 0.24) 48%, rgba(110, 221, 255, 0) 100%),
            radial-gradient(${bloomScaleX * 0.16}% ${bloomScaleY * 0.18}% at ${rightX}% ${rightY}%, rgba(208, 244, 255, 0.34), rgba(110, 221, 255, 0.14) 50%, rgba(110, 221, 255, 0) 100%),
            radial-gradient(${bloomScaleX * 0.44}% ${bloomScaleY * 0.32}% at ${centerX}% ${Math.max(centerY - 8, 12)}%, rgba(160, 236, 255, 0.22), rgba(160, 236, 255, 0.08) 54%, rgba(160, 236, 255, 0) 100%)
          `,
        }}
      />
      <div
        aria-hidden
        style={{
          ...bloomStyle,
          clipPath: context.clipPath,
          opacity: 0.45,
          background:
            'linear-gradient(145deg, rgba(255, 255, 255, 0.72), rgba(205, 246, 255, 0.18) 42%, rgba(255, 255, 255, 0.04) 78%, rgba(255, 255, 255, 0.24))',
          filter:
            'drop-shadow(0 0 6px rgba(170, 240, 255, 0.45)) drop-shadow(0 0 14px rgba(122, 225, 255, 0.18))',
        }}
      />
      <svg
        aria-hidden
        width={WIDTH}
        height={HEIGHT}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        style={{
          position: 'absolute',
          inset: 0,
          overflow: 'visible',
          pointerEvents: 'none',
        }}
      >
        {context.projectedFaces.map((face, index) => (
          <polygon
            key={index}
            points={face.points
              .map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`)
              .join(' ')}
            fill={`rgba(188, 232, 247, ${face.fillOpacity.toFixed(3)})`}
            stroke={`rgba(126, 176, 198, ${face.strokeOpacity.toFixed(3)})`}
            strokeWidth='1'
            strokeLinejoin='round'
            vectorEffect='non-scaling-stroke'
          />
        ))}
      </svg>
      <Shader
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
          background: `
            linear-gradient(140deg, rgba(255, 255, 255, 0.22), rgba(255, 255, 255, 0.03) 38%, rgba(255, 255, 255, 0.1) 68%, rgba(255, 255, 255, 0.28)),
            linear-gradient(180deg, rgba(255, 255, 255, 0.24), rgba(255, 255, 255, 0.05))
          `,
        }}
      />
    </div>
  )
}

export default function Page() {
  const [showDebug, setShowDebug] = useState(false)
  const containerRef = useRef(null)
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const basePhiRef = useRef(-0.42)
  const baseThetaRef = useRef(0.64)

  const [phi, setPhi] = useState(basePhiRef.current)
  const [theta, setTheta] = useState(baseThetaRef.current)

  useMotionValueEvent(x, 'change', () => {
    setTheta(baseThetaRef.current + x.get() * 0.0125)
    setPhi(clamp(basePhiRef.current - y.get() * 0.01, -1.35, 1.35))
  })

  useMotionValueEvent(y, 'change', () => {
    setTheta(baseThetaRef.current + x.get() * 0.0125)
    setPhi(clamp(basePhiRef.current - y.get() * 0.01, -1.35, 1.35))
  })

  return (
    <>
      <div
        style={{
          width: '100dvw',
          height: '100dvh',
          padding: 20,
          background:
            'linear-gradient(to bottom, #9599a6, #c4c7cf 50%, #484950 50%, #213236)',
        }}
      >
        <Image
          src={sampleImage}
          alt='Sample'
          quality={100}
          style={{
            position: 'absolute',
            marginTop: '50dvh',
            marginLeft: '50dvw',
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'none',
          }}
        />
        <h1
          style={{
            position: 'absolute',
            marginTop: '50dvh',
            marginLeft: '50dvw',
            transform: 'translate(-50%, -50%)',
            fontSize: 40,
            color: 'white',
            textShadow: '0 4px 8px black',
          }}
        >
          Pure SVG Filter. No WebGL.
        </h1>
        <div
          ref={containerRef}
          style={{
            width: '100%',
            height: '100%',
            position: 'relative',
          }}
        >
          <motion.div
            drag
            dragElastic={0.16}
            dragMomentum
            dragPropagation={false}
            dragConstraints={containerRef}
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              x,
              y,
              width: WIDTH,
              height: HEIGHT,
              transform: 'translate(-50%, -50%)',
              touchAction: 'none',
              cursor: 'grab',
            }}
          >
            <LiquidPyramid debug={showDebug} theta={theta} phi={phi} />
          </motion.div>
        </div>
      </div>
      <div
        style={{
          position: 'fixed',
          top: 10,
          left: 10,
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          marginBottom: 20,
          fontSize: '.85em',
          zIndex: 100,
        }}
      >
        <label
          style={{
            display: 'flex',
            gap: 5,
            alignItems: 'center',
            userSelect: 'none',
          }}
        >
          <input
            type='checkbox'
            onChange={(e) => setShowDebug(e.target.checked)}
          />
          <span>Debug</span>
        </label>
        <div
          style={{
            position: 'fixed',
            top: 10,
            right: 10,
          }}
        >
          <fieldset>
            <legend>phi</legend>
            <input
              type='range'
              value={phi}
              min={-1.35}
              max={1.35}
              step={0.001}
              onChange={(e) => {
                const nextPhi = +e.target.value
                basePhiRef.current = nextPhi + y.get() * 0.01
                setPhi(nextPhi)
              }}
            />
          </fieldset>
          <fieldset>
            <legend>theta</legend>
            <input
              type='range'
              value={theta}
              min={-3.14}
              max={3.14}
              step={0.001}
              onChange={(e) => {
                const nextTheta = +e.target.value
                baseThetaRef.current = nextTheta - x.get() * 0.0125
                setTheta(nextTheta)
              }}
            />
          </fieldset>
        </div>
      </div>
    </>
  )
}
