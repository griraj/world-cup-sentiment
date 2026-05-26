export const metadata = {
  title: '⚽ World Cup Sentiment Tracker',
  description: 'Real-time fan sentiment analysis during World Cup matches',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body style={{ margin: 0, background: '#0a0e1a' }}>
        {children}
      </body>
    </html>
  )
}
