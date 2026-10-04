export const PROFILES = {
  tourist: { id: "tourist", label: "Tourist", input: "both", output: "both" },
  lowVision: { id: "lowVision", label: "Low vision", input: "both", output: "speech" },
  deaf: { id: "deaf", label: "Deaf or hard of hearing", input: "camera", output: "screen" },
  wheelchair: { id: "wheelchair", label: "Wheelchair", input: "both", output: "both" },
};

export const FACINGS = ["straight", "left", "right", "behind"];

const STALE_MS = 3 * 60 * 1000;

export function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9& ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function nodeById(station, id) {
  return station.nodes.find((node) => node.id === id) || null;
}

export function tripById(station, id) {
  return station.trips.find((trip) => trip.id === id) || null;
}

function sentenceFor(node, trip, profile) {
  const correct = node.id === trip.correctNodeId;
  if (profile === "wheelchair" && node.accessible === false) {
    return node.accessibleInstruction || node.reject;
  }
  return correct ? node.follow : node.reject;
}

export function buildLocalManifest(station, tripId, profile) {
  const trip = tripById(station, tripId);
  if (!trip) {
    throw new Error(`Unknown trip: ${tripId}`);
  }
  const safeProfile = PROFILES[profile] ? profile : "tourist";
  const steps = trip.stepIds.map((id) => {
    const node = nodeById(station, id);
    if (!node) throw new Error(`Unknown node: ${id}`);
    return {
      nodeId: node.id,
      name: node.name,
      expectedText: node.expectedText,
      landmarks: node.landmarks,
      accessible: node.accessible,
      minutesToPlatform: node.minutesToPlatform,
      instruction: sentenceFor(node, trip, safeProfile),
      turns: node.turns,
    };
  });
  return {
    tripId: trip.id,
    title: trip.title,
    profile: safeProfile,
    summary: trip.summary,
    destinationKey: trip.correctNodeId,
    minutesToPlatform: trip.minutesToPlatform,
    arrivalQuery: trip.arrival,
    steps,
    arrivals: null,
    source: "station-file",
    createdAt: new Date().toISOString(),
  };
}

export function findPath(station, startId, endId, options = {}) {
  const stepFree = Boolean(options.stepFree);
  const edges = (station.edges || []).filter((edge) => !(stepFree && edge.type === "stairs"));
  const nodeIds = new Set((station.nodes || []).map((node) => node.id));
  for (const edge of edges) {
    nodeIds.add(edge.from);
    nodeIds.add(edge.to);
  }
  if (!nodeIds.has(startId) || !nodeIds.has(endId)) return [];
  const distances = {};
  const previous = {};
  const unvisited = new Set(nodeIds);
  for (const id of nodeIds) distances[id] = Infinity;
  distances[startId] = 0;
  while (unvisited.size > 0) {
    let current = null;
    for (const id of unvisited) {
      if (current === null || distances[id] < distances[current]) current = id;
    }
    if (current == null || distances[current] === Infinity || current === endId) break;
    unvisited.delete(current);
    for (const edge of edges) {
      if (edge.from !== current || !unvisited.has(edge.to)) continue;
      const alt = distances[current] + (Number(edge.weight) || 1);
      if (alt < distances[edge.to]) {
        distances[edge.to] = alt;
        previous[edge.to] = { node: current, edge };
      }
    }
  }
  if (startId !== endId && !previous[endId]) return [];
  const path = [];
  let cursor = endId;
  while (previous[cursor]) {
    path.unshift(previous[cursor].edge);
    cursor = previous[cursor].node;
  }
  return path;
}

export function applyRoute(station, manifest, startId = "ent-42-7") {
  const signs = manifest.steps;
  const stepFree = manifest.profile === "wheelchair" || manifest.tripId === "enter-accessible";
  const route = findPath(station, startId, manifest.destinationKey, { stepFree });
  if (!route.length) return { ...manifest, signs, routeStart: startId };
  const steps = route.map((edge) => {
    const node = nodeById(station, edge.to) || {};
    return {
      nodeId: edge.to,
      name: node.name || edge.to,
      expectedText: node.expectedText || [],
      landmarks: node.landmarks || [],
      accessible: edge.type !== "stairs",
      instruction: edge.instruction,
      edgeType: edge.type,
    };
  });
  return { ...manifest, signs, steps, routeStart: startId };
}

