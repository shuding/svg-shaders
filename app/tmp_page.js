'use client'

import { useEffect, useId, useRef, useState } from 'react'
import Image from 'next/image'

import sampleImage from './sample.jpg'

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
const canvasDPI = 1.2

function Shader({
  width = 100,
  height = 100,
  debug,
  style,
  fragment,
  children,
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
        mouse
      )
      const dx = pos.x * w - x
      const dy = pos.y * h - y
      maxScale = Math.max(maxScale, Math.abs(dx), Math.abs(dy))
      rawValues.push(dx, dy)
    }
    maxScale *= 2

    let index = 0
    for (let i = 0; i < data.length; i += 4) {
      const r = rawValues[index++] / maxScale + 0.5
      const g = rawValues[index++] / maxScale + 0.5
      data[i] = r * 255
      data[i + 1] = g * 255
      data[i + 2] = 0
      data[i + 3] = 255
    }
    context.putImageData(new ImageData(data, w, h), 0, 0)

    feImageRef.current.setAttribute('href', canvas.toDataURL())
    feDisplacementMapRef.current.setAttribute('scale', maxScale / canvasDPI)
    if (debugRef.current) {
      debugRef.current.textContent = `Displacement Map (scale = ${maxScale.toFixed(
        2
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
        ref={containerRef}
        style={{
          width,
          height,
          overflow: 'hidden',
          filter: `url(#${id}_filter)`,
          ...style,
        }}
      >
        {children}
      </div>
      {debug ? (
        <p
          style={{ marginBottom: '0.2em', fontVariantNumeric: 'tabular-nums' }}
        >
          <small ref={debugRef}>Displacement Map</small>
        </p>
      ) : null}
      <canvas
        width={width * canvasDPI}
        height={height * canvasDPI}
        ref={canvasRef}
        style={{ display: debug ? 'inline-block' : 'none', width, height }}
      />
    </>
  )
}

function MagicCarpet({ children, debug }) {
  const [rotation, setRotation] = useState(36)
  const [wave, setWave] = useState(0.6)

  return (
    <>
      <Shader
        width={240}
        height={240}
        debug={debug}
        fragment={(uv, mouse) => {
          // Rotate X degrees around the center
          const angle = (rotation * Math.PI) / 180

          // Apply wave effect based on mouse position
          const offsetX = Math.sin((uv.y + mouse.y) * wave * 5) * 0.1
          const offsetY = Math.sin((uv.x + mouse.x) * wave * 5) * 0.1

          const x =
            (uv.x - 0.5 + offsetX) * Math.cos(angle) -
            (uv.y - 0.5 + offsetY) * Math.sin(angle)
          const y =
            (uv.x - 0.5 + offsetX) * Math.sin(angle) +
            (uv.y - 0.5 + offsetY) * Math.cos(angle)
          return texture(x + 0.5, y + 0.5)
        }}
      >
        {children}
      </Shader>
      <br />
      <fieldset>
        <legend>Rotation</legend>
        <input
          type='range'
          value={rotation}
          min={0}
          max={360}
          onChange={(e) => setRotation(e.target.value)}
        />
      </fieldset>
      <fieldset>
        <legend>Wave</legend>
        <input
          type='range'
          value={wave}
          min={0}
          max={1}
          step={0.01}
          onChange={(e) => setWave(e.target.value)}
        />
      </fieldset>
    </>
  )
}

function Pixelate({ children, debug }) {
  const [size, setSize] = useState(20)

  return (
    <>
      <Shader
        width={240}
        height={240}
        debug={debug}
        fragment={(uv) => {
          // Round to the nearest multiple of `size`
          const x = Math.round(uv.x * size) / size
          const y = Math.round(uv.y * size) / size
          return texture(x, y)
        }}
      >
        {children}
      </Shader>
      <br />
      <fieldset>
        <legend>Size</legend>
        <input
          type='range'
          value={size}
          min={15}
          max={100}
          onChange={(e) => setSize(e.target.value)}
        />
      </fieldset>
    </>
  )
}

function Noise({ children, debug }) {
  const [size, setSize] = useState(20)

  return (
    <>
      <Shader
        width={240}
        height={240}
        debug={debug}
        fragment={(uv, mouse) => {
          // Apply a random offset to each pixel
          // If it's close to the mouse, the offset is smaller
          const dist = ((uv.x - mouse.x) ** 2 + (uv.y - mouse.y) ** 2) ** 0.5
          const factor = size * (dist <= 0.1 ? 0 : (dist - 0.1) ** 2)

          const x = uv.x + ((Math.random() - 0.5) * factor) / 100
          const y = uv.y + ((Math.random() - 0.5) * factor) / 100
          return texture(x, y)
        }}
      >
        {children}
      </Shader>
      <br />
      <fieldset>
        <legend>Size</legend>
        <input
          type='range'
          value={size}
          min={5}
          max={30}
          onChange={(e) => setSize(e.target.value)}
        />
      </fieldset>
    </>
  )
}

