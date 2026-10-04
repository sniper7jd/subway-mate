import { normalizeText } from "./guidance.js";

function nodeCuePhrases(node) {
  return [
    node.name,
    ...(node.expectedText || []),
    ...(node.observationAliases || []),
    ...(node.landmarks || []),
    ...(node.photoCueText || []),
  ]
    .map((phrase) => String(phrase || "").trim())
    .filter((phrase) => normalizeText(phrase).length >= 4);
}

export function buildVisionCueCatalog(station) {
  return station.nodes.map((node) => ({
    nodeId: node.id,
    name: node.name,
    cues: [...new Set(nodeCuePhrases(node))],
  }));
}

export function sanitizeVisionCueMatch(station, raw) {
  const catalog = buildVisionCueCatalog(station);
  const byNormalizedCue = new Map();
  for (const entry of catalog) {
    for (const cue of entry.cues) {
      const normalized = normalizeText(cue);
      const match = byNormalizedCue.get(normalized) || { cue, ids: [] };
      match.ids.push(entry.nodeId);
      byNormalizedCue.set(normalized, match);
    }
  }

  const acceptedMatches = [...new Set((Array.isArray(raw?.matchedCues) ? raw.matchedCues : [])
    .filter((cue) => typeof cue === "string")
    .map((cue) => normalizeText(cue))
    .filter((cue) => cue && byNormalizedCue.has(cue)))];
  const matchedCues = acceptedMatches.map((cue) => byNormalizedCue.get(cue).cue);
  const candidateIds = [...new Set(acceptedMatches.flatMap((cue) => byNormalizedCue.get(cue).ids))];
  const visibleText = typeof raw?.visibleText === "string"
    ? raw.visibleText.trim().slice(0, 240)
    : "";
  const candidateNodes = candidateIds.map((id) => station.nodes.find((node) => node.id === id));

  let message;
  if (candidateNodes.length === 1) {
    message = `The image may show ${matchedCues.join(", ")} near ${candidateNodes[0].name}. Are you physically at that place? Confirm only if you are.`;
  } else if (candidateNodes.length > 1) {
    message = `I can make out ${matchedCues.join(", ")}, but that clue fits more than one mapped place: ${candidateNodes.map((node) => node.name).join(" or ")}. Which one are you standing at?`;
  } else if (visibleText) {
    message = `I can read “${visibleText},” but I can't match it to one known station location. Tell me the train number or letter and direction, or try a closer photo.`;
  } else {
    message = "I can't identify a known station clue in this frame. Move closer to a sign or landmark, or tell me what you can read. I won't guess your location.";
  }

  return { visibleText, matchedCues, candidateIds, message };
}
