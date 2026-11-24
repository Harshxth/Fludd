// Writes the toy fixture to public/data/toy/ in the gold formats (docs/contracts.md).
// Two bowls, bowl 1 spills into bowl 2, a pump in bowl 2, a 3x3 road grid with 12 segments.
// Synthetic numbers placed over USF so the map lines up. Run: node scripts/make-toy-fixture.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync, crc32 } from "node:zlib";
import { join } from "node:path";

const out = join(import.meta.dirname, "../public/data/toy");
mkdirSync(join(out, "levels"), { recursive: true });
mkdirSync(join(out, "layers"), { recursive: true });
const write = (p, v) => writeFileSync(join(out, p), typeof v === "string" || v instanceof Uint8Array ? v : JSON.stringify(v, null, 1));

const W = 48, H = 36, HOURS = 25;
const bbox = [-82.42, 28.055, -82.408, 28.064];
const cellSizeM = Math.round(((bbox[2] - bbox[0]) * 111320 * Math.cos((28.06 * Math.PI) / 180)) / W);
const toLngLat = (x, y) => [bbox[0] + ((x + 0.5) / W) * (bbox[2] - bbox[0]), bbox[3] - ((y + 0.5) / H) * (bbox[3] - bbox[1])];
const r = (v) => Math.round(v * 100) / 100;

// ---- ground and bowls
const centers = [{ id: 1, x: 14, y: 18, depth: 4, s: 50 }, { id: 2, x: 34, y: 18, depth: 5, s: 60 }];
const ground = new Float32Array(W * H), ids = new Uint16Array(W * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  let h = 14 + 0.02 * y;
  let best = 0, bestD = 14 * 14;
  for (const c of centers) {
    const d2 = (x - c.x) ** 2 + (y - c.y) ** 2;
    h -= c.depth * Math.exp(-d2 / c.s);
    if (d2 < bestD) { bestD = d2; best = c.id; }
  }
  ground[y * W + x] = h; ids[y * W + x] = best;
}
const gMin = Math.floor(Math.min(...ground)), gMax = Math.ceil(Math.max(...ground));

