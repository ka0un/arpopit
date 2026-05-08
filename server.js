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

// ── Heartbeat — keeps connections alive through ngrok's idle timeout ───────────
// Marks each WS alive on pong; terminates those that miss two beats.
const PING_INTERVAL = 25_000 // 25s, well under ngrok's 60s idle limit
wss.on('connection', ws => { ws.isAlive = true })
setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) { ws.terminate(); return }
    ws.isAlive = false
    ws.ping()
  })
}, PING_INTERVAL)

// ── WebSocket ─────────────────────────────────────────────────────────────────
wss.on('connection', (ws) => {
  ws.on('pong', () => { ws.isAlive = true })

  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw) } catch { return }

    switch (msg.type) {

      case 'desk_connect': {
        const { desktopId } = msg
        desks.set(desktopId, ws)
        ws._desktopId = desktopId
        ws._role = 'desktop'
        send(ws, { type: 'leaderboard', entries: leaderboard.slice(0, 10) })

        // Re-notify desk of any players already waiting for it
        // (handles race where phone connected before desktop WS was ready)
        let replayed = 0
        for (const [, player] of players) {
          if (player.desktopId === desktopId) {
            send(ws, { type: 'player_joined', playerId: player.playerId })
            if (player.name) send(ws, { type: 'player_named', name: player.name })
            replayed++
          }
        }
        console.log(`[desk] ${desktopId} (replayed ${replayed} player(s))`)
        break
      }

      case 'player_connect': {
        const { playerId, desktopId } = msg
        players.set(ws, { playerId, desktopId, name: null })
        ws._role = 'phone'
        ws._playerId = playerId
        ws._desktopId = desktopId
        const deskWs = desks.get(desktopId)
        console.log(`[phone] ${playerId} → desk "${desktopId}" (found=${!!deskWs})`)
        if (deskWs) {
          send(deskWs, { type: 'player_joined', playerId })
        } else {
          console.warn(`  ⚠ desk "${desktopId}" not in map — known: [${[...desks.keys()].map(k => k.slice(0,8)).join(', ')}]`)
        }
        send(ws, { type: 'leaderboard', entries: leaderboard.slice(0, 10) })
        break
      }

      case 'set_name': {
        const player = players.get(ws)
        if (!player) break
        const name = String(msg.name || '').trim().slice(0, 20) || 'Player'
        player.name = name
        send(ws, { type: 'name_ok', name })
        const deskWs = desks.get(player.desktopId)
        console.log(`[name] "${name}" → desk "${player.desktopId}" (found=${!!deskWs})`)
        send(deskWs, { type: 'player_named', name })
        break
      }

      case 'live_score': {
        const player = players.get(ws)
        if (!player?.name) break
        const score = Math.max(0, Math.floor(Number(msg.score) || 0))
        const payload = JSON.stringify({ type: 'live_score', name: player.name, score })
        wss.clients.forEach(c => {
          if (c._role === 'desktop' && c.readyState === WebSocket.OPEN) c.send(payload)
        })
        break
      }

      case 'rename_player': {
        const player = players.get(ws)
        if (!player?.name) break
        const oldName = player.name
        const newName = String(msg.name || '').trim().slice(0, 20) || oldName
        if (newName === oldName) break
        player.name = newName
        // Patch the most recent leaderboard entry that belonged to this player
        const entry = [...leaderboard].reverse().find(e => e.name === oldName)
        if (entry) { entry.name = newName; saveData() }
        send(ws, { type: 'name_ok', name: newName })
        const deskWs = desks.get(player.desktopId)
        send(deskWs, { type: 'player_named', name: newName })
        broadcastLeaderboard()
        console.log(`[rename] "${oldName}" → "${newName}"`)
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
    // Only remove the desk entry if it still points to THIS websocket
    // (prevents deleting a newer connection that already replaced us)
    if (ws._role === 'desktop' && desks.get(ws._desktopId) === ws) {
      desks.delete(ws._desktopId)
      console.log(`[desk] disconnected: ${ws._desktopId}`)
    }
    if (ws._role === 'phone') {
      players.delete(ws)
      console.log(`[phone] disconnected: ${ws._playerId}`)
    }
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
