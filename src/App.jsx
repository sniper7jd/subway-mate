import { useCallback, useEffect, useRef, useState } from "react";
import {
  ARRIVAL_LINE,
  OPENING,
  advanceStep,
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
  const rotation = tone === "arrive" ? 270 : (HEADING_TURN[heading] ?? 0);
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
      {cameraState === "ready" && <ArrowCue heading={heading} label={label} tone={tone} />}
      <div className="scan-control">
        <button onClick={onReadSign}>
          <Icon name="scan" />
          Read this sign
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

function arrowLabel(step, arrived) {
  if (arrived) return "ON YOUR LEFT · 5 MIN";
  if (step?.isOffPath) return `WALK BACK ${step.distance}`;
  return step?.distance || "";
}

export function App() {
  const [phase, setPhase] = useState("welcome");
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

  useEffect(() => { routeRef.current = route; }, [route]);
  useEffect(() => { cursorRef.current = cursor; }, [cursor]);
  useEffect(() => { doneRef.current = doneIds; }, [doneIds]);
  useEffect(() => { arrivedRef.current = arrived; }, [arrived]);

  useEffect(() => {
    if (videoRef.current && streamRef.current) videoRef.current.srcObject = streamRef.current;
  }, [route, view]);

  const speakNow = useCallback((line) => {
    if (!window.speechSynthesis || !line) return;
    window.speechSynthesis.resume();
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(line);
    utterance.rate = 0.95;
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
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
    speakNow("Detecting current location.");
    window.setTimeout(() => {
      setPhase("ask");
      setHistory([{ role: "mate", text: OPENING }]);
      speakNow(OPENING);
    }, 1200);
  }, [speakNow]);

  const enableCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCameraState("ready");
    } catch {
      setCameraState("denied");
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
    const result = replyFor(text, routeRef.current, cursorRef.current, arrivedRef.current);
    applyRouteResult(result);
    setDestination("");
    say(text, result.line);
  }, [applyRouteResult, say]);

  const readSign = useCallback(() => {
    const active = routeRef.current;
    if (!active) return;
    if (arrivedRef.current) {
      say("", ARRIVAL_LINE);
      return;
    }
    const result = advanceStep(active, cursorRef.current, doneRef.current);
    setCursor(result.cursor);
    setDoneIds(result.doneIds);
    setArrived(result.arrived);
    setScanStatus("");
    say("", result.line);
  }, [say]);

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
    recognition.onerror = () => setListening(false);
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
            <p className="kicker">LOCATING</p>
            <h1>Detecting current location</h1>
            <p className="welcome__copy">Checking which station entrance you are at.</p>
          </div>
        </section>
      </main>
    );
  }

  const step = route?.steps[cursor];
  const tone = arrived ? "arrive" : step?.isOffPath ? "back" : "forward";
  const label = arrowLabel(step, arrived);

  return (
    <main className="app app--active">
      <section className="stage">
        <header className="topbar">
          <div><span className="status-dot" /> LIVE AT <b>42 ST–TIMES SQUARE</b></div>
          <div className="route-badges" aria-label="Active train">
            <span className={route === null || route?.trainLine.startsWith("1") ? "" : "is-seven"}>
              {route?.trainLine.startsWith("7") ? "7" : "1"}
            </span>
          </div>
        </header>

        {route ? (
          <>
            {view === "camera" ? (
              <CameraStage
                videoRef={videoRef}
                cameraState={cameraState}
                heading={arrived ? "West" : step?.heading}
                label={label}
                tone={tone}
                scanning={scanning}
                scanStatus={scanStatus}
                onReadSign={readSign}
                onEnableCamera={enableCamera}
              />
            ) : (
              <StationSchematic steps={route.steps} current={cursor} doneIds={doneIds} />
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
            current={cursor}
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
