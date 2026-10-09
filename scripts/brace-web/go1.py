"""Standalone Go1 brace controller in plain MuJoCo — the exact loop the browser runs.

Mirrors mjlab 1.5.3 + brace_task as trained (env.yaml in the HF release):
  physics dt 0.005, decimation 4 (policy at 50 Hz)
  obs = imu_lin_vel(3) imu_ang_vel(3) projected_gravity(3) joint_pos-default(12)
        joint_vel(12) last_action(12) twist cmd(3) [threat(4) if warned]
  target = default + scale * action   (joint order FR,FL,RR,RL x hip,thigh,calf)
"""
import math, numpy as np, mujoco, onnxruntime as ort

JOINTS = [f"{l}_{j}_joint" for l in ("FR","FL","RR","RL") for j in ("hip","thigh","calf")]
DEFAULT = np.array([0.1,0.9,-1.8, -0.1,0.9,-1.8, 0.1,0.9,-1.8, -0.1,0.9,-1.8])
SCALE = np.array([0.3727530387083568,0.3727530387083568,0.24850202580557115]*4)
FORCE_NORM, WARN_NORM, IMPACT_H = 250.0, 1.2, 0.10

class Go1:
    def __init__(self, xml_path, onnx_path, warned_obs=True):
        self.m = mujoco.MjModel.from_xml_path(xml_path)
        self.d = mujoco.MjData(self.m)
        self.sess = ort.InferenceSession(onnx_path)
        self.in_name = self.sess.get_inputs()[0].name
        self.obs_dim = self.sess.get_inputs()[0].shape[-1]
        self.warned_obs = warned_obs   # False = feed zeros where the warning goes ("blind")
        m = self.m
        self.qadr = np.array([m.jnt_qposadr[mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_JOINT, "robot/"+j)] for j in JOINTS])
        self.vadr = np.array([m.jnt_dofadr[mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_JOINT, "robot/"+j)] for j in JOINTS])
        self.act = np.array([mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_ACTUATOR, "robot/"+j) for j in JOINTS])
        self.trunk = mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_BODY, "robot/trunk")
        def sens(n):
            i = mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_SENSOR, n); return m.sensor_adr[i]
        self.s_lin, self.s_ang = sens("robot/imu_lin_vel"), sens("robot/imu_ang_vel")
        self.reset()

    def reset(self):
        m, d = self.m, self.d
        mujoco.mj_resetData(m, d)
        d.qpos[:3] = [0, 0, 0.278]; d.qpos[3:7] = [1, 0, 0, 0]
        d.qpos[self.qadr] = DEFAULT
        mujoco.mj_forward(m, d)
        self.action = np.zeros(12)
        self.cmd = np.zeros(3)
        self.threat = None   # dict(theta_w, force, ttl, sustain)
        self.wrench_live = 0.0

    def heading(self):
        R = self.d.xmat[self.trunk].reshape(3, 3)
        return math.atan2(R[1, 0], R[0, 0])

    def threat_vec(self):
        t = self.threat
        if not t or t["ttl"] <= 0: return np.zeros(4)
        tb = (t["theta_w"] - self.heading() + math.pi) % (2*math.pi) - math.pi
        return np.array([math.cos(tb), math.sin(tb), min(max(t["force"]/FORCE_NORM, 0), 1), min(max(t["ttl"]/WARN_NORM, 0), 1)])

    def obs(self):
        d = self.d
        R = d.xmat[self.trunk].reshape(3, 3)
        grav = R.T @ np.array([0, 0, -1.0])
        o = [d.sensordata[self.s_lin:self.s_lin+3], d.sensordata[self.s_ang:self.s_ang+3], grav,
             d.qpos[self.qadr] - DEFAULT, d.qvel[self.vadr], self.action, self.cmd]
        if self.obs_dim == 52:
            o.append(self.threat_vec() if self.warned_obs else np.zeros(4))
        return np.concatenate(o).astype(np.float32)

    def shove(self, theta_w, force, warn_s, duration):
        self.threat = dict(theta_w=theta_w, force=force, ttl=warn_s, duration=duration)

    def _advance_threat(self, dt):
        t = self.threat
        if not t: return
        if t["ttl"] > 0:
            t["ttl"] -= dt
            if t["ttl"] <= 0:      # impact: write wrench once, held for `duration`
                F = np.array([t["force"]*math.cos(t["theta_w"]), t["force"]*math.sin(t["theta_w"]), 0.0])
                tau = np.cross([0, 0, IMPACT_H], F)
                self.d.xfrc_applied[self.trunk, :3] = F
                self.d.xfrc_applied[self.trunk, 3:] = tau
                self.wrench_live = t["duration"]
        if self.wrench_live > 0:
            self.wrench_live -= dt
            if self.wrench_live <= 0:
                self.d.xfrc_applied[self.trunk] = 0
                self.threat = None

    def step(self):
        """One policy step (0.02 s)."""
        a = self.sess.run(None, {self.in_name: self.obs()[None]})[0][0]
        self.action = a.astype(np.float64)
        self.d.ctrl[self.act] = DEFAULT + SCALE * self.action
        for _ in range(4):
            mujoco.mj_step(self.m, self.d)
        # mjlab order: physics substeps, then command update (countdown / impact)
        self._advance_threat(0.02)

    def fallen(self):
        R = self.d.xmat[self.trunk].reshape(3, 3)
        tilt = math.degrees(math.acos(max(-1, min(1, R[2, 2]))))
        return tilt > 70 or self.d.xpos[self.trunk][2] < 0.12, tilt
