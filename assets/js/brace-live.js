/* "Shove it yourself" — the live demo on the brace-for-impact page.

   Loaded only when the visitor presses Start (about 4.4 MB over the wire,
   almost all of it MuJoCo's WebAssembly). Physics and policy live in
   brace-core.js; this file is rendering, input and the tally.

   Two views: one robot at a time, or all three side by side. Side by side,
   each robot runs in its own physics world and gets the identical shove
   (same direction, force, warning time and duration) at the same instant.

   Third-party code comes from jsDelivr at pinned versions:
     @mujoco/mujoco 3.10.0  — the same engine version the Python check ran on
     three 0.186.1           — rendering only */

import { Go1, Policy, POLICY_DT } from "/assets/js/brace-core.js?v=20261008c";

const MUJOCO = "https://cdn.jsdelivr.net/npm/@mujoco/mujoco@3.10.0/mujoco.js";
const THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.min.js";
const A = "/assets/brace/";

const ROBOTS = {
  warned:   { policy: "warned",   blind: false, label: "Warned",      sees: "sees each shove coming" },
  unwarned: { policy: "unwarned", blind: false, label: "Not warned",  sees: "never sees it coming · walks crouched low, as in the study" },
  blind:    { policy: "warned",   blind: true,  label: "Warning off", sees: "trained with the warning, now fed zeros" },
};
const ORDER = ["warned", "unwarned", "blind"];
const LANE = 1.3;          // metres between robots side by side
const WATCH_STEPS = 100;   // the study watched each shove for 2 s

