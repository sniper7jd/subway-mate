import station from "./times-square.json" with { type: "json" };
import { buildVisionCueCatalog, sanitizeVisionCueMatch } from "./vision.js";
import {
  createConversationState,
  processImageText,
  processTextMessage,
} from "../server/imessage-guide.js";
import sharp from "sharp";
import {
  isSupportedImageAttachment,
  normalizeImageForOcr,
  scanIMessageAttachment,
} from "../server/imessage-images.js";
import { createMessageDeduplicator, createReplyEchoGuard } from "../server/message-dedupe.js";
import {
  applyRoute,
  arrivalSentence,
  blankWallSentence,
  buildLocalManifest,
  findPath,
  interpretSign,
  matchDestination,
  relativeFacing,
  spokenPlan,
} from "./guidance.js";
import {
  OPENING,
  advanceStep,
  chooseObservationCandidate,
  hasLostContext,
  matchObservation,
  matchRoute,
  matchSignText,
  reportsLocation,
  observationClarificationLine,
  requestedTripId,
  rewindStep,
  routeForTrip,
  nextTrainLine,
  replyFor,
  unrecognizedLocationLine,
} from "../src/mockRoutes.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  !isSupportedImageAttachment({ mimeType: "image/heic" })
    && !isSupportedImageAttachment({ mimeType: "application/octet-stream", name: "IMG_1234.HEIC" })
    && isSupportedImageAttachment({ mimeType: "image/jpeg" })
    && isSupportedImageAttachment({ mimeType: "application/octet-stream", name: "IMG_1234.PNG" })
    && !isSupportedImageAttachment({ mimeType: "application/pdf", name: "station.pdf" }),
  "iMessage accepts JPEG, PNG, and WebP photos and rejects unsupported HEIC attachments",
);
const largeTestImage = await sharp({
  create: { width: 1800, height: 900, channels: 3, background: "#ffffff" },
}).jpeg().toBuffer();
const normalizedTestImage = await normalizeImageForOcr(largeTestImage);
const normalizedTestMetadata = await sharp(normalizedTestImage).metadata();
assert(
  normalizedTestMetadata.width === 1280 && normalizedTestMetadata.height === 640,
  "iMessage photo normalization scales large images to the bounded OCR size",
);
let rejectedInvalidImage = false;
try {
  await normalizeImageForOcr(Buffer.from("not an image"));
} catch {
  rejectedInvalidImage = true;
}
assert(rejectedInvalidImage, "invalid image bytes are rejected during normalization");

const isDuplicateIMessage = createMessageDeduplicator({ maxEntries: 2 });
assert(!isDuplicateIMessage("imessage-1"), "first Spectrum delivery is processed");
assert(isDuplicateIMessage("imessage-1"), "at-least-once redelivery of the same message is suppressed");
assert(!isDuplicateIMessage("imessage-2"), "a distinct Spectrum message remains processable");
assert(!isDuplicateIMessage("imessage-3"), "deduplication stays bounded as new messages arrive");
const isRepeatedText = createMessageDeduplicator({ ttlMs: 4_000 });
assert(!isRepeatedText("space\nHi"), "the first copy of an iMessage text is answered");
assert(isRepeatedText("space\nHi"), "a second delivery of the same iMessage text is ignored");
assert(!isRepeatedText("space\nI'm here"), "a different follow-up text is still answered");
const replyEcho = createReplyEchoGuard();
replyEcho.remember("space", "Hi. Where would you like to go?");
assert(replyEcho.isEcho("space", "Hi. Where would you like to go?"), "the bot ignores an echo of its own reply");
assert(!replyEcho.isEcho("space", "Bronx"), "a new rider message is not treated as an echo");
const expiredEcho = createReplyEchoGuard({ ttlMs: -1 });
expiredEcho.remember("space", "Same reply");
assert(!expiredEcho.isEcho("space", "Same reply"), "an old reply echo can be treated as a new message");

