'use client'

import { useEffect, useId, useRef, useState } from 'react'
import Image from 'next/image'
import sampleImage from '../sample.jpg'

// Bayer matrix levels - used for ordered dithering
function generateBayerMatrix(level) {
  if (level === 0) {
    return {
      size: 2,
      data: [
        [0, 2],
        [3, 1],
      ],
    }
  }

  const prev = generateBayerMatrix(level - 1)
  const size = prev.size * 2
  const data = []

  for (let y = 0; y < size; y++) {
    data[y] = []
    for (let x = 0; x < size; x++) {
      const px = x % prev.size
      const py = y % prev.size
      const quadrant = (x >= prev.size ? 1 : 0) + (y >= prev.size ? 2 : 0)
      const offsets = [0, 2, 3, 1]
      data[y][x] = 4 * prev.data[py][px] + offsets[quadrant]
    }
  }

  return { size, data }
}

// Generate Bayer pattern scaled up by pixelScale
function generateBayerPatternDataURL(level, pixelScale) {
  const { size, data } = generateBayerMatrix(level)
  const scaledSize = size * pixelScale
  const canvas = document.createElement('canvas')
  canvas.width = scaledSize
  canvas.height = scaledSize
  const ctx = canvas.getContext('2d')
  const imageData = ctx.createImageData(scaledSize, scaledSize)
  const maxVal = size * size

  for (let y = 0; y < scaledSize; y++) {
    for (let x = 0; x < scaledSize; x++) {
      const bx = Math.floor(x / pixelScale)
      const by = Math.floor(y / pixelScale)
      const i = (y * scaledSize + x) * 4
      // Normalize to 0-255, offset by 0.5/maxVal for proper threshold centering
      const val = Math.floor(((data[by][bx] + 0.5) / maxVal) * 255)
      imageData.data[i] = val
      imageData.data[i + 1] = val
      imageData.data[i + 2] = val
      imageData.data[i + 3] = 255
    }
  }

  ctx.putImageData(imageData, 0, 0)
  return { dataURL: canvas.toDataURL(), size: scaledSize }
}

// Generate blue noise pattern
function generateBlueNoiseDataURL(size, pixelScale) {
  const scaledSize = size * pixelScale
  const canvas = document.createElement('canvas')
  canvas.width = scaledSize
  canvas.height = scaledSize
  const ctx = canvas.getContext('2d')
  const imageData = ctx.createImageData(scaledSize, scaledSize)

  // Generate base blue noise at native size
  const halton = (index, base) => {
    let result = 0
    let f = 1 / base
    let i = index
    while (i > 0) {
      result += f * (i % base)
      i = Math.floor(i / base)
      f /= base
    }
    return result
  }

  const values = new Array(size * size).fill(0)
  for (let i = 0; i < size * size; i++) {
    const x = Math.floor(halton(i, 2) * size)
    const y = Math.floor(halton(i, 3) * size)
    values[y * size + x] = i / (size * size)
  }

  // Fill remaining
  for (let i = 0; i < values.length; i++) {
    if (values[i] === 0 && i > 0) {
      values[i] = Math.random()
    }
  }

  // Scale up
  for (let y = 0; y < scaledSize; y++) {
    for (let x = 0; x < scaledSize; x++) {
      const bx = Math.floor(x / pixelScale)
      const by = Math.floor(y / pixelScale)
      const val = Math.floor(values[by * size + bx] * 255)
      const idx = (y * scaledSize + x) * 4
      imageData.data[idx] = val
      imageData.data[idx + 1] = val
      imageData.data[idx + 2] = val
      imageData.data[idx + 3] = 255
    }
  }

  ctx.putImageData(imageData, 0, 0)
  return { dataURL: canvas.toDataURL(), size: scaledSize }
}

