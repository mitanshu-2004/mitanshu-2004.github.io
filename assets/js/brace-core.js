/* The brace-for-impact Go1, running in the visitor's browser.

   This is the trained policy from the study, unchanged, in MuJoCo compiled to
   WebAssembly. Nothing here is a re-implementation of the robot's behaviour —
   it rebuilds exactly what the policy saw in training and asks it what to do:

     physics   mjlab's Go1 scene (assets/brace/go1.xml), visual meshes removed;
               every inertial, actuator, contact and solver setting checked
               equal to the training model. dt 0.005 s, policy at 50 Hz.
     sees      imu lin vel, imu ang vel, gravity in the body frame, joint
               angles minus the standing pose, joint velocities, its last
               action, the walking command, and (warned robot only) the
               four-number warning [cos, sin, force/250, time-to-impact/1.2].
     does      joint target = standing pose + scale * action.

   No DOM in this file, so the same code runs headless in Node for the
   equivalence test against the Python reference (scripts/brace-web/). */

export const JOINTS = ["FR", "FL", "RR", "RL"].flatMap(l => ["hip", "thigh", "calf"].map(j => `${l}_${j}_joint`));
const DEFAULT = Float64Array.from([0.1, 0.9, -1.8, -0.1, 0.9, -1.8, 0.1, 0.9, -1.8, -0.1, 0.9, -1.8]);
const S_HT = 0.3727530387083568, S_C = 0.24850202580557115;
const SCALE = Float64Array.from([S_HT, S_HT, S_C, S_HT, S_HT, S_C, S_HT, S_HT, S_C, S_HT, S_HT, S_C]);
const FORCE_NORM = 250, WARN_NORM = 1.2, IMPACT_H = 0.10;
export const POLICY_DT = 0.02;

/* The policy: (obs - mean) / std, then 512-256-128 with ELU, then 12 outputs.
   Weights are the ONNX export's, float32, W stored [out][in]. */
export class Policy {
  constructor(buf, obsDim) {
    const f = new Float32Array(buf);
    const dims = [obsDim, 512, 256, 128, 12];
    let o = 0;
    const take = n => { const a = f.subarray(o, o + n); o += n; return a; };
    this.mean = take(obsDim); this.std = take(obsDim);
    this.layers = [];
    for (let i = 0; i < 4; i++) this.layers.push({ W: take(dims[i + 1] * dims[i]), b: take(dims[i + 1]), n: dims[i + 1], m: dims[i] });
    if (o !== f.length) throw new Error(`policy blob size mismatch: used ${o}, have ${f.length}`);
    this.obsDim = obsDim;
    this.bufs = dims.map(n => new Float32Array(n));
  }
  run(obs) {
    let x = this.bufs[0];
    for (let i = 0; i < this.obsDim; i++) x[i] = (obs[i] - this.mean[i]) / this.std[i];
    this.layers.forEach((L, li) => {
      const y = this.bufs[li + 1], last = li === this.layers.length - 1;
      for (let r = 0; r < L.n; r++) {
        let s = L.b[r]; const row = r * L.m;
        for (let c = 0; c < L.m; c++) s += L.W[row + c] * x[c];
        y[r] = last || s > 0 ? s : Math.expm1(s);
      }
      x = y;
    });
    return x;
  }
}

export class Go1 {
  constructor(mj, xml) {
    this.mj = mj;
    const m = this.m = mj.MjModel.from_xml_string(xml);
    this.d = new mj.MjData(m);
    const T = mj.mjtObj, id = (t, n) => {
      const i = mj.mj_name2id(m, t.value, n);
      if (i < 0) throw new Error(`missing ${n}`);
      return i;
    };
    const jnt = JOINTS.map(j => id(T.mjOBJ_JOINT, "robot/" + j));
    this.qadr = jnt.map(i => m.jnt_qposadr[i]);
    this.vadr = jnt.map(i => m.jnt_dofadr[i]);
    this.act = JOINTS.map(j => id(T.mjOBJ_ACTUATOR, "robot/" + j));
    this.trunk = id(T.mjOBJ_BODY, "robot/trunk");
    this.sLin = m.sensor_adr[id(T.mjOBJ_SENSOR, "robot/imu_lin_vel")];
    this.sAng = m.sensor_adr[id(T.mjOBJ_SENSOR, "robot/imu_ang_vel")];
    this.obsBuf = new Float32Array(52);
    this.policy = null; this.blind = false;
    this.reset(0);
  }

  /* policy: a Policy; blind: feed zeros where the warning goes (the crutch test) */
  use(policy, blind = false) { this.policy = policy; this.blind = blind; }

