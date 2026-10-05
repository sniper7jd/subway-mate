import station from "../shared/times-square.json" with { type: "json" };
import { tripById } from "../shared/guidance.js";

const CACHE_MS = 30_000;
const TRAIN_FEED = "subwayinfo.nyc";
const ERROR_CACHE_MS = 20_000;
const cache = new Map();

export async function loadArrivals(trip) {
  if (!trip?.id || !trip.arrival?.stationId) throw new Error("This trip has no arrival feed");
  const hit = cache.get(trip.id);
  if (hit?.data && Date.now() - hit.at < CACHE_MS) return hit.data;
  if (hit?.error && Date.now() - hit.at < ERROR_CACHE_MS) throw new Error(hit.error);
  try {
    const url = `https://subwayinfo.nyc/api/arrivals?station_id=${encodeURIComponent(trip.arrival.stationId)}`;
    const response = await fetch(url, {
      headers: { "User-Agent": "SubwayMate/1.0" },
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) throw new Error(`Arrivals request failed (${response.status})`);
    const data = await response.json();
    const next = (data.arrivals || [])
      .filter((item) => trip.arrival.lines.includes(item.line) && item.direction === trip.arrival.direction)
      .sort((a, b) => a.minutesAway - b.minutesAway)
      .slice(0, 2)
      .map((item) => ({
        label: `${item.line} ${item.headsign || trip.arrival.label}`,
        at: Date.parse(item.arrivalTime),
      }))
      .filter((item) => Number.isFinite(item.at));
    const result = {
      fetchedAt: Date.now(),
      next,
      stationName: data.stationName || station.stationName,
      source: TRAIN_FEED,
    };
    cache.set(trip.id, { at: Date.now(), data: result });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Arrivals request failed";
    cache.set(trip.id, { at: Date.now(), error: message });
    throw error;
  }
}

export async function arrivalsForTripId(tripId) {
  const trip = tripById(station, tripId);
  if (!trip) return null;
  try {
    return await loadArrivals(trip);
  } catch {
    return null;
  }
}
