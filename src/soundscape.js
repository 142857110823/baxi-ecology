import {DURATION} from './simulation.js';

const finite = value => Number.isFinite(value) ? value : 0;
const unit = value => Math.max(0, Math.min(1, finite(value)));
const smooth = value => {const t = unit(value); return t * t * (3 - 2 * t);};

/** Linear amplitude targets, not a claim about measured weather or loudness. */
export function soundscapeEnvelope({phase = 'prepare', time = 0, paused = false, replay = false, reduced = false, enabled = true} = {}) {
 if (!enabled || paused || replay?.paused) return {stream: 0, rain: 0};
 const active = replay ? 'wave' : phase;
 if (!['prepare', 'wave', 'aftermath', 'complete'].includes(active)) return {stream: 0, rain: 0};
 const t = Math.max(0, finite(time)), scale = reduced ? .65 : 1;
 const storm = active === 'wave' ? smooth(t / 3.4) * smooth((DURATION - t) / 7.5) : 0;
 const variation = reduced ? .93 : .92 + .08 * Math.sin(t * .73 + Math.sin(t * .17));
 const stream = active === 'aftermath' ? .030 : active === 'complete' ? .025 : .028;
 return {stream: (stream + .012 * storm) * scale, rain: .075 * storm * variation * scale};
}

function noiseBuffer(context, kind, seconds, seed) {
 const rate = context.sampleRate, length = Math.round(rate * seconds);
 const overlap = Math.min(Math.round(rate * .18), Math.floor(length / 4));
 const buffer = context.createBuffer(2, length, rate);
 for (let channel = 0; channel < 2; channel++) {
  let randomState = (seed + channel * 977) >>> 0, low = 0, slow = 0, droplet = 0;
  const random = () => {randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState / 4294967296;};
  const raw = new Float32Array(length + overlap);
  // Noise excites slow irregular washes and short splashes; there are no tone sources.
  for (let i = 0; i < raw.length; i++) {
   const white = random() * 2 - 1;
   low = low * .96 + white * .04;
   slow = slow * .998 + white * .002;
   if (random() < 7 / rate) droplet = .2 + random() * .6;
   droplet *= Math.exp(-1 / (rate * .018));
   const wash = .70 + Math.min(.30, Math.abs(slow) * 4);
   raw[i] = kind === 'stream'
    ? Math.max(-1, Math.min(1, (low * 3.6 + white * .16) * wash))
    : Math.max(-1, Math.min(1, white * (.48 + droplet * .24) + low * .30));
  }
  const output = buffer.getChannelData(channel);
  output.set(raw.subarray(0, length));
  // Continue the tail across the seam, then crossfade into the original head.
  for (let i = 0; i < overlap; i++) {
   const blend = smooth(i / Math.max(1, overlap - 1));
   output[i] = raw[length + i] * (1 - blend) + raw[i] * blend;
  }
 }
 return buffer;
}

