"""Export policy weights (float32 .bin) and decimated visual meshes for the browser."""
import onnx, onnx.numpy_helper as nh, numpy as np, glob, os, json, mujoco, trimesh, fast_simplification
OUT = "/tmp/brace/web"
HF = os.path.expanduser("~/.cache/huggingface/hub/models--mitanshugoel--go1-brace/snapshots/*/")
# --- policies: [mean, std, W0,b0, W1,b1, W2,b2, W3,b3] float32, W stored [out,in] row-major
for name, sub in [("warned", "anticipatory"), ("unwarned", "reactive")]:
    m = onnx.load(glob.glob(HF + sub + "/*/*.onnx")[0])
    init = {t.name: nh.to_array(t).astype(np.float32) for t in m.graph.initializer}
    for n in m.graph.node:
        if n.op_type == "Gemm":
            at = {a.name: a.i for a in n.attribute}; assert at.get("transB", 0) == 1, at
        if n.op_type == "Elu":
            assert all(abs(a.f - 1.0) < 1e-6 for a in n.attribute if a.name == "alpha")
    div = [k for k in init if k.startswith("onnx::Div")][0]
    parts = [init["obs_normalizer._mean"].ravel(), init[div].ravel()]
    for i in (0, 2, 4, 6): parts += [init[f"mlp.{i}.weight"].ravel(), init[f"mlp.{i}.bias"].ravel()]
    blob = np.concatenate(parts).astype("<f4"); blob.tofile(f"{OUT}/policy-{name}.bin")
    print(name, "obs", init["obs_normalizer._mean"].shape[1], "bytes", blob.nbytes)
# --- visual meshes from the exact training model, decimated
ref = mujoco.MjModel.from_binary_path("/tmp/brace/export/train_model.mjb")
meshes, geoms, chunks, off = [], [], [], 0
TARGET = {"robot/trunk": 6000}
for mi in range(ref.nmesh):
    name = mujoco.mj_id2name(ref, mujoco.mjtObj.mjOBJ_MESH, mi)
    va, vn = ref.mesh_vertadr[mi], ref.mesh_vertnum[mi]; fa, fn = ref.mesh_faceadr[mi], ref.mesh_facenum[mi]
    V = ref.mesh_vert[va:va+vn].astype(np.float32); F = ref.mesh_face[fa:fa+fn].astype(np.int32)
    tgt = TARGET.get(name, 2500)
    if fn > tgt:
        V, F = fast_simplification.simplify(V, F, target_reduction=1 - tgt/fn)
    V = V.astype("<f4"); F = F.astype("<u2" if len(V) < 65536 else "<u4")
    meshes.append(dict(name=name, vOff=off, vCount=int(len(V)), iOff=off + V.nbytes, iCount=int(F.size), faces_orig=int(fn)))
    chunks += [V.tobytes(), F.tobytes()]; off += V.nbytes + F.nbytes
    if off % 4: pad = 4 - off % 4; chunks.append(b"\0"*pad); off += pad
open(f"{OUT}/go1-meshes.bin", "wb").write(b"".join(chunks))
for gi in range(ref.ngeom):
    if ref.geom_type[gi] != mujoco.mjtGeom.mjGEOM_MESH: continue
    geoms.append(dict(body=mujoco.mj_id2name(ref, mujoco.mjtObj.mjOBJ_BODY, ref.geom_bodyid[gi]),
                      mesh=int(ref.geom_dataid[gi]), pos=ref.geom_pos[gi].round(6).tolist(),
                      quat=ref.geom_quat[gi].round(6).tolist(), rgba=ref.geom_rgba[gi].round(3).tolist(),
                      matrgba=(ref.mat_rgba[ref.geom_matid[gi]].round(3).tolist() if ref.geom_matid[gi] >= 0 else None)))
json.dump(dict(meshes=meshes, geoms=geoms), open(f"{OUT}/go1-meshes.json", "w"))
print("meshes", [(m_["name"], m_["faces_orig"], m_["iCount"]//3) for m_ in meshes], "bin", off, "geoms", len(geoms))
