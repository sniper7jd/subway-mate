import station from "./times-square.json" with { type: "json" };
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const downtown = buildLocalManifest(station, "downtown-123", "tourist");
const uptownHit = interpretSign("UPTOWN & THE BRONX 1 2 3", downtown);
assert(uptownHit.kind === "match", "uptown sign should match");
assert(/turn around/i.test(uptownHit.sentence), uptownHit.sentence);

const downtownHit = interpretSign("DOWNTOWN & BROOKLYN", downtown);
assert(/you're good\. follow this\./i.test(downtownHit.sentence), downtownHit.sentence);

const wheelchair = buildLocalManifest(station, "queens-7", "wheelchair");
const stairs = interpretSign("7 TRAIN TO QUEENS STAIRS", wheelchair);
assert(/do not follow these stairs/i.test(stairs.sentence), stairs.sentence);
assert(/southeast corner of 42nd/i.test(stairs.sentence), stairs.sentence);

const bronxRoute = findPath(station, "ent-42-7", "uptown-123", { stepFree: false });
assert(bronxRoute.some((edge) => edge.type === "stairs"), "bronx route uses stairs");
const queensFree = findPath(station, "ent-42-7", "seven-elevator", { stepFree: true });
assert(queensFree.length > 0 && queensFree.every((edge) => edge.type !== "stairs"), "step-free route has no stairs");
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

console.log("self-check ok");
