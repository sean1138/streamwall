import range from 'lodash/range'
import sortBy from 'lodash/sortBy'
import truncate from 'lodash/truncate'
import ReconnectingWebSocket from 'reconnecting-websocket'
import { h, Fragment, render } from 'preact'
import { useEffect, useState, useCallback, useRef } from 'preact/hooks'
import { State } from 'xstate'
import styled, { css } from 'styled-components'
import { useHotkeys } from 'react-hotkeys-hook'

import '../index.css'
import SoundIcon from '../static/volume-up-solid.svg'
import NoVideoIcon from '../static/video-slash-solid.svg'
import ReloadIcon from '../static/redo-alt-solid.svg'
import LifeRingIcon from '../static/life-ring-regular.svg'
import WindowIcon from '../static/window-maximize-regular.svg'

const hotkeyTriggers = [
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '0',
  'q',
  'w',
  'e',
  'r',
  't',
  'y',
  'u',
  'i',
  'o',
  'p',
]

function App({ wsEndpoint }) {
  const wsRef = useRef()
  const [isConnected, setIsConnected] = useState(false)
  const [config, setConfig] = useState({})
  const [streams, setStreams] = useState([])
  const [customStreams, setCustomStreams] = useState([])
  const [stateIdxMap, setStateIdxMap] = useState(new Map())
  const [delayState, setDelayState] = useState()

  const { gridCount } = config

  useEffect(() => {
    const ws = new ReconnectingWebSocket(wsEndpoint, [], {
      maxReconnectionDelay: 5000,
      minReconnectionDelay: 1000 + Math.random() * 500,
      reconnectionDelayGrowFactor: 1.1,
    })
    ws.addEventListener('open', () => setIsConnected(true))
    ws.addEventListener('close', () => setIsConnected(false))
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.type === 'state') {
        const {
          config: newConfig,
          streams: newStreams,
          views,
          streamdelay,
        } = msg.state
        const newStateIdxMap = new Map()
        for (const viewState of views) {
          const { pos, content } = viewState.context
          const stream = newStreams.find((d) => d.link === content.url)
          const streamId = stream?._id
          const state = State.from(viewState.state)
          const isListening = state.matches(
            'displaying.running.audio.listening',
          )
          const isBlurred = state.matches('displaying.running.video.blurred')
          for (const space of pos.spaces) {
            if (!newStateIdxMap.has(space)) {
              newStateIdxMap.set(space, {})
            }
            Object.assign(newStateIdxMap.get(space), {
              streamId,
              content,
              state,
              isListening,
              isBlurred,
            })
          }
        }
        setConfig(newConfig)
        setStateIdxMap(newStateIdxMap)
        setStreams(sortBy(newStreams, ['_id']))
        setCustomStreams(newStreams.filter((s) => s._dataSource === 'custom'))
        setDelayState(
          streamdelay && {
            ...streamdelay,
            state: State.from(streamdelay.state),
          },
        )
      } else {
        console.warn('unexpected ws message', msg)
      }
    })
    wsRef.current = ws
  }, [])

  const handleSetView = useCallback(
    (idx, streamId) => {
      const newSpaceIdxMap = new Map(stateIdxMap)
      const stream = streams.find((d) => d._id === streamId)
      if (stream) {
        const content = {
          url: stream?.link,
          kind: stream?.kind || 'video',
        }
        newSpaceIdxMap.set(idx, {
          ...newSpaceIdxMap.get(idx),
          streamId,
          content,
        })
      } else {
        newSpaceIdxMap.delete(idx)
      }
      const views = Array.from(newSpaceIdxMap, ([space, { content }]) => [
        space,
        content,
      ])
      wsRef.current.send(JSON.stringify({ type: 'set-views', views }))
    },
    [streams, stateIdxMap],
  )

  const handleSetListening = useCallback((idx, listening) => {
    wsRef.current.send(
      JSON.stringify({
        type: 'set-listening-view',
        viewIdx: listening ? idx : null,
      }),
    )
  }, [])

  const handleSetBlurred = useCallback((idx, blurred) => {
    wsRef.current.send(
      JSON.stringify({
        type: 'set-view-blurred',
        viewIdx: idx,
        blurred: blurred,
      }),
    )
  }, [])

  const handleReloadView = useCallback((idx) => {
    wsRef.current.send(
      JSON.stringify({
        type: 'reload-view',
        viewIdx: idx,
      }),
    )
  }, [])

  const handleBrowse = useCallback((url) => {
    wsRef.current.send(
      JSON.stringify({
        type: 'browse',
        url,
      }),
    )
  }, [])

  const handleDevTools = useCallback((idx) => {
    wsRef.current.send(
      JSON.stringify({
        type: 'dev-tools',
        viewIdx: idx,
      }),
    )
  }, [])

  const handleClickId = useCallback(
    (streamId) => {
      const availableIdx = range(gridCount * gridCount).find(
        (i) => !stateIdxMap.has(i),
      )
      if (availableIdx === undefined) {
        return
      }
      handleSetView(availableIdx, streamId)
    },
    [gridCount, stateIdxMap],
  )

  const handleChangeCustomStream = useCallback((idx, customStream) => {
    let newCustomStreams = [...customStreams]
    newCustomStreams[idx] = customStream
    newCustomStreams = newCustomStreams.filter((s) => s.label || s.link)
    wsRef.current.send(
      JSON.stringify({
        type: 'set-custom-streams',
        streams: newCustomStreams,
      }),
    )
  })

  const setStreamCensored = useCallback((isCensored) => {
    wsRef.current.send(
      JSON.stringify({
        type: 'set-stream-censored',
        isCensored,
      }),
    )
  }, [])

  // Set up keyboard shortcuts.
  useHotkeys(
    hotkeyTriggers.map((k) => `alt+${k}`).join(','),
    (ev, { key }) => {
      ev.preventDefault()
      const idx = hotkeyTriggers.indexOf(key[key.length - 1])
      const isListening = stateIdxMap.get(idx)?.isListening ?? false
      handleSetListening(idx, !isListening)
    },
    [stateIdxMap],
  )
  useHotkeys(
    hotkeyTriggers.map((k) => `alt+shift+${k}`).join(','),
    (ev, { key }) => {
      ev.preventDefault()
      const idx = hotkeyTriggers.indexOf(key[key.length - 1])
      const isBlurred = stateIdxMap.get(idx)?.isBlurred ?? false
      handleSetBlurred(idx, !isBlurred)
    },
    [stateIdxMap],
  )
  useHotkeys(
    `alt+c`,
    () => {
      setStreamCensored(true)
    },
    [setStreamCensored],
  )
  useHotkeys(
    `alt+shift+c`,
    () => {
      setStreamCensored(false)
    },
    [setStreamCensored],
  )

  return (
    <div>
      <h1>Streamwall ({location.host})</h1>
      <div>
        connection status: {isConnected ? 'connected' : 'connecting...'}
      </div>
      {delayState && (
        <StreamDelayBox
          delayState={delayState}
          setStreamCensored={setStreamCensored}
        />
      )}
      <StyledDataContainer isConnected={isConnected}>
        <div>
          {range(0, gridCount).map((y) => (
            <StyledGridLine>
              {range(0, gridCount).map((x) => {
                const idx = gridCount * y + x
                const {
                  streamId = '',
                  isListening = false,
                  isBlurred = false,
                  content = { url: '' },
                  state,
                } = stateIdxMap.get(idx) || {}
                return (
                  <GridInput
                    idx={idx}
                    url={content.url}
                    spaceValue={streamId}
                    isError={state && state.matches('displaying.error')}
                    isDisplaying={state && state.matches('displaying')}
                    isListening={isListening}
                    isBlurred={isBlurred}
                    onChangeSpace={handleSetView}
                    onSetListening={handleSetListening}
                    onSetBlurred={handleSetBlurred}
                    onReloadView={handleReloadView}
                    onBrowse={handleBrowse}
                    onDevTools={handleDevTools}
                  />
                )
              })}
            </StyledGridLine>
          ))}
        </div>
        <div>
          {isConnected
            ? streams.map((row) => (
                <StreamLine id={row._id} row={row} onClickId={handleClickId} />
              ))
            : 'loading...'}
        </div>
        <h2>Custom Streams</h2>
        <div>
          {/*
            Include an empty object at the end to create an extra input for a new custom stream.
            We need it to be part of the array (rather than JSX below) for DOM diffing to match the key and retain focus.
           */}
          {[...customStreams, { link: '', label: '', kind: 'video' }].map(
            ({ link, label, kind }, idx) => (
              <CustomStreamInput
                key={idx}
                idx={idx}
                link={link}
                label={label}
                kind={kind}
                onChange={handleChangeCustomStream}
              />
            ),
          )}
        </div>
      </StyledDataContainer>
    </div>
  )
}