function Fractal({ children, debug }) {
  const [size, setSize] = useState(5)

  return (
    <>
      <Shader
        width={240}
        height={240}
        debug={debug}
        fragment={(uv) => {
          const x = (uv.x * size) % 1
          const y = (uv.y * size) % 1
          return texture(x, y)
        }}
      >
        {children}
      </Shader>
      <br />
      <fieldset>
        <legend>Size</legend>
        <input
          type='range'
          value={size}
          min={1}
          max={8}
          onChange={(e) => setSize(e.target.value)}
        />
      </fieldset>
    </>
  )
}

function Spiral({ children, debug }) {
  const [size, setSize] = useState(10)

  return (
    <>
      <Shader
        width={240}
        height={240}
        debug={debug}
        fragment={(uv) => {
          const x = uv.x - 0.5
          const y = uv.y - 0.5
          const r = Math.sqrt(x ** 2 + y ** 2)
          const theta = Math.atan2(y, x)
          const angle = theta + (r * size) / 10
          const nx = Math.cos(angle) * r + 0.5
          const ny = Math.sin(angle) * r + 0.5
          return texture(nx, ny)
        }}
      >
        {children}
      </Shader>
      <br />
      <fieldset>
        <legend>Size</legend>
        <input
          type='range'
          value={size}
          min={0}
          max={200}
          onChange={(e) => setSize(e.target.value)}
        />
      </fieldset>
    </>
  )
}

export default function Page() {
  const [selectedShader, setShader] = useState('MagicCarpet')
  const [showDebug, setShowDebug] = useState(false)

  // Other ideas: raindrops, snowflakes, black hole, glitch, CRT, scanlines, etc...
  const SelectedShader = { MagicCarpet, Pixelate, Noise, Fractal, Spiral }[
    selectedShader
  ]

  return (
    <div style={{ padding: 20 }}>
      <h1
        style={{
          fontSize: '1em',
        }}
      >
        Composable SVG Shaders
      </h1>
      <p>
        These “shaders” are conceptually similar to regular shader programs,
        but can be applied to HTML elements.
      </p>
      <div
        style={{
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          marginBottom: 20,
          fontSize: '.85em',
        }}
      >
        <select onChange={(e) => setShader(e.target.value)}>
          <option value='MagicCarpet'>Shader: Magic Carpet</option>
          <option value='Noise'>Shader: Noise</option>
          <option value='Pixelate'>Shader: Pixelate</option>
          <option value='Fractal'>Shader: Fractal</option>
          <option value='Spiral'>Shader: Spiral</option>
        </select>
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
      <SelectedShader debug={showDebug}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            background: 'yellow',
            borderRadius: 30,
            width: 210,
            height: 210,
            padding: 20,
            margin: 10,
            border: '1px solid #ccc',
            boxShadow: '0 5px 10px rgba(0, 0, 0, 0.15)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
            <Image
              src={sampleImage}
              alt='Sample'
              width={40}
              height={40}
              style={{
                borderRadius: 50,
              }}
            />
            <h1 style={{ fontSize: '1.5em' }}>Hello!</h1>
          </div>
          <input type='range' />
          <input
            type='text'
            placeholder='Type here'
            style={{
              width: '100%',
              fontSize: '1em',
              height: '2em',
            }}
          />
          <marquee style={{ margin: 0 }}>
            This site uses cookies. Opt-out if you wish.
          </marquee>
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              gap: 10,
            }}
          >
            <button>Accept</button>
            <button>Decline</button>
          </div>
        </div>
      </SelectedShader>
      <footer>
        <p>
          Disclaimer: This is an <strong>experimental</strong> demo based on
          SVG filters.
          <br />
          It may not work on all browsers (<strong>Chrome preferred</strong>).
        </p>
        <p>
          Created by{' '}
          <a href='https://twitter.com/shuding_' target='_blank'>
            Shu
          </a>
          , source code on{' '}
          <a href='https://github.com/shuding/svg-shaders' target='_blank'>
            GitHub
          </a>
          .
        </p>
      </footer>
    </div>
  )
}
