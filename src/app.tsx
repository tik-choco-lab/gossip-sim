import { useEffect, useMemo, useState } from 'preact/hooks'
import './app.css'

type Edge = [number, number]

type Transmission = {
  id: string
  source: number
  target: number
  ignored: boolean
}

type SimulationSnapshot = {
  informed: boolean[]
  sent: boolean[]
  round: number
  totalMessages: number
  ignoredMessages: number
  activeEdges: Edge[]
  lastNewNodes: number[]
  complete: boolean
}

type RoundOutcome = SimulationSnapshot & {
  history: SimulationSnapshot[]
}

type NodePoint = {
  id: number
  x: number
  y: number
}

type SimulationState = SimulationSnapshot & {
  transmissions: Transmission[]
  pendingOutcome: RoundOutcome | null
  isAnimating: boolean
  history: SimulationSnapshot[]
}

type Settings = {
  nodeCount: number
  connectionCount: number
  fanout: number
  seed: number
}

const initialSettings: Settings = {
  nodeCount: 36,
  connectionCount: 4,
  fanout: 2,
  seed: 17,
}

const animationDurationMs = 900

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max)

const createRandomSeed = () => Math.floor(Math.random() * 9999) + 1

const createRandom = (seed: number) => {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

const pickMany = <T,>(items: T[], count: number, random: () => number) => {
  const pool = [...items]
  const picks: T[] = []

  while (pool.length > 0 && picks.length < count) {
    const index = Math.floor(random() * pool.length)
    picks.push(pool[index])
    pool.splice(index, 1)
  }

  return picks
}

const edgeKey = (a: number, b: number) => `${Math.min(a, b)}-${Math.max(a, b)}`

const createTopology = (settings: Settings) => {
  const n = settings.nodeCount
  const k = clamp(settings.connectionCount, 1, Math.max(1, n - 1))
  const random = createRandom(settings.seed)
  const edgeMap = new Map<string, Edge>()
  const degrees = Array.from({ length: n }, () => 0)

  const addEdge = (source: number, target: number) => {
    const key = edgeKey(source, target)
    if (source === target || edgeMap.has(key)) {
      return false
    }

    edgeMap.set(key, [source, target])
    degrees[source] += 1
    degrees[target] += 1
    return true
  }

  if (k >= 2) {
    for (let node = 0; node < n; node += 1) {
      const next = (node + 1) % n
      addEdge(node, next)
    }
  }

  while (degrees.some((degree) => degree < k)) {
    const candidates: Edge[] = []

    for (let source = 0; source < n; source += 1) {
      if (degrees[source] >= k) {
        continue
      }

      for (let target = source + 1; target < n; target += 1) {
        if (degrees[target] < k && !edgeMap.has(edgeKey(source, target))) {
          candidates.push([source, target])
        }
      }
    }

    if (candidates.length === 0) {
      break
    }

    const [source, target] = candidates[Math.floor(random() * candidates.length)]
    addEdge(source, target)
  }

  const adjacency = Array.from({ length: n }, () => [] as number[])
  const edges = [...edgeMap.values()]

  for (const [source, target] of edges) {
    adjacency[source].push(target)
    adjacency[target].push(source)
  }

  return {
    edges,
    adjacency: adjacency.map((neighbors) => [...new Set(neighbors)]),
  }
}

const createLayout = (settings: Settings): NodePoint[] => {
  const random = createRandom(settings.seed * 31 + settings.nodeCount)
  const padding = 34
  const size = 520 - padding * 2

  return Array.from({ length: settings.nodeCount }, (_, id) => ({
    id,
    x: padding + random() * size,
    y: padding + random() * size,
  }))
}

const createInitialState = (nodeCount: number): SimulationState => {
  const informed = Array.from({ length: nodeCount }, () => false)
  informed[0] = true

  return {
    informed,
    sent: Array.from({ length: nodeCount }, () => false),
    round: 0,
    totalMessages: 0,
    ignoredMessages: 0,
    activeEdges: [],
    transmissions: [],
    lastNewNodes: [0],
    pendingOutcome: null,
    isAnimating: false,
    complete: nodeCount <= 1,
    history: [],
  }
}

const createSnapshot = (state: SimulationState): SimulationSnapshot => ({
  informed: [...state.informed],
  sent: [...state.sent],
  round: state.round,
  totalMessages: state.totalMessages,
  ignoredMessages: state.ignoredMessages,
  activeEdges: state.activeEdges.map(([source, target]) => [source, target]),
  lastNewNodes: [...state.lastNewNodes],
  complete: state.complete,
})

export function App() {
  const [settings, setSettings] = useState(initialSettings)
  const [isRunning, setIsRunning] = useState(false)
  const [randomizeSeedOnReset, setRandomizeSeedOnReset] = useState(true)
  const [animationProgress, setAnimationProgress] = useState(1)
  const [state, setState] = useState(() => createInitialState(initialSettings.nodeCount))

  const topology = useMemo(() => createTopology(settings), [settings])
  const nodes = useMemo(() => createLayout(settings), [settings])
  const hasArrived = state.isAnimating && animationProgress >= 1
  const visibleInformed =
    hasArrived && state.pendingOutcome ? state.pendingOutcome.informed : state.informed
  const visibleLastNewNodes =
    hasArrived && state.pendingOutcome ? state.pendingOutcome.lastNewNodes : state.lastNewNodes
  const informedCount = visibleInformed.filter(Boolean).length
  const maxConnectionCount = Math.max(1, settings.nodeCount - 1)

  const updateSetting = (key: keyof Settings, rawValue: number) => {
    setIsRunning(false)
    setSettings((current) => {
      const next = { ...current, [key]: rawValue }
      next.nodeCount = clamp(Math.round(next.nodeCount), 4, 120)
      next.connectionCount = clamp(
        Math.round(next.connectionCount),
        1,
        Math.max(1, next.nodeCount - 1),
      )
      next.fanout = clamp(Math.round(next.fanout), 1, 12)
      next.seed = clamp(Math.round(next.seed), 1, 9999)
      return next
    })
  }

  const reset = (nextSettings = settings) => {
    setIsRunning(false)
    setAnimationProgress(1)

    if (randomizeSeedOnReset) {
      const randomizedSettings = {
        ...nextSettings,
        seed: createRandomSeed(),
      }
      setSettings(randomizedSettings)
      setState(createInitialState(randomizedSettings.nodeCount))
      return
    }

    setState(createInitialState(nextSettings.nodeCount))
  }

  const randomizeSeed = () => {
    setIsRunning(false)
    setAnimationProgress(1)
    setSettings((current) => ({
      ...current,
      seed: createRandomSeed(),
    }))
  }

  const restart = () => {
    const nextSettings = randomizeSeedOnReset
      ? {
          ...settings,
          seed: createRandomSeed(),
        }
      : settings

    setAnimationProgress(1)
    setState(createInitialState(nextSettings.nodeCount))
    setIsRunning(true)

    if (nextSettings !== settings) {
      setSettings(nextSettings)
    }
  }

  const prepareRound = (current: SimulationState): SimulationState => {
    if (current.complete || current.isAnimating) {
      return current
    }

    const random = createRandom(settings.seed + current.round * 9973)
    const informed = [...current.informed]
    const sent = [...current.sent]
    const activeEdges: Edge[] = []
    const transmissions: Transmission[] = []
    const lastNewNodes: number[] = []
    let totalMessages = current.totalMessages
    let ignoredMessages = current.ignoredMessages

    current.informed.forEach((isInformed, source) => {
      if (!isInformed || current.sent[source]) {
        return
      }

      const neighbors = topology.adjacency[source]
      sent[source] = true

      for (const target of pickMany(neighbors, settings.fanout, random)) {
        const ignored = informed[target]

        activeEdges.push([source, target])
        transmissions.push({
          id: `${current.round + 1}-${source}-${target}-${transmissions.length}`,
          source,
          target,
          ignored,
        })
        totalMessages += 1

        if (ignored) {
          ignoredMessages += 1
          continue
        }

        informed[target] = true
        lastNewNodes.push(target)
      }
    })

    const outcome: RoundOutcome = {
      informed,
      sent,
      round: current.round + 1,
      totalMessages,
      ignoredMessages,
      activeEdges,
      lastNewNodes,
      complete:
        informed.every(Boolean) ||
        !informed.some((isInformed, index) => isInformed && !sent[index]),
      history: [...current.history, createSnapshot(current)],
    }

    return {
      ...current,
      activeEdges,
      transmissions,
      pendingOutcome: outcome,
      isAnimating: true,
    }
  }

  const step = () => {
    setAnimationProgress(0)
    setState((current) => prepareRound(current))
  }

  const stepBack = () => {
    setIsRunning(false)
    setAnimationProgress(1)
    setState((current) => {
      if (current.isAnimating || current.history.length === 0) {
        return current
      }

      const history = current.history.slice(0, -1)
      const previous = current.history[current.history.length - 1]

      return {
        ...previous,
        history,
        transmissions: [],
        pendingOutcome: null,
        isAnimating: false,
      }
    })
  }

  useEffect(() => {
    setState(createInitialState(settings.nodeCount))
    setAnimationProgress(1)
  }, [settings.nodeCount, settings.connectionCount, settings.fanout, settings.seed])

  useEffect(() => {
    if (!isRunning || state.complete || state.isAnimating) {
      return
    }

    const timerId = window.setTimeout(step, 0)
    return () => window.clearTimeout(timerId)
  }, [isRunning, state, settings, topology])

  useEffect(() => {
    if (state.complete && isRunning) {
      setIsRunning(false)
    }
  }, [state.complete, isRunning])

  useEffect(() => {
    if (!state.isAnimating) {
      return
    }

    let frameId = 0
    const startedAt = performance.now()

    const tick = (now: number) => {
      const elapsed = now - startedAt
      const progress = clamp(elapsed / animationDurationMs, 0, 1)
      setAnimationProgress(progress)

      if (progress < 1) {
        frameId = window.requestAnimationFrame(tick)
      }
    }

    frameId = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frameId)
  }, [state.isAnimating, state.transmissions])

  useEffect(() => {
    if (!state.isAnimating) {
      return
    }

    const timerId = window.setTimeout(() => {
      setState((current) => {
        if (!current.pendingOutcome) {
          return current
        }

        const settledState: SimulationState = {
          ...current.pendingOutcome,
          transmissions: [],
          pendingOutcome: null,
          isAnimating: false,
        }

        if (!isRunning || settledState.complete) {
          return settledState
        }

        setAnimationProgress(0)
        return prepareRound(settledState)
      })
    }, animationDurationMs)

    return () => window.clearTimeout(timerId)
  }, [state.isAnimating, state.pendingOutcome, isRunning, settings, topology])

  const newNodeIds = new Set(visibleLastNewNodes)
  const messageProgress = animationProgress

  return (
    <main class="app-shell">
      <section class="workspace" aria-label="Gossip protocol simulator">
        <div class="sim-panel">
          <div class="canvas-header">
            <dl class="metrics">
              <div>
                <dt>総メッセージ</dt>
                <dd>{state.totalMessages}</dd>
              </div>
              <div>
                <dt>無視メッセージ</dt>
                <dd>{state.ignoredMessages}</dd>
              </div>
              <div>
                <dt>到達ノード</dt>
                <dd>
                  {informedCount}
                  <span>/{settings.nodeCount}</span>
                </dd>
              </div>
            </dl>
          </div>

          <svg class="network" viewBox="0 0 520 520" role="img" aria-label="gossip network">
            <g class="edges">
              {topology.edges.map(([source, target]) => {
                const a = nodes[source]
                const b = nodes[target]
                return (
                  <line
                    key={`${source}-${target}`}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    class="edge"
                  />
                )
              })}
            </g>
            <g class="messages" aria-hidden="true">
              {state.transmissions.map((message) => {
                const a = nodes[message.source]
                const b = nodes[message.target]
                const cx = a.x + (b.x - a.x) * messageProgress
                const cy = a.y + (b.y - a.y) * messageProgress

                return (
                  <g key={message.id} class={message.ignored ? 'message-flow ignored' : 'message-flow'}>
                    <circle cx={cx} cy={cy} r="4" class="message" />
                  </g>
                )
              })}
            </g>
            <g class="nodes">
              {nodes.map((node) => {
                const className = [
                  'node',
                  visibleInformed[node.id] ? 'informed' : '',
                  newNodeIds.has(node.id) ? 'new' : '',
                ]
                  .filter(Boolean)
                  .join(' ')

                return (
                  <circle
                    key={node.id}
                    cx={node.x}
                    cy={node.y}
                    r="7"
                    class={className}
                  />
                )
              })}
            </g>
          </svg>

          <div class="graph-footer">
            <div class="progress-row">
              <div class="progress">
                <span style={{ width: `${(informedCount / settings.nodeCount) * 100}%` }} />
              </div>
            </div>

            <div class="control-row">
              <span class="round-label">
                Round <strong>{state.round}</strong>
              </span>

              <div class="actions" aria-label="simulation controls">
                <button
                  type="button"
                  class="icon-button"
                  onClick={stepBack}
                  disabled={state.history.length === 0 || state.isAnimating}
                  aria-label="1ラウンド戻す"
                  title="1ラウンド戻す"
                >
                  <span aria-hidden="true">↶</span>
                </button>
                <button
                  type="button"
                  class="icon-button"
                  onClick={step}
                  disabled={state.complete || state.isAnimating}
                  aria-label="1ラウンド進める"
                  title="1ラウンド進める"
                >
                  <span aria-hidden="true">↷</span>
                </button>
                <button
                  type="button"
                  class="icon-button secondary"
                  onClick={() => (state.complete ? restart() : setIsRunning((value) => !value))}
                  aria-label={state.complete ? '再実行' : isRunning ? '停止' : '自動実行'}
                  title={state.complete ? '再実行' : isRunning ? '停止' : '自動実行'}
                >
                  <span aria-hidden="true">{state.complete ? '↻' : isRunning ? '⏸' : '▶'}</span>
                </button>
                <button
                  type="button"
                  class="icon-button ghost"
                  onClick={() => reset()}
                  aria-label="リセット"
                  title="リセット"
                >
                  <span aria-hidden="true">↺</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <aside class="side-panel">
          <div class="controls">
            <h2>設定</h2>
            <label>
              <span>
                ノード数 N
                <strong>{settings.nodeCount}</strong>
              </span>
              <input
                type="range"
                min="4"
                max="120"
                value={settings.nodeCount}
                onInput={(event) =>
                  updateSetting('nodeCount', Number(event.currentTarget.value))
                }
              />
            </label>
            <label>
              <span>
                接続数 d
                <strong>{settings.connectionCount}</strong>
              </span>
              <input
                type="range"
                min="1"
                max={maxConnectionCount}
                value={settings.connectionCount}
                onInput={(event) =>
                  updateSetting('connectionCount', Number(event.currentTarget.value))
                }
              />
            </label>
            <label>
              <span>
                交換ノード数 f
                <strong>{settings.fanout}</strong>
              </span>
              <input
                type="range"
                min="1"
                max="12"
                value={settings.fanout}
                onInput={(event) => updateSetting('fanout', Number(event.currentTarget.value))}
              />
            </label>
            <label>
              <span>
                Seed
                <strong>{settings.seed}</strong>
              </span>
              <input
                type="range"
                min="1"
                max="9999"
                value={settings.seed}
                onInput={(event) => updateSetting('seed', Number(event.currentTarget.value))}
              />
            </label>
            <div class="seed-actions">
              <button type="button" class="compact" onClick={randomizeSeed}>
                Seedをランダム
              </button>
              <label class="check-row">
                <input
                  type="checkbox"
                  checked={randomizeSeedOnReset}
                  onChange={(event) => setRandomizeSeedOnReset(event.currentTarget.checked)}
                />
                <span>リセット時に毎回ランダム</span>
              </label>
            </div>
          </div>
        </aside>
      </section>
    </main>
  )
}
