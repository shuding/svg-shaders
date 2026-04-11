'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { motion } from 'motion/react'
import Image from 'next/image'
import sampleImage from '../sample.jpg'

// TODO: We can add more custom functions here to adjust the actual color
// in a declarative way (i.e. by leveraging the `type` field here). The implementation
// can be based on the <feColorMatrix> filter primitive and others.
function texture(x, y) {
  return {
    type: 't',
    x,
    y,
  }
}

// Making this higher will improve the quality (resolution) of the displacement
// map but decrease performance.
const canvasDPI = 2

function Shader({
  width = 100,
  height = 100,
  debug,
  style,
  fragment,
  constraints,
}) {
  const id = useId().replace(/[#:]/g, '-')
  const canvasRef = useRef()
  const feImageRef = useRef()
  const feDisplacementMapRef = useRef()
  const containerRef = useRef()
  const debugRef = useRef()

  const mouseRef = useRef({ x: 0, y: 0 })
  const mouseUsed = useRef(false)
  const [mouseDep, setMouseDep] = useState(0)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleMouseMove = (e) => {
      const rect = container.getBoundingClientRect()
      mouseRef.current = {
        x: (e.clientX - rect.left) / rect.width,
        y: (e.clientY - rect.top) / rect.height,
      }
      if (mouseUsed.current) {
        setMouseDep((d) => d + 1)
      }
    }

    container.addEventListener('mousemove', handleMouseMove)
    return () => container.removeEventListener('mousemove', handleMouseMove)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (!feImageRef.current) return
    if (!feDisplacementMapRef.current) return

    const context = canvas.getContext('2d')

    const mouse = new Proxy(mouseRef.current, {
      get: (target, prop) => {
        mouseUsed.current = true
        return target[prop]
      },
    })

    mouseUsed.current = false

    const w = width * canvasDPI
    const h = height * canvasDPI
    const data = new Uint8ClampedArray(w * h * 4)

    // Dynamic scale to make it as smooth as possible to ensure the best quality
    // but also meet the requirements of the shader.
    let maxScale = 0
    const rawValues = []
    for (let i = 0; i < data.length; i += 4) {
      const x = (i / 4) % w
      const y = ~~(i / 4 / w)
      const pos = fragment(
        {
          x: x / w,
          y: y / h,
        },
        mouse,
      )
      const dx = pos.x * w - x
      const dy = pos.y * h - y
      maxScale = Math.max(maxScale, Math.abs(dx), Math.abs(dy))
      rawValues.push(dx, dy)
    }
    maxScale *= 0.5

    let index = 0
    for (let i = 0; i < data.length; i += 4) {
      const r = rawValues[index++] / maxScale + 0.5
      const g = rawValues[index++] / maxScale + 0.5
      data[i] = r * 256
      data[i + 1] = g * 256
      data[i + 2] = 0
      data[i + 3] = 255
    }
    context.putImageData(new ImageData(data, w, h), 0, 0)

    feImageRef.current.setAttribute('href', canvas.toDataURL())
    feDisplacementMapRef.current.setAttribute('scale', maxScale / canvasDPI)
    if (debugRef.current) {
      debugRef.current.textContent = `Displacement Map (scale = ${maxScale.toFixed(
        2,
      )})`
    }
  }, [width, height, fragment, mouseDep, canvasDPI])

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
              id={`${id}_map`}
              width={width}
              height={height}
              ref={feImageRef}
            />
            <feDisplacementMap
              in='SourceGraphic'
              in2={`${id}_map`}
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
        <motion.div
          ref={containerRef}
          drag
          dragElastic={0.1}
          dragPropagation={false}
          dragConstraints={constraints}
          style={{
            width,
            height,
            overflow: 'hidden',
            backdropFilter: `
            url(#${id}_filter)
            blur(0.25px)
            contrast(1.2)
            brightness(1.05)
            saturate(1.1)
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
    </>
  )
}

function smoothStep(a, b, t) {
  t = Math.max(0, Math.min(1, (t - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

function length(x, y) {
  return Math.sqrt(x * x + y * y)
}

// From https://iquilezles.org/articles/distfunctions2d
function roundedRectSDF(x, y, width, height, radius) {
  const qx = Math.abs(x) - width + radius
  const qy = Math.abs(y) - height + radius
  return (
    Math.min(Math.max(qx, qy), 0) +
    length(Math.max(qx, 0), Math.max(qy, 0)) -
    radius
  )
}

function LiquidGlass({ debug, containerRef }) {
  const [scale, setScale] = useState(1)
  const [size, setSize] = useState(0.3)

  const ratio = 3 / 2
  const realScale = 3 - scale

  return (
    <>
      <Shader
        width={200 * ratio}
        height={200}
        debug={debug}
        fragment={(uv, mouse) => {
          const distanceToEdge = roundedRectSDF(
            uv.x - 0.5,
            uv.y - 0.5,
            0.1 * ratio * realScale,
            0.1 * realScale,
            (0.1 / 2) * realScale,
          )
          //((uv.x - 0.5) ** 2 + (uv.y - 0.5) ** 2) ** 0.5
          const displacement = smoothStep(1, 0, distanceToEdge - size)
          const scaled = smoothStep(0, 1, displacement)

          return texture(
            (uv.x - 0.5) * scaled + 0.5,
            (uv.y - 0.5) * scaled + 0.5,
          )
        }}
        constraints={containerRef}
        style={{
          borderRadius: 150,
          boxShadow:
            '0 4px 8px rgba(0, 0, 0, 0.25), 0 -10px 25px inset rgba(0, 0, 0, 0.15)',
        }}
      />
      <div
        style={{
          position: 'fixed',
          top: 10,
          right: 10,
        }}
      >
        <fieldset>
          <legend>Scale</legend>
          <input
            type='range'
            value={scale}
            min={0}
            max={3}
            step={0.05}
            onChange={(e) => setScale(e.target.value)}
          />
        </fieldset>
        <fieldset>
          <legend>Size</legend>
          <input
            type='range'
            value={size}
            min={0}
            max={1}
            step={0.001}
            onChange={(e) => setSize(e.target.value)}
          />
        </fieldset>
      </div>
    </>
  )
}

export default function Page() {
  const [showDebug, setShowDebug] = useState(false)
  const containerRef = useRef(null)

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
          }}
        />
        <div
          ref={containerRef}
          style={{
            width: '100%',
            height: '100%',
          }}
        >
          <LiquidGlass debug={showDebug} containerRef={containerRef} />
          <svg
            xmlns='http://www.w3.org/2000/svg'
            filterUnits='userSpaceOnUse'
            colorInterpolationFilters='sRGB'
            width={200}
            height={200}
            viewBox='0 0 200 200'
            style={{ position: 'absolute' }}
          >
            <defs>
              <filter
                filterUnits='userSpaceOnUse'
                colorInterpolationFilters='sRGB'
              ></filter>
            </defs>
            <text stroke='black' x='0' y='100'>
              Vercel
            </text>
          </svg>
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
      </div>
    </>
  )
}
