export const OPENING =
  "You entered the 42nd Street–Times Square station. Where do you want to go?";

export const ONLY_DEMO = "This demo only walks to the Bronx or Queens.";

export const ARRIVAL_LINE =
  "Go out. Your train is coming on the left in about 5 minutes. Press End when you are done.";

export const routeBronx = {
  destination: "The Bronx / Van Cortlandt Park",
  trainLine: "1 Train (Uptown & The Bronx)",
  platform: "Platform 2 - Upper Level",
  totalCheckpoints: 3,
  steps: [
    {
      id: 1,
      instruction: "Walk straight North for 30 meters through the main turnstiles.",
      subtext: "Keep the station booth on your right.",
      distance: "30m",
      heading: "North",
    },
    {
      id: 2,
      instruction: "Turn right. Walk 15 meters toward the red circular 1 signs.",
      subtext: "You are in the main mezzanine corridor.",
      distance: "15m",
      heading: "East",
    },
    {
      id: 3,
      instruction: "Turn left and head down the stairs to the platform.",
      subtext: "Handrail is on the right side. Platform is 20 steps down.",
      distance: "10m",
      heading: "North",
    },
  ],
};

export const routeQueens = {
  destination: "Queens / Flushing",
  trainLine: "7 Train (Queens-bound)",
  platform: "Platform 5 - Deep Lower Level",
  totalCheckpoints: 3,
  steps: [
    {
      id: 1,
      instruction: "Walk straight West for 50 meters down the long transfer corridor.",
      subtext: "Follow the purple signs. The floor is flat with no steps.",
      distance: "50m",
      heading: "West",
    },
    {
      id: 2,
      instruction: "Turn right and walk 25 meters further West.",
      subtext: "Keep following the purple 7 train signs.",
      distance: "25m",
      heading: "West",
    },
    {
      id: 3,
      instruction: "Take the escalator down to the lower level platform.",
      subtext: "The escalator is directly ahead. Boarding is on both sides.",
      distance: "10m",
      heading: "West",
    },
  ],
};

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
  const step = route.steps[0];
  return `${route.trainLine}. ${route.platform}. ${step.instruction} ${step.subtext}`;
}

function stepLine(step) {
  return `${step.instruction} ${step.subtext}`;
}

export function advanceStep(route, cursor, doneIds) {
  const steps = route.steps;
  const done = new Set(doneIds);
  const current = steps[cursor];
  if (current) done.add(current.id);
  const nextIndex = cursor + 1;
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
  const step = route.steps[cursor] || route.steps[0];
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
