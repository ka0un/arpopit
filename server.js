const express   = require('express')
const http      = require('http')
const WebSocket = require('ws')
const fs        = require('fs')
const path      = require('path')
const os        = require('os')

const app    = express()
const server = http.createServer(app)
const wss    = new WebSocket.Server({ server })

app.use(express.static(path.join(__dirname)))

// ── Persistent storage ────────────────────────────────────────────────────────
const DATA_FILE = path.join(__dirname, 'data.json')
function loadData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) } catch { return { leaderboard: [] } }
}
function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ leaderboard }, null, 2))
}
let { leaderboard } = loadData()

// ── In-memory connections ─────────────────────────────────────────────────────
// desks:   Map<desktopId → ws>
// players: Map<ws → { playerId, desktopId, name }>
const desks   = new Map()
const players = new Map()

function send(ws, msg) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
}

function broadcastLeaderboard() {
  const payload = JSON.stringify({ type: 'leaderboard', entries: leaderboard.slice(0, 10) })
  wss.clients.forEach(ws => { if (ws.readyState === WebSocket.OPEN) ws.send(payload) })
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw) } catch { return }

    switch (msg.type) {

      case 'desk_connect': {
        const { desktopId } = msg
        desks.set(desktopId, ws)
        ws._desktopId = desktopId
        ws._role = 'desktop'
        send(ws, { type: 'leaderboard', entries: leaderboard.slice(0, 10) })
        console.log(`[desk] ${desktopId}`)
        break
      }

      case 'player_connect': {
        const { playerId, desktopId } = msg
        players.set(ws, { playerId, desktopId, name: null })
        ws._role = 'phone'
        ws._playerId = playerId
        ws._desktopId = desktopId
        send(desks.get(desktopId), { type: 'player_joined', playerId })
        send(ws, { type: 'leaderboard', entries: leaderboard.slice(0, 10) })
        console.log(`[phone] ${playerId} → desk ${desktopId}`)
        break
      }

      case 'set_name': {
        const player = players.get(ws)
        if (!player) break
        const name = String(msg.name || '').trim().slice(0, 20) || 'Player'
        player.name = name
        send(ws, { type: 'name_ok', name })
        send(desks.get(player.desktopId), { type: 'player_named', name })
        console.log(`[name] ${name}`)
        break
      }

      case 'live_score': {
        const player = players.get(ws)
        if (!player?.name) break
        const score = Math.max(0, Math.floor(Number(msg.score) || 0))
        const payload = JSON.stringify({ type: 'live_score', name: player.name, score })
        // Send to paired desktop + broadcast to all desktops
        wss.clients.forEach(c => {
          if (c._role === 'desktop' && c.readyState === WebSocket.OPEN) c.send(payload)
        })
        break
      }

      case 'submit_score': {
        const player = players.get(ws)
        if (!player?.name) break
        const entry = {
          id:    Date.now() + Math.random(),
          name:  player.name,
          score: Math.max(0, Math.floor(Number(msg.score) || 0)),
          ts:    Date.now(),
        }
        leaderboard.push(entry)
        leaderboard.sort((a, b) => b.score - a.score)
        leaderboard = leaderboard.slice(0, 100)
        saveData()
        broadcastLeaderboard()
        const rank = leaderboard.findIndex(e => e.id === entry.id) + 1
        send(ws, { type: 'score_saved', rank })
        console.log(`[score] ${entry.name}: ${entry.score} (rank ${rank})`)
        break
      }
    }
  })

  ws.on('close', () => {
    if (ws._role === 'desktop') desks.delete(ws._desktopId)
    if (ws._role === 'phone')   players.delete(ws)
  })
})

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000
server.listen(PORT, '0.0.0.0', () => {
  let lanIp = 'localhost'
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) { lanIp = iface.address; break }
    }
  }
  console.log(`\nServer ready on port ${PORT}`)
  console.log(`  Desktop:  http://${lanIp}:${PORT}/`)
  console.log(`  (players join via QR on the desktop screen)\n`)
})
