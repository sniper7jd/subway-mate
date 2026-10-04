export const ENTRANCE_LINE =
  "42 St / 7 Av. Times Square, Broadway entrance. Where do you want to go?";

export const OPENING = ENTRANCE_LINE;

export const ONLY_DEMO = "This demo only walks to the Bronx or Queens.";

export const ARRIVAL_LINE =
  "Go out. Your train is coming on the left in about 5 minutes. Press End when you are done.";

const demoBeats = [
  { id: "right", onMap: true, instruction: "Go right.", subtext: "", cue: "GO RIGHT", distance: "", heading: "East", tone: "forward" },
  { id: "stairs", onMap: true, instruction: "Go down the stairs.", subtext: "", cue: "GO DOWN", distance: "", heading: "South", tone: "forward" },
  { id: "wrong", onMap: false, instruction: "You're on the wrong way. Go back 20 meters.", subtext: "", cue: "BACK 20m", distance: "20m", heading: "North", tone: "back" },
  { id: "left", onMap: true, instruction: "Go left.", subtext: "", cue: "GO LEFT", distance: "", heading: "West", tone: "forward" },
  { id: "down", onMap: true, instruction: "Go down.", subtext: "Your train should be on the left.", cue: "GO DOWN", distance: "", heading: "South", tone: "forward", arrive: true },
];

function withBeats(route) {
  const beats = demoBeats.map((beat) => ({ ...beat }));
  return {
    ...route,
    totalCheckpoints: beats.filter((beat) => beat.onMap).length,
    beats,
    steps: beats.filter((beat) => beat.onMap),
  };
}

export const routeBronx = withBeats({
  destination: "The Bronx / Van Cortlandt Park",
  trainLine: "1 Train (Uptown & The Bronx)",
  platform: "Platform 2 - Upper Level",
});

export const routeQueens = withBeats({
  destination: "Queens / Flushing",
  trainLine: "7 Train (Queens-bound)",
  platform: "Platform 5 - Deep Lower Level",
});

export function signCaption(id) {
  return {
    "downtown-brooklyn": "This is Downtown and Brooklyn.",
    "uptown-bronx-123": "This is Uptown and the Bronx, 1 2 3.",
    "uptown-bronx-1": "This is the uptown 1.",
    "one-train-uptown": "This is the 1 train uptown.",
    "seven-flushing": "This is the 7 train to Flushing.",
    "seven-platform": "This is the 7 train platform.",
    nqrw: "This is N, Q, R, and W.",
  }[id] || "I don't see a station sign.";
}

export function matchRoute(text) {
  const q = String(text || "").toLowerCase();
  if (/\bbronx\b|\bvan cortlandt\b/.test(q)) return routeBronx;
  if (/\bqueens\b|\bflushing\b/.test(q)) return routeQueens;
  return null;
}

export function startLine(route) {
  const step = route.beats[0];
  return `${route.trainLine}. ${route.platform}. ${stepLine(step)}`;
}

function stepLine(step) {
  return [step.instruction, step.subtext].filter(Boolean).join(" ");
}

export function mapIndexFor(route, cursor) {
  const beats = route?.beats || [];
  let lastMap = 0;
  let count = -1;
  for (let index = 0; index < beats.length; index += 1) {
    if (!beats[index].onMap) continue;
    count += 1;
    if (index <= cursor) lastMap = count;
    if (index === cursor) return count;
  }
  return lastMap;
}

export function advanceStep(route, cursor, doneIds) {
  const beats = route.beats;
  const done = new Set(doneIds);
  const current = beats[cursor];
  const nextIndex = cursor + 1;
  if (!beats[nextIndex]) {
    if (current?.onMap) done.add(current.id);
    return {
      cursor,
      doneIds: [...done],
      arrived: true,
      line: current ? stepLine(current) : ARRIVAL_LINE,
      tone: current?.tone || "forward",
    };
  }
  if (current?.onMap && beats[nextIndex].onMap) done.add(current.id);
  if (!current?.onMap && beats[nextIndex].onMap) {
    for (let index = cursor - 1; index >= 0; index -= 1) {
      if (beats[index].onMap) {
        done.add(beats[index].id);
        break;
      }
    }
  }
  const next = beats[nextIndex];
  return {
    cursor: nextIndex,
    doneIds: [...done],
    arrived: Boolean(next.arrive),
    line: stepLine(next),
    tone: next.tone,
  };
}

export function replyFor(text, route, cursor, arrived) {
  const picked = matchRoute(text);
  if (!route) {
    if (!picked) return { line: ONLY_DEMO };
    return { route: picked, cursor: 0, doneIds: [], arrived: false, line: startLine(picked) };
  }
  const q = String(text || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const switchOnly = /^(the )?(bronx|van cortlandt( park)?|queens|flushing)$/.test(q);
  if (switchOnly && picked && picked.destination !== route.destination) {
    return { route: picked, cursor: 0, doneIds: [], arrived: false, line: startLine(picked) };
  }
  if (arrived) return { line: ARRIVAL_LINE };
  if (/\btrain\b/.test(q)) return { line: `${route.trainLine}. ${route.platform}.` };
  if (/\bplatform\b/.test(q)) return { line: route.platform };
  const step = route.beats?.[cursor] || route.beats?.[0];
  return { line: stepLine(step) };
}

export function applySign(route, cursor, doneIds, signId) {
  const steps = route.steps;
  const current = steps[cursor];
  const offIndex = steps.findIndex((step) => step.isOffPath);
  const off = steps[offIndex];
  const done = new Set(doneIds);

  if (off && signId === off.signId && cursor !== offIndex) {
    return {
      cursor: offIndex,
      doneIds: [...done],
      arrived: false,
      line: stepLine(off),
      tone: "back",
    };
  }

  if (current?.isOffPath) {
    const next = steps[cursor + 1];
    if (next && signId === next.signId) {
      done.add(current.id);
      const last = cursor + 1 === steps.length - 1;
      if (last) done.add(next.id);
      return {
        cursor: cursor + 1,
        doneIds: [...done],
        arrived: last,
        line: last ? `${stepLine(next)} ${ARRIVAL_LINE}` : stepLine(next),
        tone: last ? "arrive" : "forward",
      };
    }
    return {
      cursor,
      doneIds: [...done],
      arrived: false,
      line: stepLine(current),
      tone: "back",
    };
  }

  if (current && signId === current.signId) {
    done.add(current.id);
    let nextIndex = cursor + 1;
    if (steps[nextIndex]?.isOffPath) nextIndex += 1;
    if (nextIndex >= steps.length) {
      return {
        cursor,
        doneIds: [...done],
        arrived: true,
        line: ARRIVAL_LINE,
        tone: "arrive",
      };
    }
    return {
      cursor: nextIndex,
      doneIds: [...done],
      arrived: false,
      line: stepLine(steps[nextIndex]),
      tone: "forward",
    };
  }

  return {
    cursor,
    doneIds: [...done],
    arrived: false,
    line: `${signCaption(signId)} That is not the sign for this step. ${current ? stepLine(current) : ""}`.trim(),
    tone: null,
  };
}
