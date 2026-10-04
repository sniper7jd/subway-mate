import { useCallback, useEffect, useRef, useState } from "react";
import station from "../shared/times-square.json" with { type: "json" };
import {
  ARRIVAL_LINE,
  ENTRANCE_LINE,
  OPENING,
  advanceStep,
  chooseObservationCandidate,
  hasDestinationIntent,
  hasLostContext,
  matchObservation,
  matchSignText,
  mapIndexFor,
  observationClarificationLine,
  reportsLocation,
  rewindStep as rewindRouteStep,
  replyFor,
  requestedTripId,
  routeForTrip,
  startLine,
  tripNameForId,
  unrecognizedLocationLine,
} from "./mockRoutes.js";
import { readSignText, warmSignReader } from "./ocr.js";
import "./styles.css";

function Icon({ name }) {
  const paths = {
    camera: <><path d="M8 6 10 3h4l2 3h4v14H4V6h4Z" /><circle cx="12" cy="13" r="4" /></>,
    map: <><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z" /><path d="M9 3v15M15 6v15" /></>,
    mic: <><rect x="8" y="3" width="8" height="12" rx="4" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8" /></>,
    send: <path d="m3 4 18 8-18 8 3-8-3-8Zm3 8h15" />,
    sound: <><path d="M4 10v4h4l5 4V6l-5 4H4Z" /><path d="M16 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12" /></>,
  };
  return <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

export function AskLine({ destination, setDestination, stepFree, setStepFree, onSubmit, onStartAccessible }) {
  return (
    <form className="ask-line" onSubmit={(event) => { event.preventDefault(); onSubmit(destination); }}>
      <label htmlFor="destination">Where are you going? Or tell me what you can see.</label>
      <div className="ask-line__row">
        <input
          id="destination"
          value={destination}
          onChange={(event) => setDestination(event.target.value)}
          placeholder="e.g. Bronx, Queens, Grand Central"
          autoComplete="off"
        />
        <button type="submit" disabled={!destination.trim()} aria-label="Find route">
          <Icon name="send" />
        </button>
      </div>
      <label className="step-free-option">
        <input type="checkbox" checked={stepFree} onChange={(event) => setStepFree(event.target.checked)} />
        Step-free route (avoid stairs)
      </label>
      {stepFree && (
        <div className="step-free-shortcut">
          <p>The only mapped step-free platform route starts at the northwest-corner elevator (EL619), 43rd Street and Broadway, and goes to Uptown N/Q/R/W.</p>
          <button type="button" onClick={onStartAccessible}>
            I'm at EL619 — start that route
          </button>
          <small>Choose this only if you are physically at that elevator. Elevator inventory is not live status.</small>
        </div>
      )}
    </form>
  );
}

export function SignPhoto({ scan, readerState, onSelect, onSample, onConfirm, onClear, onRetry }) {
  const cameraInput = useRef(null);
  const galleryInput = useRef(null);
  const choose = (input) => {
    if (input.current) input.current.value = "";
    input.current?.click();
  };
  return (
    <section className="sign-photo" aria-label="Read a station sign from a photo">
      <div className="sign-photo__heading">
        <span className="sign-photo__icon"><Icon name="camera" /></span>
        <div>
          <strong>Lost? Check a sign photo</strong>
          <p>Reads visible words and numbers locally—not objects, colors, or logos. The photo is not uploaded.</p>
        </div>
      </div>
      <input
        ref={cameraInput}
        className="visually-hidden"
        type="file"
        accept="image/*"
        capture="environment"
        aria-label="Take a station sign photo"
        onChange={(event) => onSelect(event.target.files?.[0])}
      />
      <input
        ref={galleryInput}
        className="visually-hidden"
        type="file"
        accept="image/*"
        aria-label="Choose a station sign photo"
        onChange={(event) => onSelect(event.target.files?.[0])}
      />
      <div className="sign-photo__actions">
        <button type="button" onClick={() => choose(cameraInput)} disabled={scan?.status === "reading"}>
          Take a photo
        </button>
        <button type="button" onClick={() => choose(galleryInput)} disabled={scan?.status === "reading"}>
          Choose photo
        </button>
      </div>
      <details className="sign-photo__samples">
        <summary>Try a sample sign (works away from the station)</summary>
        <div>
          {[
            ["Uptown 1/2/3", "uptown.png"],
            ["Downtown 1/2/3", "downtown.png"],
            ["Queens 7", "seven-flushing.png"],
            ["Downtown N/R (should not match)", "downtown-brooklyn.png"],
            ["Blank wall (no match)", "blank.png"],
          ].map(([label, file]) => (
            <button key={file} type="button" disabled={scan?.status === "reading"} onClick={() => onSample(`/signs/${file}`)}>
              {label}
            </button>
          ))}
        </div>
      </details>
      {!scan && readerState?.status === "loading" && (
        <p className="sign-photo__reader" role="status" aria-live="polite">
          {readerState.label}{readerState.progress > 0 ? ` ${Math.round(readerState.progress * 100)}%` : ""}
          {" "}Preparing in the background; text directions are ready now.
        </p>
      )}
      {!scan && readerState?.status === "ready" && (
        <p className="sign-photo__reader">On-device sign reader ready.</p>
      )}
      {!scan && readerState?.status === "error" && (
        <div className="sign-photo__reader sign-photo__reader--error" role="alert">
          <p>The local sign reader could not start. Check the connection once so its files can load, then retry.</p>
          <button type="button" onClick={onRetry}>Retry sign reader</button>
        </div>
      )}
      {!scan && <p className="sign-photo__hint">For a faster, clearer read, fill the photo with one sign and hold steady.</p>}
      {scan && (
        <div className="sign-photo__result" aria-live="polite">
          <button className="sign-photo__clear" type="button" onClick={onClear}>Clear photo</button>
          {scan.previewUrl && <img src={scan.previewUrl} alt="Photo being checked for station sign text" />}
          {scan.status === "reading" && (
            <p role="status">{scan.progressLabel || "Reading sign text on this device…"}</p>
          )}
          {scan.status === "error" && (
            <>
              <p role="alert">{scan.error}</p>
              {readerState?.status === "error" && (
                <button type="button" onClick={onRetry}>Retry sign reader</button>
              )}
            </>
          )}
          {scan.status === "result" && (
            <>
              <p><b>Text read:</b> {scan.text || "No readable sign text found."}</p>
              {scan.confidence !== null && (
                <p className="sign-photo__confidence">
                  Text-reading confidence: {Math.round(scan.confidence)}%. This is not location certainty.
                </p>
              )}
              {scan.candidates.length ? (
                <>
                  <p>
                    Possible match{scan.candidates.length === 1 ? "" : "es"} in the station map:
                    {" "}{scan.candidates.map((node) => node.name).join("; ")}.
                    A directional sign may point somewhere else; confirm only if you are standing at this location.
                  </p>
                  {scan.matchedTerms?.length > 0 && (
                    <p className="sign-photo__confidence">Matched visible text: {scan.matchedTerms.join(", ")}.</p>
                  )}
                  <div className="sign-photo__matches">
                    {scan.candidates.map((node) => (
                      <button key={node.id} type="button" onClick={() => onConfirm(node)}>
                        I’m standing at {node.name}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <p>No safe match to a known station sign. Your location and directions have not changed. Try a clearer photo or describe a named landmark.</p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

export function JourneyCard({ route, steps, current, doneIds, onExit, elevatorNotice }) {
  const done = doneIds.length;
  return (
    <article className="journey-card">
      <div>
        <p className="kicker">TRAIN</p>
        <h2>{route.trainLine}</h2>
      </div>
      <button className="text-button" onClick={onExit}>End</button>
      <div className="journey-card__progress" aria-hidden="true">
        <span style={{ width: `${route.totalCheckpoints ? (done / route.totalCheckpoints) * 100 : route.alreadyAtDestination ? 100 : 0}%` }} />
      </div>
      <p>
        {route.platform}. {route.alreadyAtDestination ? "You are at the destination in the station map." : `${done} of ${route.totalCheckpoints} steps complete.`}
        {route.stepFree ? " Step-free route." : ""}
      </p>
      {elevatorNotice && <p className="journey-start-cues" role="status">{elevatorNotice}</p>}
      {route.startVisualCues?.length > 0 && (
        <p className="journey-start-cues">
          Starting-location cues: {route.startVisualCues.join("; ")}
        </p>
      )}
      <ol className="journey-steps">
        {steps.length ? steps.map((step, index) => (
          <li
            key={step.id}
            className={index === current ? "is-current" : doneIds.includes(step.id) ? "is-done" : ""}
          >
            {step.instruction}
            {step.visualCues?.length > 0 && (
              <small className="journey-visual-cue">Visual cues: {step.visualCues.join("; ")}</small>
            )}
          </li>
        )) : <li>You are at the destination platform recorded in the station map.</li>}
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
        {!steps.length && <p className="schematic__empty">You are at the matched destination location.</p>}
        {steps.map((step, index) => {
          const done = doneIds.includes(step.id);
          return (
            <div
              className={`schematic__node ${index === current ? "is-active" : ""} ${done ? "is-past" : ""}`}
              key={step.id}
            >
              <span className="schematic__dot">{done ? "✓" : index + 1}</span>
              <span className="schematic__detail">
                <b>{step.name}</b>
                <small>{step.edgeType} · {step.instruction}</small>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function CameraStage({
  videoRef,
  cameraState,
  step,
  arrived,
  arrivalLine,
  visionAvailable,
  visionAnalysis,
  onEnableCamera,
  onAnalyzeFrame,
  onConfirmVisionNode,
}) {
  return (
    <section className="camera-stage" aria-label="Current route guidance and optional camera preview">
      <video ref={videoRef} autoPlay muted playsInline />
      <div className="camera-stage__shade" />
      {cameraState !== "ready" && !step && (
        <div className="camera-empty">
          <span className="camera-empty__icon"><Icon name="camera" /></span>
          <strong>{cameraState === "denied" ? "Camera preview is unavailable" : "Camera preview is optional"}</strong>
          <p>Your route and spoken directions work without camera access. Preview only; use the sign-photo tool to read a sign locally.</p>
        </div>
      )}
      {cameraState === "ready" && step && (
        <div className="route-guidance" role="status">
          <span>{arrived ? "DIRECTIONS COMPLETE" : "STEP IN THE STATION FILE"}</span>
          <p>{arrived ? arrivalLine || ARRIVAL_LINE : step.instruction}</p>
          {!arrived && step.visualCues?.length > 0 && (
            <small className="route-guidance__cue">Visual cues: {step.visualCues.join("; ")}</small>
          )}
        </div>
      )}
      {!step && arrived && (
        <div className="route-guidance route-guidance--no-camera" role="status">
          <span>AT MATCHED DESTINATION</span>
          <p>{arrivalLine || "You said you are at this destination platform in the station map."}</p>
        </div>
      )}
      {cameraState !== "ready" && step && (
        <div className="route-guidance route-guidance--no-camera" role="status">
          <span>{arrived ? "DIRECTIONS COMPLETE" : "NEXT STEP"}</span>
          <p>{arrived ? arrivalLine || ARRIVAL_LINE : step.instruction}</p>
          {!arrived && step.visualCues?.length > 0 && (
            <small className="route-guidance__cue">Visual cues: {step.visualCues.join("; ")}</small>
          )}
        </div>
      )}
      {cameraState !== "ready" && (
        <button className="preview-button" onClick={onEnableCamera}>Enable optional camera preview</button>
      )}
      {cameraState === "ready" && (
        <div className="camera-preview-label">Preview only — no sign recognition</div>
      )}
      {cameraState === "ready" && (
        <div className="vision-assist">
          {visionAvailable ? (
            <>
              <button
                className="vision-assist__button"
                onClick={onAnalyzeFrame}
                disabled={visionAnalysis?.status === "analyzing"}
              >
                {visionAnalysis?.status === "analyzing" ? "Checking this frame…" : "Analyze this frame online"}
              </button>
              <p>This sends one still frame to the Subway Mate server and xAI. Video is not sent; the app does not save this frame. Use only if you're comfortable sharing it.</p>
              {visionAnalysis?.message && (
                <div className={`vision-assist__result${visionAnalysis.status === "error" ? " is-error" : ""}`} role="status">
                  <p>{visionAnalysis.message}</p>
                  {visionAnalysis.candidateIds?.map((id) => (
                    <button key={id} onClick={() => onConfirmVisionNode(id)}>
                      I'm physically at {station.nodes.find((node) => node.id === id)?.name || "this place"}
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p>Online visual help is not configured. The local sign reader and typed directions still work.</p>
          )}
        </div>
      )}
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

export function TextFallback({ onSend, locationKnown = false }) {
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
        <input
          id="fallback-input"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={locationKnown ? "“I see the green globe” or ask about this step" : "“I'm lost; I see the upper mezzanine”"}
        />
        <button disabled={!text.trim()} aria-label="Send message"><Icon name="send" /></button>
      </div>
    </form>
  );
}

function VoiceButton({ listening, onClick }) {
  return (
    <button
      type="button"
      className={`voice-button ${listening ? "is-listening" : ""}`}
      onClick={onClick}
      aria-label={listening ? "Stop listening" : "Ask Subway Mate"}
      aria-pressed={listening}
    >
      <Icon name="mic" />
      <span>{listening ? "Listening…" : "Ask"}</span>
    </button>
  );
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
  const [route, setRoute] = useState(null);
  const [cursor, setCursor] = useState(0);
  const [doneIds, setDoneIds] = useState([]);
  const [arrived, setArrived] = useState(false);
  const [destination, setDestination] = useState("");
  const [stepFree, setStepFree] = useState(false);
  const [equipmentStatuses, setEquipmentStatuses] = useState({});
  const [elevatorNotice, setElevatorNotice] = useState(
    `Using the station-file elevator inventory snapshot from ${station.mtaReference?.retrievedOn || "an unknown date"}; this is not live status.`,
  );
  const [knownLocation, setKnownLocation] = useState(null);
  const [locationNeeded, setLocationNeeded] = useState(false);
  const [history, setHistory] = useState([]);
  const [view, setView] = useState("camera");
  const [cameraState, setCameraState] = useState("idle");
  const [visionAvailable, setVisionAvailable] = useState(false);
  const [visionAnalysis, setVisionAnalysis] = useState({ status: "idle", message: "" });
  const [photoScan, setPhotoScan] = useState(null);
  const [readerState, setReaderState] = useState({ status: "idle", label: "", progress: 0 });
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const historyRef = useRef(null);
  const recognitionRef = useRef(null);
  const recorderRef = useRef(null);
  const recordingStreamRef = useRef(null);
  const recordingTimerRef = useRef(null);
  const voiceAttemptRef = useRef(0);
  const photoUrlRef = useRef(null);
  const photoScanIdRef = useRef(0);
  const routeRef = useRef(null);
  const cursorRef = useRef(0);
  const doneRef = useRef([]);
  const arrivedRef = useRef(false);
  const originRef = useRef(null);
  const pendingTripRef = useRef(null);
  const pendingLocationCandidatesRef = useRef([]);

  useEffect(() => { routeRef.current = route; }, [route]);
  useEffect(() => { cursorRef.current = cursor; }, [cursor]);
  useEffect(() => { doneRef.current = doneIds; }, [doneIds]);
  useEffect(() => { arrivedRef.current = arrived; }, [arrived]);
  useEffect(() => {
    let active = true;
    fetch("/api/health")
      .then((response) => {
        if (!response.ok) throw new Error(`Visual service status unavailable (${response.status})`);
        return response.json();
      })
      .then((health) => {
        if (active) setVisionAvailable(Boolean(health.vision));
      })
      .catch(() => {
        if (active) setVisionAvailable(false);
      });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    fetch("/api/mta/elevators")
      .then((response) => {
        if (!response.ok) throw new Error(`MTA inventory refresh failed (${response.status})`);
        return response.json();
      })
      .then((inventory) => {
        if (!active) return;
        setEquipmentStatuses(inventory.equipmentStatuses || {});
        const refreshedAt = Number.isFinite(inventory.fetchedAt)
          ? new Date(inventory.fetchedAt).toLocaleString()
          : "unknown time";
        setElevatorNotice(`${inventory.notice} Updated ${refreshedAt}.`);
      })
      .catch(() => {
        if (active) {
          setElevatorNotice(
            `Could not refresh MTA elevator inventory. Using the station-file snapshot from ${station.mtaReference?.retrievedOn || "an unknown date"}; confirm availability with staff.`,
          );
        }
      });
    return () => { active = false; };
  }, []);
  useEffect(() => () => {
    photoScanIdRef.current += 1;
    voiceAttemptRef.current += 1;
    if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
    recognitionRef.current?.abort?.();
    recorderRef.current?.stop?.();
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    window.clearTimeout(recordingTimerRef.current);
  }, []);

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

  const updateReaderProgress = useCallback(({ status, progress }) => {
    const label = status?.includes("language")
      ? "Loading the local English sign model…"
      : status?.includes("core")
        ? "Starting the local OCR engine…"
        : status?.includes("initializ")
          ? "Preparing the sign reader…"
          : status?.includes("recogniz")
            ? "Reading sign text on this device…"
            : "Preparing the local sign reader…";
    setReaderState({
      status: "loading",
      label,
      progress: Number.isFinite(progress) ? progress : 0,
    });
  }, []);

  const warmReader = useCallback(() => {
    setReaderState({ status: "loading", label: "Preparing the local sign reader…", progress: 0 });
    warmSignReader(updateReaderProgress).then(
      () => setReaderState({ status: "ready", label: "On-device sign reader ready.", progress: 1 }),
      () => setReaderState({ status: "error", label: "", progress: 0 }),
    );
  }, [updateReaderProgress]);

  const beginDetect = useCallback(() => {
    warmReader();
    window.speechSynthesis?.getVoices();
    const entrance = station.nodes.find((node) => node.id === "ent-42-7");
    if (!entrance) throw new Error("The configured 42nd Street and Seventh Avenue start node is missing.");
    originRef.current = entrance.id;
    pendingTripRef.current = null;
    pendingLocationCandidatesRef.current = [];
    setKnownLocation(entrance.name);
    setLocationNeeded(false);
    setPhase("ask");
    setHistory([{ role: "mate", text: OPENING }]);
    speakNow(ENTRANCE_LINE);
  }, [speakNow, warmReader]);

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

  const clearPhotoScan = useCallback(() => {
    photoScanIdRef.current += 1;
    if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
    photoUrlRef.current = null;
    setPhotoScan(null);
  }, []);

  const scanSignPhoto = useCallback(async (file) => {
    if (!file) return;
    const scanId = ++photoScanIdRef.current;
    if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
    photoUrlRef.current = null;
    if (!file.type.startsWith("image/")) {
      setPhotoScan({ status: "error", error: "Choose an image file to check a station sign." });
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      setPhotoScan({ status: "error", error: "That photo is over 12 MB. Choose a smaller image." });
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    photoUrlRef.current = previewUrl;
    setPhotoScan({ status: "reading", previewUrl, progressLabel: "Preparing the on-device text reader…" });
    try {
      const result = await readSignText(file, (message) => {
        if (scanId !== photoScanIdRef.current) return;
        updateReaderProgress(message);
        const percent = Number.isFinite(message.progress) ? ` ${Math.round(message.progress * 100)}%` : "";
        const label = message.status?.includes("recogniz")
          ? `Reading sign text on this device…${percent}`
          : `${message.status?.includes("language") ? "Loading the local sign model" : "Preparing the local sign reader"}…${percent}`;
        setPhotoScan((current) => current?.previewUrl === previewUrl
          ? { ...current, progressLabel: label }
          : current);
      });
      if (scanId !== photoScanIdRef.current) return;
      setReaderState({ status: "ready", label: "On-device sign reader ready.", progress: 1 });
      const match = matchSignText(result.text);
      setPhotoScan({
        status: "result",
        previewUrl,
        text: result.text,
        confidence: result.confidence,
        candidates: match.candidates,
        matchedTerms: match.matchedTerms,
      });
    } catch (error) {
      if (scanId !== photoScanIdRef.current) return;
      setReaderState({ status: "error", label: "", progress: 0 });
      setPhotoScan({
        status: "error",
        previewUrl,
        error: error instanceof Error && /too large|too long|timed out/i.test(error.message)
          ? error.message
          : "The local sign reader could not read this photo. Try a clear, well-lit, smaller image or describe a known landmark. Nothing was uploaded.",
      });
    }
  }, [updateReaderProgress]);

  const scanSampleSign = useCallback(async (path) => {
    clearPhotoScan();
    const scanId = photoScanIdRef.current;
    setPhotoScan({ status: "reading", progressLabel: "Loading the local sample image…" });
    try {
      const response = await fetch(path);
      if (!response.ok) throw new Error(`Sample image request failed with status ${response.status}.`);
      const blob = await response.blob();
      if (scanId !== photoScanIdRef.current) return;
      const file = new File([blob], path.split("/").at(-1) || "sample-sign.png", {
        type: blob.type || "image/png",
      });
      await scanSignPhoto(file);
    } catch {
      if (scanId !== photoScanIdRef.current) return;
      setPhotoScan({
        status: "error",
        error: "The built-in sample could not be loaded. Reload the app and try again.",
      });
    }
  }, [clearPhotoScan, scanSignPhoto]);

  const clearUncertainRoute = useCallback(() => {
    routeRef.current = null;
    setRoute(null);
    cursorRef.current = 0;
    setCursor(0);
    doneRef.current = [];
    setDoneIds([]);
    arrivedRef.current = false;
    setArrived(false);
    originRef.current = null;
    setKnownLocation(null);
    setLocationNeeded(true);
    setView("camera");
  }, []);

  const applyRouteResult = useCallback((result) => {
    if (result.route) {
      routeRef.current = result.route;
      setRoute(result.route);
      cursorRef.current = result.cursor ?? 0;
      setCursor(result.cursor ?? 0);
      doneRef.current = result.doneIds ?? [];
      setDoneIds(result.doneIds ?? []);
      arrivedRef.current = Boolean(result.arrived);
      setArrived(Boolean(result.arrived));
      setView("camera");
    } else {
      if (typeof result.cursor === "number") {
        cursorRef.current = result.cursor;
        setCursor(result.cursor);
      }
      if (result.doneIds) {
        doneRef.current = result.doneIds;
        setDoneIds(result.doneIds);
      }
      if (typeof result.arrived === "boolean") {
        arrivedRef.current = result.arrived;
        setArrived(result.arrived);
      }
    }
  }, []);

  const startAccessibleRoute = useCallback(() => {
    const startNodeId = "ent-43-broadway";
    const nextRoute = routeForTrip("nqrw-uptown", {
      startNodeId,
      stepFree: true,
      equipmentStatuses,
    });
    if (!nextRoute) {
      say("", "I can't verify a working step-free route right now. Check elevator availability with station staff before moving.");
      return;
    }
    originRef.current = startNodeId;
    setKnownLocation(nextRoute.startLocation);
    setLocationNeeded(false);
    setStepFree(true);
    setDestination("");
    applyRouteResult({ route: nextRoute, cursor: 0, doneIds: [], arrived: false });
    say("", startLine(nextRoute));
  }, [applyRouteResult, equipmentStatuses, say]);

  useEffect(() => {
    const active = routeRef.current;
    if (!active) return;
    const updated = routeForTrip(active.tripId, {
      startNodeId: active.startNodeId,
      stepFree: active.stepFree,
      equipmentStatuses,
    });
    const pathKey = (candidate) => candidate?.steps
      .map((step) => `${step.fromNodeId}>${step.nodeId}:${step.edgeType}`)
      .join("|");
    if (!updated || pathKey(updated) !== pathKey(active)) {
      clearUncertainRoute();
      say("", "The refreshed elevator inventory changes this route. I've stopped guidance; confirm a station sign or landmark before choosing another path.");
      return;
    }
    routeRef.current = updated;
    setRoute(updated);
  }, [clearUncertainRoute, equipmentStatuses, say]);

  const handleMessage = useCallback((text) => {
    clearPhotoScan();
    const active = routeRef.current;
    const requestedTrip = hasDestinationIntent(text) ? requestedTripId(text) : null;
    if (requestedTrip) pendingTripRef.current = requestedTrip;
    const clarifiedLocation = pendingLocationCandidatesRef.current.length
      ? chooseObservationCandidate(pendingLocationCandidatesRef.current, text)
      : null;
    const observation = clarifiedLocation
      ? { node: clarifiedLocation, candidates: [clarifiedLocation] }
      : matchObservation(text);
    if (observation.candidates.length > 1) {
      clearUncertainRoute();
      pendingLocationCandidatesRef.current = observation.candidates;
      setDestination("");
      const destinationReminder = pendingTripRef.current
        ? ` I'll keep your destination: ${tripNameForId(pendingTripRef.current)}.`
        : "";
      say(text, `${observationClarificationLine(observation.candidates)}${destinationReminder}`);
      return;
    }
    const observedNode = observation.node;
    if (observedNode) pendingLocationCandidatesRef.current = [];
    if (!observedNode && hasLostContext(text) && (!active || reportsLocation(text))) {
      clearUncertainRoute();
      setDestination("");
      say(text, unrecognizedLocationLine(
        text,
        pendingTripRef.current ? tripNameForId(pendingTripRef.current) : "",
      ));
      return;
    }
    if (!observedNode && !active && originRef.current === null && matchRoute(text)) {
      setDestination("");
      say(text, "I don't know where you are in the station, so I won't send you from the entrance by assumption. Describe a known sign or landmark you can see first.");
      return;
    }
    if (observedNode) {
      originRef.current = observedNode.id;
      setKnownLocation(observedNode.name);
      setLocationNeeded(false);
      if (!active && pendingTripRef.current && !hasDestinationIntent(text)) {
        const pendingRoute = routeForTrip(pendingTripRef.current, {
          startNodeId: observedNode.id,
          stepFree,
          equipmentStatuses,
        });
        if (pendingRoute) {
          pendingTripRef.current = null;
          pendingLocationCandidatesRef.current = [];
          setDestination("");
          applyRouteResult({ route: pendingRoute, cursor: 0, doneIds: [], arrived: pendingRoute.alreadyAtDestination });
          say(text, startLine(pendingRoute));
          return;
        }
        const pendingDestination = tripNameForId(pendingTripRef.current);
        pendingTripRef.current = null;
        const unavailable = stepFree
          ? replyFor(`step-free to ${pendingDestination}`, null, 0, false, {
            startNodeId: observedNode.id,
            stepFree: true,
            equipmentStatuses,
          }).line
          : `I matched your location to ${observedNode.name}, but the local map has no verified path from there to ${pendingDestination}. I won't guess; ask station staff or describe another known station sign.`;
        setDestination("");
        say(text, unavailable);
        return;
      }
      if (!active && !hasDestinationIntent(text)) {
        setDestination("");
        say(text, `I matched your description to ${observedNode.name} in the Times Square station file. Where are you trying to go? I can route only where the station map has a path.`);
        return;
      }
    }
    const result = replyFor(text, active, cursorRef.current, arrivedRef.current, {
      stepFree,
      startNodeId: observedNode?.id || originRef.current,
      locationObserved: Boolean(observedNode),
      doneIds: doneRef.current,
      equipmentStatuses,
    });
    setDestination("");
    if (result.route) {
      pendingTripRef.current = null;
      pendingLocationCandidatesRef.current = [];
      originRef.current = result.route.startNodeId;
      setKnownLocation(result.route.startLocation);
      setLocationNeeded(false);
    } else if (result.locationMatched) {
      originRef.current = result.locationMatched;
      routeRef.current = null;
      setRoute(null);
      cursorRef.current = 0;
      setCursor(0);
      doneRef.current = [];
      setDoneIds([]);
      arrivedRef.current = false;
      setArrived(false);
      setView("camera");
    }
    applyRouteResult(result);
    say(text, result.line);
  }, [applyRouteResult, clearPhotoScan, clearUncertainRoute, equipmentStatuses, say, stepFree]);

  const confirmStep = useCallback(() => {
    const active = routeRef.current;
    if (!active) return;
    if (arrivedRef.current) {
      say("", active.arrivalLine || ARRIVAL_LINE);
      return;
    }
    const result = advanceStep(active, cursorRef.current, doneRef.current);
    cursorRef.current = result.cursor;
    doneRef.current = result.doneIds;
    arrivedRef.current = result.arrived;
    setCursor(result.cursor);
    setDoneIds(result.doneIds);
    setArrived(result.arrived);
    say("", result.line);
  }, [say]);

  const goBackOneStep = useCallback(() => {
    const active = routeRef.current;
    if (!active) return;
    const result = rewindRouteStep(active, cursorRef.current, doneRef.current, arrivedRef.current);
    cursorRef.current = result.cursor;
    doneRef.current = result.doneIds;
    arrivedRef.current = result.arrived;
    setCursor(result.cursor);
    setDoneIds(result.doneIds);
    setArrived(result.arrived);
    say("", result.line);
  }, [say]);

  const confirmPhotoLocation = useCallback((node) => {
    const active = routeRef.current;
    setVisionAnalysis({ status: "idle", message: "" });
    originRef.current = node.id;
    setKnownLocation(node.name);
    setLocationNeeded(false);
    clearPhotoScan();
    if (!active) {
      if (pendingTripRef.current) {
        const pendingRoute = routeForTrip(pendingTripRef.current, {
          startNodeId: node.id,
          stepFree,
          equipmentStatuses,
        });
        if (pendingRoute) {
          pendingTripRef.current = null;
          setDestination("");
          applyRouteResult({ route: pendingRoute, cursor: 0, doneIds: [], arrived: pendingRoute.alreadyAtDestination });
          say("", startLine(pendingRoute));
          return;
        }
        const pendingDestination = tripNameForId(pendingTripRef.current);
        pendingTripRef.current = null;
        setDestination("");
        say("", `I matched you to ${node.name}, but the local map has no verified path from there to ${pendingDestination}. I won't guess. Tell me another destination or describe a different mapped location.`);
        return;
      }
      setDestination("");
      say("", `You confirmed you are standing at ${node.name}. Where are you trying to go?`);
      return;
    }
    const result = replyFor("Where am I?", active, cursorRef.current, arrivedRef.current, {
      stepFree: active.stepFree || stepFree,
      startNodeId: node.id,
      locationObserved: true,
      equipmentStatuses,
    });
    if (!result.route && result.locationMatched) {
      routeRef.current = null;
      setRoute(null);
      cursorRef.current = 0;
      setCursor(0);
      doneRef.current = [];
      setDoneIds([]);
      arrivedRef.current = false;
      setArrived(false);
      setView("camera");
    }
    applyRouteResult(result);
    say("", result.line);
  }, [applyRouteResult, clearPhotoScan, equipmentStatuses, say, stepFree]);

  const analyzeCameraFrame = useCallback(async () => {
    const video = videoRef.current;
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) {
      const message = "The camera frame isn't ready yet. Wait a moment and try again.";
      setVisionAnalysis({ status: "error", message });
      say("", message);
      return;
    }
    const scale = Math.min(1, 1024 / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) {
      const message = "This browser couldn't prepare the camera frame. Use the local sign-photo reader instead.";
      setVisionAnalysis({ status: "error", message });
      say("", message);
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageDataUrl = canvas.toDataURL("image/jpeg", 0.78);
    setVisionAnalysis({ status: "analyzing", message: "" });
    try {
      const response = await fetch("/api/vision-cue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageDataUrl }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `Visual analysis failed (${response.status})`);
      const accepted = {
        status: "result",
        message: result.message,
        candidateIds: result.candidateIds || [],
        visibleText: result.visibleText || "",
      };
      setVisionAnalysis(accepted);
      say("", accepted.message);
    } catch (error) {
      const message = error instanceof Error
        ? `${error.message} No location was changed. Try the local sign reader or describe what you can see.`
        : "Online visual assistance failed. No location was changed; try the local sign reader or describe the clue.";
      setVisionAnalysis({ status: "error", message });
      say("", message);
    }
  }, [say]);

  const toggleListening = useCallback(() => {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
      return;
    }
    if (!Recognition) {
      if (listening) {
        voiceAttemptRef.current += 1;
        setListening(false);
        return;
      }
      if (!window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) {
        say("", "This browser cannot take voice input. Type your destination or question instead.");
        return;
      }
      const attempt = ++voiceAttemptRef.current;
      setListening(true);
      fetch("/api/health")
        .then((response) => {
          if (!response.ok) throw new Error("The voice service is unavailable.");
          return response.json();
        })
        .then(async (health) => {
          if (attempt !== voiceAttemptRef.current) return;
          if (!health.grok) {
            setListening(false);
            say("", "Browser voice recognition is unavailable, and server transcription is not configured. Type your destination or question instead.");
            return;
          }
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          if (attempt !== voiceAttemptRef.current) {
            stream.getTracks().forEach((track) => track.stop());
            return;
          }
          recordingStreamRef.current = stream;
          const recorder = new MediaRecorder(stream);
          const chunks = [];
          recorder.ondataavailable = (event) => {
            if (event.data?.size) chunks.push(event.data);
          };
          recorder.onerror = () => {
            window.clearTimeout(recordingTimerRef.current);
            recordingTimerRef.current = null;
            setListening(false);
            stream.getTracks().forEach((track) => track.stop());
            recordingStreamRef.current = null;
            recorderRef.current = null;
            say("", "The recording failed. Please try again or type your message.");
          };
          recorder.onstop = async () => {
            window.clearTimeout(recordingTimerRef.current);
            recordingTimerRef.current = null;
            setListening(false);
            recorderRef.current = null;
            stream.getTracks().forEach((track) => track.stop());
            recordingStreamRef.current = null;
            const audio = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
            if (!audio.size) {
              say("", "I didn't receive any audio. Tap Ask and try again.");
              return;
            }
            try {
              const audioDataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => typeof reader.result === "string"
                  ? resolve(reader.result)
                  : reject(new Error("Could not read the voice recording."));
                reader.onerror = () => reject(new Error("Could not read the voice recording."));
                reader.readAsDataURL(audio);
              });
              const response = await fetch("/api/transcribe", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ audioDataUrl }),
              });
              const result = await response.json().catch(() => ({}));
              if (!response.ok) throw new Error(result.error || "Voice transcription failed.");
              if (!result.text?.trim()) {
                say("", "I couldn't hear words clearly. Try again or type your message.");
                return;
              }
              handleMessage(result.text.trim());
            } catch (error) {
              say("", `${error.message || "Voice transcription failed."} You can type your message instead.`);
            }
          };
          recorderRef.current = recorder;
          recorder.start();
          setHistory((prev) => [...prev, { role: "mate", text: "Listening. Tap Stop when you have finished speaking." }].slice(-40));
          recordingTimerRef.current = window.setTimeout(() => {
            if (recorder.state === "recording") {
              setHistory((prev) => [...prev, { role: "mate", text: "Recording stopped after 15 seconds." }].slice(-40));
              recorder.stop();
            }
          }, 15000);
        })
        .catch((error) => {
          if (attempt === voiceAttemptRef.current) {
            setListening(false);
            recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
            recordingStreamRef.current = null;
            say("", `${error.message || "Voice input is unavailable."} Type your destination or question instead.`);
          }
        });
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
      const text = event.results?.[event.resultIndex || 0]?.[0]?.transcript || "";
      if (text) handleMessage(text);
    };
    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };
    recognition.onerror = (event) => {
      setListening(false);
      recognitionRef.current = null;
      const messages = {
        "not-allowed": "Allow microphone access in your browser, then tap Ask again.",
        "service-not-allowed": "This browser blocked speech recognition. Type your message instead.",
        "no-speech": "I didn't hear anything. Tap Ask and try again.",
        "audio-capture": "I can't access a microphone. Check your device settings or type your message.",
        network: "Browser speech recognition needs a network connection. Reconnect or type your message.",
      };
      say("", messages[event?.error] || "Voice recognition stopped unexpectedly. Try again or type your message.");
    };
    recognitionRef.current = recognition;
    setListening(true);
    try {
      recognition.start();
    } catch (error) {
      recognitionRef.current = null;
      setListening(false);
      say("", `${error.message || "Could not start voice recognition."} Try again or type your message.`);
    }
  }, [handleMessage, listening, say]);

  const endJourney = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraState("idle");
    setRoute(null);
    routeRef.current = null;
    setCursor(0);
    cursorRef.current = 0;
    setDoneIds([]);
    doneRef.current = [];
    setArrived(false);
    arrivedRef.current = false;
    setDestination("");
    setStepFree(false);
    setKnownLocation(null);
    setLocationNeeded(false);
    originRef.current = null;
    pendingTripRef.current = null;
    pendingLocationCandidatesRef.current = [];
    setView("camera");
    setPhase("welcome");
    setHistory([]);
    clearPhotoScan();
  }, [clearPhotoScan]);

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
            <p className="welcome__copy">Local station directions and clear, spoken guidance—one step at a time. Camera preview is optional.</p>
          </div>
          <div className="mode-list">
            <button className="mode-card mode-card--primary" onClick={beginDetect}>
              <span className="mode-card__icon"><Icon name="mic" /></span>
              <span><strong>Guide me by voice</strong><small>Ask where you want to go</small></span>
              <span aria-hidden="true">→</span>
            </button>
            <button className="mode-card" onClick={beginDetect}>
              <span className="mode-card__icon"><Icon name="send" /></span>
              <span><strong>Type a destination or landmark</strong><small>Tell me where you're going or what you see</small></span>
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </section>
      </main>
    );
  }

  const step = route?.steps?.[cursor];
  const mapCursor = route ? mapIndexFor(route, cursor) : 0;

  return (
    <main className="app app--active">
      <section className="stage">
        <header className="topbar">
          <div><span className="status-dot" /> MAP START <b>{route?.startLocation || knownLocation || "LOCATION NOT CONFIRMED"}</b></div>
          {route ? (
            <div className="route-badges" aria-label="Active train">
              <span className={route.lineBadge === "7" ? "is-seven" : ""}>
                {route.lineBadge}
              </span>
            </div>
          ) : <div className="route-badges" />}
        </header>

        {route ? (
          <>
            {view === "camera" ? (
              <CameraStage
                videoRef={videoRef}
                cameraState={cameraState}
                step={step}
                arrived={arrived}
                arrivalLine={route.arrivalLine}
                visionAvailable={visionAvailable}
                visionAnalysis={visionAnalysis}
                onEnableCamera={enableCamera}
                onAnalyzeFrame={analyzeCameraFrame}
                onConfirmVisionNode={(id) => {
                  const node = station.nodes.find((item) => item.id === id);
                  if (node) confirmPhotoLocation(node);
                }}
              />
            ) : (
              <StationSchematic steps={route.steps} current={mapCursor} doneIds={doneIds} />
            )}
            <div className="view-toggle" aria-label="Navigation view">
              <button className={view === "camera" ? "is-active" : ""} onClick={() => setView("camera")}>
                <Icon name="camera" /> Preview
              </button>
              <button className={view === "map" ? "is-active" : ""} onClick={() => setView("map")}>
                <Icon name="map" /> Map
              </button>
            </div>
            <div className="step-controls">
              <button
                className="step-back"
                onClick={goBackOneStep}
                disabled={cursor === 0 && !arrived}
                aria-label="Go back one direction step"
              >
                Back one step
              </button>
              <button className="confirm-step" onClick={confirmStep} disabled={arrived}>
                {arrived ? "Directions complete" : cursor === route.steps.length - 1 ? "Confirm final step" : "I've completed this step"}
              </button>
            </div>
          </>
        ) : (
          <div className="route-setup">
            <span className="route-setup__compass" aria-hidden="true">M</span>
            <p className="kicker">42 ST AND 7 AV</p>
            <h1>Where do you want to go?</h1>
            <p>{locationNeeded
              ? "I can't confirm where you are from that description. Tell me a specific sign, street corner, or landmark you can see."
              : knownLocation
              ? `Starting from ${knownLocation}. If you're somewhere else in the station, tell me a sign or landmark you can see.`
              : `${OPENING} Lost already? Describe a named station sign or landmark you can see.`}</p>
            <p className="observation-hint">
              Lost? Describe a cue I know: {station.visualCueGuidance.recognized.join(", ")}.
              Turnstiles and unnamed signs aren't unique—include the nearest line and direction.
            </p>
            <AskLine
              destination={destination}
              setDestination={setDestination}
              stepFree={stepFree}
              setStepFree={setStepFree}
              onSubmit={handleMessage}
              onStartAccessible={startAccessibleRoute}
            />
            <SignPhoto
              scan={photoScan}
              readerState={readerState}
              onSelect={scanSignPhoto}
              onSample={scanSampleSign}
              onConfirm={confirmPhotoLocation}
              onClear={clearPhotoScan}
              onRetry={warmReader}
            />
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
            elevatorNotice={elevatorNotice}
          />
        )}
        {route && (
          <SignPhoto
            scan={photoScan}
            readerState={readerState}
            onSelect={scanSignPhoto}
            onSample={scanSampleSign}
            onConfirm={confirmPhotoLocation}
            onClear={clearPhotoScan}
            onRetry={warmReader}
          />
        )}
        <TwoLineChat history={history} speaking={speaking} onToggleSpeech={speakGuidance} scrollerRef={historyRef} />
        <div className="drawer__controls">
          <TextFallback onSend={handleMessage} locationKnown={Boolean(knownLocation)} />
          <VoiceButton listening={listening} onClick={toggleListening} />
        </div>
      </section>
    </main>
  );
}

export default App;
