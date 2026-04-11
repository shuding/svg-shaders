import { Inter } from 'next/font/google'
import './style.css'

export const metadata = {
  title: 'You can just ship things.',
  description: 'You can just ship things - vercel.com',
}

const inter = Inter({
  weights: [400, 500, 600],
  styles: ['normal'],
  subsets: ['latin-ext'],
})

export default function RootLayout({ children }) {
  return (
    <html lang='en'>
      <body
        className={inter.className}
        style={{
          margin: 0,
          padding: 0,
          background: '#000',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100dvh',
        }}
      >
        <img
          src='/ship.jpg'
          alt='Ship'
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            zIndex: -1,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            filter: 'blur(12px)',
            transform: 'scale(1.1)',
            opacity: 0.17,
          }}
        />
        {children}
      </body>
    </html>
  )
}