export function applyGrokPhrases(localManifest, grokJson) {
  if (!grokJson || !Array.isArray(grokJson.steps)) return localManifest;
  const allowed = new Set(localManifest.steps.map((step) => step.nodeId));
  const phrases = new Map();
  for (const step of grokJson.steps) {
    if (!step || !allowed.has(step.nodeId)) continue;
    if (typeof step.sentence === "string" && step.sentence.trim()) {
      phrases.set(step.nodeId, step.sentence.trim());
    }
  }
  const wheelchair = localManifest.profile === "wheelchair";
  const steps = localManifest.steps.map((step) => {
    const sentence = phrases.get(step.nodeId);
    if (!sentence) return step;
    if (wheelchair && step.accessible === false && /follow these stairs|take the stairs|go down/i.test(sentence)) {
      return step;
    }
    return { ...step, instruction: sentence };
  });
  const summary = typeof grokJson.summary === "string" && grokJson.summary.trim()
    ? grokJson.summary.trim()
    : localManifest.summary;
  return { ...localManifest, steps, summary, source: "grok" };
}

export function interpretSign(text, manifest) {
  const norm = normalizeText(text);
  if (!norm) return { kind: "empty" };
  let best = null;
  for (const step of manifest.steps) {
    const hits = step.expectedText.filter((token) => norm.includes(token));
    if (!hits.length) continue;
    const score = hits.reduce((sum, token) => sum + token.length, 0);
    if (!best || score > best.score) best = { step, score };
  }
  if (!best) return { kind: "unknown", text: norm };
  const correct = best.step.nodeId === manifest.destinationKey;
  const blocked = manifest.profile === "wheelchair" && best.step.accessible === false;
  return {
    kind: "match",
    nodeId: best.step.nodeId,
    sentence: correct && !blocked ? "You're good. Follow this." : best.step.instruction,
  };
}

export function blankWallSentence(manifest, lastNodeId, facing) {
  if (!lastNodeId) return "Find a sign.";
  const step = manifest.steps.find((item) => item.nodeId === lastNodeId) || manifest.steps[0];
  const safeFacing = FACINGS.includes(facing) ? facing : "straight";
  return step.turns[safeFacing] || step.instruction;
}

export function relativeFacing(referenceHeading, currentHeading) {
  if (!Number.isFinite(referenceHeading) || !Number.isFinite(currentHeading)) return null;
  const diff = (currentHeading - referenceHeading + 360) % 360;
  if (diff > 315 || diff <= 45) return "straight";
  if (diff <= 135) return "right";
  if (diff <= 225) return "behind";
  return "left";
}

export function arrivalSentence(manifest, now = Date.now()) {
  const arrivals = manifest?.arrivals;
  if (!arrivals?.next?.length) return "";
  const age = now - arrivals.fetchedAt;
  if (!Number.isFinite(arrivals.fetchedAt) || age > STALE_MS) return "";
  const walk = manifest.minutesToPlatform ?? 4;
  const upcoming = arrivals.next
    .map((item) => ({
      label: item.label,
      minutes: Math.max(0, Math.round((item.at - now) / 60000)),
    }))
    .sort((a, b) => a.minutes - b.minutes);
  const first = upcoming[0];
  const second = upcoming[1];
  const ride = first.minutes >= walk ? first : second;
  if (!ride) return "";
  return `The ${ride.label} is the train you can catch. It is in ${minutesLabel(ride.minutes)}.`;
}

const PLAN_LINES = {
  "downtown-123": "Take the downtown 1, 2, or 3 toward Brooklyn. That train goes to One World Trade Center.",
  "uptown-123": "Take the uptown 1, 2, or 3 toward the Bronx. That train goes toward Riverdale.",
  "queens-7": "Take the 7 toward Queens. That train goes to Flushing.",
  "shuttle-grand-central": "Take the shuttle toward Grand Central.",
  "enter-accessible": "Take the step-free way to the downtown 1, 2, or 3. That train goes to One World Trade Center.",
};

export function spokenPlan(manifest) {
  const lead = PLAN_LINES[manifest?.tripId] || "Stay on the path through Times Square.";
  const base = `${lead} Follow the signs through Times Square. I will tell you when the camera sees the right one.`;
  const ride = arrivalSentence(manifest);
  return ride ? `${base} ${ride}` : base;
}

export function displayPlan(manifest) {
  const short = {
    "downtown-123": "Downtown 1 to One World Trade Center",
    "uptown-123": "Uptown 1 toward the Bronx",
    "queens-7": "7 toward Queens",
    "shuttle-grand-central": "Shuttle to Grand Central",
    "enter-accessible": "Step-free to the downtown 1",
  };
  return short[manifest?.tripId] || "Follow the path";
}