export function createSoundscape() {
 let context = null, graph = null, enabled = true, disposed = false, didUnlock = false;
 let status = 'locked', error = '', pendingUnlock = null, closing = null;
 let input = {phase: 'prepare', time: 0, paused: false, replay: false, reduced: false};
 let targets = {stream: 0, rain: 0};
 const constructor = () => globalThis.AudioContext || globalThis.webkitAudioContext;

 function parameter(node) {
  node.gain.value = 0;
  return {param: node.gain, from: 0, to: 0, start: context.currentTime, end: context.currentTime};
 }
 function ramp(record, target, seconds) {
  if (record.to === target) return;
  const now = context.currentTime;
  const amount = record.end <= record.start ? 1 : unit((now - record.start) / (record.end - record.start));
  const held = record.from + (record.to - record.from) * amount;
  record.param.cancelScheduledValues(now);
  record.param.setValueAtTime(held, now);
  record.param.linearRampToValueAtTime(target, now + seconds);
  Object.assign(record, {from: held, to: target, start: now, end: now + seconds});
 }
 function apply() {
  targets = soundscapeEnvelope({...input, enabled: enabled && !disposed});
  if (!graph || !context || context.state === 'closed') return;
  const audible = targets.stream > 0 || targets.rain > 0;
  ramp(graph.stream, targets.stream, .12);
  ramp(graph.rain, targets.rain, .18);
  // Linear fade reaches literal zero; unchanged mute targets are never rescheduled.
  ramp(graph.master, audible ? 1 : 0, audible ? .09 : .020);
 }
 function disconnectGraph() {
  if (!graph) return;
  for (const source of graph.sources) {
   try {source.stop();} catch {}
   source.buffer = null;
  }
  for (const node of graph.nodes) {try {node.disconnect();} catch {}}
  graph = null;
 }
 function buildGraph() {
  const nodes = [], sources = [];
  graph = {nodes, sources};
  const own = node => {nodes.push(node); return node;};
  const master = own(context.createGain());
  graph.master = parameter(master);
  master.connect(context.destination);
  for (const [kind, seconds, seed, high, low] of [
   ['stream', 8, 20261113, 85, 2100],
   ['rain', 11, 20261114, 650, 6200],
  ]) {
   const source = own(context.createBufferSource());
   sources.push(source);
   source.buffer = noiseBuffer(context, kind, seconds, seed);
   source.loop = true;
   const highpass = own(context.createBiquadFilter()), lowpass = own(context.createBiquadFilter());
   highpass.type = 'highpass'; highpass.frequency.value = Math.min(high, context.sampleRate * .4); highpass.Q.value = .5;
   lowpass.type = 'lowpass'; lowpass.frequency.value = Math.min(low, context.sampleRate * .45); lowpass.Q.value = .5;
   const gain = own(context.createGain());
   graph[kind] = parameter(gain);
   source.connect(highpass); highpass.connect(lowpass); lowpass.connect(gain); gain.connect(master);
   source.start();
  }
 }

 function unlock() {
  if (disposed || !enabled) return Promise.resolve(false);
  if (pendingUnlock) return pendingUnlock;
  if (context?.state === 'running') {didUnlock = true; status = 'running'; error = ''; apply(); return Promise.resolve(true);}
  const Audio = constructor();
  if (typeof Audio !== 'function') {status = 'unsupported'; return Promise.resolve(false);}
  // Parent must call from a trusted gesture; browsers exposing activation can enforce it here.
  if (globalThis.navigator?.userActivation?.isActive === false) {
   error = 'gesture-required'; return Promise.resolve(false);
  }
  if (!context) {
   try {
    context = new Audio({latencyHint: 'playback'});
    buildGraph();
   } catch (failure) {
    error = String(failure?.message || failure); status = 'blocked';
    disconnectGraph();
    try {Promise.resolve(context?.close()).catch(() => {});} catch {}
    context = null;
    return Promise.resolve(false);
   }
  }
  const ownedContext = context;
  status = 'unlocking';
  pendingUnlock = (async () => {
   try {
    await (ownedContext.state === 'running' ? Promise.resolve() : ownedContext.resume());
    if (disposed) return false;
    status = ownedContext.state === 'running' ? 'running' : 'blocked';
    if (status === 'running') didUnlock = true;
    error = status === 'running' ? '' : 'audio-not-running';
    apply();
    return status === 'running';
   } catch (failure) {
    if (!disposed) {status = 'blocked'; error = String(failure?.message || failure);}
    return false;
   } finally {pendingUnlock = null;}
  })();
  return pendingUnlock;
 }
 function setEnabled(value) {
  if (disposed) return;
  enabled = !!value;
  apply();
 }
 function update(value = {}) {
  if (disposed) return;
  input = {
   phase: value.phase ?? 'prepare', time: finite(value.time),
   paused: !!value.paused || !!value.replay?.paused, replay: !!value.replay, reduced: !!value.reduced,
  };
  apply();
 }
 function dispose() {
  if (disposed) return closing || Promise.resolve();
  disposed = true; enabled = false; status = 'disposed'; targets = {stream: 0, rain: 0};
  disconnectGraph();
  const ownedContext = context;
  try {closing = ownedContext && ownedContext.state !== 'closed' ? Promise.resolve(ownedContext.close()).catch(() => {}) : Promise.resolve();}
  catch {closing = Promise.resolve();}
  return closing;
 }
 return {
  unlock, setEnabled, update, dispose,
  get state() {
   let currentStatus = status;
   if (disposed) currentStatus = 'disposed';
   else if (context?.state === 'running') currentStatus = 'running';
   else if (context && !['blocked', 'unlocking'].includes(status)) currentStatus = context.state;
   return {
    enabled, unlocked: didUnlock && !disposed, disposed,
    status: currentStatus,
    contextState: context?.state ?? null,
    silent: disposed || !context || context.state !== 'running' || targets.stream === 0 && targets.rain === 0,
    stream: targets.stream, rain: targets.rain, error,
   };
  },
 };
}
