import { useCallback, useEffect, useRef, useState } from "react";
import {
  ARRIVAL_LINE,
  ENTRANCE_LINE,
  OPENING,
  advanceStep,
  mapIndexFor,
  replyFor,
} from "./mockRoutes.js";
import "./styles.css";

function Icon({ name }) {
  const paths = {
    camera: <><path d="M8 6 10 3h4l2 3h4v14H4V6h4Z" /><circle cx="12" cy="13" r="4" /></>,
    map: <><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z" /><path d="M9 3v15M15 6v15" /></>,
    mic: <><rect x="8" y="3" width="8" height="12" rx="4" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8" /></>,
    send: <path d="m3 4 18 8-18 8 3-8-3-8Zm3 8h15" />,
    scan: <><path d="M8 4H4v4M16 4h4v4M20 16v4h-4M8 20H4v-4" /><path d="M7 12h10" /></>,
    sound: <><path d="M4 10v4h4l5 4V6l-5 4H4Z" /><path d="M16 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12" /></>,
  };
  return <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

const HEADING_TURN = { North: 0, East: 90, South: 180, West: 270 };

export function AskLine({ destination, setDestination, onSubmit }) {
  return (
    <form className="ask-line" onSubmit={(event) => { event.preventDefault(); onSubmit(destination); }}>
      <label htmlFor="destination">Where do you want to go?</label>
      <div className="ask-line__row">
        <input
          id="destination"
          value={destination}
          onChange={(event) => setDestination(event.target.value)}
          placeholder=""
          autoComplete="off"
        />
        <button type="submit" disabled={!destination.trim()} aria-label="Find route">
          <Icon name="send" />
        </button>
      </div>
    </form>
  );
}

export function JourneyCard({ route, steps, current, doneIds, onExit }) {
  const done = doneIds.length;
  return (
    <article className="journey-card">
      <div>
        <p className="kicker">TRAIN</p>
        <h2>{route.trainLine}</h2>
      </div>
      <button className="text-button" onClick={onExit}>End</button>
      <div className="journey-card__progress" aria-hidden="true">
        <span style={{ width: `${(done / route.totalCheckpoints) * 100}%` }} />
      </div>
      <p>{route.platform}. {done} of {route.totalCheckpoints} checkpoints.</p>
      <ol className="journey-steps">
        {steps.map((step, index) => (
          <li
            key={step.id}
            className={index === current ? "is-current" : doneIds.includes(step.id) ? "is-done" : ""}
          >
            {step.instruction}
          </li>
        ))}
      </ol>
    </article>
  );
}

export function StationSchematic({ steps, current, doneIds }) {
  return (
    <section className="schematic" aria-label="Checkpoint progress">
      <div className="schematic__heading">
        <span><b>42 ST</b> / TIMES SQUARE</span>
        <small>{doneIds.length} OF {steps.length}</small>
      </div>
      <div className="schematic__route">
        <span className="schematic__line" aria-hidden="true" />
        {steps.map((step, index) => {
          const done = doneIds.includes(step.id);
          return (
            <div
              className={`schematic__node ${index === current ? "is-active" : ""} ${done ? "is-past" : ""}`}
              key={step.id}
            >
              <span className="schematic__dot">{done ? "✓" : index + 1}</span>
              <b>{step.distance}</b>
              <small>{step.heading}</small>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function ArrowCue({ heading, label, tone }) {
  const rotation = HEADING_TURN[heading] ?? 0;
  return (
    <div className={`arrow-cue ${tone === "back" ? "arrow-cue--back" : ""} ${tone === "arrive" ? "arrow-cue--arrive" : ""}`} aria-label={label}>
      <span className="arrow-cue__label">{label}</span>
      <svg viewBox="0 0 110 165" style={{ transform: `rotate(${rotation}deg)` }} aria-hidden="true">
        <path className="arrow-glow" d="M55 145V35M17 72l38-42 38 42" />
        <path d="M55 145V35M17 72l38-42 38 42" />
      </svg>
    </div>
  );
}

export function CameraStage({
  videoRef,
  cameraState,
  heading,
  label,
  tone,
  scanning,
  scanStatus,
  onReadSign,
  onEnableCamera,
}) {
  return (
    <section className="camera-stage" aria-label="Live navigation camera">
      <video ref={videoRef} autoPlay muted playsInline />
      <div className="camera-stage__shade" />
      {cameraState !== "ready" && (
        <div className="camera-empty">
          <span className="camera-empty__icon"><Icon name="camera" /></span>
          <strong>{cameraState === "denied" ? "Camera access is off" : "Ready for the live view"}</strong>
          <p>Point the camera at a station sign. The page stays the same size.</p>
          <button onClick={onEnableCamera}>Enable camera</button>
        </div>
      )}
      {scanning ? (
        <div className="sign-processing" role="status">
          <span />
          <strong>Reading the sign</strong>
        </div>
      ) : cameraState === "ready" ? <ArrowCue heading={heading} label={label} tone={tone} /> : null}
      <div className="scan-control">
        <button onClick={onReadSign} disabled={scanning}>
          <Icon name="scan" />
          {scanning ? "Reading…" : "Read this sign"}
        </button>
        {scanStatus && <span role="status">{scanStatus}</span>}
      </div>
    </section>
  );
}

export function TwoLineChat({ history, speaking, onToggleSpeech, scrollerRef }) {
  const lines = history?.length ? history : [{ role: "mate", text: OPENING }];
  return (
    <div className="two-line-chat">
      <div className="two-line-chat__log" aria-live="polite" ref={scrollerRef}>
        {lines.map((line, index) => (
          <p key={`${line.role}-${index}`} className={line.role === "you" ? "two-line-chat__you" : ""}>
            <span>{line.role === "you" ? "YOU" : "SUBWAY MATE"}</span> {line.text}
          </p>
        ))}
      </div>
      <button onClick={onToggleSpeech} className={speaking ? "is-active" : ""} aria-label={speaking ? "Stop spoken guidance" : "Speak guidance"}>
        <Icon name="sound" />
      </button>
    </div>
  );
}

export function TextFallback({ onSend }) {
  const [text, setText] = useState("");
  return (
    <form className="text-fallback" onSubmit={(event) => {
      event.preventDefault();
      if (!text.trim()) return;
      onSend(text.trim());
      setText("");
    }}>
      <label htmlFor="fallback-input">Type instead</label>
      <div>
        <input id="fallback-input" value={text} onChange={(event) => setText(event.target.value)} placeholder="Ask about this step…" />
        <button disabled={!text.trim()} aria-label="Send message"><Icon name="send" /></button>
      </div>
    </form>
  );
}

function VoiceButton({ listening, onClick }) {
  return (
    <button
      className={`voice-button ${listening ? "is-listening" : ""}`}
      onClick={onClick}
      aria-label={listening ? "Stop listening" : "Ask Subway Mate"}
    >
      <Icon name="mic" />
      <span>{listening ? "Listening…" : "Ask"}</span>
    </button>
  );
}

function arrowLabel(step) {
  return step?.cue || step?.distance || "";
}

function pickVoice() {
  const voices = window.speechSynthesis?.getVoices?.() || [];
  return voices.find((voice) => voice.lang === "en-US") || voices.find((voice) => voice.lang?.startsWith("en")) || voices[0] || null;
}

function routeAudioToSpeaker() {
  const session = navigator.audioSession;
  if (session && session.type !== "playback") session.type = "playback";
}

export function App() {
  const [phase, setPhase] = useState("welcome");
  const [finding, setFinding] = useState(false);
  const [route, setRoute] = useState(null);
  const [cursor, setCursor] = useState(0);
  const [doneIds, setDoneIds] = useState([]);
  const [arrived, setArrived] = useState(false);
  const [destination, setDestination] = useState("");
  const [history, setHistory] = useState([]);
  const [view, setView] = useState("camera");
  const [cameraState, setCameraState] = useState("idle");
  const [scanning, setScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const historyRef = useRef(null);
  const recognitionRef = useRef(null);
  const routeRef = useRef(null);
  const cursorRef = useRef(0);
  const doneRef = useRef([]);
  const arrivedRef = useRef(false);
  const scanningRef = useRef(false);

  useEffect(() => { routeRef.current = route; }, [route]);
  useEffect(() => { cursorRef.current = cursor; }, [cursor]);
  useEffect(() => { doneRef.current = doneIds; }, [doneIds]);
  useEffect(() => { arrivedRef.current = arrived; }, [arrived]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !streamRef.current) return;
    video.srcObject = streamRef.current;
    video.muted = true;
    video.playsInline = true;
    video.play?.().catch(() => {});
  }, [route, view, cameraState]);

  const speakNow = useCallback((line) => {
    const synth = window.speechSynthesis;
    if (!synth || !line) return;
    routeAudioToSpeaker();
    synth.resume();
    const utterance = new SpeechSynthesisUtterance(line);
    const voice = pickVoice();
    if (voice) utterance.voice = voice;
    utterance.volume = 1;
    utterance.rate = 0.95;
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    synth.speak(utterance);
  }, []);

  const say = useCallback((user, line) => {
    setHistory((prev) => {
      const next = [...prev];
      if (user) next.push({ role: "you", text: user });
      if (line) next.push({ role: "mate", text: line });
      return next.slice(-40);
    });
    speakNow(line);
  }, [speakNow]);

  useEffect(() => {
    historyRef.current?.scrollTo({ top: historyRef.current.scrollHeight });
  }, [history]);

  const beginDetect = useCallback(() => {
    setPhase("detecting");
    window.speechSynthesis?.getVoices();
    speakNow(ENTRANCE_LINE);
    window.setTimeout(() => {
      setPhase("ask");
      setHistory([{ role: "mate", text: OPENING }]);
    }, 1400);
  }, [speakNow]);

  const enableCamera = useCallback(async () => {
    if (streamRef.current?.getVideoTracks().some((track) => track.readyState === "live")) {
      setCameraState("ready");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play?.().catch(() => {});
      }
      setCameraState("ready");
      routeAudioToSpeaker();
    } catch {
      if (!streamRef.current) setCameraState("denied");
    }
  }, []);

  const applyRouteResult = useCallback((result) => {
    if (result.route) {
      setRoute(result.route);
      setCursor(result.cursor ?? 0);
      setDoneIds(result.doneIds ?? []);
      setArrived(Boolean(result.arrived));
      setView("camera");
      enableCamera();
    } else {
      if (typeof result.cursor === "number") setCursor(result.cursor);
      if (result.doneIds) setDoneIds(result.doneIds);
      if (typeof result.arrived === "boolean") setArrived(result.arrived);
    }
  }, [enableCamera]);

  const handleMessage = useCallback((text) => {
    const active = routeRef.current;
    const result = replyFor(text, active, cursorRef.current, arrivedRef.current);
    setDestination("");
    if (result.route && !active) {
      enableCamera();
      setHistory((prev) => [...prev, { role: "you", text }, { role: "mate", text: "Finding the train." }].slice(-40));
      speakNow(`Finding the train. ${result.line}`);
      setFinding(true);
      window.setTimeout(() => {
        applyRouteResult(result);
        setFinding(false);
        setHistory((prev) => [...prev, { role: "mate", text: result.line }].slice(-40));
      }, 1600);
      return;
    }
    applyRouteResult(result);
    say(text, result.line);
  }, [applyRouteResult, enableCamera, say, speakNow]);

  const readSign = useCallback(() => {
    const active = routeRef.current;
    if (!active || scanningRef.current) return;
    if (arrivedRef.current) {
      say("", ARRIVAL_LINE);
      return;
    }
    const wait = [1600, 2400, 1900, 2200][cursorRef.current] ?? 1800;
    const result = advanceStep(active, cursorRef.current, doneRef.current);
    speakNow(`Reading the sign. ${result.line}`);
    scanningRef.current = true;
    setScanning(true);
    setScanStatus("Reading the sign…");
    window.setTimeout(() => {
      const currentRoute = routeRef.current;
      scanningRef.current = false;
      setScanning(false);
      if (!currentRoute) return;
      setCursor(result.cursor);
      setDoneIds(result.doneIds);
      setArrived(result.arrived);
      setScanStatus("");
      setHistory((prev) => [...prev, { role: "mate", text: result.line }].slice(-40));
    }, wait);
  }, [say, speakNow]);

  const toggleListening = useCallback(() => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      say("", "Voice recognition isn’t available in this browser. Type Bronx or Queens.");
      return;
    }
    if (listening && recognitionRef.current) {
      recognitionRef.current.stop();
      setListening(false);
      return;
    }
    const recognition = new Recognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const text = event.results?.[0]?.[0]?.transcript || "";
      if (text) handleMessage(text);
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = (event) => {
      setListening(false);
      if (event?.error === "not-allowed" || event?.error === "service-not-allowed") {
        say("", "Allow the microphone, then tap Ask again.");
      }
    };
    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }, [handleMessage, listening, say]);

  const endJourney = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraState("idle");
    setRoute(null);
    setCursor(0);
    setDoneIds([]);
    setArrived(false);
    setDestination("");
    setScanStatus("");
    setView("camera");
    setPhase("welcome");
    setFinding(false);
    setHistory([]);
  }, []);

  const speakGuidance = useCallback(() => {
    if (speaking) {
      window.speechSynthesis?.cancel();
      setSpeaking(false);
      return;
    }
    const last = [...history].reverse().find((line) => line.role === "mate");
    speakNow(last?.text || OPENING);
  }, [history, speakNow, speaking]);

  if (phase === "welcome") {
    return (
      <main className="app">
        <section className="welcome" aria-labelledby="welcome-title">
          <div className="wordmark"><span className="wordmark__mark">M</span> SUBWAY MATE</div>
          <div className="welcome__content">
            <p className="kicker">ACCESSIBLE WAYFINDING</p>
            <h1 id="welcome-title">Move through the subway with confidence.</h1>
            <p className="welcome__copy">Live camera directions and clear, spoken guidance—one decision at a time.</p>
          </div>
          <div className="mode-list">
            <button className="mode-card mode-card--primary" onClick={beginDetect}>
              <span className="mode-card__icon"><Icon name="mic" /></span>
              <span><strong>Guide me by voice</strong><small>Ask where you want to go</small></span>
              <span aria-hidden="true">→</span>
            </button>
            <button className="mode-card" onClick={beginDetect}>
              <span className="mode-card__icon"><Icon name="send" /></span>
              <span><strong>Type my destination</strong><small>Use text and screen cues</small></span>
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (phase === "detecting") {
    return (
      <main className="app">
        <section className="welcome" aria-live="polite">
          <div className="wordmark"><span className="wordmark__mark">M</span> SUBWAY MATE</div>
          <div className="welcome__content">
            <p className="kicker">DETECTING LOCATION</p>
            <h1>42 St / 7 Av</h1>
            <p className="welcome__copy">Times Square / Broadway entrance</p>
          </div>
        </section>
      </main>
    );
  }

  const step = route?.beats?.[cursor];
  const tone = step?.tone || "forward";
  const label = arrowLabel(step);
  const mapCursor = route ? mapIndexFor(route, cursor) : 0;

  return (
    <main className="app app--active">
      <section className="stage">
        <header className="topbar">
          <div><span className="status-dot" /> LIVE AT <b>42 ST–TIMES SQUARE</b></div>
          {route ? (
            <div className="route-badges" aria-label="Active train">
              <span className={route.trainLine.startsWith("7") ? "is-seven" : ""}>
                {route.trainLine.startsWith("7") ? "7" : "1"}
              </span>
            </div>
          ) : <div className="route-badges" />}
        </header>

        {finding ? (
          <div className="route-setup">
            <p className="kicker">TRAIN</p>
            <h1>Finding the train</h1>
          </div>
        ) : route ? (
          <>
            {view === "camera" ? (
              <CameraStage
                videoRef={videoRef}
                cameraState={cameraState}
                heading={step?.heading}
                label={label}
                tone={tone}
                scanning={scanning}
                scanStatus={scanStatus}
                onReadSign={readSign}
                onEnableCamera={enableCamera}
              />
            ) : (
              <StationSchematic steps={route.steps} current={mapCursor} doneIds={doneIds} />
            )}
            <div className="view-toggle" aria-label="Navigation view">
              <button className={view === "camera" ? "is-active" : ""} onClick={() => setView("camera")}>
                <Icon name="camera" /> Camera
              </button>
              <button className={view === "map" ? "is-active" : ""} onClick={() => setView("map")}>
                <Icon name="map" /> Map
              </button>
            </div>
          </>
        ) : (
          <div className="route-setup">
            <span className="route-setup__compass">↑</span>
            <p className="kicker">42 ST AND 7 AV</p>
            <h1>Where do you want to go?</h1>
            <p>{OPENING}</p>
            <AskLine destination={destination} setDestination={setDestination} onSubmit={handleMessage} />
          </div>
        )}
      </section>

      <section className="drawer" aria-label="Subway Mate assistant">
        {route && (
          <JourneyCard
            route={route}
            steps={route.steps}
            current={mapCursor}
            doneIds={doneIds}
            onExit={endJourney}
          />
        )}
        <TwoLineChat history={history} speaking={speaking} onToggleSpeech={speakGuidance} scrollerRef={historyRef} />
        <div className="drawer__controls">
          <TextFallback onSend={handleMessage} />
          <VoiceButton listening={listening} onClick={toggleListening} />
        </div>
      </section>
    </main>
  );
}

export default App;
