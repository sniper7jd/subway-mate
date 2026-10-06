import { useEffect, useMemo, useState } from "react";
import { CircleMarker, MapContainer, Polygon, Polyline, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MultiFloorRouter } from "../shared/router.js";
import diagram from "../shared/times-square-diagram.geojson" with { type: "json" };

const router = MultiFloorRouter.fromGeoJSON(diagram);
const FLOORS = [
  { level: 0, label: "Street" },
  { level: -1, label: "Mezzanine" },
  { level: -2, label: "Platforms" },
  { level: -3, label: "Lower mezzanine" },
  { level: -4, label: "7" },
];
const DIAGRAM_BOUNDS = [[385, 40], [445, 460]];

const points = diagram.features.filter((feature) => feature.geometry.type === "Point");

function floorLabel(level) {
  return FLOORS.find((floor) => floor.level === level)?.label || `Level ${level}`;
}

function toLatLng([x, y]) {
  return [y, x];
}

function FitDiagram() {
  const map = useMap();
  useEffect(() => {
    const fit = () => {
      map.invalidateSize();
      map.fitBounds(DIAGRAM_BOUNDS, { padding: [16, 16] });
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  return null;
}

function ClosePopups({ level, checkpointKey }) {
  const map = useMap();
  useEffect(() => {
    map.closePopup();
  }, [map, level, checkpointKey]);
  return null;
}

export default function Floorplan({ onExit }) {
  const [level, setLevel] = useState(0);
  const [startId, setStartId] = useState("ent-42-7");
  const [endId, setEndId] = useState("seven-platform");
  const [wheelchair, setWheelchair] = useState(false);
  const [checkpoint, setCheckpoint] = useState(null);

  const route = useMemo(
    () => router.findPath(startId, endId, { profile: wheelchair ? "wheelchair" : "tourist" }),
    [startId, endId, wheelchair],
  );

  const confirmedKey = checkpoint ? `${checkpoint.id}_lvl_${checkpoint.level}` : null;
  const highlightedWalk = route.segments.find((segment) => (
    segment.kind === "walk" && segment.nodeIds.includes(confirmedKey)
  ));
  const nextVertical = route.segments.find((segment) => (
    segment.kind === "vertical" && segment.fromKey === confirmedKey
  ));

  const islands = diagram.features.filter((feature) => (
    feature.properties.type === "island" && feature.properties.level === level
  ));
  const corridors = diagram.features.filter((feature) => (
    feature.properties.type === "corridor" && feature.properties.level === level
  ));
  const floorPoints = points.filter((feature) => feature.properties.level === level);

  function chooseStart(id) {
    setStartId(id);
    setCheckpoint(null);
  }

  function chooseEnd(id) {
    setEndId(id);
    setCheckpoint(null);
  }

  function chooseProfile(checked) {
    setWheelchair(checked);
    setCheckpoint(null);
  }

  function checkIn(id, nodeLevel) {
    setCheckpoint({ id, level: nodeLevel });
    setLevel(nodeLevel);
  }

  return (
    <main className="app floorplan">
      <header className="floorplan__header">
        <div>
          <p className="kicker">SCHEMATIC DIAGRAM</p>
          <h1>Times Square floors</h1>
          <p>This is a schematic diagram, not a live location.</p>
        </div>
        <button type="button" className="floorplan__exit" onClick={onExit}>Exit to guidance</button>
      </header>

      <div className="floorplan__controls">
        <label>
          From
          <select value={startId} onChange={(event) => chooseStart(event.target.value)}>
            {points.map((feature) => (
              <option key={feature.properties.id} value={feature.properties.id}>{feature.properties.name}</option>
            ))}
          </select>
        </label>
        <label>
          To
          <select value={endId} onChange={(event) => chooseEnd(event.target.value)}>
            {points.map((feature) => (
              <option key={feature.properties.id} value={feature.properties.id}>{feature.properties.name}</option>
            ))}
          </select>
        </label>
        <label className="floorplan__wheelchair">
          <input
            type="checkbox"
            checked={wheelchair}
            onChange={(event) => chooseProfile(event.target.checked)}
          />
          Wheelchair
        </label>
      </div>

      <div className="floorplan__floors" role="group" aria-label="Floor">
        {FLOORS.map((floor) => (
          <button
            key={floor.level}
            type="button"
            aria-pressed={level === floor.level}
            onClick={() => setLevel(floor.level)}
          >
            {floor.label}
          </button>
        ))}
      </div>

      <div className="floorplan__map">
        <MapContainer
          crs={L.CRS.Simple}
          bounds={DIAGRAM_BOUNDS}
          zoomControl={false}
          attributionControl={false}
          style={{ height: "100%", width: "100%", background: "#09130f" }}
        >
          <FitDiagram />
          <ClosePopups level={level} checkpointKey={confirmedKey} />
          {islands.map((feature) => (
            <Polygon
              key={feature.properties.name}
              positions={feature.geometry.coordinates[0].map(toLatLng)}
              pathOptions={{ color: "#29443a", weight: 1, fillColor: "#10231d", fillOpacity: 1 }}
            />
          ))}
          {corridors.map((feature) => (
            <Polyline
              key={`${feature.properties.from}-${feature.properties.to}`}
              positions={feature.geometry.coordinates.map(toLatLng)}
              pathOptions={{ color: "#3d5c50", weight: 4 }}
            />
          ))}
          {highlightedWalk?.level === level && (
            <Polyline
              positions={highlightedWalk.coordinates.map(toLatLng)}
              pathOptions={{ color: "#9fffcf", weight: 6 }}
            />
          )}
          {floorPoints.map((feature) => {
            const confirmed = checkpoint?.id === feature.properties.id && checkpoint.level === level;
            return (
              <CircleMarker
                key={feature.properties.id}
                center={toLatLng(feature.geometry.coordinates)}
                radius={confirmed ? 9 : 5}
                pathOptions={{
                  color: confirmed ? "#9fffcf" : "#93aaa0",
                  fillColor: confirmed ? "#52eea1" : "#143028",
                  fillOpacity: 1,
                  weight: 2,
                }}
              >
                <Popup>
                  <div className="floorplan__popup">
                    <strong>{feature.properties.name}</strong>
                    <button
                      type="button"
                      onClick={() => checkIn(feature.properties.id, feature.properties.level)}
                    >
                      I'm here
                    </button>
                  </div>
                </Popup>
              </CircleMarker>
            );
          })}
        </MapContainer>

        {nextVertical && (
          <div className="floorplan__transition" role="status">
            <p>{nextVertical.label}</p>
            <button type="button" onClick={() => setLevel(nextVertical.toLevel)}>
              Show {floorLabel(nextVertical.toLevel)}
            </button>
          </div>
        )}

        {!route.success && (
          <p className="floorplan__miss" role="status">No verifiable route found for this profile.</p>
        )}
      </div>
    </main>
  );
}
