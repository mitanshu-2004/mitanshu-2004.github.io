"""Fall rate per shove in the standalone (browser-equivalent) loop, eval.py protocol."""
import sys, glob, os, math, numpy as np, mujoco
from multiprocessing import Pool
sys.path.insert(0, "/tmp/brace/port"); from go1 import Go1
XML = "/tmp/brace/export/go1_brace_physics.xml"
HF = os.path.expanduser("~/.cache/huggingface/hub/models--mitanshugoel--go1-brace/snapshots/*/")
ONNX = {"warned": glob.glob(HF+"anticipatory/*/*.onnx")[0], "unwarned": glob.glob(HF+"reactive/*/*.onnx")[0]}
ONNX["blind"] = ONNX["warned"]

def run(args):
    robot, force, n_shoves, seed = args
    rng = np.random.default_rng(seed)
    g = Go1(XML, ONNX[robot], warned_obs=(robot != "blind"))
    def reset():
        g.reset(); yaw = rng.uniform(-math.pi, math.pi)
        g.d.qpos[3:7] = [math.cos(yaw/2), 0, 0, math.sin(yaw/2)]; mujoco.mj_forward(g.m, g.d)
    def new_cmd():
        if rng.random() < 0.1: return np.zeros(3), None
        c = np.array([rng.uniform(-1.5, 2.0), rng.uniform(-1, 1), rng.uniform(-0.7, 0.7)])
        return c, (rng.uniform(-math.pi, math.pi) if rng.random() < 0.3 else None)
    reset(); cmd, head = new_cmd(); t_cmd = rng.uniform(3, 8); t_thr = rng.uniform(3, 6)
    shoves = falls = 0; watching = -1; tilts = []; peak = 0
    while shoves < n_shoves:
        if head is not None:
            err = (head - g.heading() + math.pi) % (2*math.pi) - math.pi
            cmd[2] = np.clip(0.5*err, -0.7, 0.7)
        g.cmd = cmd.astype(np.float32)
        live_before = g.wrench_live > 0
        g.step()
        t_cmd -= 0.02; t_thr -= 0.02
        if t_cmd <= 0: cmd, head = new_cmd(); t_cmd = rng.uniform(3, 8)
        if t_thr <= 0 and g.threat is None:
            g.shove(rng.uniform(-math.pi, math.pi), force, rng.uniform(0.4, 1.2), rng.uniform(0.1, 0.3))
            t_thr = rng.uniform(3, 6)
        fell, tilt = g.fallen()
        if watching < 0 and g.wrench_live > 0 and not live_before:
            watching = 0; peak = tilt
        elif watching >= 0:
            watching += 1; peak = max(peak, tilt)
            if fell or watching >= 100:
                shoves += 1; falls += fell; tilts.append(peak); watching = -1
        if fell:
            reset(); g.threat = None; g.d.xfrc_applied[:] = 0; g.wrench_live = 0
    return robot, force, shoves, falls, float(np.mean(tilts))

if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 400
    forces = [float(f) for f in (sys.argv[2].split(",") if len(sys.argv) > 2 else ["250"])]
    jobs = [(r, f, n, 1000*i + j) for f in forces for i, r in enumerate(["warned","unwarned","blind"]) for j in range(4)]
    jobs = [(r, f, n//4, s) for r, f, _, s in jobs]
    agg = {}
    with Pool(min(12, os.cpu_count())) as p:
        for r, f, s, fl, tm in p.imap_unordered(run, jobs):
            a = agg.setdefault((r, f), [0, 0, []]); a[0] += s; a[1] += fl; a[2].append(tm)
    for (r, f), (s, fl, tm) in sorted(agg.items(), key=lambda x: (x[0][1], x[0][0])):
        p_ = fl/s; z = 1.96; c = (p_ + z*z/(2*s))/(1+z*z/s); h = z*math.sqrt(p_*(1-p_)/s + z*z/(4*s*s))/(1+z*z/s)
        print(f"{f:5.0f} N  {r:9s} shoves={s:5d} falls={fl:4d}  rate={100*p_:5.1f}%  95%CI=[{100*(c-h):.1f},{100*(c+h):.1f}]  mean peak tilt={np.mean(tm):.1f}°")
