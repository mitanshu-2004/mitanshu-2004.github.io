import sys, json, glob, os, numpy as np
sys.path.insert(0, "/tmp/brace/port"); from go1 import Go1
S = json.load(open(os.path.expanduser("~/mitanshu-site-upgrade/scripts/brace-web/script.json")))
robot = sys.argv[1]
HF = os.path.expanduser("~/.cache/huggingface/hub/models--mitanshugoel--go1-brace/snapshots/*/")
onnx = glob.glob(HF + ("reactive" if robot == "unwarned" else "anticipatory") + "/*/*.onnx")[0]
g = Go1(os.path.expanduser("~/mitanshu-site-upgrade/assets/brace/go1.xml"), onnx, warned_obs=(robot != "blind"))
out = []
for t in range(S["steps"]):
    for at, c in S["cmds"]:
        if at == t: g.cmd = np.array(c, dtype=np.float32)
    for at, th, f, w, dur in S["shoves"]:
        if at == t: g.shove(th, f, w, dur)
    if t == 0: out.append({"a0": g.sess.run(None, {g.in_name: g.obs()[None]})[0][0][:4].tolist()})
    g.step()
    if t % 50 == 49:
        fell, tilt = g.fallen(); out.append([t] + [round(float(v), 4) for v in g.d.xpos[g.trunk]] + [round(tilt, 2), bool(fell)])
print(json.dumps(out))
