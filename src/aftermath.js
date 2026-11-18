import {DAM_CAPACITIES} from './simulation.js';

const T = window.THREE;
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, finite(value)));
const noise = n => {const f = Math.sin(n * 127.1 + 311.7) * 43758.5453; return f - Math.floor(f);};

/**
 * Finite village restoration scenery. No terrain, simulation or campaign mutation.
 * sync consumes absolute dam fill; tick takes the scene clock in seconds.
 */
export function createAftermath(scene, World) {
 const root = new T.Group();
 root.name = 'village-aftermath';
 scene.add(root);
 const outlet = World.pointAt('main', .86), c = Math.cos(outlet.angle), s = Math.sin(outlet.angle);
 const world = (x, z) => ({x: outlet.x + c * x + s * z, z: outlet.z - s * x + c * z});
 const ground = (x, z) => {const p = world(x, z); return World.heightAt(p.x, p.z);};
  const target = world(24, 11.6);
 const fieldPoint = new T.Vector3(target.x, World.heightAt(target.x, target.z) + .55, target.z);
 const peakAmount = new Map();
 let hints = true, gauges = false, disposed = false, flag = null, sourceHints, goal, rods;
 let previousRound = 0;

 function release() {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  root.traverse(o => {
   if (o.isInstancedMesh) o.dispose();
   if (o.geometry) geometries.add(o.geometry);
   for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
    if (!m) continue;
    materials.add(m);
    if (m.map) textures.add(m.map);
   }
  });
  geometries.forEach(g => g.dispose());
  textures.forEach(t => t.dispose());
  materials.forEach(m => m.dispose());
  root.clear();
  flag = null;
 }

 function sync(state = {}, scenario = {}, layout = []) {
  if (disposed) return;
  release();
  if (finite(state.round) === 0 && previousRound > 0 && !state.history?.length) peakAmount.clear();
  previousRound = finite(state.round);
  const built = !!state.field?.built, integrity = clamp(finite(state.field?.integrity, 100) / 100);
  const history = Array.isArray(state.history) ? state.history : [];
  const material = (color, extra = {}) => new T.MeshStandardMaterial({color, roughness: .97, ...extra});
  const mats = {
   stone: material('#9b9b88', {flatShading: true}), soil: material('#9f8a63'),
   wood: material('#776b50'), rope: material('#c3b998'),
   leaf: material('#73804e', {side: T.DoubleSide}),
   stalk: material('#a9a277'), mud: material('#796f55', {side: T.DoubleSide}),
   risk: material('#b88358'), pale: material('#d3ccb1'), gauge: material('#50695c'),
  };
  const box = new T.BoxGeometry(1, 1, 1), stone = new T.IcosahedronGeometry(1, 1);
  const stonePositions = stone.attributes.position;
  for (let i = 0; i < stonePositions.count; i++) {
   const x = stonePositions.getX(i), y = stonePositions.getY(i), z = stonePositions.getZ(i);
   const weather = 1 + .13 * Math.sin(x * 7.1 + y * 5.3) * Math.cos(z * 9.2 - x * 3);
   stonePositions.setXYZ(i, x * weather, y * weather, z * weather);
  }
  stone.computeVertexNormals();
  const pole = new T.CylinderGeometry(.055, .07, 1, 5);
  // Every shared primitive is used by at least one mesh, then released once on sync.
  const primitiveUse = new Set();
  function group(name, parent = root) {const g = new T.Group(); g.name = name; parent.add(g); return g;}
  function mesh(name, geometry, mat, parent, cast = false) {
   const o = new T.Mesh(geometry, mat); o.name = name;
   o.castShadow = cast; o.receiveShadow = true; parent.add(o);
   primitiveUse.add(geometry); return o;
  }
  function batch(name, geometry, mat, rows, parent, cast = false) {
   if (!rows.length) return null;
   const o = new T.InstancedMesh(geometry, mat, rows.length), dummy = new T.Object3D(), color = new T.Color();
   o.name = name; o.castShadow = cast; o.receiveShadow = true;
   rows.forEach((r, i) => {
    dummy.position.set(...r.p); dummy.scale.set(...r.scale);
    dummy.rotation.set(...(r.rotation || [0, 0, 0]));
    dummy.updateMatrix(); o.setMatrixAt(i, dummy.matrix);
    if (r.tint !== undefined) {color.setScalar(r.tint); o.setColorAt(i, color);}
   });
   o.instanceMatrix.needsUpdate = true;
   if (o.instanceColor) o.instanceColor.needsUpdate = true;
   primitiveUse.add(geometry); parent.add(o); return o;
  }
  function strip(name, points, width, mat, parent, lift = .035) {
   const positions = [], indices = [];
   for (let i = 0; i < points.length; i++) {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz) || 1;
    for (const side of [-1, 1]) {
     const x = points[i][0] - dz / length * width * .5 * side;
     const z = points[i][1] + dx / length * width * .5 * side;
     positions.push(x, points[i][2](x, z) + lift, z);
    }
    if (i) {const n = i * 2; indices.push(n - 2, n - 1, n, n - 1, n + 1, n);}
   }
   const g = new T.BufferGeometry();
   g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
   g.setIndex(indices); g.computeVertexNormals();
   return mesh(name, g, mat, parent);
  }

  const site = group('field-site');
  site.position.set(outlet.x, 0, outlet.z); site.rotation.y = outlet.angle;
  site.userData.fieldPoint = fieldPoint;
  const frontZ = 9.2, leftX = 13.2, rightX = 37.8, backZ = 12.95;
  const fillHeight = (x, z) => ground(x, z) + .19 + .30 * Math.exp(-Math.max(0, z - frontZ) / 1.3);
  const standing = group(built ? 'restored-field' : 'construction-outline', site);
  standing.userData.built = built; standing.userData.integrity = integrity * 100;
  if (built) {
   const positions = [], indices = [], nx = 62, nz = 16;
   for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const x = leftX + (rightX - leftX) * i / nx, z = frontZ + (backZ - frontZ) * j / nz;
    positions.push(x, fillHeight(x, z), z);
   }
   for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i; indices.push(a, a + nx + 1, a + 1, a + 1, a + nx + 1, a + nx + 2);
   }
   const perimeter = [];
   for (let i = 0; i <= nx; i++) perimeter.push(i);
   for (let j = 1; j <= nz; j++) perimeter.push(j * (nx + 1) + nx);
   for (let i = nx - 1; i >= 0; i--) perimeter.push(nz * (nx + 1) + i);
   for (let j = nz - 1; j > 0; j--) perimeter.push(j * (nx + 1));
   // Close the shallow fill to the terrain rather than floating a flat green patch.
   const skirtStart = positions.length / 3;
   for (const i of perimeter) {
    const x = positions[i * 3], z = positions[i * 3 + 2];
    positions.push(x, ground(x, z) + .005, z);
   }
   perimeter.forEach((a, i) => {
    const next = (i + 1) % perimeter.length, b = perimeter[next];
    indices.push(a, skirtStart + i, b, b, skirtStart + i, skirtStart + next);
   });
   const soil = new T.BufferGeometry();
   soil.setAttribute('position', new T.Float32BufferAttribute(positions, 3)); soil.setIndex(indices); soil.computeVertexNormals();
   mesh('soil-fill', soil, mats.soil, standing);

   const stones = [], fallen = [], mudStones = [];
   function wall(x, z, along, index) {
    if (Math.abs(x - 25.5) < .9 && along === 'x') return;
    for (let row = 0; row < 3; row++) {
     const j = index * 3 + row, broken = noise(j + 23) > .55 + integrity * .45 && row > 0;
     const px = x + (along === 'x' ? (row % 2) * .19 : 0);
     const pz = z + (along === 'z' ? (row % 2) * .19 : 0);
     const stoneRow = {
      p: [px, ground(px, pz) + .105 + row * .205, pz],
      scale: [along === 'x' ? .39 : .25, .16 + noise(j) * .035, along === 'x' ? .25 : .39],
      rotation: [.05 * Math.sin(j), j * 2.399, .055 * Math.cos(j)],
      tint: .84 + noise(j + 6) * .30,
     };
     if (broken) {
      const fx = px + .30 + noise(j + 5) * .6, fz = pz - .45 - noise(j + 8) * .7;
      fallen.push({...stoneRow, p: [fx, ground(fx, fz) + .13, fz]});
     } else {
      stones.push(stoneRow);
      if (row === 0 && history.some(h => finite(h.exported) > 0) && noise(j + 91) > .45) {
       mudStones.push({...stoneRow, scale: [stoneRow.scale[0] * 1.01, .045, stoneRow.scale[2] * 1.02]});
      }
     }
    }
   }
   for (let i = 0; i < 45; i++) wall(leftX + .28 + i * .54, frontZ, 'x', i);
   for (let i = 0; frontZ + .35 + i * .54 <= backZ; i++) wall(leftX, frontZ + .35 + i * .54, 'z', i + 45);
   batch('hand-laid-revetment', stone, mats.stone, stones, standing, true);
   batch('dislodged-stones', stone, mats.stone, fallen, standing, true);
   batch('old-mud-on-stone', stone, mats.mud, mudStones, standing);
   const steps = [];
   for (let i = 0; i < 4; i++) {
    const x = 25.5, z = frontZ - .75 + i * .30;
    const height = .16 + i * .10;
    steps.push({p: [x, ground(x, z) + height * .5 - .012, z], scale: [1.35, height, .38], tint: .9 + i * .035});
   }
   batch('access-steps', box, mats.stone, steps, standing, true);
   const furrows = [];
   for (let row = 0; row < 7; row++) {
    const z = frontZ + .65 + row * .48;
    const points = Array.from({length: 53}, (_, i) => [leftX + .5 + i * .45, z + .035 * Math.sin(i * .8 + row), fillHeight]);
    furrows.push(points);
   }
   // All row furrows share one geometry and one draw call.
   const furrowPositions = [];
   for (const points of furrows) for (let i = 1; i < points.length; i++) {
    for (const p of [points[i - 1], points[i]]) furrowPositions.push(p[0], fillHeight(p[0], p[1]) + .014, p[1]);
   }
   const fg = new T.BufferGeometry();
   fg.setAttribute('position', new T.Float32BufferAttribute(furrowPositions, 3));
   const lines = new T.LineSegments(fg, new T.LineBasicMaterial({color: '#807556'})); lines.name = 'cultivation-furrows'; standing.add(lines);
   const crops = group('standing-crops', standing), leaves = [], stalks = [];
   const leaf = new T.BufferGeometry();
   leaf.setAttribute('position', new T.Float32BufferAttribute([0, 0, 0, -.16, .24, .06, 0, .38, .02, 0, 0, 0, .17, .18, -.035, 0, .33, 0], 3));
   leaf.computeVertexNormals();
   for (let row = 0; row < 7; row++) for (let i = 0; i < 51; i++) {
    const id = row * 51 + i;
    if (noise(id + 17) > .12 + integrity * .88) continue;
    const x = leftX + .7 + i * .45 + (noise(id) - .5) * .14;
    const z = frontZ + .65 + row * .48, size = .70 + .45 * noise(id + 88);
    leaves.push({p: [x, fillHeight(x, z) + .015, z], scale: [size, size, size], rotation: [0, id * 2.399, 0], tint: .78 + noise(id + 4) * .4});
    stalks.push({p: [x, fillHeight(x, z) + .14 * size, z], scale: [.20, .27 * size, .20]});
   }
   batch('crop-leaves', leaf, mats.leaf, leaves, crops);
   batch('crop-stalks', pole, mats.stalk, stalks, crops);
   if (!leaves.length) leaf.dispose();
  } else {
   const stakes = [], caps = [];
   for (let i = 0; i < 12; i++) {
    const x = leftX + i * (rightX - leftX) / 11, z = frontZ;
    stakes.push({p: [x, ground(x, z) + .38, z], scale: [1, .82, 1], rotation: [0, .2, .045 * Math.sin(i)]});
    caps.push({p: [x, ground(x, z) + .69, z], scale: [.13, .12, .12]});
   }
   batch('survey-stakes', pole, mats.wood, stakes, standing, true);
   batch('stake-bindings', box, mats.rope, caps, standing);
   for (const [z, name] of [[frontZ, 'front-setting-out'], [backZ, 'rear-setting-out']]) {
    strip(name, Array.from({length: 65}, (_, i) => [leftX + i / 64 * (rightX - leftX), z, ground]), .048, mats.rope, standing);
   }
   const piles = Array.from({length: 28}, (_, i) => {
    const x = 36.7 + (noise(i) - .5) * 1.1, z = 8.2 + (noise(i + 8) - .5) * .8;
    return {p: [x, ground(x, z) + .12 + Math.floor(i / 12) * .12, z], scale: [.27, .17, .24], rotation: [i * .4, i * 2.4, .1], tint: .85 + noise(i + 7) * .3};
   });
   batch('reclaimed-stone-stack', stone, mats.stone, piles, standing, true);
  }

  // Before the first rain the village is not pristine: an old mud tongue, a broken wall
  // corner and a faint waterline make the threat visible without adding a panel.
  const rainThreat = group('rain-threat', site);
  if (!built && history.length === 0) {
   const tongue = Array.from({length: 32}, (_, i) => {
    const u = i / 31, x = leftX + u * (rightX - leftX);
    return [x, frontZ - .18 + Math.sin(u * 7.2) * .22, ground];
   });
   strip('old-mud-tongue', tongue, .55, mats.mud, rainThreat, .055);
   const waterline = tongue.map(([x, z]) => [x, z + .48, ground]);
   strip('old-waterline', waterline, .035, mats.pale, rainThreat, .052);
   const broken = [];
   for (let i = 0; i < 15; i++) {
    const x = leftX + .35 + i * .42, z = frontZ + .18 + (i % 3) * .28;
    broken.push({p: [x, ground(x, z) + .10, z], scale: [.30 + (i % 3) * .04, .16, .26], rotation: [.1 * i, i * 2.399, .08 * (i % 2)], tint: .82 + noise(i + 33) * .25});
   }
   batch('broken-field-wall', stone, mats.stone, broken, rainThreat, true);
  }

  const scars = group('silt-scars', site);
  history.slice(-3).forEach((h, index) => {
   const severity = clamp(finite(h.exported) / Math.max(1, finite(h.baseline, scenario.baseline || 100)));
   if (severity <= .001) return;
   const z = 9.85 + index * 1.05, reach = 4 + severity * 16;
   const scarSurface = (x, z) => built && x >= leftX && x <= rightX && z >= frontZ && z <= backZ ? fillHeight(x, z) : ground(x, z);
   const points = Array.from({length: 55}, (_, i) => {
    const u = i / 54, x = 12.8 + u * reach;
    return [x, z + .16 * Math.sin(u * 11 + index) + u * .33, scarSurface];
   });
   const scar = strip(`silt-trace-${index}`, points, (.13 + severity * .48) * (built ? .32 + (1 - integrity) * .68 : 1), mats.mud, scars, built ? .021 : .045);
   scar.userData.exportRatio = severity;
   scar.userData.won = !!h.won;
  });

  goal = group('field-goal', site);
  goal.position.set(24.3, ground(24.3, 8.35), 8.35);
  goal.userData.action = built ? 'inspect-field' : 'field';
  goal.userData.fieldPoint = fieldPoint;
  goal.userData.label = built ? (integrity < .99 ? '\u7530\u57c2\u53d7\u635f' : '\u7530\u57c2\u5df2\u62a4') : '\u8425\u9020\u7530\u57c2';
  batch('goal-post', pole, mats.wood, [{p: [0, 1.4, 0], scale: [1.2, 2.8, 1.2]}], goal, true);
  const flagG = new T.PlaneGeometry(2.05, .68, 12, 3);
  flagG.translate(1.06, 2.37, 0);
  const flagM = material(built && integrity >= .99 ? '#69795c' : '#b47651', {side: T.DoubleSide});
  if (typeof document !== 'undefined') {
   const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 160;
   const ctx = canvas.getContext('2d');
   if (ctx) {
    ctx.fillStyle = built && integrity >= .99 ? '#69795c' : '#b47651'; ctx.fillRect(0, 0, 512, 160);
    ctx.strokeStyle = '#d9cfac'; ctx.lineWidth = 3; ctx.strokeRect(12, 12, 488, 136);
    ctx.fillStyle = '#eee5cc'; ctx.font = '600 66px "Microsoft YaHei", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(goal.userData.label, 256, 82);
    flagM.map = new T.CanvasTexture(canvas); flagM.map.encoding = T.sRGBEncoding; flagM.color.set('#ffffff');
   }
  }
  flag = mesh('goal-pennant', flagG, flagM, goal);
  flag.frustumCulled = false;

  sourceHints = group('source-hints');
  const sourceList = Array.isArray(World.sources) ? World.sources : [];
  const weighted = sourceList.map(source => ({
   ...source,
   activeWeight: Math.max(0, finite(scenario.sourceWeights?.[source.id], source.weight)),
  })).filter(source => source.activeWeight > .04);
  const maxWeight = Math.max(.001, ...weighted.map(source => source.activeWeight));
  for (const source of weighted) {
   const marker = group(`source-${source.id}`, sourceHints);
   const radius = Math.min(9, 3.2 + 5.2 * Math.sqrt(source.activeWeight / maxWeight));
   marker.userData.sourceId = source.id; marker.userData.weight = source.activeWeight; marker.userData.radius = radius;
   const patchPos = [], patchIdx = [], patchRings = 8, patchSegments = 44;
   for (let ring = 0; ring <= patchRings; ring++) for (let i = 0; i <= patchSegments; i++) {
    const a = i / patchSegments * Math.PI * 2, rr = ring / patchRings;
    const px = source.x + Math.cos(a) * radius * rr;
    const pz = source.z + Math.sin(a) * radius * rr * .68;
    patchPos.push(px, World.heightAt(px, pz) + .055, pz);
   }
   for (let ring = 0; ring < patchRings; ring++) for (let i = 0; i < patchSegments; i++) {
    const a = ring * (patchSegments + 1) + i, b = a + 1, c = a + patchSegments + 1, d = c + 1;
    patchIdx.push(a, c, b, b, c, d);
   }
   const patchGeometry = new T.BufferGeometry();
   patchGeometry.setAttribute('position', new T.Float32BufferAttribute(patchPos, 3));
   patchGeometry.setIndex(patchIdx); patchGeometry.computeVertexNormals();
   const patchMaterial = new T.MeshBasicMaterial({color: '#b5653a', transparent: true, opacity: .30, depthWrite: false, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2});
   const sourcePatch = mesh('source-patch', patchGeometry, patchMaterial, marker);
   sourcePatch.castShadow = false; sourcePatch.receiveShadow = false; sourcePatch.renderOrder = 2;
   const p = World.pointAt(source.channel, source.t), angle = finite(p.angle);
   const wc = Math.cos(angle), ws = Math.sin(angle), points = [], stakes = [], ties = [];
   for (let i = 0; i <= 32; i++) {
    const a = -.95 + i / 32 * 1.9, x = source.x + Math.cos(a) * radius * wc + Math.sin(a) * radius * .55 * ws;
    const z = source.z - Math.cos(a) * radius * ws + Math.sin(a) * radius * .55 * wc;
    points.push([x, z, World.heightAt]);
    if (i % 16 === 0) {
     const h = .60 + .55 * Math.sqrt(source.activeWeight / maxWeight);
     stakes.push({p: [x, World.heightAt(x, z) + h * .5, z], scale: [.75, h, .75], rotation: [.04, angle, -.06]});
     ties.push({p: [x, World.heightAt(x, z) + h * .77, z], scale: [.14, .13, .14]});
    }
   }
   strip('slope-contour', points, .085, mats.risk, marker, .045);
   batch('reed-stakes', pole, mats.wood, stakes, marker);
   batch('risk-bindings', box, mats.risk, ties, marker);
  }

  rods = group('capacity-rods');
  const ids = new Set();
  for (const dam of Array.isArray(layout) ? layout : []) {
   if (dam.type !== 'dam' || !['main', 'west', 'east'].includes(dam.channel) || !Number.isFinite(dam.t)) continue;
   ids.add(dam.id);
   const p = World.pointAt(dam.channel, dam.t), total = Math.max(.001, finite(dam.capacity, DAM_CAPACITIES[dam.level] || 6));
   const amount = Math.min(total, Math.max(0, finite(dam.fill))), fill = amount / total;
   // Saved absolute peaks, including zero on rollback, override renderer history.
   // Only legacy records without highFill use the absolute-amount cache.
   const peak = dam.highFill !== undefined ? Math.max(0, finite(dam.highFill))
    : Math.max(peakAmount.get(dam.id) || 0, amount);
   const old = clamp(peak / total);
   peakAmount.set(dam.id, peak);
   const gauge = group(`capacity-${dam.id}`, rods), side = p.width * .5 + .65;
   const x = p.x + Math.cos(p.angle) * side + Math.sin(p.angle) * -2.5;
   const z = p.z - Math.sin(p.angle) * side + Math.cos(p.angle) * -2.5;
   gauge.position.set(x, World.heightAt(x, z), z); gauge.rotation.y = p.angle;
   gauge.userData = {structureId: dam.id, fillRatio: fill, highWaterRatio: old, fill: amount, capacity: total};
   const h = 1.7;
   batch('graduated-rod', box, mats.pale, [{p: [0, h * .5, 0], scale: [.18, h, .12]}], gauge);
   const ticks = Array.from({length: 9}, (_, i) => ({p: [.01, .10 + i * (h - .20) / 8, .069], scale: [i % 2 ? .09 : .17, .028, .016]}));
   batch('capacity-graduations', box, mats.gauge, ticks, gauge);
   batch('current-fill-notch', box, mats.risk, [{p: [0, .10 + fill * (h - .20), 0], scale: [.35, .085, .17]}], gauge);
   if (old > .001) batch('old-high-water-mud', box, mats.mud, [{p: [.005, .10 + old * (h - .20), .073], scale: [.19, .055, .025]}], gauge);
  }
  for (const id of peakAmount.keys()) if (!ids.has(id)) peakAmount.delete(id);
  sourceHints.visible = hints; goal.visible = hints; rods.visible = gauges;
  root.userData = {round: finite(state.round), phase: state.phase || 'prepare', built, integrity: integrity * 100};
  // Some branches leave primitives/materials unused; dispose those immediately.
  for (const geometry of [box, stone, pole]) if (!primitiveUse.has(geometry)) geometry.dispose();
  const usedMaterials = new Set();
  root.traverse(o => {if (o.material) usedMaterials.add(o.material);});
  for (const mat of Object.values(mats)) if (!usedMaterials.has(mat)) mat.dispose();
 }

 function tick(time) {
  if (!flag || disposed) return;
  const t = finite(time), a = flag.geometry.attributes.position;
  for (let i = 0; i < a.count; i++) {
   const x = a.getX(i), y = a.getY(i);
   a.setZ(i, x / 2.1 * (.055 * Math.sin(t * 1.7 - x * 2.1) + .028 * Math.sin(t * 2.3 + y * 4)));
  }
  a.needsUpdate = true;
  flag.geometry.computeVertexNormals();
 }
 function setHints(value) {
  hints = !!value;
  if (sourceHints) sourceHints.visible = hints;
  if (goal) goal.visible = hints;
 }
 function setGauges(value) {gauges = !!value; if (rods) rods.visible = gauges;}
 function dispose() {if (disposed) return; release(); peakAmount.clear(); scene.remove(root); disposed = true;}
 return {root, fieldPoint, sync, tick, setHints, setGauges, dispose};
}