function png(rgba) {
  const raw = Buffer.alloc((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) rgba.subarray(y * W * 4, (y + 1) * W * 4).forEach((v, i) => (raw[y * (W * 4 + 1) + 1 + i] = v));
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const gPix = new Uint8Array(W * H * 4), bPix = new Uint8Array(W * H * 4);
for (let i = 0; i < W * H; i++) {
  const v = Math.round(((ground[i] - gMin) / (gMax - gMin)) * 65535);
  gPix.set([v >> 8, v & 255, 0, 255], i * 4);
  bPix.set([ids[i] & 255, ids[i] >> 8, 0, 255], i * 4);
}
write("ground.png", png(gPix));
write("bowls.png", png(bPix));

const lowest = (id) => {
  let bi = -1;
  for (let i = 0; i < W * H; i++) if (ids[i] === id && (bi < 0 || ground[i] < ground[bi])) bi = i;
  return { position: toLngLat(bi % W, Math.floor(bi / W)).map((v) => Number(v.toFixed(6))), heightM: r(ground[bi]) };
};
const bowls = [
  { id: 1, lowestPoint: lowest(1), spillHeightM: 12, spillsTo: 2, parent: null, pump: false, storageAtSpillM3: 41000 },
  { id: 2, lowestPoint: lowest(2), spillHeightM: 13, spillsTo: null, parent: null, pump: true, storageAtSpillM3: 96000 },
];
write("bowls.json", bowls);

// ---- levels: rise to a peak at hour 14, recede after; bowl 1 overflows into bowl 2; pump trims bowl 2
const scenarios = { "10yr": 0.4, "25yr": 0.6, "100yr": 0.9, "500yr": 1.3, milton: 1.0 };
const shape = (t) => (t <= 14 ? Math.sin(((t / 14) * Math.PI) / 2) : Math.max(0.35, 1 - (t - 14) * 0.05));
for (const [scenario, k] of Object.entries(scenarios)) for (const pump of ["on", "off"]) {
  const [b1, b2] = bowls;
  const l1 = [], l2 = [];
  for (let t = 0; t < HOURS; t++) {
    const want1 = 4.5 * k * shape(t);
    const room1 = b1.spillHeightM - b1.lowestPoint.heightM;
    const over = Math.max(0, want1 - room1);
    l1.push(r(b1.lowestPoint.heightM + Math.min(want1, room1)));
    const rise2 = (4 * k + over * 0.5) * shape(t) * (pump === "on" ? 0.7 : 1);
    l2.push(r(b2.lowestPoint.heightM + rise2));
  }
  write(`levels/${scenario}-pump-${pump}.json`, { scenario, pump, levels: { 1: l1, 2: l2 } });
}

// ---- road graph: 3x3 nodes, 12 segments
const gx = [6, 24, 42], gy = [6, 18, 30];
const nodes = gy.flatMap((y) => gx.map((x) => ({ x, y })));
const edges = [];
for (let j = 0; j < 3; j++) for (let i = 0; i < 2; i++) edges.push([j * 3 + i, j * 3 + i + 1]);
for (let j = 0; j < 2; j++) for (let i = 0; i < 3; i++) edges.push([j * 3 + i, (j + 1) * 3 + i]);
const n = nodes.length, e = edges.length;
const arrays = [], parts = [];
let offset = 0;
const add = (name, type, Ctor, values) => {
  const a = Ctor.from(values);
  arrays.push({ name, type, offset, length: a.length });
  parts.push(Buffer.from(a.buffer)); offset += a.byteLength;
};
add("nodeLng", "float32", Float32Array, nodes.map((p) => toLngLat(p.x, p.y)[0]));
add("nodeLat", "float32", Float32Array, nodes.map((p) => toLngLat(p.x, p.y)[1]));
add("edgeFrom", "uint32", Uint32Array, edges.map((d) => d[0]));
add("edgeTo", "uint32", Uint32Array, edges.map((d) => d[1]));
add("edgeLengthM", "float32", Float32Array, edges.map(([a, b]) => Math.hypot(nodes[a].x - nodes[b].x, nodes[a].y - nodes[b].y) * cellSizeM));
add("edgeSpeedClass", "uint8", Uint8Array, edges.map((_, i) => (i === 3 || i === 10 ? 2 : 1)));
write("graph.bin", new Uint8Array(Buffer.concat(parts)));
write("graph.json", { nodeCount: n, edgeCount: e, speedClasses: { 1: "residential 25 mph", 2: "arterial 40 mph" }, arrays });

write("segments.json", edges.map(([a, b], id) => {
  const crossed = new Map();
  for (let s = 0; s <= 24; s++) {
    const x = Math.round(nodes[a].x + ((nodes[b].x - nodes[a].x) * s) / 24), y = Math.round(nodes[a].y + ((nodes[b].y - nodes[a].y) * s) / 24);
    const i = y * W + x;
    if (ids[i] && (!crossed.has(ids[i]) || ground[i] < crossed.get(ids[i]))) crossed.set(ids[i], ground[i]);
  }
  return { id, bowls: [...crossed].map(([bowl, h]) => ({ bowl, lowestGroundM: r(h) })) };
}));

// ---- map layers
const pt = (x, y, props) => ({ type: "Feature", properties: props, geometry: { type: "Point", coordinates: toLngLat(x, y) } });
const fc = (features) => ({ type: "FeatureCollection", features });
const box = (x0, y0, x1, y1) => [[toLngLat(x0, y0), toLngLat(x1, y0), toLngLat(x1, y1), toLngLat(x0, y1), toLngLat(x0, y0)]];
write("layers/fema-zones.geojson", fc([
  { type: "Feature", properties: { zone: "AE" }, geometry: { type: "Polygon", coordinates: box(27, 11, 41, 25) } },
  { type: "Feature", properties: { zone: "X" }, geometry: { type: "Polygon", coordinates: box(0, 0, 27, 36) } },
]));
write("layers/pump-stations.geojson", fc([pt(36, 20, { name: "Toy pump station", capacityM3s: 0.5 })]));
write("layers/drains.geojson", fc([pt(12, 17, { kind: "inlet" }), pt(33, 19, { kind: "inlet" }), pt(24, 18, { kind: "culvert" })]));
write("layers/ponds.geojson", fc([pt(34, 18, { name: "Toy retention pond" })]));
write("layers/fire-stations.geojson", fc([pt(4, 4, { name: "Toy fire station" })]));
write("layers/hospitals.geojson", fc([pt(44, 4, { name: "Toy hospital" })]));
write("layers/milton-damage.geojson", fc([pt(13, 18, {}), pt(15, 19, {}), pt(33, 17, {}), pt(35, 18, {}), pt(20, 30, {})]));
write("layers/known-flooding.geojson", fc([pt(14, 17, { source: "city" }), pt(34, 19, { source: "city" })]));
const line = (pts, props) => ({ type: "Feature", properties: props, geometry: { type: "LineString", coordinates: pts.map(([x, y]) => toLngLat(x, y)) } });
write("layers/storm-pipes.geojson", fc([line([[12, 17], [24, 18]], { kind: "pipe", diameterIn: 24 }), line([[24, 18], [34, 18]], { kind: "culvert", diameterIn: 36 })]));
write("layers/outfalls.geojson", fc([pt(34, 18, { kind: "outfall" })]));

write("validation.json", { hitRate: 0.8, hits: 4, total: 5, falseAlarmAreaKm2: 0.02, femaBaseline: { insideHighRisk: 2, total: 5 }, computedAt: "2026-11-21T11:10:00-05:00" });

write("manifest.json", {
  version: "toy-1",
  bbox,
  grid: { width: W, height: H, cellSizeM },
  groundRange: { min: gMin, max: gMax },
  hourZero: "2026-11-21T08:00:00-05:00",
  hours: HOURS,
  scenarios: Object.keys(scenarios),
  units: "m",
  sources: [{ name: "Synthetic toy fixture", url: "web/scripts/make-toy-fixture.mjs", date: "2026-11-21" }],
});
// The region index (docs/regions.md): the toy data is one tile at the data root.
write("regions.json", { areas: [{ id: "toy", name: "Toy town", tiles: [{ id: "toy", name: "Toy fixture", bbox, path: "" }] }] });
console.log(`toy fixture written to ${out}`);