function StreamDelayBox({ delayState, setStreamCensored }) {
  const handleToggleStreamCensored = useCallback(() => {
    setStreamCensored(!delayState.isCensored)
  }, [delayState.isCensored, setStreamCensored])
  let buttonText
  if (delayState.isConnected) {
    if (delayState.state.matches('censorship.censored.deactivating')) {
      buttonText = 'Deactivating...'
    } else if (delayState.isCensored) {
      buttonText = 'Uncensor stream'
    } else {
      buttonText = 'Censor stream'
    }
  }
  return (
    <div>
      <StyledStreamDelayBox>
        <strong>Streamdelay</strong>
        <span>{delayState.isConnected ? 'connected' : 'connecting...'}</span>
        {delayState.isConnected && (
          <>
            <span>delay: {delayState.delaySeconds}s</span>
            <StyledToggleButton
              isActive={delayState.isCensored}
              onClick={handleToggleStreamCensored}
              tabIndex={1}
            >
              {buttonText}
            </StyledToggleButton>
          </>
        )}
      </StyledStreamDelayBox>
    </div>
  )
}

function StreamLine({
  id,
  row: { label, source, title, link, notes, state, city },
  onClickId,
}) {
  const handleClickId = useCallback(() => {
    onClickId(id)
  })
  let location
  if (state && city) {
    location = ` (${city} ${state}) `
  }
  return (
    <StyledStreamLine>
      <StyledId onClick={handleClickId}>{id}</StyledId>
      <div>
        {label ? (
          label
        ) : (
          <>
            <strong>{source}</strong>
            {location}
            <a href={link} target="_blank">
              {truncate(title || link, { length: 55 })}
            </a>{' '}
            {notes}
          </>
        )}
      </div>
    </StyledStreamLine>
  )
}

