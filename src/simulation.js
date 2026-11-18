// Teaching model parameters, not measured engineering efficiencies or flood travel times.
import {vegetationContains,VEGETATION_LENGTH_BOUNDS,VEGETATION_WIDTH_BOUNDS} from './vegetation-shape.js';
export const BASELINE = 100;
export const DURATION = 35;
export const DEFAULT_SEED = 20261113;
export const PACKETS_PER_SOURCE = 32;
export const EMISSION_DURATION = 18;
export const TRAVEL_SECONDS_PER_UNIT = 10;
export const COVERAGE_GRID_SIZE = 64;
export const MAX_VEGETATION_REDUCTION = 0.5;
export const VEGETATION_RADIUS = 5;
export const VEGETATION_COST = 2;
export const DAM_EFFICIENCIES = Object.freeze([0.25, 0.45, 0.6]);
export const DAM_CAPACITIES = Object.freeze([6, 12, 18]);
export const DAM_COSTS = Object.freeze([3, 5, 7]);
export const BRANCH_JOINS = Object.freeze({ west: 0.48, east: 0.64 });

const channels = new Set(['main', 'west', 'east']);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const coordinate = value => finite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER;
const validId = value => typeof value === 'string' && value.trim().length > 0;
const unit = value => finite(value) && value >= 0 && value <= 1;
const validLevel = value => Number.isInteger(value) && value >= 0 && value <= 2;
const compareId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

export function costOf(structure) {
  if (!isRecord(structure)) throw new TypeError('Expected a structure');
  if (structure.type === 'vegetation') return VEGETATION_COST;
  if (structure.type === 'dam' && validLevel(structure.level)) return DAM_COSTS[structure.level];
  throw new TypeError('Unknown structure type or invalid dam level');
}

/** Structural validation only: placement, budget and world boundaries belong to the caller. */
export function validateLayoutSchema(payload) {
  const errors = [];
  if (!isRecord(payload) || !Array.isArray(payload.structures)) {
    return { ok: false, errors: ['Expected { structures: [] }'] };
  }
  const ids = new Set();
  let dams = 0;
  let plants = 0;
  payload.structures.forEach((s, index) => {
    const prefix = `structures[${index}]`;
    if (!isRecord(s)) {
      errors.push(`${prefix}: expected an object`);
      return;
    }
    if (!validId(s.id) || ids.has(s.id)) errors.push(`${prefix}: invalid or duplicate id`);
    ids.add(s.id);
    if (!coordinate(s.x) || !coordinate(s.z)) errors.push(`${prefix}: invalid coordinates`);
    if (s.type === 'dam') {
      dams++;
      if (!channels.has(s.channel) || !unit(s.t)) errors.push(`${prefix}: invalid channel or t`);
      if (!validLevel(s.level)) errors.push(`${prefix}: invalid level`);
      if (s.fill !== undefined && (!finite(s.fill) || s.fill < 0 || s.fill > DAM_CAPACITIES[s.level])) {
        errors.push(`${prefix}: invalid fill`);
      }
    } else if (s.type === 'vegetation') {
      plants++;
      if (s.radius !== undefined && s.radius !== VEGETATION_RADIUS) errors.push(`${prefix}: radius must be 5`);
      if (s.rotation !== undefined && !finite(s.rotation)) errors.push(`${prefix}: invalid rotation`);
      for (const [key, bounds] of [['halfLength', VEGETATION_LENGTH_BOUNDS], ['halfWidth', VEGETATION_WIDTH_BOUNDS]]) {
        if (s[key] !== undefined && (!finite(s[key]) || s[key] < bounds[0] || s[key] > bounds[1])) {
          errors.push(`${prefix}: invalid ${key}`);
        }
      }
    } else {
      errors.push(`${prefix}: unknown type`);
    }
  });
  if (dams > 6 || plants > 12) errors.push('Layout exceeds 6 dams or 12 vegetation patches');
  return { ok: errors.length === 0, errors };
}