function minutesLabel(count) {
  return `${count} ${count === 1 ? "minute" : "minutes"}`;
}

export function matchDestination(text) {
  const q = String(text || "").toLowerCase();
  const stepFree = /step[-\s]?free|wheelchair|elevator|accessible|no stairs/.test(q);
  let tripId = null;
  if (/queens|flushing|7 train|\b7\b/.test(q)) tripId = "queens-7";
  else if (/grand central|shuttle/.test(q)) tripId = "shuttle-grand-central";
  else if (/world trade|one wtc|\bwtc\b|cortlandt|downtown|brooklyn/.test(q)) {
    tripId = stepFree ? "enter-accessible" : "downtown-123";
  } else if (/bronx|uptown/.test(q)) tripId = "uptown-123";
  return { tripId, profile: stepFree || tripId === "enter-accessible" ? "wheelchair" : "tourist" };
}

const BEARINGS = ["north", "east", "south", "west"];

export function guessEntrance(text) {
  const q = String(text || "").toLowerCase();
  if (/mcdonald/.test(q)) return "ent-42-7";
  if (/baskin|robins|robbins/.test(q)) return "ent-broadway-plaza";
  if (/40/.test(q) && /broadway/.test(q)) return "ent-40-broadway";
  if (/40/.test(q) && (/7|seventh/.test(q))) return "ent-40-7";
  if (/broadway plaza|43rd|42nd and 43/.test(q)) return "ent-broadway-plaza";
  if (/42/.test(q) && (/7|seventh/.test(q))) return "ent-42-7";
  return null;
}

export function guessFacing(text) {
  const q = String(text || "").toLowerCase();
  const hit = BEARINGS.find((bearing) => q.includes(bearing));
  return hit || null;
}

export function relativeTurn(facing, target) {
  if (!BEARINGS.includes(facing) || !BEARINGS.includes(target)) return null;
  const delta = (BEARINGS.indexOf(target) - BEARINGS.indexOf(facing) + 4) % 4;
  return ["straight", "right", "around", "left"][delta];
}

export function trainHeading(tripId) {
  return {
    "uptown-123": "1 2 3 uptown, north platform",
    "downtown-123": "1 2 3 downtown, south platform",
    "queens-7": "7 toward Queens, east platform",
    "shuttle-grand-central": "S toward Grand Central, east",
    "enter-accessible": "1 2 3 downtown, by elevator",
  }[tripId] || "Your train";
}

export function shortRide(station, tripId, entranceId) {
  const trip = tripById(station, tripId);
  const entrance = station.layout?.entrances?.find((item) => item.id === entranceId);
  const from = entrance ? entrance.name : "the upper mezzanine under 42nd Street";
  const ride = {
    "uptown-123": "the uptown 1 toward the Bronx",
    "downtown-123": "the downtown 1 toward Brooklyn and the World Trade Center",
    "queens-7": "the 7 toward Queens",
    "shuttle-grand-central": "the shuttle toward Grand Central",
    "enter-accessible": "the downtown 1, step-free",
  }[tripId] || trip?.title || "your train";
  return `Take ${ride}. Start at ${from}.`;
}

export function localGuide({ station, tripId, facing, entranceId }) {
  const trip = tripById(station, tripId);
  const train = station.layout?.trains?.[trip?.correctNodeId];
  const entrance = station.layout?.entrances?.find((item) => item.id === entranceId);
  const target = train?.bearing || "north";
  const approach = train?.approach || trip?.summary || "Follow the signs for your train.";
  const from = entrance ? `From ${entrance.name}. ${entrance.note}` : "From the upper mezzanine under 42nd Street.";
  const turn = relativeTurn(facing, target);
  let text = `${from} ${approach}`;
  if (!facing) {
    text += " Which way are you facing: north, east, south, or west?";
  } else if (turn === "straight") {
    text += ` You are already facing ${target}. Walk that way.`;
  } else if (turn === "around") {
    text += ` You are facing ${facing}. Turn around so you face ${target}.`;
  } else if (turn) {
    text += ` You are facing ${facing}. Turn ${turn} so you face ${target}.`;
  }
  return { text, compass: target };
}

export function deliverPlan(output) {
  return {
    show: output === "screen" || output === "both" || output === "speech",
    speak: output === "speech" || output === "both",
  };
}
