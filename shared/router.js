export class MultiFloorRouter {
  constructor(nodes, edges) {
    this.nodes = nodes;
    this.edges = edges;
  }

  static fromGeoJSON(collection) {
    const nodes = new Map();
    const edges = new Map();

    for (const feature of collection.features) {
      const properties = feature.properties;
      if (!properties) continue;
      if (properties.id && properties.level !== undefined && feature.geometry?.type === "Point") {
        const key = `${properties.id}_lvl_${properties.level}`;
        nodes.set(key, feature);
        if (!edges.has(key)) edges.set(key, []);
      }
    }

    for (const feature of collection.features) {
      const properties = feature.properties;
      if (!properties) continue;
      if (properties.type === "corridor") {
        const fromKey = `${properties.from}_lvl_${properties.level}`;
        const toKey = `${properties.to}_lvl_${properties.level}`;
        if (edges.has(fromKey) && edges.has(toKey)) {
          edges.get(fromKey).push({ target: toKey, weight: properties.weight, edgeFeature: feature });
          edges.get(toKey).push({ target: fromKey, weight: properties.weight, edgeFeature: feature });
        }
      } else if (properties.type === "portal") {
        const fromKey = `${properties.from}_lvl_${properties.level_a}`;
        const toKey = `${properties.to}_lvl_${properties.level_b}`;
        if (edges.has(fromKey) && edges.has(toKey)) {
          edges.get(fromKey).push({ target: toKey, weight: properties.weight, edgeFeature: feature });
          edges.get(toKey).push({ target: fromKey, weight: properties.weight, edgeFeature: feature });
        }
      }
    }

    return new MultiFloorRouter(nodes, edges);
  }

  keysForId(id) {
    const marker = "_lvl_";
    const matches = [];
    for (const key of this.nodes.keys()) {
      const index = key.lastIndexOf(marker);
      if (index !== -1 && key.slice(0, index) === id) matches.push(key);
    }
    return matches;
  }

  findPath(startId, endId, { profile } = {}) {
    const startKeys = this.keysForId(startId);
    const endKeys = this.keysForId(endId);

    if (!startKeys.length || !endKeys.length) return { success: false, path: [], segments: [] };

    const startKey = startKeys[0];
    const endKey = endKeys[0];
    const startNode = this.nodes.get(startKey);
    const endNode = this.nodes.get(endKey);

    if (profile === "wheelchair") {
      if (startNode.properties.accessible === false || endNode.properties.accessible === false) {
        return { success: false, path: [], segments: [] };
      }
    }

    if (startKey === endKey) {
      return { success: true, path: [startKey], segments: [] };
    }

    const distances = {};
    const previous = {};
    const unvisited = new Set(this.nodes.keys());

    for (const key of unvisited) distances[key] = Infinity;
    distances[startKey] = 0;

    while (unvisited.size > 0) {
      let current = null;
      for (const key of unvisited) {
        if (current === null || distances[key] < distances[current]) current = key;
      }

      if (current === null || distances[current] === Infinity || current === endKey) break;
      unvisited.delete(current);

      for (const edge of this.edges.get(current) || []) {
        if (!unvisited.has(edge.target)) continue;

        const properties = edge.edgeFeature.properties;
        if (profile === "wheelchair") {
          if (properties.connector_type === "stairs") continue;
          if (properties.connector_type === "elevator" && properties.status !== "in_service") continue;
        }

        const alt = distances[current] + edge.weight;
        if (alt < distances[edge.target]) {
          distances[edge.target] = alt;
          previous[edge.target] = { node: current, edgeFeature: edge.edgeFeature };
        }
      }
    }

    if (!previous[endKey]) return { success: false, path: [], segments: [] };

    const pathKeys = [];
    const pathEdges = [];
    let cursor = endKey;
    while (previous[cursor]) {
      pathKeys.unshift(cursor);
      pathEdges.unshift(previous[cursor].edgeFeature);
      cursor = previous[cursor].node;
    }
    pathKeys.unshift(startKey);

    return {
      success: true,
      path: pathKeys,
      segments: this.buildSegments(pathKeys, pathEdges),
    };
  }

  buildSegments(pathKeys, pathEdges) {
    const segments = [];
    let currentWalk = null;

    for (let index = 0; index < pathEdges.length; index += 1) {
      const edge = pathEdges[index];
      const properties = edge.properties;
      const fromKey = pathKeys[index];
      const toKey = pathKeys[index + 1];

      if (properties.type === "corridor") {
        if (!currentWalk) {
          currentWalk = {
            kind: "walk",
            level: properties.level,
            nodeIds: [fromKey],
            coordinates: [this.nodes.get(fromKey).geometry.coordinates],
          };
        }
        currentWalk.nodeIds.push(toKey);
        currentWalk.coordinates.push(this.nodes.get(toKey).geometry.coordinates);
      } else if (properties.type === "portal") {
        if (currentWalk) {
          segments.push(currentWalk);
          currentWalk = null;
        }
        const forward = fromKey === `${properties.from}_lvl_${properties.level_a}`;
        segments.push({
          kind: "vertical",
          type: properties.connector_type,
          equipmentId: properties.equipment_id || null,
          fromLevel: forward ? properties.level_a : properties.level_b,
          toLevel: forward ? properties.level_b : properties.level_a,
          label: forward ? properties.instruction : properties.reverse_instruction,
          fromKey,
          toKey,
        });
      }
    }

    if (currentWalk) segments.push(currentWalk);
    return segments;
  }
}
