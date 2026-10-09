"""Build the browser physics model: mjlab's exact training scene minus visual meshes."""
import mujoco, numpy as np, brace_task, sys
from mjlab.tasks.registry import load_env_cfg
from mjlab.scene import Scene
from brace_task import WARNED_TASK
ref = mujoco.MjModel.from_binary_path("/tmp/brace/export/train_model.mjb")
cfg = load_env_cfg(WARNED_TASK, play=True); cfg.scene.num_envs=1
s = Scene(cfg.scene, device="cpu"); spec = s.spec
for g in list(spec.geoms):
    if g.type == mujoco.mjtGeom.mjGEOM_MESH: spec.delete(g)
for x in list(spec.meshes)+list(spec.textures)+list(spec.materials): spec.delete(x)
for g in spec.geoms: g.material=""
o=spec.option; r=ref.opt
for k in ["timestep","integrator","cone","impratio","iterations","ls_iterations","tolerance","ls_tolerance","ccd_iterations","solver","jacobian","noslip_iterations"]:
    setattr(o,k,getattr(r,k))
o.gravity=r.gravity
import re
xml = re.sub(r"\n\s*<default/>", "", spec.to_xml())
open("/tmp/brace/export/go1_brace_physics.xml","w").write(xml)
m = mujoco.MjModel.from_xml_string(xml)
checks = ["body_mass","body_inertia","body_ipos","body_iquat","body_pos","body_quat","jnt_range","dof_armature","actuator_gainprm","actuator_biasprm","actuator_forcerange","qpos0","geom_friction","geom_solref","geom_condim"]
nonmesh = ref.geom_type != mujoco.mjtGeom.mjGEOM_MESH
for n in checks:
    a=getattr(ref,n); b=getattr(m,n)
    if n.startswith("geom_"): a=a[nonmesh]
    assert a.shape==b.shape and np.allclose(a,b), n
assert m.opt.timestep==ref.opt.timestep and m.opt.integrator==ref.opt.integrator and m.opt.cone==ref.opt.cone and m.opt.impratio==ref.opt.impratio
print("physics xml OK", len(xml), "bytes")