function GridInput({
  idx,
  url,
  onChangeSpace,
  spaceValue,
  isDisplaying,
  isError,
  isListening,
  isBlurred,
  onSetListening,
  onSetBlurred,
  onReloadView,
  onBrowse,
  onDevTools,
}) {
  const [editingValue, setEditingValue] = useState()
  const handleFocus = useCallback((ev) => {
    setEditingValue(ev.target.value)
  })
  const handleBlur = useCallback((ev) => {
    setEditingValue(undefined)
  })
  const handleChange = useCallback(
    (ev) => {
      const { name, value } = ev.target
      setEditingValue(value)
      onChangeSpace(Number(name), value)
    },
    [onChangeSpace],
  )
  const handleListeningClick = useCallback(
    () => onSetListening(idx, !isListening),
    [idx, onSetListening, isListening],
  )
  const handleBlurClick = useCallback(() => onSetBlurred(idx, !isBlurred), [
    idx,
    onSetBlurred,
    isBlurred,
  ])
  const handleReloadClick = useCallback(() => onReloadView(idx), [
    idx,
    onReloadView,
  ])
  const handleBrowseClick = useCallback(() => onBrowse(url), [url, onBrowse])
  const handleDevToolsClick = useCallback(() => onDevTools(idx), [
    idx,
    onDevTools,
  ])
  const handleClick = useCallback((ev) => {
    ev.target.select()
  })
  return (
    <StyledGridContainer>
      <StyledGridInput
        name={idx}
        value={editingValue || spaceValue || ''}
        isError={isError}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onClick={handleClick}
        onChange={handleChange}
      />
      <StyledGridButtons>
      {isDisplaying && (
        <StyledGridButtons side="left">
          <StyledSmallButton onClick={handleReloadClick} tabIndex={1} title="reload stream">
            <ReloadIcon />
          </StyledSmallButton>
          <StyledSmallButton onClick={handleBrowseClick} tabIndex={1} title="view stream in new window">
            <WindowIcon />
          </StyledSmallButton>
          <StyledSmallButton onClick={handleDevToolsClick} tabIndex={1} title="inspect stream element">
            <LifeRingIcon />
          </StyledSmallButton>
        </StyledGridButtons>
      )}
        <StyledToggleButton
          isActive={isBlurred}
          onClick={handleBlurClick}
          tabIndex={1}
          title="toggle blur"
        >
          <NoVideoIcon />
        </StyledToggleButton>
        <StyledToggleButton
          isActive={isListening}
          onClick={handleListeningClick}
          tabIndex={1}
          title="toggle audio"
        >
          <SoundIcon />
        </StyledToggleButton>
      </StyledGridButtons>
    </StyledGridContainer>
  )
}

