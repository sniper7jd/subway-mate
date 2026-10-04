import station from "../shared/times-square.json" with { type: "json" };

const ELEVATOR_SOURCE = "https://data.ny.gov/resource/94fv-bak7.json";
const ELEVATOR_CACHE_MS = 5 * 60 * 1000;
const ERROR_CACHE_MS = 60 * 1000;
let elevatorInventoryCache = null;
let elevatorInventoryErrorAt = 0;

export async function loadElevatorInventory() {
  if (elevatorInventoryCache && Date.now() - elevatorInventoryCache.fetchedAt < ELEVATOR_CACHE_MS) {
    return elevatorInventoryCache;
  }
  if (Date.now() - elevatorInventoryErrorAt < ERROR_CACHE_MS) {
    throw new Error("MTA elevator inventory is temporarily unavailable");
  }
  try {
    const url = new URL(ELEVATOR_SOURCE);
    url.searchParams.set("$where", "station_complex_mrn='611'");
    url.searchParams.set("$select", "equipment_code,service_status_code,service_status,notes");
    url.searchParams.set("$limit", "100");
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`MTA elevator inventory request failed (${response.status})`);
    const records = await response.json();
    if (!Array.isArray(records)) throw new Error("MTA elevator inventory returned an invalid response");
    const equipmentStatuses = Object.fromEntries(records
      .filter((record) => typeof record.equipment_code === "string" && typeof record.service_status_code === "string")
      .map((record) => [record.equipment_code, record.service_status_code]));
    for (const asset of station.elevatorAssets || []) {
      if (!Object.hasOwn(equipmentStatuses, asset.equipmentCode)) {
        equipmentStatuses[asset.equipmentCode] = "UNKNOWN";
      }
    }
    const result = {
      source: ELEVATOR_SOURCE,
      datasetId: "94fv-bak7",
      fetchedAt: Date.now(),
      live: false,
      equipmentStatuses,
      equipment: records.map((record) => ({
        equipmentCode: record.equipment_code,
        serviceStatusCode: record.service_status_code,
        serviceStatus: record.service_status,
        notes: record.notes || "",
      })),
      notice: "MTA inventory is periodically updated, not a live outage feed. Confirm elevator availability with MTA or station staff.",
    };
    elevatorInventoryCache = result;
    elevatorInventoryErrorAt = 0;
    return result;
  } catch (error) {
    elevatorInventoryErrorAt = Date.now();
    throw error;
  }
}