export async function start(root) {
  const $ = s => root.querySelector(s);
  const stage = $(".sim-stage"), status = $(".sim-status");
  const say = t => { status.textContent = t; };

  say("Loading physics…");
  const [THREE, mj, xml, pw, pu, meshInfo, meshBin] = await Promise.all([
    import(THREE_URL),
    import(MUJOCO).then(m => m.default()),
    fetch(A + "go1.xml").then(r => r.text()),
    fetch(A + "policy-warned.bin").then(r => r.arrayBuffer()),
    fetch(A + "policy-unwarned.bin").then(r => r.arrayBuffer()),
    fetch(A + "go1-meshes.json").then(r => r.json()),
    fetch(A + "go1-meshes.bin").then(r => r.arrayBuffer()),
  ]);
  const policies = { warned: new Policy(pw, 52), unwarned: new Policy(pu, 48) };

  /* ---------- scene (MuJoCo is z-up; so is this scene) ---------- */
  THREE.Object3D.DEFAULT_UP.set(0, 0, 1);
  const canvas = $("canvas");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 200);
  camera.up.set(0, 0, 1);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -3.5, right: 3.5, top: 3.5, bottom: -3.5, near: 0.1, far: 10 });
  scene.add(sun, sun.target);

  // tokens are light-dark() pairs, so read them resolved, through an element
  const probe = document.createElement("i"); probe.hidden = true; root.append(probe);
  const css = n => { probe.style.color = `var(${n})`; return getComputedStyle(probe).color; };
  const tex = document.createElement("canvas"); tex.width = tex.height = 128;
  const groundTex = new THREE.CanvasTexture(tex);
  groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
  groundTex.repeat.set(100, 100);
  groundTex.colorSpace = THREE.SRGBColorSpace;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200),
    new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.95 }));
  ground.receiveShadow = true;
  scene.add(ground);

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2b2b2e, roughness: 0.55, metalness: 0.25 });
  const arrowMat = new THREE.MeshBasicMaterial({ color: 0xff6a2b });
  const meshes = meshInfo.meshes.map(m => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(meshBin, m.vOff, m.vCount * 3), 3));
    const Idx = m.vCount < 65536 ? Uint16Array : Uint32Array;
    geo.setIndex(new THREE.BufferAttribute(new Idx(meshBin, m.iOff, m.iCount), 1));
    geo.computeVertexNormals();
    return geo;
  });
  const shaftGeo = new THREE.CylinderGeometry(0.025, 0.025, 1, 12), headGeo = new THREE.ConeGeometry(0.07, 0.16, 16);

  function label(text) {
    const c = document.createElement("canvas"); c.width = 512; c.height = 96;
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
    s.scale.set(0.8, 0.15, 1);
    s.userData.draw = (ink, bg) => {
      const x = c.getContext("2d"); x.clearRect(0, 0, 512, 96);
      x.font = "600 40px ui-monospace, Menlo, Consolas, monospace"; x.textAlign = "center"; x.textBaseline = "middle";
      const w = x.measureText(text).width + 40;
      x.fillStyle = bg; x.globalAlpha = 0.85; x.fillRect(256 - w / 2, 14, w, 68); x.globalAlpha = 1;
      x.fillStyle = ink; x.fillText(text, 256, 49); t.needsUpdate = true;
    };
    s.userData.text = text;
    return s;
  }

  /* one robot = its own physics world + its meshes + its arrow + its tally */
  function makeRobot(key) {
    const R = ROBOTS[key], g = new Go1(mj, xml);
    g.use(policies[R.policy], R.blind);
    const root3 = new THREE.Group(), bodies = [];
    const byName = new Map();
    for (const gm of meshInfo.geoms) {
      let grp = byName.get(gm.body);
      if (!grp) {
        grp = new THREE.Group();
        grp.userData.id = mj.mj_name2id(g.m, mj.mjtObj.mjOBJ_BODY.value, gm.body);
        byName.set(gm.body, grp); bodies.push(grp); root3.add(grp);
      }
      const mesh = new THREE.Mesh(meshes[gm.mesh], bodyMat);
      mesh.position.fromArray(gm.pos);
      mesh.quaternion.set(gm.quat[1], gm.quat[2], gm.quat[3], gm.quat[0]);
      mesh.castShadow = true;
      grp.add(mesh);
    }
    const arrow = new THREE.Group();
    const shaft = new THREE.Mesh(shaftGeo, arrowMat), head = new THREE.Mesh(headGeo, arrowMat);
    shaft.rotation.z = -Math.PI / 2; head.rotation.z = -Math.PI / 2;
    arrow.add(shaft, head); arrow.visible = false; root3.add(arrow);
    const tag = label(R.label); tag.visible = false; root3.add(tag);
    scene.add(root3);
    return { key, g, root3, bodies, arrow, shaft, head, tag, lane: 0,
             tally: { shoves: 0, falls: 0 }, watching: -1, down: 0 };
  }
  const robots = Object.fromEntries(ORDER.map(k => [k, makeRobot(k)]));

  function paint() {
    // the floor and sky follow the site's light/dark theme
    const bg = css("--bg"), line = css("--line"), strong = css("--line-strong"), ink = css("--ink");
    const c = tex.getContext("2d");
    c.fillStyle = bg; c.fillRect(0, 0, 128, 128);
    c.fillStyle = line; c.fillRect(0, 0, 64, 64); c.fillRect(64, 64, 64, 64);
    c.strokeStyle = strong; c.globalAlpha = 0.5; c.lineWidth = 2; c.strokeRect(0, 0, 128, 128); c.globalAlpha = 1;
    groundTex.needsUpdate = true;
    scene.background = new THREE.Color(bg);
    scene.fog = new THREE.Fog(bg, 9, 32);
    arrowMat.color.set(css("--accent"));
    // the Go1 is dark grey; on the dark theme lift it so it still reads against the floor
    const lum = new THREE.Color(bg).getHSL({}).l;
    bodyMat.color.set(lum < 0.3 ? 0x6a6560 : 0x2b2b2e);
    for (const r of Object.values(robots)) r.tag.userData.draw(ink, bg);
  }
  paint();

  /* ---------- which robots are on stage ---------- */
  let camYaw = -2.3, camPitch = 0.42, camDist = 2.7;
  let mode = "warned", active = [robots.warned], force = 250;
  function show(m) {
    mode = m;
    active = m === "all" ? ORDER.map(k => robots[k]) : [robots[m]];
    // lay the robots out in lanes across the camera's view, all facing +x
    active.forEach((r, i) => { r.lane = (i - (active.length - 1) / 2) * LANE; });
    // side by side reads best from the front quarter, lanes running across the screen
    camYaw = m === "all" ? 0.5 : -2.3; camPitch = m === "all" ? 0.34 : 0.42;
    for (const r of Object.values(robots)) {
      const on = active.includes(r);
      r.root3.visible = on; r.tag.visible = on && active.length > 1;
      if (on) { r.g.reset(0); r.watching = -1; r.down = 0; }
    }
    root.querySelectorAll("[data-robot]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.robot === m)));
    $(".sim-who").textContent = m === "all"
      ? "All three side by side · each shove hits all three the same way"
      : `${ROBOTS[m].label} — ${ROBOTS[m].sees}`;
    renderTally();
  }
  function renderTally() {
    const one = r => `${r.tally.falls}/${r.tally.shoves}`;
    $(".sim-tally").textContent = mode === "all"
      ? `Falls: ${ORDER.map(k => `${ROBOTS[k].label} ${one(robots[k])}`).join(" · ")}`
      : (r => r.tally.shoves
          ? `${r.tally.falls} fall${r.tally.falls === 1 ? "" : "s"} in ${r.tally.shoves} shove${r.tally.shoves === 1 ? "" : "s"}`
          : "No shoves yet")(active[0]);
  }

  /* A shove from bearing `fromW` (where it comes from, world frame). Warning
     time and duration are drawn from the training ranges, once, and every
     robot on stage gets exactly that shove. */
  function shoveFrom(fromW) {
    if (active.some(r => r.down > 0)) { say("Let it get up first."); return; }
    if (active.some(r => r.g.threat)) { say("One shove at a time."); return; }
    const warn = 0.4 + Math.random() * 0.8, dur = 0.1 + Math.random() * 0.2;
    for (const r of active) r.g.shove(fromW + Math.PI, force, warn, dur);
    say("");
  }

  /* ---------- camera: follows the robots; drag to orbit, wheel to zoom ---------- */
  const focus = new THREE.Vector3(0, 0, 0.25), want = new THREE.Vector3();
  const world = (r, i) => [r.g.d.xpos[i * 3], r.g.d.xpos[i * 3 + 1] + r.lane, r.g.d.xpos[i * 3 + 2]];
  function placeCamera(dt) {
    want.set(0, 0, 0);
    for (const r of active) { const p = world(r, r.g.trunk); want.x += p[0]; want.y += p[1]; }
    want.multiplyScalar(1 / active.length); want.z = 0.25;
    focus.lerp(want, Math.min(1, dt * 4));
    const dist = camDist * (active.length > 1 ? 1.7 : 1);
    camera.position.set(
      focus.x + dist * Math.cos(camPitch) * Math.cos(camYaw),
      focus.y + dist * Math.cos(camPitch) * Math.sin(camYaw),
      focus.z + dist * Math.sin(camPitch));
    camera.lookAt(focus);
    sun.position.set(focus.x + 1.2, focus.y - 0.8, 3); sun.target.position.copy(focus);
  }

  /* ---------- input ---------- */
  root.querySelectorAll("[data-robot]").forEach(b => b.addEventListener("click", () => show(b.dataset.robot)));
  const slider = $(".sim-force"), fOut = $(".sim-force-out");
  slider.addEventListener("input", () => { force = +slider.value; fOut.textContent = `${force} N`; });
  $(".sim-shove").addEventListener("click", () => shoveFrom(Math.random() * 2 * Math.PI));
  $(".sim-reset").addEventListener("click", () => {
    for (const r of Object.values(robots)) r.tally = { shoves: 0, falls: 0 };
    show(mode);
  });

  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let drag = null;
  canvas.addEventListener("pointerdown", e => { drag = { x: e.clientX, y: e.clientY, yaw: camYaw, pitch: camPitch, moved: false }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointermove", e => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 6) drag.moved = true;
    camYaw = drag.yaw - dx * 0.008;
    camPitch = Math.max(0.05, Math.min(1.3, drag.pitch + dy * 0.006));
  });
  canvas.addEventListener("pointerup", e => {
    const wasClick = drag && !drag.moved; drag = null;
    if (!wasClick) return;
    // click on the floor: the shove comes from where you clicked
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObject(ground)[0];
    if (hit) shoveFrom(Math.atan2(hit.point.y - focus.y, hit.point.x - focus.x));
  });
  canvas.addEventListener("wheel", e => { e.preventDefault(); camDist = Math.max(0.8, Math.min(6, camDist * (1 + Math.sign(e.deltaY) * 0.1))); }, { passive: false });

  let keys = new Set(), touchCmd = [0, 0, 0];
  const KEYS = ["w", "a", "s", "d", "q", "e", "arrowup", "arrowdown", "arrowleft", "arrowright", "shift", " "];
  stage.addEventListener("keydown", e => {
    const k = e.key.toLowerCase();
    if (!KEYS.includes(k)) return;
    e.preventDefault();
    if (k === " ") { if (!e.repeat) shoveFrom(Math.random() * 2 * Math.PI); return; }
    keys.add(k);
  });
  stage.addEventListener("keyup", e => keys.delete(e.key.toLowerCase()));
  stage.addEventListener("blur", () => keys.clear());
  root.querySelectorAll("[data-walk]").forEach(b => {
    const v = b.dataset.walk.split(",").map(Number);
    const on = e => { e.preventDefault(); touchCmd = v; }, off = () => { touchCmd = [0, 0, 0]; };
    b.addEventListener("pointerdown", on); b.addEventListener("pointerup", off);
    b.addEventListener("pointerleave", off); b.addEventListener("pointercancel", off);
  });

  /* Wander: left alone, the robots walk the way the study's evaluation drove
     them, a random speed and turn held for 3-8 s. Standing still is not their
     natural state: the not-warned robot, asked to stand, settles into a low
     crouch (it does that in the training environment too). */
  let wander = true, wanderCmd = [0.6, 0, 0], wanderLeft = 0;
  const wanderBtn = $(".sim-wander");
  wanderBtn.addEventListener("click", () => {
    wander = !wander;
    wanderBtn.setAttribute("aria-pressed", String(wander));
    wanderBtn.textContent = wander ? "Wandering" : "Standing still";
  });
  function nextWander() {
    if (wanderLeft > 0) { wanderLeft -= POLICY_DT; return wanderCmd; }
    wanderLeft = 3 + Math.random() * 5;
    return (wanderCmd = [0.3 + Math.random() * 0.9, 0, (Math.random() * 2 - 1) * 0.4]);
  }

  // inside the ranges the policy was trained and evaluated on
  function command() {
    const has = k => keys.has(k);
    const fast = has("shift") ? 2.0 : 1.0;
    let vx = (has("w") || has("arrowup") ? fast : 0) - (has("s") || has("arrowdown") ? 0.8 : 0);
    let wz = (has("a") || has("arrowleft") ? 0.6 : 0) - (has("d") || has("arrowright") ? 0.6 : 0);
    let vy = (has("q") ? 0.5 : 0) - (has("e") ? 0.5 : 0);
    if (!keys.size) [vx, vy, wz] = touchCmd;
    if (!keys.size && !touchCmd.some(Boolean) && wander) return nextWander();
    return [vx, vy, wz];
  }

  /* ---------- loop: fixed 50 Hz policy steps against real time ---------- */
  function tick(r, cmd) {
    const g = r.g;
    if (r.down > 0) {
      r.down -= POLICY_DT;
      g.cmd = [0, 0, 0];
      g.step();
      if (r.down <= 0) { g.reset(g.heading(), g.d.xpos[g.trunk * 3], g.d.xpos[g.trunk * 3 + 1]); say(""); }
      return;
    }
    g.cmd = cmd;
    const liveBefore = g.wrenchLive > 0;
    g.step();
    if (r.watching < 0 && g.wrenchLive > 0 && !liveBefore) r.watching = 0;
    else if (r.watching >= 0) r.watching++;
    const fell = g.fallen();
    if (r.watching >= 0 && (fell || r.watching >= WATCH_STEPS)) {
      r.tally.shoves++; if (fell) r.tally.falls++;
      r.watching = -1; renderTally();
      if (active.length === 1) say(fell ? "Down. Back up in a second." : "Stayed up.");
    }
    if (fell) {
      if (active.length > 1) say(`${ROBOTS[r.key].label} went down.`);
      r.down = 1.2; g.threat = null; g.wrenchLive = 0; g.d.xfrc_applied.fill(0);
    }
  }

  function drawArrow(r) {
    const t = r.g.threat, { arrow, shaft, head } = r;
    if (!t) { arrow.visible = false; return; }
    const p = world(r, r.g.trunk);
    const dir = new THREE.Vector3(Math.cos(t.thetaW), Math.sin(t.thetaW), 0);
    const anchor = new THREE.Vector3(p[0], p[1], p[2] + 0.1);
    const len = Math.max(t.force * 0.0026, 0.2);   // 250 N ≈ 0.65 m
    let tail;
    if (t.ttl > 0) tail = anchor.clone().addScaledVector(dir, -(0.35 + t.ttl * 1.5) - len);  // incoming: closes in as impact nears
    else tail = anchor;                                                                   // landed: pushing through the body
    arrow.visible = true;
    arrow.position.copy(tail);
    arrow.rotation.set(0, 0, Math.atan2(dir.y, dir.x));
    shaft.scale.set(1, len - 0.16, 1); shaft.position.set((len - 0.16) / 2, 0, 0);
    head.position.set(len - 0.08, 0, 0);
  }

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * renderer.getPixelRatio())) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  }

  let acc = 0, last = performance.now(), visible = true;
  new IntersectionObserver(es => { visible = es[0].isIntersecting; }).observe(stage);
  document.addEventListener("visibilitychange", () => { last = performance.now(); });

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (!visible || document.hidden) return;
    acc += dt;
    // never more than 5 policy steps per frame: on a slow device the robots
    // run slower than real time rather than skipping physics
    let n = 0;
    while (acc >= POLICY_DT && n < 5) { const c = command(); for (const r of active) tick(r, c); acc -= POLICY_DT; n++; }
    if (n === 5) acc = 0;
    for (const r of active) {
      const g = r.g, p = g.d.xpos, b = g.trunk * 3;
      if (Math.hypot(p[b], p[b + 1]) > 60 && !g.threat) g.reset(g.heading());   // stay on the floor
      for (const grp of r.bodies) {
        const i = grp.userData.id;
        grp.position.set(...world(r, i));
        grp.quaternion.set(g.d.xquat[i * 4 + 1], g.d.xquat[i * 4 + 2], g.d.xquat[i * 4 + 3], g.d.xquat[i * 4]);
      }
      if (r.tag.visible) { const q = world(r, g.trunk); r.tag.position.set(q[0], q[1], q[2] + 0.38); }
      drawArrow(r);
    }
    const t = active[0].g.threat;
    $(".sim-incoming").textContent = !t ? "" : t.ttl > 0
      ? `Incoming · ${Math.round(t.force)} N · ${t.ttl.toFixed(1)} s` : `Impact · ${Math.round(t.force)} N`;
    placeCamera(dt);
    resize();
    renderer.render(scene, camera);
  }

  document.getElementById("themeTog")?.addEventListener("click", () => setTimeout(paint, 0));
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", paint);

  root._sim = { robots, scene, camera, shoveFrom };  // for tests and the curious
  show("warned");
  root.classList.add("is-live");
  // one analytics row when a visitor actually runs it (same cookieless beacon as analytics.js)
  try {
    const ep = document.querySelector('meta[name="chat-endpoint"]');
    if (ep && !/^(localhost|127\.)/.test(location.hostname))
      navigator.sendBeacon(ep.content.replace(/\/chat\/?$/, "") + "/collect", new Blob([JSON.stringify({
        path: location.pathname + "#live-started", referrer: "", utm_source: "", utm_medium: "", utm_campaign: "",
        screen: screen.width + "x" + screen.height })], { type: "text/plain" }));
  } catch (e) { /* never break the demo for a counter */ }
  say("");
  stage.focus({ preventScroll: true });
  requestAnimationFrame(frame);
}