function DitherFilter({ id, threshold, colorMode, patternDataURL, patternSize }) {
  const patternRef = useRef()

  useEffect(() => {
    if (patternRef.current && patternDataURL) {
      patternRef.current.setAttribute('href', patternDataURL)
    }
  }, [patternDataURL])

  const grayscaleMatrix =
    colorMode === 'mono'
      ? '0.299 0.587 0.114 0 0  0.299 0.587 0.114 0 0  0.299 0.587 0.114 0 0  0 0 0 1 0'
      : '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0'

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={0}
      height={0}
      style={{ position: 'absolute' }}
    >
      <defs>
        <filter
          id={`${id}_dither`}
          x="0%"
          y="0%"
          width="100%"
          height="100%"
          colorInterpolationFilters="sRGB"
          primitiveUnits="userSpaceOnUse"
        >
          {/* Step 1: Convert to grayscale if mono mode */}
          <feColorMatrix
            in="SourceGraphic"
            type="matrix"
            values={grayscaleMatrix}
            result="grayscale"
          />

          {/* Step 2: Load pattern at its native size */}
          <feImage
            ref={patternRef}
            width={patternSize}
            height={patternSize}
            preserveAspectRatio="none"
            result="pattern"
          />

          {/* Step 3: Tile the pattern */}
          <feTile in="pattern" result="tiledPattern" />

          {/* Step 4: Add pattern to image
              We want: image + (pattern - 0.5) * strength
              k1=0, k2=1, k3=strength, k4=-strength*0.5 */}
          <feComposite
            in="grayscale"
            in2="tiledPattern"
            operator="arithmetic"
            k1="0"
            k2="1"
            k3={threshold}
            k4={-threshold * 0.5}
            result="combined"
          />

          {/* Step 5: Hard threshold */}
          <feComponentTransfer in="combined">
            <feFuncR type="discrete" tableValues="0 1" />
            <feFuncG type="discrete" tableValues="0 1" />
            <feFuncB type="discrete" tableValues="0 1" />
          </feComponentTransfer>
        </filter>

        {/* Random dithering using feTurbulence */}
        <filter
          id={`${id}_random_dither`}
          x="0%"
          y="0%"
          width="100%"
          height="100%"
          colorInterpolationFilters="sRGB"
        >
          <feColorMatrix
            in="SourceGraphic"
            type="matrix"
            values={grayscaleMatrix}
            result="grayscale"
          />

          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.5"
            numOctaves="1"
            seed="1"
            result="noise"
          />

          <feComposite
            in="grayscale"
            in2="noise"
            operator="arithmetic"
            k1="0"
            k2="1"
            k3={threshold}
            k4={-threshold * 0.5}
            result="combined"
          />

          <feComponentTransfer in="combined">
            <feFuncR type="discrete" tableValues="0 1" />
            <feFuncG type="discrete" tableValues="0 1" />
            <feFuncB type="discrete" tableValues="0 1" />
          </feComponentTransfer>
        </filter>
      </defs>
    </svg>
  )
}