  reset(yaw = 0, x = 0, y = 0) {
    const { m, d, mj } = this;
    mj.mj_resetData(m, d);
    const q = d.qpos;
    q[0] = x; q[1] = y; q[2] = 0.278;
    q[3] = Math.cos(yaw / 2); q[4] = 0; q[5] = 0; q[6] = Math.sin(yaw / 2);
    this.qadr.forEach((a, i) => { q[a] = DEFAULT[i]; });
    mj.mj_forward(m, d);
    this.action = new Float64Array(12);
    this.cmd = [0, 0, 0];
    this.threat = null;      // {thetaW, force, ttl, duration}
    this.wrenchLive = 0;     // seconds the applied force has left
    this.time = 0;
  }

  heading() {
    const R = this.d.xmat, o = this.trunk * 9;
    return Math.atan2(R[o + 3], R[o]);
  }

  /* trunk tilt from vertical in degrees, and trunk height */
  pose() {
    const o = this.trunk * 9, zz = this.d.xmat[o + 8];
    return { tilt: Math.acos(Math.max(-1, Math.min(1, zz))) * 180 / Math.PI, z: this.d.xpos[this.trunk * 3 + 2] };
  }

  /* the study's fall rule: past 70 degrees of tilt, or the trunk below 12 cm */
  fallen() { const p = this.pose(); return p.tilt > 70 || p.z < 0.12; }

  threatVec(out, k) {
    const t = this.threat;
    if (!t || t.ttl <= 0 || this.blind) { out[k] = out[k + 1] = out[k + 2] = out[k + 3] = 0; return; }
    let tb = t.thetaW - this.heading();
    tb = ((tb + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    out[k] = Math.cos(tb); out[k + 1] = Math.sin(tb);
    out[k + 2] = Math.min(Math.max(t.force / FORCE_NORM, 0), 1);
    out[k + 3] = Math.min(Math.max(t.ttl / WARN_NORM, 0), 1);
  }

  obs() {
    const { d } = this, o = this.obsBuf, R = d.xmat, r = this.trunk * 9, sd = d.sensordata;
    let k = 0;
    for (let i = 0; i < 3; i++) o[k++] = sd[this.sLin + i];
    for (let i = 0; i < 3; i++) o[k++] = sd[this.sAng + i];
    // gravity [0,0,-1] in the body frame = -(third row of R) = R^T [0,0,-1]
    o[k++] = -R[r + 6]; o[k++] = -R[r + 7]; o[k++] = -R[r + 8];
    for (let i = 0; i < 12; i++) o[k++] = d.qpos[this.qadr[i]] - DEFAULT[i];
    for (let i = 0; i < 12; i++) o[k++] = d.qvel[this.vadr[i]];
    for (let i = 0; i < 12; i++) o[k++] = this.action[i];
    for (let i = 0; i < 3; i++) o[k++] = this.cmd[i];
    if (this.policy.obsDim === 52) this.threatVec(o, k);
    return o;
  }

  /* Announce a shove: it lands after `warn` seconds, pushing toward world yaw
     `thetaW` with `force` newtons for `duration` seconds. */
  shove(thetaW, force, warn = 0.8, duration = 0.2) {
    if (this.threat) return false;
    this.threat = { thetaW, force, ttl: warn, duration, warn };
    return true;
  }

  advanceThreat(dt) {
    const t = this.threat, x = this.d.xfrc_applied, b = this.trunk * 6;
    if (!t) return;
    if (t.ttl > 0) {
      t.ttl -= dt;
      if (t.ttl <= 0) {
        // written once, held for `duration`; applied 10 cm above the trunk
        // centre so the hit tips the robot rather than only sliding it
        const fx = t.force * Math.cos(t.thetaW), fy = t.force * Math.sin(t.thetaW);
        x[b] = fx; x[b + 1] = fy; x[b + 2] = 0;
        x[b + 3] = -IMPACT_H * fy; x[b + 4] = IMPACT_H * fx; x[b + 5] = 0;
        this.wrenchLive = t.duration;
      }
    }
    if (this.wrenchLive > 0) {
      this.wrenchLive -= dt;
      if (this.wrenchLive <= 0) {
        for (let i = 0; i < 6; i++) x[b + i] = 0;
        this.wrenchLive = 0;
        this.threat = null;
      }
    }
  }

  /* one policy step: 0.02 s of simulated time */
  step() {
    const a = this.policy.run(this.obs()), { d, m, mj } = this;
    for (let i = 0; i < 12; i++) {
      this.action[i] = a[i];
      d.ctrl[this.act[i]] = DEFAULT[i] + SCALE[i] * a[i];
    }
    for (let s = 0; s < 4; s++) mj.mj_step(m, d);
    this.advanceThreat(POLICY_DT);
    this.time += POLICY_DT;
  }
}
