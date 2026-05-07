// AR Bubble Pop — WebSocket + static file server
// Run: node server.js
// Phone game:  http://<YOUR_LAN_IP>:3000/phone.html
// Leaderboard: http://<YOUR_LAN_IP>:3000/leaderboard.html
//
// Find your LAN IP: macOS → ifconfig | grep "inet " | grep -v 127
//                   Windows → ipconfig | findstr "IPv4"

const express = require('express')
const http = require('http')
const WebSocket = require('ws')
const path = require('path')

const app = express()
const server = http.createServer(app)
const wss = new WebSocket.Server({ server })

app.use(express.static(path.join(__dirname)))

// In-memory leaderboard — clients persist via localStorage
let leaderboard = []

function broadcast(msg) {
  const data = JSON.stringify(msg)
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(data)
  })
}

wss.on('connection', (ws) => {
  // Send current state immediately
  ws.send(JSON.stringify({ type: 'leaderboard', entries: leaderboard.slice(0, 10) }))

  ws.on('message', (raw) => {
    let msg
    try { msg = JSON.parse(raw) } catch { return }

    if (msg.type === 'submit_score') {
      const entry = {
        id: Date.now(),
        name: String(msg.name || '').trim().slice(0, 20) || 'Anonymous',
        score: Math.max(0, Math.floor(Number(msg.score) || 0)),
        ts: Date.now(),
      }
      leaderboard.push(entry)
      leaderboard.sort((a, b) => b.score - a.score)
      leaderboard = leaderboard.slice(0, 100)
      broadcast({ type: 'leaderboard', entries: leaderboard.slice(0, 10) })
      console.log(`[score] ${entry.name}: ${entry.score}`)
    }

    if (msg.type === 'live_score') {
      broadcast({
        type: 'live_score',
        name: String(msg.name || '').slice(0, 20),
        score: Math.max(0, Math.floor(Number(msg.score) || 0)),
      })
    }
  })
})

const PORT = process.env.PORT || 3000
server.listen(PORT, '0.0.0.0', () => {
  const { networkInterfaces } = require('os')
  const nets = networkInterfaces()
  let lanIp = 'localhost'
  for (const ifaces of Object.values(nets)) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) { lanIp = iface.address; break }
    }
  }
  console.log(`\nServer ready on port ${PORT}`)
  console.log(`  Phone game:  http://${lanIp}:${PORT}/phone.html`)
  console.log(`  Leaderboard: http://${lanIp}:${PORT}/leaderboard.html\n`)
})
