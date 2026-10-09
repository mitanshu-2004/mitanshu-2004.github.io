import os, sys, glob, numpy as np, torch, mujoco, functools
torch.load = functools.partial(torch.load, map_location="cpu")
sys.path.insert(0, "/tmp/brace/brace-for-impact"); sys.path.insert(0, "/tmp/brace/port")
import brace_task
from brace_task import WARNED_TASK
from mjlab.tasks.registry import load_env_cfg, load_rl_cfg, load_runner_cls
from mjlab.envs import ManagerBasedRlEnv
from mjlab.rl import MjlabOnPolicyRunner, RslRlVecEnvWrapper
from go1 import Go1
HF = glob.glob(os.path.expanduser("~/.cache/huggingface/hub/models--mitanshugoel--go1-brace/snapshots/*/anticipatory/*/"))[0]
cfg = load_env_cfg(WARNED_TASK, play=True); cfg.scene.num_envs = 1
cfg.observations["actor"].enable_corruption = False
for k in list(cfg.events.keys()):
    if k not in ("reset_base","reset_robot_joints"): cfg.events.pop(k)
env = ManagerBasedRlEnv(cfg=cfg, device="cpu")
wrapped = RslRlVecEnvWrapper(env, clip_actions=load_rl_cfg(WARNED_TASK).clip_actions)
runner = (load_runner_cls(WARNED_TASK) or MjlabOnPolicyRunner)(wrapped, __import__("dataclasses").asdict(load_rl_cfg(WARNED_TASK)), device="cpu")
runner.load("/tmp/brace/port/anticipatory_3999_cpu.pt")
policy = runner.get_inference_policy(device="cpu")
onnx = glob.glob(HF + "*.onnx")[0]
g = Go1("/tmp/brace/export/go1_brace_physics.xml", onnx)
obs = wrapped.get_observations()
maxo = maxa = 0
for t in range(300):
    with torch.no_grad(): a_t = policy(obs)
    o_env = obs["actor"][0].numpy() if isinstance(obs, dict) or hasattr(obs, "keys") else obs[0].numpy()
    # mirror env state into standalone
    sd = env.sim.data
    g.d.qpos[:] = sd.qpos[0].cpu().numpy(); g.d.qvel[:] = sd.qvel[0].cpu().numpy()
    mujoco.mj_forward(g.m, g.d)
    g.action = env.action_manager.get_term("joint_pos").raw_action[0].numpy().astype(np.float64)
    g.cmd = env.command_manager.get_command("twist")[0].numpy()
    # threat: copy the env's threat command directly (tested separately by its own unit tests)
    th = env.command_manager.get_term("threat")
    g.threat = dict(theta_w=float(th._theta_w[0]), force=float(th._force[0]), ttl=float(th._time_to_impact[0]), duration=float(th._duration[0]))
    o_me = g.obs()
    a_onnx = g.sess.run(None, {g.in_name: o_env[None].astype(np.float32)})[0][0]
    maxo = max(maxo, np.abs(o_me - o_env).max()); maxa = max(maxa, np.abs(a_onnx - a_t[0].numpy()).max())
    if t in (0, 50, 299): print(t, "obs maxdiff", np.abs(o_me-o_env).max().round(6), "per-term", [np.abs(o_me-o_env)[s].max().round(5) for s in (slice(0,3),slice(3,6),slice(6,9),slice(9,21),slice(21,33),slice(33,45),slice(45,48),slice(48,52))], "onnx-vs-pt", np.abs(a_onnx-a_t[0].numpy()).max())
    obs, _, _, _ = wrapped.step(a_t)
print("MAX obs diff", maxo, "MAX onnx vs pt action diff", maxa)
