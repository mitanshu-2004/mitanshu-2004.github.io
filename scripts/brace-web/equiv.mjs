// Run assets/js/brace-core.js headless on a fixed script; print the trunk track.
// Usage: node equiv.mjs <path-to-@mujoco/mujoco-3.10.0/mujoco.js> warned|unwarned|blind
import fs from "fs"; import path from "path"; import url from "url";
const here = path.dirname(url.fileURLToPath(import.meta.url)), root = path.join(here, "..", "..");
const { Go1, Policy } = await import(path.join(root, "assets/js/brace-core.js"));
const mj = await (await import(process.argv[2])).default();
const robot = process.argv[3] || "warned";
const S = JSON.parse(fs.readFileSync(path.join(here, "script.json")));
const g = new Go1(mj, fs.readFileSync(path.join(root, "assets/brace/go1.xml"), "utf8"));
const file = robot === "unwarned" ? "policy-unwarned.bin" : "policy-warned.bin";
const buf = fs.readFileSync(path.join(root, "assets/brace", file));
g.use(new Policy(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length), robot === "unwarned" ? 48 : 52), robot === "blind");
const out = [];
for (let t = 0; t < S.steps; t++) {
  for (const [at, c] of S.cmds) if (at === t) g.cmd = c.slice();
  for (const [at, th, f, w, dur] of S.shoves) if (at === t) g.shove(th, f, w, dur);
  if (t === 0) out.push({ a0: Array.from(g.policy.run(g.obs())).slice(0, 4) });
  g.step();
  if (t % 50 === 49) { const p = g.pose(); out.push([t, ...Array.from(g.d.xpos.slice(g.trunk*3, g.trunk*3+3)).map(v => +v.toFixed(4)), +p.tilt.toFixed(2), g.fallen()]); }
}
console.log(JSON.stringify(out));