const imessageStart = processTextMessage(createConversationState(), "Bronx");
assert(imessageStart.state.route?.tripId === "uptown-123", "iMessage bot starts a graph-backed Bronx route");
const unsupportedIMessagePhoto = await scanIMessageAttachment(imessageStart.state, {
  mimeType: "image/heic",
  name: "IMG_1234.HEIC",
  read: () => {
    throw new Error("unsupported HEIC attachment must be rejected before reading bytes");
  },
});
assert(
  unsupportedIMessagePhoto.state === imessageStart.state
    && /send a JPEG, PNG, or WebP/i.test(unsupportedIMessagePhoto.reply),
  "HEIC attachments are explicitly rejected without altering the active route",
);
const oversizedIMessagePhoto = await scanIMessageAttachment(imessageStart.state, {
  mimeType: "image/jpeg",
  size: 13 * 1024 * 1024,
  read: () => {
    throw new Error("oversized attachment must be rejected before reading bytes");
  },
});
assert(
  oversizedIMessagePhoto.state === imessageStart.state
    && /over 12 MB/i.test(oversizedIMessagePhoto.reply),
  "oversized iMessage photos are rejected without reading or changing route state",
);
const lostDuringBronxRoute = processTextMessage(imessageStart.state, "I'm lost");
assert(
  !lostDuringBronxRoute.state.route
    && lostDuringBronxRoute.state.pendingTripId === "uptown-123"
    && /nearest landmark or sign/i.test(lostDuringBronxRoute.reply)
    && /green globe/i.test(lostDuringBronxRoute.reply),
  "a lost-rider prompt asks for a usable landmark and retains the Bronx destination",
);
const wrongDirectionReport = processTextMessage(
  lostDuringBronxRoute.state,
  "I'm at the Downtown 1/2/3 sign",
);
assert(
  wrongDirectionReport.state.route?.tripId === "uptown-123"
    && wrongDirectionReport.state.route.startNodeId === "downtown-123"
    && /wrong direction for the Bronx/i.test(wrongDirectionReport.reply)
    && /First,/i.test(wrongDirectionReport.reply),
  "a downtown sign after getting lost identifies the wrong direction and resumes graph routing to the Bronx",
);
const ambiguousLostLandmark = processTextMessage(
  lostDuringBronxRoute.state,
  "I see a purple 7 bullet",
);
const clarifiedLostLandmark = processTextMessage(ambiguousLostLandmark.state, "stairs");
assert(
  ambiguousLostLandmark.state.pendingTripId === "uptown-123"
    && ambiguousLostLandmark.state.pendingLocationCandidates.length === 2
    && clarifiedLostLandmark.state.route?.tripId === "uptown-123"
    && clarifiedLostLandmark.state.route.startNodeId === "seven-stairs",
  "an ambiguous lost-location landmark asks which mapped point and keeps the Bronx destination through clarification",
);
const atBronxPlatform = processTextMessage(
  imessageStart.state,
  "I'm at the green globe",
);
assert(
  atBronxPlatform.state.arrived
    && /Uptown 1\/2\/3 side for the Bronx/i.test(atBronxPlatform.reply),
  "a mapped Uptown 1/2/3 landmark confirms the correct Bronx direction",
);
assert(
  imessageStart.state.startNodeId === "ent-42-7" && imessageStart.state.cursor === 0,
  "iMessage route uses the default 42nd Street and Seventh Avenue start",
);
const imessageOkay = processTextMessage(imessageStart.state, "okay");
assert(imessageOkay.state.cursor === 0, "iMessage 'okay' alone does not advance the route");
const imessageAdvance = processTextMessage(imessageStart.state, "okay, I'm there");
assert(imessageAdvance.state.cursor === 1, "iMessage explicit arrival advances exactly one graph step");
const imessageImage = processImageText(imessageStart.state, "UPTOWN BRONX 1 2 3");
assert(
  imessageImage.state.route === imessageStart.state.route
    && imessageImage.state.cursor === 0
    && imessageImage.state.pendingImageNodeIds.includes("uptown-123"),
  "an iMessage photo proposes a mapped candidate without relocating or advancing",
);
const imessageImageConfirm = processTextMessage(imessageImage.state, "CONFIRM LOCATION");
assert(
  imessageImageConfirm.state.route?.startNodeId === "uptown-123"
    && imessageImageConfirm.state.arrived,
  "an explicit iMessage photo confirmation replans from the confirmed candidate",
);
const imessageAmbiguousPhoto = processImageText(imessageStart.state, "IRT Flushing Line");
assert(
  imessageAmbiguousPhoto.state.pendingImageNodeIds.length > 1,
  "iMessage photo cues shared by stairs and platform require disambiguation",
);
const imessageWrongLinePhoto = processImageText(imessageStart.state, "Downtown Brooklyn N R");
assert(
  imessageWrongLinePhoto.state.route === imessageStart.state.route
    && imessageWrongLinePhoto.state.pendingImageNodeIds.length === 0,
  "an iMessage photo with the wrong line markers cannot relocate the rider",
);
const imessagePrematureEnd = processTextMessage(imessageStart.state, "end");
assert(
  Boolean(imessagePrematureEnd.state.route) && /haven't confirmed reaching/i.test(imessagePrematureEnd.reply),
  "iMessage END does not close an unfinished route",
);
const imessageEnd = processTextMessage(
  { ...imessageStart.state, arrived: true },
  "end",
);
assert(
  imessageEnd.reply === "Okay, have a great rest of your day."
    && imessageEnd.state.route === null,
  "iMessage END after arrival sends the requested farewell and clears the trip",
);
const imessageThanks = processTextMessage(
  { ...imessageStart.state, arrived: true },
  "Thank you!",
);
assert(
  imessageThanks.reply === imessageEnd.reply && imessageThanks.state.route === null,
  "an iMessage thank-you after arrival behaves exactly like END",
);
const imessageThanksEarly = processTextMessage(imessageStart.state, "Thanks");
assert(
  Boolean(imessageThanksEarly.state.route) && /haven't confirmed reaching/i.test(imessageThanksEarly.reply),
  "a thank-you before arrival does not falsely close an unfinished route",
);

const visionCatalog = buildVisionCueCatalog(station);
assert(visionCatalog.length === station.nodes.length, "online vision cue catalog contains only station graph nodes");
const globeVisionMatch = sanitizeVisionCueMatch(station, {
  matchedCues: ["green globe"],
  candidateNodeIds: ["downtown-123"],
  visibleText: "UPTOWN",
});
assert(
  globeVisionMatch.candidateIds.length === 1 && globeVisionMatch.candidateIds[0] === "uptown-123",
  "online vision maps an exact known cue to its station-file node and ignores model-supplied node IDs",
);
const genericVisionMatch = sanitizeVisionCueMatch(station, {
  matchedCues: ["turnstiles", "a sign that says Queens"],
  candidateNodeIds: ["seven-platform"],
  visibleText: "Queens",
});
assert(
  genericVisionMatch.candidateIds.length === 0,
  "unlisted visual descriptions and fabricated model node IDs never become location candidates",
);
const sharedVisionMatch = sanitizeVisionCueMatch(station, { matchedCues: ["IRT Flushing Line"] });
assert(
  sharedVisionMatch.candidateIds.includes("seven-stairs")
    && sharedVisionMatch.candidateIds.includes("seven-platform")
    && sharedVisionMatch.candidateIds.length === 2,
  "shared line cues stay ambiguous between the mapped 7 stairs and platform",
);

const downtown = buildLocalManifest(station, "downtown-123", "tourist");
const uptownHit = interpretSign("UPTOWN & THE BRONX 1 2 3", downtown);
assert(uptownHit.kind === "match", "uptown sign should match");
assert(/turn around/i.test(uptownHit.sentence), uptownHit.sentence);

