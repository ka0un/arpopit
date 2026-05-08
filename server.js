const express = require('express')
const http = require('http')
const WebSocket = require('ws')
const fs = require('fs')
const path = require('path')
const os = require('os')

const app = express()
const server = http.createServer(app)
const wss = new WebSocket.Server({ server })

app.use(express.static(path.join(__dirname)))

// ── Persistent storage ────────────────────────────────────────────────────────
const DATA_FILE = path.join(__dirname, 'data.json')
function loadData() {
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
    return { leaderboard: data.leaderboard || [], recentAttempts: data.recentAttempts || [] }
  } catch {
    return { leaderboard: [], recentAttempts: [] }
  }
}
function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ leaderboard, recentAttempts }, null, 2))
}
let { leaderboard, recentAttempts } = loadData()

// Deduplicate existing leaderboard to keep only highest score per player
const deduped = new Map()
for (const entry of leaderboard) {
  const key = entry.playerId || entry.name
  const existing = deduped.get(key)
  if (!existing || entry.score > existing.score) {
    deduped.set(key, entry)
  }
}
leaderboard = Array.from(deduped.values())
leaderboard.sort((a, b) => b.score - a.score)
saveData()

// ── In-memory connections ─────────────────────────────────────────────────────
// desks:   Map<desktopId → ws>
// players: Map<ws → { playerId, desktopId, name }>
const desks = new Map()
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
        send(ws, { type: 'recent_attempts_history', attempts: recentAttempts })

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
          console.warn(`  ⚠ desk "${desktopId}" not in map — known: [${[...desks.keys()].map(k => k.slice(0, 8)).join(', ')}]`)
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

      case 'btn_press': {
        const player = players.get(ws)
        if (!player?.name) break
        const color = msg.color === 'purple' ? 'purple' : 'green'
        const payload = JSON.stringify({ type: 'btn_press', name: player.name, color })
        const deskWs = desks.get(player.desktopId)
        if (deskWs && deskWs.readyState === WebSocket.OPEN) deskWs.send(payload)
        break
      }

      case 'live_score': {
        const player = players.get(ws)
        if (!player?.name) break
        const score = Math.max(0, Math.floor(Number(msg.score) || 0))
        const timeLeft = msg.timeLeft
        const payload = JSON.stringify({ type: 'live_score', name: player.name, score, timeLeft })
        const deskWs = desks.get(player.desktopId)
        if (deskWs && deskWs.readyState === WebSocket.OPEN) deskWs.send(payload)
        break
      }

      case 'rename_player': {
        const player = players.get(ws)
        if (!player?.name) break
        const oldName = player.name
        const newName = String(msg.name || '').trim().slice(0, 20) || oldName
        if (newName === oldName) break
        player.name = newName
        let patched = false
        for (const e of leaderboard) {
          if ((e.playerId && e.playerId === player.playerId) || (!e.playerId && e.name === oldName)) {
            e.name = newName
            patched = true
          }
        }
        for (const a of recentAttempts) {
          if ((a.playerId && a.playerId === player.playerId) || (!a.playerId && a.name === oldName)) {
            a.name = newName
            patched = true
          }
        }
        if (patched) saveData()
        send(ws, { type: 'name_ok', name: newName })
        const deskWs = desks.get(player.desktopId)
        send(deskWs, { type: 'player_named', name: newName })
        broadcastLeaderboard()

        const historyPayload = JSON.stringify({ type: 'recent_attempts_history', attempts: recentAttempts })
        wss.clients.forEach(c => {
          if (c.readyState === WebSocket.OPEN && (c._role === 'desktop' || c._role === 'leaderboard')) {
            c.send(historyPayload)
          }
        })

        console.log(`[rename] "${oldName}" → "${newName}"`)
        break
      }

      case 'submit_score': {
        const player = players.get(ws)
        if (!player?.name) break
        const score = Math.max(0, Math.floor(Number(msg.score) || 0))

        let entryId = null
        const existingIdx = leaderboard.findIndex(e => e.playerId ? e.playerId === player.playerId : e.name === player.name)

        if (existingIdx !== -1) {
          const existing = leaderboard[existingIdx]
          entryId = existing.id
          if (score > existing.score) {
            existing.score = score
            existing.ts = Date.now()
            existing.name = player.name
          }
        } else {
          entryId = Date.now() + Math.random()
          const entry = {
            id: entryId,
            playerId: player.playerId,
            name: player.name,
            score: score,
            ts: Date.now(),
          }
          leaderboard.push(entry)
        }

        leaderboard.sort((a, b) => b.score - a.score)
        leaderboard = leaderboard.slice(0, 100)

        recentAttempts.unshift({ playerId: player.playerId, name: player.name, score, rank: leaderboard.findIndex(e => e.id === entryId) + 1 })
        if (recentAttempts.length > 5) recentAttempts.pop()

        saveData()
        broadcastLeaderboard()
        const rank = leaderboard.findIndex(e => e.id === entryId) + 1

        const attemptPayload = JSON.stringify({ type: 'recent_attempt', name: player.name, score: score, rank: rank })
        wss.clients.forEach(c => {
          if (c.readyState === WebSocket.OPEN) c.send(attemptPayload)
        })

        send(ws, { type: 'score_saved', rank })
        console.log(`[score] ${player.name}: ${score} (rank ${rank})`)
        break
      }

      case 'leaderboard_connect': {
        ws._role = 'leaderboard'
        send(ws, { type: 'leaderboard', entries: leaderboard.slice(0, 10) })
        send(ws, { type: 'recent_attempts_history', attempts: recentAttempts })
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
      const deskWs = desks.get(ws._desktopId)
      if (deskWs && deskWs.readyState === WebSocket.OPEN) {
        deskWs.send(JSON.stringify({ type: 'player_left', playerId: ws._playerId }))
      }
      players.delete(ws)
      console.log(`[phone] disconnected: ${ws._playerId}`)
    }
  })
})

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 25649
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
