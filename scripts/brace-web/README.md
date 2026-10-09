# The live brace-for-impact sim — how it was built and checked

The "Shove it yourself" section on `/projects/brace-for-impact.html` runs the study's two
trained policies in the browser. Everything it loads is in `assets/brace/`; the code is
`assets/js/brace-core.js` (physics + policy, no DOM) and `assets/js/brace-live.js`
(rendering, input, tally). This folder is how those assets were made and how the port was
proved to behave like training.

## Layout these scripts expect

They were run from a scratch folder, `/tmp/brace`, and still say so:

```
/tmp/brace/brace-for-impact   git clone https://github.com/mitanshu-2004/brace-for-impact
/tmp/brace/venv               uv venv; uv pip install mjlab==1.5.3 torch (cpu) onnxruntime onnx trimesh fast-simplification
/tmp/brace/export             outputs
```

Policies come from the Hugging Face release (`mitanshugoel/go1-brace`, `anticipatory/` =
warned, `reactive/` = unwarned), read from the local HF cache.

## Steps, in order

1. **`make_physics_xml.py`** — builds mjlab's exact training scene (the warned task, play
   mode), deletes the visual meshes, copies the solver options the sim applies at runtime
   (timestep 0.005, implicitfast, elliptic cones, impratio 10, …) and asserts every
   inertial, actuator, joint, contact and solver setting equals the training model saved
   from a live mjlab env. Output: `assets/brace/go1.xml` (16 KB).
2. **`export_web.py`** — the ONNX policies as raw float32 (`policy-*.bin`: normaliser
   mean/std then the 512-256-128 ELU MLP), and the Go1 visual meshes decimated from 206k
   to 17k triangles (`go1-meshes.bin/json`, 209 KB).
3. **`go1.py`** — the controller in plain MuJoCo + onnxruntime, the reference the browser
   code mirrors line for line.
4. **`verify_obs.py`** — runs the real mjlab env with the `.pt` checkpoint and, every step,
   rebuilds the observation from `go1.py` on the same state. Result: max difference
   5e-7 (float rounding) on all 52 inputs, and ONNX vs `.pt` actions within 1e-6.
5. **`equiv.py` + `equiv.mjs`** — the same scripted 30 s rollout (walking, turning, four
   shoves of 120–250 N) through `go1.py` and through `assets/js/brace-core.js` on
   `@mujoco/mujoco@3.10.0` in Node. Warned and not-warned: trunk paths agree within
   0.2 mm. Warning-off agrees until it stumbles, then diverges the way a falling robot
   does, and both end up down.
   `node equiv.mjs <path to @mujoco/mujoco 3.10.0>/mujoco.js warned|unwarned|blind`
6. **`fallrate.py`** — the eval.py protocol (random walking commands, one shove every
   3–6 s with a 0.4–1.2 s warning and 0.1–0.3 s of force, 2 s watched) in the browser-
   equivalent loop: `python fallrate.py 2000 120,200,250`.

Pinned in the browser: `@mujoco/mujoco` 3.10.0 (the version the Python checks ran on) and
`three` 0.186.1, both from jsDelivr, loaded only when the visitor presses Start.
