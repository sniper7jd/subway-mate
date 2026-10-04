import station from "../shared/times-square.json" with { type: "json" };
import { findPath, normalizeText, tripById } from "../shared/guidance.js";

const START_ID = station.layout.entrances[0].graphId;
const ACCESSIBILITY_TERMS = /\b(step[- ]?free|wheelchair|elevator|accessible|no stairs)\b/i;
const DESTINATION_INTENT = /\b(to|toward|towards|want|need|going|headed|take me|help me get|trying to get)\b/i;
const DESTINATION_REQUEST = /\b(?:take me to|help me get to|trying to get to|want to go to|need to get to|going to|headed to|heading to|go to|towards?|bound for)\b/i;
const OBSERVATION_CUE = /\b(i see|i can see|i(?:'m| am) looking at|i(?:'m| am) lost|i am lost|i am at|i'm at|i am by|i'm by|i am near|i'm near|i am on|i'm on|standing by|standing near|standing at|there is|there's)\b/i;
const LOST_CONTEXT = /\b(?:lost|i see|i can see|i(?:'m| am) looking at|i(?:'m| am) (?:at|by|near|on)|standing (?:by|near|at)|where am i|around me|near me)\b/i;
const LOCATION_REPORT = /\b(?:lost|i see|i can see|i(?:'m| am) looking at|i(?:'m| am) (?:at|by|near|on)|standing (?:by|near|at)|around me|near me)\b/i;
const NEEDS_RECOVERY = /\b(?:lost|can't find|cannot find|don't see|do not see|not sure where|confused|stuck)\b/i;
const BACK_ONE_STEP = /^(?:go back(?: one step)?|back one step|previous step|undo(?: that)?)\.?$/i;
const TRAIN_TIME = /\b(?:when(?: is| are|'s)?|how (?:long|soon)|what time|minutes away|arrival time|train time)\b/i;
const STEP_CONFIRMATION = /^(?:(?:okay|ok)[, ]*)?(?:i(?:'m| am) (?:there|here)|i(?:'ve| have) (?:done|completed) (?:that|this step)|that(?:'s| is) done|done with (?:that|this step)|i reached (?:it|there))\.?$/i;
const ELEVATOR_STATUS_QUESTION = /\b(?:elevator status|elevators? (?:working|in service|out of service|open|broken|down)|is (?:the |an )?elevator|are the elevators)\b|\bel\d{3}x?\b/i;
const NON_LOCATION_TERMS = new Set([
  "uptown",
  "bronx",
  "downtown",
  "brooklyn",
  "queens",
  "flushing",
  "north",
  "south",
  "east",
  "west",
  "stairs",
  "elevator",
  "train",
  "platform",
]);
const SIGN_DESTINATION_TERMS = new Set([
  "uptown",
  "bronx",
  "downtown",
  "brooklyn",
  "queens",
  "flushing",
  "stairs",
]);

export const OPENING = `Where would you like to go from ${station.stationName}?`;
export const ENTRANCE_LINE = OPENING;
export const ARRIVAL_LINE = "You have reached the end of the directions in this station. Follow the train and platform signs before boarding.";

function resolveTrip(text) {
  const query = normalizeText(text);
  if (!query) return null;
  const aliases = [
    ...Object.entries(station.aliases).map(([alias, tripId]) => ({ alias, tripId })),
    ...station.trips.flatMap((trip) => (trip.aliases || []).map((alias) => ({ alias, tripId: trip.id }))),
  ]
    .map(({ alias, tripId }) => ({ alias: normalizeText(alias), tripId }))
    .filter((item) => item.alias && item.tripId !== "enter-accessible")
    .sort((left, right) => right.alias.length - left.alias.length);
  const match = aliases.find(({ alias }) => ` ${query} `.includes(` ${alias} `));
  return match ? tripById(station, match.tripId) : null;
}

function resolveRequestedTrip(text) {
  const request = String(text || "");
  const intent = DESTINATION_REQUEST.exec(request);
  if (intent) {
    const requestedDestination = resolveTrip(request.slice(intent.index + intent[0].length));
    if (requestedDestination) return requestedDestination;
  }
  return resolveTrip(request);
}

function containsPhrase(query, phrase) {
  const normalized = normalizeText(phrase);
  return normalized.length >= 3 && ` ${query} `.includes(` ${normalized} `);
}

function observationPhrases(node) {
  return [
    node.name,
    ...(node.observationAliases || []),
    ...(node.landmarks || []),
    ...(node.level && node.level.split(" ").length > 1 ? [node.level] : []),
  ].filter(Boolean);
}

function stepInstruction(edge, node, index) {
  const prefix = index === 0 ? "First, " : "Next, ";
  const stopName = node.name.toLowerCase();
  const confirmation = `Stop when you reach ${stopName}. Then tell me “I'm there” or tap “I've completed this step.”`;
  const action = edge.instruction.replace(/^[A-Z]/, (letter) => letter.toLowerCase());
  return `${prefix}${action} ${confirmation}`;
}

export function matchObservation(text) {
  const observationText = String(text || "").split(DESTINATION_REQUEST, 1)[0].trim();
  const query = normalizeText(observationText);
  if (!query) return { node: null, candidates: [] };
  const describedSign = OBSERVATION_CUE.test(observationText)
    && /\b(sign|platform|train|bullet|roundel)\b/i.test(observationText);
  const hasLocationCue = OBSERVATION_CUE.test(observationText);
  const queryMarkers = query.split(" ");
  const reportedLineMarkers = ["1", "2", "3", "7", "n", "q", "r", "w"]
    .filter((marker) => queryMarkers.includes(marker));
  const scores = new Map();
  for (const node of station.nodes) {
    const lineMarkers = node.lineMarkers || [];
    if (reportedLineMarkers.length && lineMarkers.length
      && !reportedLineMarkers.some((marker) => lineMarkers.includes(marker.toUpperCase()))) continue;
    const explicitAnchors = observationPhrases(node);
    let score = explicitAnchors.reduce((best, phrase) =>
      containsPhrase(query, phrase) ? Math.max(best, 20 + normalizeText(phrase).length) : best, 0);
    if (describedSign) {
      for (const expected of node.expectedText || []) {
        if (!containsPhrase(query, expected)) continue;
        const normalizedExpected = normalizeText(expected);
        if (NON_LOCATION_TERMS.has(normalizedExpected)
          && !SIGN_DESTINATION_TERMS.has(normalizedExpected)) continue;
        score = Math.max(score, 12 + normalizedExpected.length);
      }
      if (reportedLineMarkers.some((marker) => lineMarkers.includes(marker.toUpperCase()))) {
        score = Math.max(score, 14);
      }
    }
    if (score > 0) scores.set(node.id, { node, score });
  }
  for (const entrance of station.layout.entrances) {
    const node = station.nodes.find((item) => item.id === entrance.graphId);
    if (!node) continue;
    const score = (entrance.nearby || []).reduce((best, value) => {
      return containsPhrase(query, value) ? Math.max(best, 25 + normalizeText(value).length) : best;
    }, 0);
    if (score > (scores.get(node.id)?.score || 0)) scores.set(node.id, { node, score });
  }

  const ranked = [...scores.values()].sort((left, right) => right.score - left.score);
  const best = ranked[0];
  if (!best) return { node: null, candidates: [] };
  if (!hasLocationCue && !station.nodes.some((node) =>
    [...observationPhrases(node), ...(station.layout.entrances
      .find((entrance) => entrance.graphId === node.id)?.nearby || [])]
      .some((value) => normalizeText(value) === query),
  )) return { node: null, candidates: [] };
  const candidates = ranked.filter((item) => item.score === best.score);
  if (candidates.length > 1) {
    return { node: null, candidates: candidates.map((item) => item.node) };
  }
  return { node: best.node, candidates: [best.node] };
}

export function matchSignText(text) {
  const query = normalizeText(text);
  if (!query) return { node: null, candidates: [], matchedTerms: [], observedMarkers: [] };

  const words = query.split(" ");
  const numberWords = { one: "1", two: "2", three: "3", seven: "7" };
  const observedMarkers = [...new Set(words.flatMap((word) => {
    const normalized = numberWords[word] || word;
    if (["1", "2", "3", "7"].includes(normalized)) return [normalized];
    if (["n", "q", "r", "w"].includes(normalized)) return [normalized.toUpperCase()];
    if (["nr", "nq", "qr", "rw", "nqr", "nrw", "qrw", "nqrw"].includes(normalized)) {
      return [...normalized.toUpperCase()];
    }
    return [];
  }))];

  const ranked = station.nodes.flatMap((node) => {
    const lineMarkers = node.lineMarkers || [];
    if (!lineMarkers.some((marker) => observedMarkers.includes(marker))) return [];
    if (observedMarkers.some((marker) => !lineMarkers.includes(marker))) return [];

    const matchedTerms = [...new Set((node.expectedText || [])
      .filter((term) => {
        const normalized = normalizeText(term);
        return normalized.length >= 4 && ` ${query} `.includes(` ${normalized} `);
      }))];
    if (!matchedTerms.length) return [];
    return [{ node, matchedTerms }];
  });

  if (ranked.length) {
    const best = ranked;
    return {
      node: best.length === 1 ? best[0].node : null,
      candidates: best.map((item) => item.node),
      matchedTerms: best.length === 1 ? best[0].matchedTerms : [],
      observedMarkers,
    };
  }

  const entranceMatches = station.layout.entrances.flatMap((entrance) => {
    const matchedTerms = (entrance.nearby || []).filter((term) =>
      ` ${query} `.includes(` ${normalizeText(term)} `),
    );
    if (!matchedTerms.length) return [];
    const node = station.nodes.find((item) => item.id === entrance.graphId);
    return node ? [{ node, matchedTerms }] : [];
  });
  if (entranceMatches.length) {
    return {
      node: entranceMatches.length === 1 ? entranceMatches[0].node : null,
      candidates: entranceMatches.map((item) => item.node),
      matchedTerms: entranceMatches.length === 1 ? entranceMatches[0].matchedTerms : [],
      observedMarkers,
    };
  }

  const visualCueMatches = station.nodes.flatMap((node) => {
    const knownMarkers = node.lineMarkers || (node.expectedText || [])
      .map((term) => normalizeText(term).toUpperCase())
      .filter((term) => /^([1-3]|7|[NQRW])$/.test(term));
    if (observedMarkers.some((marker) => !knownMarkers.includes(marker))) return [];
    const matchedTerms = (node.photoCueText || []).filter((term) => containsPhrase(query, term));
    return matchedTerms.length ? [{ node, matchedTerms }] : [];
  });
  return {
    node: visualCueMatches.length === 1 ? visualCueMatches[0].node : null,
    candidates: visualCueMatches.map((item) => item.node),
    matchedTerms: visualCueMatches.length === 1 ? visualCueMatches[0].matchedTerms : [],
    observedMarkers,
  };
}

export function hasDestinationIntent(text) {
  return DESTINATION_INTENT.test(text);
}

export function hasLostContext(text) {
  return LOST_CONTEXT.test(text);
}

export function reportsLocation(text) {
  return LOCATION_REPORT.test(text);
}

export function observationClarificationLine(candidates) {
  const ids = new Set(candidates.map((node) => node.id));
  if (ids.has("seven-stairs") && ids.has("seven-platform")) {
    return "The purple 7 marker can be by the stairs or on the platform. Are you at the stairs marked 7, or already at the 7 platform? Tell me which, and I'll guide the next step.";
  }
  if (ids.has("nqrw-mezz") && ids.has("nqrw-uptown")) {
    return "EL230 is mentioned at both the mezzanine and uptown platform. Are you beside the EL230 elevator, or standing on the platform? Read the nearest sign if you're unsure.";
  }
  const choices = candidates.map((node) => node.name).join(" or ");
  return `That clue could mean ${choices}. Read the nearest sign's direction and train letters/numbers so I can choose the right place.`;
}

export function chooseObservationCandidate(candidates, text) {
  const query = normalizeText(text);
  const ids = new Set(candidates.map((node) => node.id));
  if (ids.has("seven-stairs") && ids.has("seven-platform")) {
    if (/\b(?:stairs?|stairway|staircase|landing)\b/.test(query) && !/\bplatform\b/.test(query)) {
      return station.nodes.find((node) => node.id === "seven-stairs") || null;
    }
    if (/\bplatform\b/.test(query)) {
      return station.nodes.find((node) => node.id === "seven-platform") || null;
    }
  }
  if (ids.has("uptown-123") && ids.has("downtown-123")) {
    if (/\b(?:uptown|bronx|northbound)\b/.test(query)) {
      return station.nodes.find((node) => node.id === "uptown-123") || null;
    }
    if (/\b(?:downtown|brooklyn|southbound)\b/.test(query)) {
      return station.nodes.find((node) => node.id === "downtown-123") || null;
    }
  }
  return null;
}

export function unrecognizedLocationLine(text = "", destination = "") {
  const destinationContext = destination ? `I can help you reach ${destination}, but I can't identify your location from that alone. ` : "";
  if (/\b(?:lost|can't find|cannot find|don't see|do not see|not sure where|confused|stuck)\b/i.test(text)) {
    const caution = /\b(turnstiles?|fare gates?|ticket machines?|metrocard machines?)\b/i.test(text)
      ? "Turnstiles and ticket machines appear in more than one area, so don't use them alone. "
      : "";
    return `${destinationContext}Pause somewhere safe. ${caution}What's the nearest landmark or sign? You can say “the green globe,” “Uptown/Bronx 1 2 3,” “Downtown/Brooklyn 1 2 3,” “purple 7 bullet,” “McDonald's,” or “Baskin-Robbins.” If none match, tell me the exact words, train number or letter, and direction on the nearest sign. I'll use only mapped clues and guide you from there.`;
  }
  if (/\b(turnstiles?|fare gates?|ticket machines?|metrocard machines?)\b/i.test(text)) {
    return `${destinationContext}Turnstiles and ticket machines appear in more than one area, so I can't use them alone to locate you. What does the nearest train sign say—include its line number or letter and Uptown/Downtown, Queens, or Brooklyn? A street corner, exit name, or specific shop name can help too.`;
  }
  if (/\b(shop|store|restaurant|food|counter)\b/i.test(text)) {
    return `${destinationContext}I can match the McDonald's by 42nd Street and Seventh Avenue or Baskin-Robbins by the Broadway plaza. I don't have a map for every shop. What's the exact name, or what line and direction are on the nearest sign?`;
  }
  if (/\bsign(?:age)?\b/i.test(text)) {
    return `${destinationContext}I can't place that sign yet. Read its line number or letter and direction (for example, 1/2/3 Uptown or 7 to Queens), or tell me a street corner, exit name, or elevator code.`;
  }
  if (/\b(?:broadway|street|avenue|42nd|43rd|40th)\b/i.test(text)) {
    return `${destinationContext}That street name alone isn't enough to identify the entrance. What's the cross street or corner? If you're underground, tell me the nearest sign's line and direction.`;
  }
  return `${destinationContext}I don't recognize that location yet, so I won't guess. Read me the nearest sign's direction and train letters/numbers, or tell me a street corner or elevator code.`;
}

function makeRoute(trip, stepFree, startNodeId = START_ID, equipmentStatuses = {}) {
  const targetId = trip.correctNodeId;
  const startNode = station.nodes.find((node) => node.id === startNodeId);
  const targetNode = station.nodes.find((node) => node.id === targetId);
  if (!startNode) throw new Error(`Unknown route start node: ${startNodeId}`);
  if (stepFree && (startNode.accessible === false || targetNode?.accessible === false)) return null;
  const assetStatuses = {
    ...Object.fromEntries((station.elevatorAssets || []).map((asset) => [asset.equipmentCode, asset.serviceStatusCode])),
    ...equipmentStatuses,
  };
  const unavailableEquipment = Object.entries(assetStatuses)
    .filter(([, status]) => status !== "IFIS")
    .map(([equipmentCode]) => equipmentCode);
  const path = findPath(station, startNodeId, targetId, { stepFree, unavailableEquipment });
  if (!path.length && startNodeId !== targetId) return null;

  const steps = path.map((edge, index) => {
    const node = station.nodes.find((item) => item.id === edge.to);
    if (!node) throw new Error(`Station edge points to unknown node: ${edge.to}`);
    return {
      id: `${index}:${edge.from}:${edge.to}:${edge.type}`,
      fromNodeId: edge.from,
      nodeId: node.id,
      name: node.name,
      level: node.level,
      expectedText: node.expectedText,
      lineMarkers: node.lineMarkers || [],
      visualCues: node.visualCues || [],
      edgeType: edge.type,
      equipmentCode: edge.equipmentCode || null,
      instruction: stepInstruction(edge, node, index),
    };
  });
  const destinationNode = station.nodes.find((node) => node.id === targetId);

  return {
    tripId: trip.id,
    destination: trip.title,
    trainLine: trip.arrival?.label || trip.title,
    lineBadge: trip.arrival?.lines?.[0] || "",
    startNodeId,
    startLocation: startNode.name,
    startVisualCues: startNode.visualCues || [],
    platform: destinationNode?.level || "Platform information is not in the station file.",
    stepFree,
    arrivalLine: trip.boardingInstruction || "You are at the platform. Check the train's line and direction sign before boarding.",
    totalCheckpoints: steps.length,
    steps,
    alreadyAtDestination: startNodeId === targetId,
  };
}

function firstStepLine(route) {
  return route.steps[0]?.instruction || "Follow the station signs to your train.";
}

function destinationName(route) {
  const names = {
    "uptown-123": "the Bronx",
    "downtown-123": "Downtown",
    "brooklyn-atlantic": "Atlantic Av–Barclays Center in Brooklyn",
    "queens-7": "Queens",
    "shuttle-grand-central": "Grand Central",
    "nqrw-uptown": "uptown N/Q/R/W",
  };
  return names[route.tripId] || route.destination;
}

function unsupportedDestinationLine(text) {
  const destinations = station.trips
    .filter((trip) => trip.id !== "enter-accessible")
    .map((trip) => trip.title)
    .join("; ");
  if (ACCESSIBILITY_TERMS.test(text)) {
    return `Step-free is a route option. Tell me a destination and I will avoid stairs where the station graph has a path. I can guide you to: ${destinations}.`;
  }
  return `I can't map that destination using this station's local directions. I can guide you to: ${destinations}.`;
}

function elevatorStatusPhrase(code) {
  if (code === "IFIS") return "listed in service";
  if (code === "RNOS") return "listed out of service";
  if (code === "UNKNOWN") return "missing from the latest inventory";
  return `listed as ${code}`;
}

export function elevatorInventoryLine(text, equipmentStatuses = {}) {
  const asked = [...String(text || "").toUpperCase().matchAll(/\bEL\d{3}X?\b/g)].map((match) => match[0]);
  const assets = station.elevatorAssets || [];
  const chosen = asked.length
    ? assets.filter((asset) => asked.includes(asset.equipmentCode))
    : assets;
  if (!chosen.length) {
    return "I don't have that elevator in the Times Square inventory. I can check EL619, EL231X, EL230, EL229, EL233, and EL232. This is not a live outage check.";
  }
  if (asked.length) {
    const details = chosen.map((asset) => {
      const code = equipmentStatuses[asset.equipmentCode] || asset.serviceStatusCode;
      const where = (asset.connects || []).join(" to ");
      return `${asset.equipmentCode} (${where}) is ${elevatorStatusPhrase(code)}`;
    });
    return `${details.join(". ")}. This is the MTA elevator inventory, not a live outage check. Confirm with station staff before you rely on it.`;
  }
  const inService = [];
  const unavailable = [];
  for (const asset of chosen) {
    const code = equipmentStatuses[asset.equipmentCode] || asset.serviceStatusCode;
    (code === "IFIS" ? inService : unavailable).push(asset.equipmentCode);
  }
  return `In the MTA inventory, ${inService.join(", ") || "none"} are listed in service. ${unavailable.join(", ") || "None"} are listed out of service or missing. This is not a live outage check. Confirm with station staff before you rely on one.`;
}

function stepFreeUnavailableLine(startNode, destination) {
  const startName = startNode?.name || "this location";
  return `No verified step-free path from ${startName} to ${destination}. The only mapped step-free platform route is Uptown N/Q/R/W from elevator EL619 at the northwest corner of 43rd Street and Broadway. Use that route only if you are standing there.`;
}

export function matchRoute(text, options = {}) {
  const trip = resolveRequestedTrip(text);
  if (!trip) return null;
  const stepFree = Boolean(options.stepFree || ACCESSIBILITY_TERMS.test(text));
  return makeRoute(trip, stepFree, options.startNodeId || START_ID, options.equipmentStatuses);
}

export function requestedTripId(text) {
  return resolveRequestedTrip(text)?.id || null;
}

export function tripNameForId(tripId) {
  return tripById(station, tripId)?.title || "";
}

export function routeForTrip(tripId, options = {}) {
  const trip = tripById(station, tripId);
  if (!trip) return null;
  return makeRoute(
    trip,
    Boolean(options.stepFree),
    options.startNodeId || START_ID,
    options.equipmentStatuses,
  );
}

export function startLine(route) {
  if (route.alreadyAtDestination) {
    return route.arrivalLine;
  }
  const location = route.startNodeId === START_ID
    ? ""
    : `You're at ${route.startLocation}. `;
  return `${location}Let's get to ${destinationName(route)} one step at a time. ${firstStepLine(route)}`;
}

export function mapIndexFor(route, cursor) {
  if (!route?.steps?.length) return 0;
  return Math.max(0, Math.min(cursor, route.steps.length - 1));
}

export function advanceStep(route, cursor, doneIds = []) {
  const steps = route.steps;
  const current = steps[cursor];
  const done = new Set(doneIds);
  if (!current) {
    return { cursor, doneIds: [...done], arrived: true, line: route.arrivalLine || ARRIVAL_LINE, tone: "arrive" };
  }
  done.add(current.id);
  const nextIndex = cursor + 1;
  if (nextIndex >= steps.length) {
    return { cursor, doneIds: [...done], arrived: true, line: route.arrivalLine || ARRIVAL_LINE, tone: "arrive" };
  }
  const next = steps[nextIndex];
  return {
    cursor: nextIndex,
    doneIds: [...done],
    arrived: false,
    line: next.instruction,
    tone: "forward",
  };
}

export function rewindStep(route, cursor, doneIds = [], arrived = false) {
  if (!route.steps.length) {
    return { cursor, doneIds: [...doneIds], arrived: false, line: "You are already at the starting location." };
  }
  const targetIndex = arrived ? route.steps.length - 1 : cursor - 1;
  if (targetIndex < 0) {
    return { cursor, doneIds: [...doneIds], arrived: false, line: "You're at the first step already. Follow the current direction when you're ready." };
  }
  const done = new Set(doneIds);
  done.delete(route.steps[targetIndex].id);
  return {
    cursor: targetIndex,
    doneIds: [...done],
    arrived: false,
    line: `Let's go back one step. ${route.steps[targetIndex].instruction}`,
  };
}

function isDestinationOnly(text) {
  const query = normalizeText(text).replace(/^the\s+/, "");
  return Object.entries(station.aliases).some(([alias, tripId]) =>
    tripId !== "enter-accessible" && normalizeText(alias) === query,
  ) || station.trips.some((trip) =>
    trip.id !== "enter-accessible"
      && [trip.title, ...(trip.aliases || [])].some((alias) => normalizeText(alias) === query),
  );
}

function currentRouteNode(route, cursor, arrived) {
  if (arrived) return route.steps.at(-1)?.nodeId || route.startNodeId;
  return cursor > 0 ? route.steps[cursor - 1]?.nodeId || route.startNodeId : route.startNodeId;
}

function lookForLine(step) {
  if (!step) return ARRIVAL_LINE;
  const cue = step.visualCues?.find((item) => !/out of service|not verified/i.test(item));
  const markers = [...new Set([
    ...(step.lineMarkers || []),
    ...(step.expectedText || []).filter((item) => normalizeText(item).length > 3),
  ])].slice(0, 4);
  const signHint = markers.length ? ` The sign should include ${markers.join(", ")}.` : "";
  return `Look for ${cue || step.name}.${signHint} Stop at ${step.name}, then tell me when you're there.`;
}

export function isStepConfirmation(text) {
  const spokenText = String(text || "").replace(/[‘’]/g, "'");
  return STEP_CONFIRMATION.test(spokenText.trim());
}

export function asksForTrainTime(text) {
  return TRAIN_TIME.test(String(text || ""));
}

export function nextTrainLine(arrivals, now = Date.now()) {
  if (!arrivals?.next?.length) return "";
  const age = now - arrivals.fetchedAt;
  if (!Number.isFinite(arrivals.fetchedAt) || age > 3 * 60 * 1000) return "";
  const upcoming = arrivals.next
    .map((item) => ({
      label: item.label,
      minutes: Math.round((item.at - now) / 60000),
    }))
    .filter((item) => item.label && Number.isFinite(item.minutes))
    .sort((left, right) => left.minutes - right.minutes)
    .slice(0, 2);
  if (!upcoming.length) return "";
  const phrase = upcoming.map((item) => {
    if (item.minutes <= 0) return `${item.label} arriving now`;
    if (item.minutes === 1) return `${item.label} in 1 minute`;
    return `${item.label} in ${item.minutes} minutes`;
  }).join(", then ");
  const place = arrivals.stationName ? ` at ${arrivals.stationName}` : "";
  return `Next${place}: ${phrase}. Check the train sign before you board.`;
}

function lineWithTrainTimes(line, arrivals) {
  const times = nextTrainLine(arrivals);
  return times ? `${line} ${times}` : line;
}

export function replyFor(text, route, cursor, arrived, options = {}) {
  const stepFree = Boolean(options.stepFree || ACCESSIBILITY_TERMS.test(text));
  const picked = matchRoute(text, { ...options, stepFree });
  if (hasLostContext(text) && reportsLocation(text)) {
    const observation = matchObservation(text);
    if (!observation.node && observation.candidates.length === 0) {
      return { line: unrecognizedLocationLine(text, route ? destinationName(route) : "") };
    }
  }
  const spokenText = String(text || "").replace(/[‘’]/g, "'");
  const askingTimes = asksForTrainTime(text);
  if (route && !arrived && isStepConfirmation(spokenText)) {
    const result = advanceStep(route, cursor, options.doneIds || []);
    if (result.arrived) result.line = lineWithTrainTimes(result.line, options.arrivals);
    return result;
  }
  if (BACK_ONE_STEP.test(spokenText.trim())) {
    if (!route) return { line: "There's no step to undo yet. Tell me where you want to go." };
    return rewindStep(route, cursor, options.doneIds || [], arrived);
  }
  if (ELEVATOR_STATUS_QUESTION.test(text)) {
    return { line: elevatorInventoryLine(text, options.equipmentStatuses) };
  }
  const query = normalizeText(text);
  if (!route && /\b(?:hello|hi|hey)\b/.test(query)) {
    return { line: `Hi. Where would you like to go from ${station.stationName}? You can ask for the Bronx, Queens, Downtown, or Brooklyn.` };
  }
  if (!route && /\b(?:help|what can you do|where can you take me)\b/.test(query)) {
    return {
      line: "I can guide you from 42nd Street and Seventh Avenue to the Bronx (1/2/3), Queens (7), Downtown (1/2/3), or Atlantic Av–Barclays Center in Brooklyn (2 or 3). Step-free guidance is mapped only from EL619 to uptown N/Q/R/W.",
    };
  }
  if (!route && NEEDS_RECOVERY.test(text)) {
    return { line: unrecognizedLocationLine(text) };
  }
  if (!route) {
    if (!picked) {
      if (hasLostContext(text)) return { line: unrecognizedLocationLine(text) };
      const trip = resolveRequestedTrip(text);
      const startNode = station.nodes.find((node) => node.id === (options.startNodeId || START_ID));
      if (trip?.startNodeId && startNode?.id !== trip.startNodeId) {
        const requiredStart = station.nodes.find((node) => node.id === trip.startNodeId);
        if (stepFree) {
          return {
            line: `For step-free ${trip.title}, the mapped route starts at elevator EL619, at the northwest corner of 43rd Street and Broadway. Use it only if you are there.`,
          };
        }
        return {
          line: `I can guide you to ${trip.title} from ${requiredStart?.name || "its mapped entrance"}. Are you at that elevator?`,
        };
      }
      if (trip && startNode) {
        if (stepFree) {
          return {
            line: stepFreeUnavailableLine(startNode, trip.title),
            locationMatched: startNode.id,
          };
        }
        return {
          line: `I matched your description to ${startNode.name}, but the local station map has no ${stepFree ? "step-free " : ""}path from there to ${trip.title}. I won't guess the way.`,
          locationMatched: startNode.id,
        };
      }
      if (askingTimes) {
        return { line: "Tell me where you're going, such as the Bronx, Queens, or Brooklyn, and I'll check the next trains." };
      }
      return { line: unsupportedDestinationLine(text) };
    }
    let line = startLine(picked);
    if (askingTimes) {
      const times = nextTrainLine(options.arrivals);
      line = times ? `${line} ${times}` : `${line} I can't get live train times right now.`;
    }
    return { route: picked, cursor: 0, doneIds: [], arrived: false, line };
  }

  if (route && askingTimes) {
    const times = nextTrainLine(options.arrivals);
    if (!times) {
      return { line: `I can't get live train times right now. ${route.arrivalLine || ARRIVAL_LINE}` };
    }
    const walking = arrived ? "" : "You're still on the way. ";
    return { line: `${walking}${times}` };
  }

  if (options.locationObserved && options.startNodeId) {
    const trip = (hasDestinationIntent(text) && resolveRequestedTrip(text)) || tripById(station, route.tripId);
    const replanned = trip && makeRoute(trip, stepFree || route.stepFree, options.startNodeId, options.equipmentStatuses);
    if (!replanned) {
      const node = station.nodes.find((item) => item.id === options.startNodeId);
      if (stepFree || route.stepFree) {
        return {
          line: stepFreeUnavailableLine(node, trip?.title || route.destination),
          locationMatched: node?.id,
        };
      }
      return {
        line: `I matched your description to ${node?.name || "a station location"}, but the local station map has no onward path to ${trip?.title || route.trainLine}. I won't guess the way.`,
        locationMatched: node?.id,
      };
    }
    return {
      route: replanned,
      cursor: 0,
      doneIds: [],
      arrived: replanned.alreadyAtDestination,
      line: startLine(replanned),
    };
  }

  if (isDestinationOnly(text) && picked && picked.tripId !== route.tripId) {
    return { route: picked, cursor: 0, doneIds: [], arrived: false, line: startLine(picked) };
  }

  if (NEEDS_RECOVERY.test(text)) {
    return {
      line: `Pause somewhere safe. I can't locate you from that alone. Tell me the words and train number or letter on the nearest sign, or use Check a sign photo. I won't guess a new direction.`,
    };
  }
  if (/\b(where am i|where am i now|current location)\b/.test(query)) {
    const node = station.nodes.find((item) => item.id === currentRouteNode(route, cursor, arrived));
    return {
      line: node
        ? `Your last confirmed point is ${node.name}. You're going to ${destinationName(route)}.`
        : "I can't confirm your exact position. Tell me what sign or landmark you can see.",
    };
  }
  if (/\b(?:what sign|which sign|what (?:do|should) i look for|what does .*look like|landmark|visual cue)\b/.test(query)) {
    return { line: lookForLine(arrived ? null : route.steps[cursor]) };
  }
  if (/\b(?:which way|where do i go|how do i get there|what do i do now)\b/.test(query)) {
    const step = route.steps[cursor];
    return { line: step?.instruction || route.arrivalLine || ARRIVAL_LINE };
  }
  if (/\b(?:am i going (?:the )?right way|is this the right way)\b/.test(query)) {
    const step = route.steps[cursor];
    return {
      line: step
        ? `I can't see your exact position, but the mapped next step is: ${step.instruction}`
        : route.arrivalLine || ARRIVAL_LINE,
    };
  }
  if (/\b(train|line|which one|which should i board|what should i board)\b/.test(query)) {
    return {
      line: `Your mapped destination is ${route.trainLine}, at ${route.platform}. At the platform, ${route.arrivalLine}`,
    };
  }
  if (/\bplatform\b/.test(query)) {
    return {
      line: `Your destination is ${route.trainLine}. ${route.platform}. At the platform, ${route.arrivalLine}`,
    };
  }
  if (/\b(step[- ]?free|wheelchair|elevator|accessible|stairs)\b/.test(query)) {
    const hasStairs = route.steps.some((step) => step.edgeType === "stairs");
    const trip = tripById(station, route.tripId);
    const verifiedStepFreeRoute = trip && makeRoute(
      trip,
      true,
      route.startNodeId,
      options.equipmentStatuses,
    );
    return {
      line: route.stepFree
        ? "This mapped route uses no stairs. MTA elevator inventory is periodic, not a live outage guarantee."
        : verifiedStepFreeRoute
          ? "A step-free path is mapped through station elevators. Their MTA inventory status is not a live outage guarantee."
          : hasStairs
            ? "This route includes stairs, and no verified step-free path to this platform is in the map. Ask station staff for an accessible route."
            : "The map shows no stairs on this path, but full step-free access is not verified. Ask station staff if you need step-free access.",
    };
  }
  if (arrived) return { line: lineWithTrainTimes(route.arrivalLine || ARRIVAL_LINE, options.arrivals) };
  if (/\b(current step|what next|next step|repeat|say that again)\b/.test(query)) {
    const step = route.steps[cursor];
    return { line: step?.instruction || ARRIVAL_LINE };
  }
  if (/\b(?:thank you|thanks|appreciate it)\b/.test(query)) {
    return { line: "You're welcome. Say “next step” whenever you're ready to continue." };
  }
  return {
    line: "I can repeat this step, go back one step, tell you what sign to look for, or help if you're lost. Ask when the train is coming for a live platform check. Ask for an elevator code, such as EL619, for its inventory status. That elevator answer is not a live outage check.",
  };
}