function copySources(sources) {
  if (!Array.isArray(sources) || sources.length === 0) throw new TypeError('Expected nonempty sources');
  const ids = new Set();
  let total = 0;
  const copies = sources.map(s => {
    if (!isRecord(s) || !validId(s.id) || ids.has(s.id)
      || !coordinate(s.x) || !coordinate(s.z) || !coordinate(s.radius) || s.radius <= 0
      || !finite(s.weight) || s.weight < 0 || !channels.has(s.channel) || !unit(s.t)) {
      throw new TypeError('Invalid source fields or duplicate source id');
    }
    ids.add(s.id);
    total += s.weight;
    return { id: s.id, weight: s.weight, x: s.x, z: s.z, radius: s.radius, channel: s.channel, t: s.t };
  }).sort(compareId);
  if (!finite(total) || Math.abs(total - 1) > 1e-9) throw new TypeError('Source weights must sum to 1');
  // Remove only floating-point normalization error, never silently accept arbitrary weights.
  for (const s of copies) s.weight /= total;
  return copies;
}

function coverageOf(source, vegetation) {
  let inside = 0;
  let covered = 0;
  for (let row = 0; row < COVERAGE_GRID_SIZE; row++) {
    const v = (2 * (row + 0.5) / COVERAGE_GRID_SIZE) - 1;
    for (let col = 0; col < COVERAGE_GRID_SIZE; col++) {
      const u = (2 * (col + 0.5) / COVERAGE_GRID_SIZE) - 1;
      if (u * u + v * v > 1) continue;
      inside++;
      const x = source.x + u * source.radius;
      const z = source.z + v * source.radius;
      if (vegetation.some(p => vegetationContains(p,x,z))) covered++;
    }
  }
  return covered / inside;
}

function routeOf(source) {
  if (source.channel === 'main') return [{ channel: 'main', from: source.t, to: 1 }];
  return [
    { channel: source.channel, from: source.t, to: 1 },
    { channel: 'main', from: BRANCH_JOINS[source.channel], to: 1 },
  ];
}

function routeStops(route, dams) {
  let offset = 0;
  const stops = [];
  for (const segment of route) {
    const local = dams.filter(d => d.channel === segment.channel && d.t >= segment.from && d.t <= segment.to)
      .sort((a, b) => a.t - b.t || compareId(a, b));
    // Match endpoint accumulation so confluence/outlet distances round identically.
    for (const d of local) stops.push({ dam: d, distance: offset + (d.t - segment.from) });
    offset += segment.to - segment.from;
  }
  return { stops, distance: offset };
}

