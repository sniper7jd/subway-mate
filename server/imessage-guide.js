import station from "../shared/times-square.json" with { type: "json" };
import {
  chooseObservationCandidate,
  hasDestinationIntent,
  hasLostContext,
  matchObservation,
  matchSignText,
  observationClarificationLine,
  replyFor,
  requestedTripId,
  reportsLocation,
  routeForTrip,
  startLine,
  tripNameForId,
  unrecognizedLocationLine,
} from "../src/mockRoutes.js";

export function createConversationState() {
  return {
    route: null,
    cursor: 0,
    doneIds: [],
    arrived: false,
    startNodeId: station.layout.entrances[0].graphId,
    stepFree: false,
    pendingTripId: null,
    pendingLocationCandidates: [],
    pendingImageNodeIds: [],
  };
}

function updateFromRouteResult(state, result) {
  if (result.route) {
    return {
      state: {
        ...state,
        route: result.route,
        cursor: result.cursor || 0,
        doneIds: result.doneIds || [],
        arrived: Boolean(result.arrived),
        startNodeId: result.route.startNodeId,
        pendingTripId: null,
        pendingLocationCandidates: [],
        pendingImageNodeIds: [],
      },
      reply: result.line,
    };
  }
  if (Number.isInteger(result.cursor)) {
    return {
      state: {
        ...state,
        cursor: result.cursor,
        doneIds: result.doneIds || state.doneIds,
        arrived: Boolean(result.arrived),
      },
      reply: result.line,
    };
  }
  return { state, reply: result.line };
}

function replanAtNode(state, node, equipmentStatuses = {}) {
  const tripId = state.pendingTripId || state.route?.tripId;
  const trip = tripId ? routeForTrip(tripId, {
    startNodeId: node.id,
    stepFree: state.stepFree,
    equipmentStatuses,
  }) : null;
  if (!trip) {
    const failedTrip = tripId ? tripNameForId(tripId) : "";
    return {
      state: {
        ...state,
        startNodeId: node.id,
        route: null,
        cursor: 0,
        doneIds: [],
        arrived: false,
        pendingTripId: null,
        pendingImageNodeIds: [],
        pendingLocationCandidates: [],
      },
      reply: failedTrip
        ? `I matched you to ${node.name}, but the local station map has no${state.stepFree ? " verified step-free" : ""} route to ${failedTrip} from there. I won't guess; tell me another mapped location or ask station staff.`
        : `I have your confirmed location: ${node.name}. Where would you like to go?`,
    };
  }
  if (!trip.steps.length && !trip.alreadyAtDestination) {
    return {
      state: { ...state, startNodeId: node.id, pendingTripId: null },
      reply: `I matched you to ${node.name}, but the station map has no verified route to ${tripNameForId(tripId)}. I won't guess. Tell me a different mapped location or ask station staff.`,
    };
  }
  const result = {
    route: trip,
    cursor: 0,
    doneIds: [],
    arrived: Boolean(trip.alreadyAtDestination),
    line: startLine(trip),
  };
  let directionNote = "";
  if (tripId === "uptown-123" && node.id === "downtown-123") {
    directionNote = "That's the Downtown 1/2/3 platform—the wrong direction for the Bronx. Bronx-bound trains use the Uptown 1/2/3 side. I'll guide you from where you are. ";
  } else if (tripId === "uptown-123" && node.id === "uptown-123") {
    directionNote = "Good, you're at the Uptown 1/2/3 side for the Bronx. Check that the train sign says Uptown or Bronx before boarding. ";
  }
  const updated = updateFromRouteResult({ ...state, startNodeId: node.id }, result);
  return { ...updated, reply: `${directionNote}${updated.reply}` };
}

function confirmImageCandidate(state, text, equipmentStatuses) {
  const confirmMatch = String(text || "").trim().match(/^confirm(?:\s+location)?(?:\s+(.+))?$/i);
  if (!confirmMatch || !state.pendingImageNodeIds.length) return null;
  const candidates = state.pendingImageNodeIds
    .map((id) => station.nodes.find((node) => node.id === id))
    .filter(Boolean);
  const requested = confirmMatch[1]?.trim();
  const node = requested
    ? candidates.find((candidate) => candidate.id.toLowerCase() === requested.toLowerCase()
      || candidate.name.toLowerCase().includes(requested.toLowerCase()))
    : candidates.length === 1 ? candidates[0] : null;
  if (!node) {
    return {
      state,
      reply: candidates.length > 1
        ? `That photo clue matches more than one place. If you are physically there, reply CONFIRM LOCATION ${candidates.map((candidate) => candidate.id).join(" or ")}.`
        : `I couldn't match that confirmation to ${candidates.map((candidate) => candidate.name).join(" or ")}. Reply CONFIRM LOCATION followed by the exact place name, only if you're standing there.`,
    };
  }
  const next = replanAtNode({ ...state, pendingImageNodeIds: [] }, node, equipmentStatuses);
  return {
    ...next,
    reply: `Thanks for confirming you're physically at ${node.name}. ${next.reply}`,
  };
}

