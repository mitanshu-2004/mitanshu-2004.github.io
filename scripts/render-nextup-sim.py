"""
Render the NextUp cobot moving through the eight Cartesian pose targets that
are hard-coded in cobot_robotiq_moveit_interface/src/position_interface.cpp.

The targets are Mitanshu's. The path between them is not MoveIt's OMPL plan —
it is damped least-squares IK solved here — so the caption must say "the pose
targets from my position_interface, reached in sequence", not "a MoveIt plan".
"""
import re
import numpy as np
import mujoco as mj
import imageio.v2 as iio

# ---- the eight targets, copied verbatim from position_interface.cpp ----------
TARGETS = [
    (-0.000008, 0.345337, 0.733738),
    ( 0.000024, 0.518024, 0.733738),
    (-0.000000, 0.528631, 0.171393),
    (-0.000004, 0.520045, 0.628285),
    ( 0.307135, 0.520045, 0.628285),
    ( 0.307135, 0.074214, 0.619908),
    ( 0.751961, 0.074214, 0.619908),
    ( 0.751961, 0.082505, 0.179068),
]

model = mj.MjModel.from_xml_path('/tmp/scene4.xml')
data = mj.MjData(model)

EEF = mj.mj_name2id(model, mj.mjtObj.mjOBJ_BODY, 'robotiq_85_base_link')
ARM = [mj.mj_name2id(model, mj.mjtObj.mjOBJ_JOINT, f'joint{i}') for i in range(1, 7)]
QADR = [model.jnt_qposadr[j] for j in ARM]
DADR = [model.jnt_dofadr[j] for j in ARM]


def ik(target, q0, iters=400, damp=0.12, step=0.55):
    """Damped least squares on the 6 arm joints only."""
    q = q0.copy()
    jacp = np.zeros((3, model.nv))
    for _ in range(iters):
        data.qpos[:] = 0
        for a, v in zip(QADR, q):
            data.qpos[a] = v
        mj.mj_kinematics(model, data)
        mj.mj_comPos(model, data)
        err = np.array(target) - data.xpos[EEF]
        if np.linalg.norm(err) < 1e-4:
            break
        mj.mj_jacBody(model, data, jacp, None, EEF)
        J = jacp[:, DADR]
        dq = J.T @ np.linalg.solve(J @ J.T + damp**2 * np.eye(3), err)
        q = q + step * dq
        for i, j in enumerate(ARM):
            lo, hi = model.jnt_range[j]
            if hi > lo:
                q[i] = np.clip(q[i], lo, hi)
    return q, float(np.linalg.norm(err))


# solve each waypoint, warm-starting from the previous solution
q = np.zeros(6)
solutions, errors = [], []
for t in TARGETS:
    q, e = ik(t, q)
    solutions.append(q.copy())
    errors.append(e)

print('  IK residuals (m):', ' '.join(f'{e:.4f}' for e in errors))
print(f'  worst {max(errors)*1000:.1f} mm, median {np.median(errors)*1000:.1f} mm')

# ---- render -----------------------------------------------------------------
renderer = mj.Renderer(model, 720, 1280)
cam = mj.MjvCamera()
mj.mjv_defaultCamera(cam)
cam.lookat[:] = [0.34, 0.28, 0.44]
cam.distance = 1.62
cam.elevation = -13

frames = []
HOLD, MOVE = 7, 26
seq = [np.zeros(6)] + solutions
for i in range(len(seq) - 1):
    a, b = seq[i], seq[i + 1]
    for k in range(MOVE):
        u = k / (MOVE - 1)
        s = u * u * (3 - 2 * u)              # smoothstep, like a velocity profile
        for adr, va, vb in zip(QADR, a, b):
            data.qpos[adr] = va * (1 - s) + vb * s
        mj.mj_forward(model, data)
        cam.azimuth = 132 + 12 * np.sin((len(frames) / 430) * 2 * np.pi)
        renderer.update_scene(data, cam)
        frames.append(renderer.render())
    for _ in range(HOLD):
        frames.append(frames[-1])

iio.mimsave('/tmp/cut/nextup-sim.mp4', frames, fps=30, quality=8, macro_block_size=1)
print(f'  rendered {len(frames)} frames ({len(frames)/30:.1f}s)')
