const Hyperswarm = require('hyperswarm')
const crypto = require('hypercore-crypto')

const TOPIC = Buffer.from('a11d88ab339f81dbe80e08e0643c0858af345919856656b874fb3cbf98b94fdc', 'hex')
const ipc = BareKit.IPC

let swarm = null
let socket = null
let buffer = ''

function emit(message) {
  ipc.write(Buffer.from(JSON.stringify(message) + '\n'))
}

async function start(options) {
  if (swarm) return
  const seed = Buffer.from(options.seedHex, 'hex')
  const keyPair = crypto.keyPair(seed)
  swarm = new Hyperswarm({
    keyPair,
    ...(Array.isArray(options.bootstrap) && options.bootstrap.length
      ? { bootstrap: options.bootstrap }
      : {}),
  })
  emit({ type: 'identity', publicKey: keyPair.publicKey.toString('hex') })

  swarm.on('connection', (next) => {
    if (socket && socket !== next) next.destroy()
    else socket = next
    emit({ type: 'connected' })
    next.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) if (line.trim()) emit({ type: 'line', line })
    })
    next.on('close', () => {
      if (socket === next) socket = null
      emit({ type: 'disconnected' })
    })
    next.on('error', (error) => emit({ type: 'error', message: error.message }))
  })

  await swarm.join(TOPIC, { server: true, client: true }).flushed()
  emit({ type: 'ready' })
}

ipc.on('data', (chunk) => {
  let command
  try { command = JSON.parse(chunk.toString('utf8')) } catch { return }
  if (command.type === 'start') void start(command).catch((e) => emit({ type: 'error', message: e.message }))
  if (command.type === 'send') {
    if (!socket) emit({ type: 'error', message: 'PEER_NO_CONECTADO' })
    else socket.write(command.line)
  }
  if (command.type === 'stop' && swarm) {
    void swarm.destroy().finally(() => { swarm = null; socket = null })
  }
})