export function processImageText(state, recognizedText) {
  const text = String(recognizedText || "").trim();
  const match = matchSignText(text);
  if (!match.candidates.length) {
    const readText = text ? `I read “${text.slice(0, 180)},” ` : "";
    return {
      state: { ...state, pendingImageNodeIds: [] },
      reply: `${readText}but can't safely match this photo to a mapped station location. Your route and progress are unchanged. Tell me the direction and train letter/number on the nearest sign.`,
    };
  }
  const ids = match.candidates.map((node) => node.id);
  const routeReset = {
    ...state,
    pendingImageNodeIds: ids,
  };
  const where = match.candidates.map((node) => node.name).join(" or ");
  const cue = match.matchedTerms?.length ? ` I read ${match.matchedTerms.join(", ")}.` : "";
  if (ids.length > 1) {
    return {
      state: routeReset,
      reply: `${cue} This could be ${where}. Tell me which one you're physically at, then reply CONFIRM LOCATION followed by its name. The image has not changed your location or route.`,
    };
  }
  return {
    state: routeReset,
    reply: `${cue} This photo may be near ${where}. If—and only if—you are physically there, reply CONFIRM LOCATION. I won't change your route until you confirm.`,
  };
}

const STEP_FREE_REQUEST = /\b(step[- ]?free|wheelchair|accessible|no stairs)\b/i;

export function processTextMessage(currentState, text, options = {}) {
  let state = currentState || createConversationState();
  const equipmentStatuses = options.equipmentStatuses || {};
  const message = String(text || "").trim();
  if (STEP_FREE_REQUEST.test(message)) state = { ...state, stepFree: true };
  if (!message) {
    return { state, reply: "Send a destination or describe a station sign. You can also attach a clear sign photo." };
  }

  if (/^(?:end|thank you(?: so much)?|thanks?(?: so much| a lot)?|thx|ty)[.! ]*$/i.test(message)) {
    if (state.arrived) {
      return { state: createConversationState(), reply: "Okay, have a great rest of your day." };
    }
    if (state.route) {
      return { state, reply: "You haven't confirmed reaching the destination yet. Send END again after you reach the mapped platform, or say “I'm there” when you finish the current step." };
    }
    return { state: createConversationState(), reply: "Okay, have a great rest of your day." };
  }

  const photoConfirmation = confirmImageCandidate(state, message, equipmentStatuses);
  if (photoConfirmation) return photoConfirmation;

  const pendingTripId = hasDestinationIntent(message)
    ? requestedTripId(message) || state.pendingTripId
    : state.pendingTripId || (state.route && hasLostContext(message) ? state.route.tripId : null);
  const clarifiedNode = state.pendingLocationCandidates.length
    ? chooseObservationCandidate(
      state.pendingLocationCandidates,
      message,
    )
    : null;
  const observation = clarifiedNode
    ? { node: clarifiedNode, candidates: [clarifiedNode] }
    : matchObservation(message);
  const withTrip = { ...state, pendingTripId };

  if (observation.candidates.length > 1) {
    return {
      state: {
        ...withTrip,
        route: null,
        pendingLocationCandidates: observation.candidates,
        stepFree: state.stepFree || /\b(step[- ]?free|wheelchair|accessible|no stairs)\b/i.test(message),
      },
      reply: `${observationClarificationLine(observation.candidates)}${pendingTripId ? ` I'll keep your destination: ${tripNameForId(pendingTripId)}.` : ""}`,
    };
  }

  if (observation.node) {
    const next = replanAtNode({
      ...withTrip,
      stepFree: state.stepFree || STEP_FREE_REQUEST.test(message),
    }, observation.node, equipmentStatuses);
    return {
      state: { ...next.state, pendingLocationCandidates: [] },
      reply: next.reply,
    };
  }

  if (hasLostContext(message) && (!state.route || reportsLocation(message))) {
    return {
      state: { ...withTrip, route: null, pendingLocationCandidates: [] },
      reply: unrecognizedLocationLine(
        message,
        state.route ? state.route.destination : pendingTripId ? tripNameForId(pendingTripId) : "",
      ),
    };
  }

  const result = replyFor(message, state.route, state.cursor, state.arrived, {
    startNodeId: state.startNodeId,
    doneIds: state.doneIds,
    stepFree: state.stepFree,
    equipmentStatuses,
    arrivals: options.arrivals || null,
  });
  return updateFromRouteResult({
    ...withTrip,
    stepFree: state.stepFree || Boolean(result.route?.stepFree),
  }, result);
}