function randomFor(seed, id) {
  let state = seed >>> 0;
  for (let i = 0; i < id.length; i++) state = Math.imul(state ^ id.charCodeAt(i), 16777619) >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function freezeTree(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * Run a deterministic, pure mass ledger. Events contain game seconds and normalized
 * channel positions. Source routes are [{channel, from, to}], upstream to downstream.
 * baseline is this rain's untreated mass; initialFill holds prior absolute deposits.
 * Persist each dam's initialFill + trapped, never trapped alone or a percentage.
 */
export function runSimulation(layout, sources, seed = DEFAULT_SEED, options = {}) {
  const validation = validateLayoutSchema(layout);
  if (!validation.ok) throw new TypeError(validation.errors.join('; '));
  if (!Number.isSafeInteger(seed)) throw new TypeError('Seed must be a safe integer');
  if (!isRecord(options)) throw new TypeError('Expected simulation options');
  const baseline = options.baseline === undefined ? BASELINE : options.baseline;
  if (!finite(baseline) || baseline <= 0 || baseline > 200) throw new TypeError('Baseline must be finite, positive and at most 200');
  const initialFill = options.initialFill === undefined ? {} : options.initialFill;
  if (!isRecord(initialFill)) throw new TypeError('Expected initialFill as a dam id to amount object');
  const sourceResults = copySources(sources);
  const structures = layout.structures;
  const dams = structures.filter(s => s.type === 'dam').map(s => ({
    id: s.id, channel: s.channel, t: s.t, level: s.level, x: s.x, z: s.z,
    capacity: DAM_CAPACITIES[s.level],
    initialFill: Object.prototype.hasOwnProperty.call(initialFill, s.id) ? initialFill[s.id] : 0,
    trapped: 0, incoming: 0, outgoing: 0,
  })).sort(compareId);
  const damById = new Map(dams.map(d => [d.id, d]));
  for (const [id, amount] of Object.entries(initialFill)) {
    const d = damById.get(id);
    if (!d || !finite(amount) || amount < 0 || amount > d.capacity) {
      throw new TypeError(`Invalid initialFill for dam ${id}`);
    }
  }
  const vegetation = structures.filter(s => s.type === 'vegetation');
  const actions = [];

  sourceResults.forEach((s, sourceIndex) => {
    s.coverage = coverageOf(s, vegetation);
    s.prevented = baseline * s.weight * MAX_VEGETATION_REDUCTION * s.coverage;
    s.produced = baseline * s.weight - s.prevented;
    s.route = routeOf(s);
    const { stops, distance } = routeStops(s.route, dams);
    const random = randomFor(seed, s.id);
    let emitted = 0;
    for (let packetIndex = 0; packetIndex < PACKETS_PER_SOURCE; packetIndex++) {
      const amount = packetIndex === PACKETS_PER_SOURCE - 1
        ? s.produced - emitted : s.produced / PACKETS_PER_SOURCE;
      emitted += amount;
      const packet = { amount, source: s.id, packetId: `${s.id}:${packetIndex}` };
      const time = (packetIndex + random()) * EMISSION_DURATION / PACKETS_PER_SOURCE;
      const common = { packet, sourceIndex, packetIndex };
      actions.push({ ...common, time, phase: 0, type: 'emit', channel: s.channel, t: s.t });
      let arrivalTime = time;
      stops.forEach((stop, index) => {
        // Preserve packet causality before the global chronological capacity sort.
        arrivalTime = Math.max(arrivalTime, time + stop.distance * TRAVEL_SECONDS_PER_UNIT);
        actions.push({
          ...common, time: arrivalTime,
          phase: index + 1, type: 'arrive', dam: stop.dam,
          channel: stop.dam.channel, t: stop.dam.t,
        });
      });
      actions.push({
        ...common, time: Math.max(arrivalTime, time + distance * TRAVEL_SECONDS_PER_UNIT),
        phase: stops.length + 1, type: 'export', channel: 'main', t: 1,
      });
    }
  });

  // Sorting arrivals across ALL sources makes capacity shared in actual arrival order.
  actions.sort((a, b) => a.time - b.time || a.sourceIndex - b.sourceIndex
    || a.packetIndex - b.packetIndex || a.phase - b.phase);
  const events = [];
  let exported = 0;
  for (const action of actions) {
    const { packet } = action;
    let amount = packet.amount;
    let type = action.type;
    if (type === 'arrive') {
      const d = action.dam;
      d.incoming += amount;
      const retained = Math.min(amount * DAM_EFFICIENCIES[d.level], Math.max(0, d.capacity - d.initialFill - d.trapped));
      d.trapped += retained;
      packet.amount -= retained;
      d.outgoing += packet.amount;
      amount = retained;
      type = 'trap';
    } else if (type === 'export') {
      exported += amount;
    }
    if (amount > 0) {
      const event = {
        source: packet.source, packetId: packet.packetId, time: action.time, amount, type,
        channel: action.channel, t: action.t,
      };
      if (action.dam) event.structureId = action.dam.id;
      events.push(event);
    }
  }
  for (const d of dams) d.remainingCapacity = Math.max(0, d.capacity - d.initialFill - d.trapped);
  return freezeTree({
    baseline, seed, duration: DURATION,
    produced: sourceResults.reduce((sum, s) => sum + s.produced, 0),
    prevented: sourceResults.reduce((sum, s) => sum + s.prevented, 0),
    trapped: dams.reduce((sum, d) => sum + d.trapped, 0),
    exported, inTransit: 0, sources: sourceResults, dams, events,
  });
}

/**
 * inTransit includes scheduled but not-yet-emitted mass, so this rain's baseline
 * is conserved even before the first emission. Prior deposits are excluded.
 */
export function ledgerAt(result, time) {
  if (!finite(time)) throw new TypeError('Time must be finite seconds');
  let trapped = 0;
  let exported = 0;
  for (const event of result.events) {
    if (event.time > time) break;
    if (event.type === 'trap') trapped += event.amount;
    if (event.type === 'export') exported += event.amount;
  }
  return Object.freeze({
    baseline: result.baseline, prevented: result.prevented, trapped, exported,
    inTransit: Math.max(0, result.baseline - result.prevented - trapped - exported),
  });
}