const downtownHit = interpretSign("DOWNTOWN & BROOKLYN", downtown);
assert(/you're good\. follow this\./i.test(downtownHit.sentence), downtownHit.sentence);

const wheelchair = buildLocalManifest(station, "queens-7", "wheelchair");
const stairs = interpretSign("7 TRAIN TO QUEENS STAIRS", wheelchair);
assert(/do not follow these stairs/i.test(stairs.sentence), stairs.sentence);
assert(/out of service/i.test(station.trips.find((trip) => trip.id === "queens-7").summary), "the 7 trip discloses the unavailable platform elevator");

const bronxRoute = findPath(station, "ent-42-7", "uptown-123", { stepFree: false });
assert(bronxRoute.some((edge) => edge.type === "stairs"), "bronx route uses stairs");
const queensFree = findPath(station, "ent-42-7", "seven-platform", { stepFree: true });
assert(queensFree.length === 0, "the 7 has no step-free graph path while its platform elevator is out of service");
const coreLocationIds = [
  "uptown-123",
  "downtown-123",
  "seven-stairs",
  "seven-platform",
  "broadway-plaza-elevator",
  "ent-42-7",
  "mez-upper",
  "ent-40-7",
  "ent-40-broadway",
  "ent-broadway-plaza",
  "lower-mezzanine",
];
const nqrwLocationIds = ["ent-43-broadway", "nqrw-mezz", "nqrw-uptown"];
for (const group of [coreLocationIds, nqrwLocationIds]) {
  for (const start of group) {
    for (const destination of group) {
      if (start === destination) continue;
      assert(
        findPath(station, start, destination).length > 0,
        `known reverse routing exists within mapped station component: ${start} -> ${destination}`,
      );
    }
  }
}
assert(
  findPath(station, "seven-stairs", "uptown-123")[0]?.reversed === true,
  "a route from the 7 stair node uses the explicit reverse stair instruction",
);
assert(
  findPath(station, "nqrw-uptown", "ent-43-broadway", { stepFree: true })
    .every((edge) => edge.type === "elevator"),
  "the N/Q/R/W step-free route remains reversible through elevators only",
);
assert(
  findPath(station, "nqrw-uptown", "ent-43-broadway", {
    stepFree: true,
    unavailableEquipment: ["EL230"],
  }).length === 0,
  "an unavailable elevator blocks step-free return paths as well",
);
assert(
  findPath(station, "nqrw-uptown", "uptown-123").length === 0,
  "the graph still refuses to invent an unverified inter-line connection",
);
const routed = applyRoute(station, buildLocalManifest(station, "uptown-123", "tourist"));
assert(routed.signs.some((step) => step.nodeId === "downtown-123"), "uptown trip still watches the downtown sign");
assert(routed.steps.at(-1).nodeId === "uptown-123", "uptown route ends at the uptown platform");

assert(matchDestination("Take me to One World Trade Center").tripId === "downtown-123", "wtc trip");
assert(matchDestination("step-free to One World Trade Center").tripId === "enter-accessible", "step-free wtc");
assert(matchDestination("the 7 toward Queens").tripId === "queens-7", "7 trip");
assert(matchDestination("a museum in another city").tripId === null, "unknown place");

assert(interpretSign("   ", downtown).kind === "empty", "blank text");
assert(blankWallSentence(downtown, null, "straight") === "Find a sign.", "no last node");
assert(
  /downtown sign/i.test(blankWallSentence(downtown, "downtown-123", "left")),
  "facing uses the last node",
);

const now = Date.now();
const soon = {
  ...downtown,
  arrivals: {
    fetchedAt: now,
    next: [
      { label: "2 Flatbush Av", at: now + 2 * 60000 },
      { label: "3 New Lots Av", at: now + 9 * 60000 },
    ],
  },
};
assert(/the train you can catch/i.test(arrivalSentence(soon, now)), arrivalSentence(soon, now));
assert(/3 new lots av/i.test(arrivalSentence(soon, now)), arrivalSentence(soon, now));
assert(!/miss/i.test(spokenPlan(soon)), spokenPlan(soon));
assert(/one world trade center/i.test(spokenPlan(soon)), spokenPlan(soon));
const later = {
  ...soon,
  arrivals: {
    fetchedAt: now,
    next: [{ label: "2 Flatbush Av", at: now + 8 * 60000 }],
  },
};
assert(/2 flatbush av/i.test(arrivalSentence(later, now)), arrivalSentence(later, now));
assert(/the train you can catch/i.test(arrivalSentence(later, now)), arrivalSentence(later, now));
assert(!/miss/i.test(spokenPlan(later)), spokenPlan(later));
const stale = { ...soon, arrivals: { ...soon.arrivals, fetchedAt: now - 4 * 60000 } };
assert(arrivalSentence(stale, now) === "", "stale countdown stays quiet");

assert(relativeFacing(10, 20) === "straight", "near heading is straight");
assert(relativeFacing(0, 90) === "right", "90 degrees is right");
assert(relativeFacing(0, 180) === "behind", "180 is behind");
assert(relativeFacing(0, 270) === "left", "270 is left");

const screenBronx = matchRoute("Take me to the Bronx");
assert(screenBronx?.tripId === "uptown-123", "screen route resolves a station alias");
const graphBronx = findPath(station, "ent-42-7", "uptown-123");
assert(
  screenBronx.steps.map((step) => `${step.fromNodeId}>${step.nodeId}:${step.edgeType}`).join("|")
    === graphBronx.map((edge) => `${edge.from}>${edge.to}:${edge.type}`).join("|"),
  "screen steps are the graph path",
);
assert(
  screenBronx.steps.every((step) => !("distance" in step) && !("heading" in step)),
  "screen route does not invent distances or compass headings",
);

const screenQueens = matchRoute("7 train to Flushing");
const screenQueensFree = matchRoute("Queens", { stepFree: true });
const screenBronxFree = matchRoute("Step-free to the Bronx");
assert(screenQueens?.steps.some((step) => step.edgeType === "stairs"), "regular Queens route follows graph stairs");
assert(
  station.nodes.find((node) => node.id === "seven-stairs").visualCues.some((cue) => /Purple tile/.test(cue))
    && screenQueens.steps.some((step) => step.visualCues.some((cue) => /EL232 out of service/.test(cue))),
  "the station file displays known 7-platform accessibility limits",
);
assert(screenQueensFree === null, "the screen refuses a step-free route to the 7 platform with unavailable access");
assert(screenBronxFree === null, "the screen refuses a step-free route to the 1/2/3 platform with unavailable access");
const brooklynRoute = matchRoute("Brooklyn");
assert(brooklynRoute?.tripId === "brooklyn-atlantic", "Brooklyn resolves to the specific Atlantic Av–Barclays Center destination");
assert(brooklynRoute.steps.at(-1).nodeId === "downtown-123", "the Brooklyn trip uses the mapped downtown 1/2/3 platform path");
assert(/only a 2 or 3/.test(brooklynRoute.arrivalLine) && /do not board a 1/i.test(brooklynRoute.arrivalLine), "Brooklyn boarding guidance excludes the wrong 1 train");
assert(
  brooklynRoute.trainLine === "downtown 2 or 3"
    && station.trips.find((trip) => trip.id === "brooklyn-atlantic")?.destinationStop?.complexId === "617",
  "the Brooklyn trip distinguishes its 2/3 boarding service from the official destination complex",
);
assert(matchRoute("Downtown").tripId === "downtown-123", "a generic downtown request stays on the local downtown platform trip");
assert(matchRoute("wheelchair") === null, "accessibility preference alone does not guess a destination");
assert(matchRoute("Take me to Grand Central")?.tripId === "shuttle-grand-central", "screen resolves Grand Central from the station file");
assert(
  /platform connection/i.test(matchRoute("Take me to Grand Central").arrivalLine),
  "the shuttle destination discloses that platform access is unverified",
);
assert(matchRoute("a museum in another city") === null, "screen does not invent an unsupported destination");
assert(/step-free is a route option/i.test(replyFor("wheelchair", null, 0, false).line), "an accessibility preference alone asks for a destination");
const switchedRoute = replyFor("The Bronx", screenQueens, 1, false);
assert(switchedRoute.route?.tripId === "uptown-123" && switchedRoute.cursor === 0, "known destination switches rebuild the graph route");

const lostAtGlobe = matchObservation("I'm lost, and I can see a green globe.");
assert(lostAtGlobe.node?.id === "uptown-123", "a described landmark matches its known station node");
const lostQueensMessage = "I'm lost; I see the green globe. Take me to Queens";
assert(matchObservation(lostQueensMessage).node?.id === "uptown-123", "destination wording cannot override the explicitly reported green-globe location");
assert(matchObservation("I see a downtown sign").node?.id === "downtown-123", "a reported known sign matches its station node");
assert(matchObservation("I'm lost; I see a green globe, heading to Queens").node?.id === "uptown-123", "a destination mention does not override a separately described landmark");
assert(
  matchObservation("I see a sign saying Queens").candidates.map((node) => node.id).sort().join("|")
    === "seven-platform|seven-stairs",
  "Queens/Flushing wording identifies the 7 area but leaves stairs versus platform unresolved",
);
assert(
  matchObservation("I see a 7 train sign").candidates.length === 2,
  "a 7 sign alone cannot distinguish the stair area from the platform",
);
assert(matchObservation("I see turnstiles").node === null, "generic turnstiles do not guess a station location");
assert(matchObservation("I see a shop").node === null, "an unnamed shop does not guess a station location");
assert(matchObservation("I see an overhead sign").node === null, "generic signage does not guess a station location");
assert(matchObservation("I'm at the station").node === null, "the generic word station does not falsely place the rider at the N/Q/R/W mezzanine");
assert(matchObservation("I'm at 42nd Street").node === null, "a partial street name does not match the 43rd Street elevator entrance");
assert(matchObservation("I'm at Broadway").node === null, "Broadway alone is not precise enough to identify an entrance");
assert(matchObservation("I'm at turnstiles").node === null, "natural 'I'm at' wording still treats generic turnstiles as ambiguous");
assert(hasLostContext("I'm at turnstiles") && reportsLocation("I'm at turnstiles"), "natural 'I'm at' phrasing is treated as a location report even when unmatched");
assert(hasLostContext("I'm looking at a shop") && reportsLocation("I'm looking at a shop"), "natural 'I'm looking at' phrasing is treated as an observation");
assert(requestedTripId("I'm lost by turnstiles. Take me to the Bronx") === "uptown-123", "a destination is retained while the reported location needs clarification");
assert(
  matchObservation("I'm lost; I see a sign marked Uptown 1 2 3").node?.id === "uptown-123",
  "a route sign with both direction and line markers identifies the mapped uptown platform",
);
assert(
  matchObservation("I'm lost; I see a sign marked 1 2 3").candidates.length === 2,
  "a 1/2/3 sign without direction stays ambiguous between uptown and downtown",
);
assert(
  /stairs marked 7, or already at the 7 platform/i.test(observationClarificationLine(
    matchObservation("I'm lost; I see a purple 7 bullet").candidates,
  )),
  "an ambiguous 7 cue asks whether the rider is by the stairs or already at the platform",
);
const sevenCandidates = matchObservation("I'm lost; I see a purple 7 bullet").candidates;
assert(
  chooseObservationCandidate(sevenCandidates, "stairs")?.id === "seven-stairs"
    && chooseObservationCandidate(sevenCandidates, "platform")?.id === "seven-platform",
  "short answers to a clarification correctly select a 7-stairs or platform candidate",
);
const directionCandidates = matchObservation("I'm lost; I see a sign marked 1 2 3").candidates;
assert(
  chooseObservationCandidate(directionCandidates, "Uptown")?.id === "uptown-123"
    && chooseObservationCandidate(directionCandidates, "Downtown")?.id === "downtown-123",
  "a rider can resolve an ambiguous 1/2/3 sign with a one-word direction answer",
);
assert(matchObservation("I'm lost; I see a passageway to the Bronx-bound IRT 7th Avenue platform").node?.id === "uptown-123", "the source-backed Bronx-bound passageway cue resolves to the 1/2/3 node");
assert(matchObservation("I'm lost; I see the 42 mosaic").node?.id === "nqrw-uptown", "the source-backed 42 mosaic cue resolves to the uptown Broadway platform");
assert(
  matchObservation("I'm lost; I see the Knickerbocker Hotel sign").node?.id === "broadway-plaza-elevator",
  "the dated shuttle-area hotel sign cue resolves only to its mapped shuttle node",
);
assert(matchObservation("McDonald's").node?.id === "ent-42-7", "known nearby entrance landmarks match their graph node");
assert(matchObservation("I am at the Broadway plaza").node?.id === "ent-broadway-plaza", "a plaza description identifies the street entrance, not the shuttle platform");
assert(matchObservation("I am headed to Queens").node === null, "destination wording alone is not mistaken for an observed location");
const lostQueensRoute = matchRoute("I'm lost, I see the green globe. Take me to Queens.", {
  startNodeId: lostAtGlobe.node.id,
});
assert(lostQueensRoute?.startNodeId === "uptown-123", "a lost rider route starts at their described location");
assert(lostQueensRoute.steps.at(-1).nodeId === "seven-platform", "a lost rider route still ends at the 7 platform");
const lostQueensReply = replyFor(lostQueensMessage, screenBronx, 1, false, {
  locationObserved: true,
  startNodeId: matchObservation(lostQueensMessage).node.id,
});
assert(
  lostQueensReply.route?.startNodeId === "uptown-123"
    && lostQueensReply.route.tripId === "queens-7",
  "the exact mid-route Queens request replans from the reported green-globe node",
);
assert(
  /Let's get to Queens/i.test(lostQueensReply.line)
    && /You're at Uptown 1\/2\/3/i.test(lostQueensReply.line)
    && !/For 7 toward Queens, take 7 toward Queens/i.test(lostQueensReply.line),
  "a replan acknowledges the destination and current location without repeating the train/destination preamble",
);
assert(
  /first, go down the stairs marked 7/i.test(lostQueensReply.line)
    && /stop when you reach 7 train stairs/i.test(lostQueensReply.line)
    && /tell me .*i'm there/i.test(lostQueensReply.line),
  "a replan gives one plain action, a clear stopping point, and a simple confirmation prompt",
);
const nextQueensStep = advanceStep(lostQueensReply.route, 0);
assert(
  /next, follow the 7 signs to the platform/i.test(nextQueensStep.line)
    && /check the sign says 7 and queens or flushing/i.test(nextQueensStep.line)
    && /stop when you reach 7 platform/i.test(nextQueensStep.line),
  "the next Queens step separately guides the rider from the 7 stair area to the platform and checks direction before boarding",
);
const chooseAfterLocation = matchRoute("Queens", { startNodeId: lostAtGlobe.node.id });
assert(chooseAfterLocation?.startNodeId === "uptown-123", "a location description followed by a separate destination keeps the located start");
assert(
  chooseAfterLocation.steps.map((step) => `${step.fromNodeId}>${step.nodeId}:${step.edgeType}`).join("|")
    === findPath(station, "uptown-123", "seven-platform").map((edge) => `${edge.from}>${edge.to}:${edge.type}`).join("|"),
  "a replan from the rider's description exactly follows the station graph",
);
assert(matchObservation("I see a roundel").candidates.length > 1, "an ambiguous station landmark asks the rider to clarify");
assert(matchObservation("where is the green globe?").node === null, "a question about a landmark is not mistaken for the rider's location");
assert(matchObservation("I see an elevator").node === null, "a generic elevator description does not guess which elevator");
assert(matchObservation("I'm at the elevator doors").node === null, "a generic elevator description does not match the out-of-service 7 elevator");
assert(
  /nearest landmark or sign/i.test(replyFor("I'm lost; the sign looks different", null, 0, false).line)
    && /train number or letter, and direction/i.test(replyFor("I'm lost; the sign looks different", null, 0, false).line),
  "an unknown location asks for actionable sign, street-corner, or elevator-code details",
);
assert(/turnstiles.*appear in more than one area/i.test(unrecognizedLocationLine("I'm lost; I see turnstiles")), "turnstiles get an explicit non-location clarification");
assert(/McDonald's.*Baskin-Robbins/i.test(unrecognizedLocationLine("I'm lost near a shop")), "unknown shops prompt riders to use an exact mapped business name");
assert(/train number or letter, and direction/i.test(unrecognizedLocationLine("I'm lost; I see signage")), "generic signage prompts for line and direction text");
assert(/cross street or corner/i.test(unrecognizedLocationLine("I'm at 42nd Street")), "a partial street location asks for the cross street rather than guessing an entrance");
assert(
  station.visualCueGuidance.recognized.some((cue) => /McDonald's/.test(cue))
    && station.visualCueGuidance.recognized.some((cue) => /Baskin-Robbins/.test(cue))
    && station.visualCueGuidance.recognized.some((cue) => /IRT Flushing Line/.test(cue))
    && station.visualCueGuidance.ambiguous.some((cue) => /Turnstiles/.test(cue.cue)),
  "the app distinguishes known named shop landmarks from non-locating generic turnstiles",
);
assert(
  station.mtaReference.stationEntrances.datasetId === "i9wp-a4ja"
    && station.mtaReference.stationEntrances.limitations.includes("does not describe indoor corridors"),
  "official MTA entrance data is cited without treating street points as indoor pathways",
);
assert(
  /nearest landmark or sign/i.test(replyFor(
    "I'm lost; the sign looks different",
    screenBronx,
    0,
    false,
  ).line),
  "an unknown location during an active trip asks for clarifying details instead of a generic chatbot response",
);
assert(matchSignText("UPTOWN & THE BRONX 1 2 3").node?.id === "uptown-123", "photo OCR resolves a line-qualified uptown sign");
assert(matchSignText("DOWNTOWN N R").node === null, "a conflicting Downtown N/R sample is not matched to a platform");
assert(matchSignText(" ").node === null, "a blank-wall sample does not produce a candidate");
assert(matchSignText("DOWNTOWN & BROOKLYN 1 2 3").node?.id === "downtown-123", "photo OCR resolves the matching 1/2/3 downtown sign");
assert(
  matchSignText("7 TRAIN TO QUEENS FLUSHING").candidates.map((node) => node.id).sort().join("|")
    === "seven-platform|seven-stairs",
  "photo OCR resolves the 7 area but does not assume whether a Queens sign is at the stairs or platform",
);
assert(
  matchSignText("DOWNTOWN & BROOKLYN N R").node === null
    && matchSignText("DOWNTOWN & BROOKLYN N R").candidates.length === 0,
  "an N/R sign must never be mistaken for the downtown 1/2/3 platform",
);
assert(
  matchSignText("UPTOWN 1 2 3 / DOWNTOWN BROOKLYN").candidates.length === 2,
  "OCR containing competing directions asks the rider to clarify",
);
assert(matchSignText("DOWNTOWN & BROOKLYN").node === null, "a photo without train markers cannot identify a platform");
const baskinLandmark = matchSignText("Baskin Robbins");
assert(baskinLandmark.node?.id === "ent-broadway-plaza", "OCR of the mapped Baskin-Robbins landmark resolves to the plaza entrance, not a platform");
assert(
  matchSignText("McDonald's").node?.id === "ent-42-7",
  "OCR of the mapped McDonald's landmark resolves only to the 42nd Street and Seventh Avenue entrance",
);
assert(matchSignText("green globe").node?.id === "uptown-123", "OCR can recognize a distinct mapped green-globe cue");
assert(
  matchSignText("purple 7 bullet").candidates.map((node) => node.id).sort().join("|")
    === "seven-platform|seven-stairs",
  "the shared purple 7 cue remains ambiguous between stairs and platform",
);
assert(
  matchSignText("EL230").candidates.map((node) => node.id).sort().join("|")
    === "nqrw-mezz|nqrw-uptown",
  "the shared EL230 label does not guess between mezzanine and platform",
);
assert(
  matchSignText("EL230 N").candidates.map((node) => node.id).sort().join("|")
    === "nqrw-mezz|nqrw-uptown",
  "a compatible N marker cannot make the shared EL230 location appear unique",
);
assert(
  matchSignText("green globe N R").candidates.length === 0,
  "conflicting train markers prevent a visual landmark from selecting an incompatible node",
);
assert(
  matchSignText("42 mosaic 7").candidates.length === 0,
  "a conflicting 7 marker prevents the 42 mosaic cue from selecting the N/Q/R/W platform",
);
const flushingLinePhotoCue = matchSignText("IRT Flushing Line");
assert(
  flushingLinePhotoCue.candidates.map((node) => node.id).sort().join("|")
    === "seven-platform|seven-stairs",
  "the sourced IRT Flushing Line cue helps identify the 7 area but does not guess stairs versus platform",
);
assert(
  station.visualCueSources.some((source) =>
    source.nodeId === "seven-stairs"
      && source.source.includes("Escalators_to_IRT_Flushing_Line")
      && /does not establish current escalator availability/.test(source.description),
  ),
  "the 7-area visual cue keeps its Commons attribution and 2013 availability limitation",
);
assert(
  matchSignText("Knickerbocker Hotel").node?.id === "broadway-plaza-elevator"
    && station.visualCueSources.some((source) =>
      source.nodeId === "broadway-plaza-elevator"
        && source.source.includes("shuttle_platforms_Sep_2021_01")
        && /dated clue/.test(source.description),
    ),
  "the shuttle hotel-sign OCR cue retains its dated Wikimedia source and limitation",
);
assert(
  findPath(station, baskinLandmark.node.id, "uptown-123").length > 0,
  "the recognized Baskin-Robbins entrance can route onward using the graph",
);
const fromBaskin = matchRoute("Bronx", { startNodeId: baskinLandmark.node.id });
assert(
  fromBaskin?.startNodeId === "ent-broadway-plaza"
    && fromBaskin.startVisualCues.includes("Baskin-Robbins nearby"),
  "a route from the confirmed Baskin-Robbins entrance retains that start cue",
);
const stairsStartAnswer = replyFor("Take me step-free to Queens", null, 0, false, {
  startNodeId: "seven-stairs",
});
assert(/no verified step-free path/i.test(stairsStartAnswer.line), "a step-free route does not start from the station's stair node");
const replannedFromObservation = replyFor(
  "I see a green globe",
  screenQueens,
  1,
  false,
  { locationObserved: true, startNodeId: "uptown-123" },
);
assert(
  replannedFromObservation.route?.tripId === "queens-7"
    && replannedFromObservation.route.startNodeId === "uptown-123"
    && replannedFromObservation.cursor === 0,
  "an observation during a journey replans the active destination from the matched node",
);
const sevenStairsMessage = "I'm at the 7 train stairs. Take me to the Bronx";
const sevenStairsObservation = matchObservation(sevenStairsMessage);
assert(sevenStairsObservation.node?.id === "seven-stairs", "the user's reported 7 stair description resolves to its mapped node");
const fromSevenStairsToBronx = replyFor(
  sevenStairsMessage,
  screenBronx,
  0,
  false,
  { locationObserved: true, startNodeId: sevenStairsObservation.node?.id },
);
assert(
  fromSevenStairsToBronx.route?.startNodeId === "seven-stairs"
    && fromSevenStairsToBronx.route.tripId === "uptown-123"
    && /go up the stairs from the 7-level sign area to the uptown 1\/2\/3 platform/i.test(fromSevenStairsToBronx.route.steps[0]?.instruction || "")
    && /stop when you reach uptown 1\/2\/3/i.test(fromSevenStairsToBronx.route.steps[0]?.instruction || ""),
  "a lost rider at the 7 stairs gets a path back to the requested Bronx platform",
);
assert(
  /Let's get to the Bronx/i.test(fromSevenStairsToBronx.line)
    && /You're at 7 train stairs/i.test(fromSevenStairsToBronx.line),
  "a recovery response names the reported location and intended destination",
);
const routeBackFromShuttleArea = replyFor(
  "I see the green globe",
  screenBronx,
  0,
  false,
  { locationObserved: true, startNodeId: "broadway-plaza-elevator" },
);
assert(
  /return from the Broadway plaza shuttle connection to the upper mezzanine/i.test(routeBackFromShuttleArea.route?.steps[0]?.instruction || "")
    && /stop when you reach upper mezzanine/i.test(routeBackFromShuttleArea.route?.steps[0]?.instruction || ""),
  "a rider matched at the shuttle connection can retrace the explicit walkway toward the 1/2/3",
);

const firstConfirmation = advanceStep(screenBronx, 0, []);
assert(firstConfirmation.cursor === 1, "one explicit confirmation advances one graph edge");
assert(firstConfirmation.doneIds[0] === screenBronx.steps[0].id, "confirmed graph edge is recorded as done");
const rewindConfirmation = rewindStep(screenBronx, firstConfirmation.cursor, firstConfirmation.doneIds);
assert(
  rewindConfirmation.cursor === 0
    && rewindConfirmation.doneIds.length === 0
    && /go back one step/i.test(rewindConfirmation.line),
  "riders can undo a mistaken confirmation and hear that step again",
);
assert(
  rewindStep(screenBronx, 0, []).cursor === 0,
  "the first direction cannot be rewound past the known start",
);
const platformAnswer = replyFor("What platform?", screenBronx, 0, false);
assert(
  /uptown 1, 2, or 3/i.test(platformAnswer.line)
    && platformAnswer.line.includes(screenBronx.platform)
    && /uptown or bronx/i.test(platformAnswer.line),
  "platform questions use active route and destination boarding data",
);
const currentStepAnswer = replyFor("What is the next step?", screenBronx, 0, false);
assert(currentStepAnswer.line === screenBronx.steps[0].instruction, "step questions use active graph edge");
const lookForSignAnswer = replyFor("What sign should I look for?", screenQueens, 2, false);
assert(
  replyFor("Which way do I go?", screenBronx, 0, false).line === screenBronx.steps[0].instruction
    && /can't see your exact position/i.test(replyFor("Am I going the right way?", screenBronx, 0, false).line)
    && replyFor("What do I look for?", screenQueens, 2, false).line === lookForSignAnswer.line,
  "natural direction and reassurance questions stay grounded in the current graph step",
);
assert(
  /look for purple tile or 7 bullet/i.test(lookForSignAnswer.line)
    && /7, flushing, queens/i.test(lookForSignAnswer.line)
    && /stop at 7 train stairs/i.test(lookForSignAnswer.line),
  "sign questions return current-step visual cues, exact text, and a stopping point",
);
const locationAnswer = replyFor("Where am I?", screenQueens, 2, false);
assert(
  /last confirmed point is uptown 1\/2\/3/i.test(locationAnswer.line)
    && /going to queens/i.test(locationAnswer.line),
  "location answers use the last confirmed graph checkpoint and active destination",
);
const destinationTrainAnswer = replyFor("Which train do I need?", screenQueens, 2, false);
assert(
  /7 toward queens/i.test(destinationTrainAnswer.line)
    && /check the sign says 7 and queens or flushing/i.test(destinationTrainAnswer.line),
  "train questions include the direction and end-platform confirmation",
);
assert(
  /pause somewhere safe/i.test(replyFor("I can't find the sign", screenQueens, 2, false).line)
    && /check a sign photo/i.test(replyFor("I can't find the sign", screenQueens, 2, false).line),
  "a lost rider gets a safe recovery prompt instead of another blind instruction",
);
assert(
  /from 42nd Street and Seventh Avenue/i.test(replyFor("help", null, 0, false).line)
    && /Queens \(7\)/.test(replyFor("help", null, 0, false).line),
  "the assistant explains supported destinations and the default start when asked for help",
);
assert(/you're welcome/i.test(replyFor("Thanks", screenQueens, 2, false).line), "chat handles a brief conversational acknowledgement");
assert(
  /no verified step-free path/i.test(replyFor("Does this route have stairs?", screenBronx, 0, false).line),
  "accessibility answers do not promise an unavailable step-free route",
);
const finalConfirmation = advanceStep(screenBronx, screenBronx.steps.length - 1, []);
assert(finalConfirmation.arrived && !/train is coming|minutes?/i.test(finalConfirmation.line), "arrival wording makes no live train-time claim");
const rewindArrival = rewindStep(
  screenBronx,
  screenBronx.steps.length - 1,
  screenBronx.steps.map((routeStep) => routeStep.id),
  finalConfirmation.arrived,
);
assert(!rewindArrival.arrived && rewindArrival.doneIds.length === screenBronx.steps.length - 1, "riders can recover if they accidentally confirmed arrival");
assert(/from Times Square/i.test(OPENING), "the opening tells riders routes start from Times Square by default");
assert(
  routeForTrip("uptown-123")?.startNodeId === "ent-42-7",
  "a destination-only request uses the default 42nd Street and Seventh Avenue entrance",
);

const nqrwStart = matchObservation("I'm at the northwest corner of 43rd Street and Broadway.");
assert(nqrwStart.node?.id === "ent-43-broadway", "the MTA-listed EL619 entrance can be reported as a route start");
assert(matchRoute("Uptown N/Q/R/W") === null, "the N/Q/R/W route is not guessed from the default 42nd Street entrance");
assert(
  /43rd Street and Broadway/i.test(replyFor("Uptown N/Q/R/W", null, 0, false).line),
  "unsupported N/Q/R/W starting locations request the mapped entrance",
);
assert(
  matchRoute("N train uptown", { startNodeId: nqrwStart.node.id })?.tripId === "nqrw-uptown",
  "an individual N/Q/R/W letter resolves to its shared uptown platform route",
);
const nqrwFree = matchRoute("Uptown N/Q/R/W", {
  startNodeId: nqrwStart.node.id,
  stepFree: true,
});
assert(nqrwFree?.steps.map((step) => step.edgeType).join(",") === "elevator,elevator", "the verified N/Q/R/W step-free route follows EL619 and EL230");
assert(nqrwFree.steps.map((step) => step.id).length === 2, "the N/Q/R/W route advances one elevator at a time");
assert(
  matchRoute("Uptown N/Q/R/W", {
    startNodeId: nqrwStart.node.id,
    stepFree: true,
    equipmentStatuses: { EL230: "RNOS" },
  }) === null,
  "the N/Q/R/W step-free route is blocked if EL230 is reported unavailable",
);
assert(
  matchRoute("Uptown N/Q/R/W", {
    startNodeId: nqrwStart.node.id,
    stepFree: true,
    equipmentStatuses: { EL230: "UNKNOWN" },
  }) === null,
  "the N/Q/R/W step-free route fails closed when elevator status is missing",
);
const accessibleShortcutRoute = routeForTrip("nqrw-uptown", {
  startNodeId: "ent-43-broadway",
  stepFree: true,
});
assert(
  accessibleShortcutRoute?.steps.map((step) => step.edgeType).join(",") === "elevator,elevator",
  "the accessible shortcut creates its route from the explicitly confirmed EL619 start",
);
assert(
  /only mapped step-free platform route is Uptown N\/Q\/R\/W from elevator EL619/i.test(replyFor(
    "Step-free to the Bronx",
    null,
    0,
    false,
    { stepFree: true, startNodeId: "ent-42-7" },
  ).line),
  "a blocked accessible destination explains the available route instead of a generic no-path error",
);
assert(
  /step-free path is mapped/i.test(replyFor(
    "Does this use stairs?",
    matchRoute("Uptown N/Q/R/W", { startNodeId: nqrwStart.node.id }),
    0,
    false,
  ).line),
  "accessibility answers use graph and equipment availability",
);
assert(matchSignText("UPTOWN N Q R W").node?.id === "nqrw-uptown", "OCR can identify the line-qualified N/Q/R/W uptown platform");

const firstVoiceConfirmation = replyFor("Okay, I'm there", screenBronx, 0, false, { doneIds: [] });
assert(firstVoiceConfirmation.cursor === 1, "saying okay, I'm there advances one completed route step");
assert(firstVoiceConfirmation.doneIds.length === 1, "voice step confirmation records only the completed step");
assert(firstVoiceConfirmation.line === screenBronx.steps[1].instruction, "voice confirmation speaks only the next step");
assert(replyFor("okay", screenBronx, 0, false).cursor === undefined, "an unqualified okay never advances the route");
const finalVoiceConfirmation = replyFor("I've completed that", screenBronx, screenBronx.steps.length - 1, false);
assert(finalVoiceConfirmation.arrived && /platform|boarding/i.test(finalVoiceConfirmation.line), "voice confirms the final step with a platform check");

const liveArrivals = {
  fetchedAt: Date.now(),
  stationName: "Times Sq-42 St",
  next: [
    { label: "1 Van Cortlandt Park-242 St", at: Date.now() + 4 * 60000 },
    { label: "2 Wakefield-241 St", at: Date.now() + 8 * 60000 },
  ],
};
const trainTimeAnswer = replyFor("When is the train?", screenBronx, 0, false, { arrivals: liveArrivals });
assert(
  /subwayinfo\.nyc/.test(trainTimeAnswer.line)
    && /updated just now/i.test(trainTimeAnswer.line)
    && /Van Cortlandt Park-242 St in 4 minutes/i.test(trainTimeAnswer.line)
    && /check the train sign/i.test(trainTimeAnswer.line),
  "a train-time question names the feed, its age, and a train the walk can reach",
);
assert(
  /none is one you can count on catching/i.test(nextTrainLine({
    fetchedAt: Date.now(),
    source: "subwayinfo.nyc",
    next: [{ label: "1 Van Cortlandt Park-242 St", at: Date.now() + 2 * 60000 }],
  }, Date.now(), { walkMinutes: 4 })),
  "a train due before the mapped walk ends is not offered as the one to catch",
);
assert(
  /can't get live train times/i.test(replyFor("When is the train?", screenBronx, 0, false).line),
  "a train-time question says when the feed is missing",
);
const staleArrivals = { ...liveArrivals, fetchedAt: Date.now() - 4 * 60000 };
assert(
  /can't get live train times/i.test(replyFor("how soon", screenBronx, 0, false, { arrivals: staleArrivals }).line),
  "a train-time question ignores a stale feed",
);
const arrivedWithTimes = replyFor("I'm there", screenBronx, screenBronx.steps.length - 1, false, { arrivals: liveArrivals });
assert(
  arrivedWithTimes.arrived && /Van Cortlandt Park-242 St in 4 minutes/i.test(arrivedWithTimes.line),
  "reaching the platform includes the next trains",
);
const imessageTimes = processTextMessage(imessageStart.state, "when is the train", { arrivals: liveArrivals });
assert(
  /subwayinfo\.nyc/.test(imessageTimes.reply) && imessageTimes.state.cursor === 0,
  "iMessage can answer a train-time question without advancing the route",
);

const rewindByText = replyFor("go back one step", screenBronx, firstVoiceConfirmation.cursor, false, {
  doneIds: firstVoiceConfirmation.doneIds,
});
assert(
  rewindByText.cursor === 0
    && rewindByText.doneIds.length === 0
    && /go back one step/i.test(rewindByText.line),
  "saying go back one step undoes the last confirmation",
);
assert(
  /no step to undo/i.test(replyFor("go back", null, 0, false).line),
  "go back before a route starts does not invent a direction",
);
const imessageRewind = processTextMessage(imessageAdvance.state, "previous step");
assert(
  imessageRewind.state.cursor === 0 && imessageRewind.state.doneIds.length === 0,
  "iMessage can undo one confirmed step",
);
const elevatorStatus = replyFor("Is EL232 working?", null, 0, false);
assert(
  /EL232/.test(elevatorStatus.line)
    && /out of service/i.test(elevatorStatus.line)
    && /not a live outage check/i.test(elevatorStatus.line),
  "an elevator-code question uses the station inventory and says it is not live",
);
const refreshedElevator = replyFor("elevator status", null, 0, false, {
  equipmentStatuses: { EL619: "RNOS", EL231X: "IFIS", EL230: "IFIS", EL229: "RNOS", EL233: "RNOS", EL232: "RNOS" },
});
assert(
  /EL619/.test(refreshedElevator.line) && /not a live outage check/i.test(refreshedElevator.line),
  "a general elevator question can use a refreshed inventory snapshot",
);
const stepFreePreference = processTextMessage(createConversationState(), "I need a step-free route");
const stepFreeQueens = processTextMessage(stepFreePreference.state, "Queens");
assert(
  stepFreePreference.state.stepFree === true
    && /no verified step-free path/i.test(stepFreeQueens.reply),
  "iMessage keeps a step-free request for the next destination",
);
const blockedElevator = processTextMessage(
  { ...createConversationState(), stepFree: true, pendingTripId: "nqrw-uptown" },
  "I'm at the EL619 elevator",
  { equipmentStatuses: { EL230: "RNOS" } },
);
assert(
  /no verified step-free/i.test(blockedElevator.reply) && !blockedElevator.state.route,
  "iMessage step-free routing uses the refreshed elevator inventory",
);

console.log("self-check ok");