export default function Page() {
  const id = useId().replace(/[#:]/g, '-')
  const [ditherType, setDitherType] = useState('bayer')
  const [bayerLevel, setBayerLevel] = useState(1) // 4x4 default
  const [pixelScale, setPixelScale] = useState(2)
  const [threshold, setThreshold] = useState(1.0)
  const [colorMode, setColorMode] = useState('mono')
  const [showOriginal, setShowOriginal] = useState(false)
  const [patternDataURL, setPatternDataURL] = useState(null)
  const [patternSize, setPatternSize] = useState(8)

  useEffect(() => {
    if (ditherType === 'bayer') {
      const { dataURL, size } = generateBayerPatternDataURL(bayerLevel, pixelScale)
      setPatternDataURL(dataURL)
      setPatternSize(size)
    } else if (ditherType === 'bluenoise') {
      const { dataURL, size } = generateBlueNoiseDataURL(32, pixelScale)
      setPatternDataURL(dataURL)
      setPatternSize(size)
    }
  }, [ditherType, bayerLevel, pixelScale])

  const getFilterId = () => {
    if (ditherType === 'random') return `${id}_random_dither`
    return `${id}_dither`
  }

  const bayerMatrixSize = Math.pow(2, bayerLevel + 1)

  return (
    <div
      style={{
        width: '100dvw',
        height: '100dvh',
        background: '#1a1a1a',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 20,
        padding: 20,
        overflow: 'auto',
      }}
    >
      <DitherFilter
        id={id}
        threshold={threshold}
        colorMode={colorMode}
        patternDataURL={patternDataURL}
        patternSize={patternSize}
      />

      <h1 style={{ color: 'white', margin: 0, fontSize: '1.5rem' }}>
        SVG Filter Dithering
      </h1>

      <div
        style={{
          display: 'flex',
          gap: 20,
          flexWrap: 'wrap',
          justifyContent: 'center',
        }}
      >
        {/* Original image */}
        <div style={{ textAlign: 'center' }}>
          <Image
            src={sampleImage}
            alt="Original"
            width={400}
            height={300}
            style={{
              objectFit: 'cover',
              borderRadius: 8,
            }}
          />
          <p style={{ color: '#888', marginTop: 8 }}>Original</p>
        </div>

        {/* Dithered image */}
        <div style={{ textAlign: 'center' }}>
          <Image
            src={sampleImage}
            alt="Dithered"
            width={400}
            height={300}
            style={{
              objectFit: 'cover',
              borderRadius: 8,
              filter: showOriginal ? 'none' : `url(#${getFilterId()})`,
            }}
          />
          <p style={{ color: '#888', marginTop: 8 }}>
            {ditherType === 'bayer' && `Bayer ${bayerMatrixSize}x${bayerMatrixSize}`}
            {ditherType === 'bluenoise' && 'Blue Noise'}
            {ditherType === 'random' && 'Random (feTurbulence)'}
            {ditherType !== 'random' && ` @ ${pixelScale}px`}
          </p>
        </div>
      </div>

      {/* Debug: show the pattern */}
      {patternDataURL && ditherType !== 'random' && (
        <div style={{ textAlign: 'center' }}>
          <img
            src={patternDataURL}
            alt="Dither pattern"
            style={{
              width: Math.min(128, patternSize * 2),
              height: Math.min(128, patternSize * 2),
              imageRendering: 'pixelated',
              border: '1px solid #444',
            }}
          />
          <p style={{ color: '#666', fontSize: '0.75rem', marginTop: 4 }}>
            Pattern tile ({patternSize}x{patternSize}px)
          </p>
        </div>
      )}

      {/* Controls */}
      <div
        style={{
          display: 'flex',
          gap: 16,
          flexWrap: 'wrap',
          justifyContent: 'center',
          background: '#2a2a2a',
          padding: 16,
          borderRadius: 8,
        }}
      >
        <fieldset style={{ border: '1px solid #444', padding: 10, borderRadius: 4 }}>
          <legend style={{ color: '#888' }}>Dither Type</legend>
          <select
            value={ditherType}
            onChange={(e) => setDitherType(e.target.value)}
            style={{
              background: '#333',
              color: 'white',
              border: '1px solid #555',
              padding: '4px 8px',
              borderRadius: 4,
            }}
          >
            <option value="bayer">Bayer (Ordered)</option>
            <option value="bluenoise">Blue Noise</option>
            <option value="random">Random (feTurbulence)</option>
          </select>
        </fieldset>

        {ditherType === 'bayer' && (
          <fieldset style={{ border: '1px solid #444', padding: 10, borderRadius: 4 }}>
            <legend style={{ color: '#888' }}>Bayer Matrix</legend>
            <input
              type="range"
              min={0}
              max={3}
              value={bayerLevel}
              onChange={(e) => setBayerLevel(Number(e.target.value))}
            />
            <span style={{ color: 'white', marginLeft: 8 }}>
              {bayerMatrixSize}x{bayerMatrixSize}
            </span>
          </fieldset>
        )}

        {ditherType !== 'random' && (
          <fieldset style={{ border: '1px solid #444', padding: 10, borderRadius: 4 }}>
            <legend style={{ color: '#888' }}>Pixel Scale</legend>
            <input
              type="range"
              min={1}
              max={8}
              value={pixelScale}
              onChange={(e) => setPixelScale(Number(e.target.value))}
            />
            <span style={{ color: 'white', marginLeft: 8 }}>{pixelScale}px</span>
          </fieldset>
        )}

        <fieldset style={{ border: '1px solid #444', padding: 10, borderRadius: 4 }}>
          <legend style={{ color: '#888' }}>Threshold</legend>
          <input
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
          />
          <span style={{ color: 'white', marginLeft: 8 }}>{threshold.toFixed(2)}</span>
        </fieldset>

        <fieldset style={{ border: '1px solid #444', padding: 10, borderRadius: 4 }}>
          <legend style={{ color: '#888' }}>Color</legend>
          <select
            value={colorMode}
            onChange={(e) => setColorMode(e.target.value)}
            style={{
              background: '#333',
              color: 'white',
              border: '1px solid #555',
              padding: '4px 8px',
              borderRadius: 4,
            }}
          >
            <option value="mono">Monochrome</option>
            <option value="color">Per-Channel RGB</option>
          </select>
        </fieldset>

        <fieldset style={{ border: '1px solid #444', padding: 10, borderRadius: 4 }}>
          <legend style={{ color: '#888' }}>Compare</legend>
          <label
            style={{ color: 'white', display: 'flex', alignItems: 'center', gap: 8 }}
          >
            <input
              type="checkbox"
              checked={showOriginal}
              onChange={(e) => setShowOriginal(e.target.checked)}
            />
            Show Original
          </label>
        </fieldset>
      </div>

      <p
        style={{
          color: '#666',
          fontSize: '0.85rem',
          maxWidth: 600,
          textAlign: 'center',
        }}
      >
        Ordered dithering via SVG filters: pattern + image → feComposite arithmetic →
        feComponentTransfer discrete threshold.
      </p>
    </div>
  )
}