function CustomStreamInput({ idx, onChange, ...props }) {
  const handleChangeLink = useCallback(
    (ev) => {
      onChange(idx, { ...props, link: ev.target.value })
    },
    [onChange],
  )
  const handleChangeLabel = useCallback(
    (ev) => {
      onChange(idx, { ...props, label: ev.target.value })
    },
    [onChange],
  )
  const handleChangeKind = useCallback(
    (ev) => {
      onChange(idx, { ...props, kind: ev.target.value })
    },
    [onChange],
  )
  return (
    <div>
      <input
        onChange={handleChangeLink}
        placeholder="https://..."
        value={props.link}
      />
      <input
        onChange={handleChangeLabel}
        placeholder="Label (optional)"
        value={props.label}
      />
      <select onChange={handleChangeKind} value={props.kind}>
        <option value="video">video</option>
        <option value="web">web</option>
      </select>
    </div>
  )
}

const StyledStreamDelayBox = styled.div`
  display: inline-flex;
  margin: 5px 0;
  padding: 10px;
  background: #fdd;

  & > * {
    margin-right: 1em;
  }
`

const StyledDataContainer = styled.div`
  opacity: ${({ isConnected }) => (isConnected ? 1 : 0.5)};
`

const StyledGridLine = styled.div`
  display: flex;
`

const StyledButton = styled.button`
// moved to index.css
`

const StyledSmallButton = styled(StyledButton)`
// moved to index.css
`

const StyledToggleButton = styled(StyledButton)`
  ${({ isActive }) =>
    isActive &&
    `
      border-color: red;
      background: #c77;
    `};
`

const StyledGridContainer = styled.div`
// moved to index.css
`

const StyledGridButtons = styled.div`
// moved to index.css

`

const StyledGridInput = styled.input`
// moved to index.css
  border: 2px solid ${({ isError }) => (isError ? 'red' : 'black')};
`

const StyledId = styled.div`
// moved to index.css

`

const StyledStreamLine = styled.div`
// moved to index.css

`

function main() {
  const script = document.getElementById('main-script')
  render(<App wsEndpoint={script.dataset.wsEndpoint} />, document.body)
}

main()
