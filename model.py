# Extracted from user-provided CroPatella original app.py.
# Mathematical functions unchanged. Executed locally in the browser with Pyodide.
import io
import math
import hashlib
import numpy as np
import trimesh

BETA_0 = -16.871594357832656
BETA_1 = 5.79389479183113
MESH_SURFACE_POOL_POINTS = 10000
N_SAMPLE_POINTS = 2048
N_RADIAL_LINES = 16

def predict_probability(centroid_size_mm: float) -> float:
    """P(male) from the deployed logistic regression on log(centroid_size_mm)."""
    log_size = math.log(centroid_size_mm)
    logit = BETA_0 + BETA_1 * log_size
    if logit >= 0:
        return 1.0 / (1.0 + math.exp(-logit))
    z = math.exp(logit)
    return z / (1.0 + z)


def _stable_mesh_seed(mesh) -> int:
    """Return a reproducible seed derived from mesh geometry."""
    vertices = np.ascontiguousarray(np.asarray(mesh.vertices, dtype=np.float64))
    faces = np.ascontiguousarray(np.asarray(mesh.faces, dtype=np.int64))
    digest = hashlib.sha256(vertices.tobytes() + faces.tobytes()).digest()
    return int.from_bytes(digest[:4], byteorder="little", signed=False)


def compute_centroid_and_size(mesh, n_sample=N_SAMPLE_POINTS):
    """Compute the deployment-time centroid-size feature reproducibly.

    A uniform 10,000-point mesh-surface pool is generated with a seed derived
    from the mesh. A deterministic 2,048-point subset is used to calculate the
    root-mean-square surface distance from the subset centroid. This matches
    the selected feature definition and point budget while giving previously
    unseen uploads a stable sampling seed.
    """
    seed = _stable_mesh_seed(mesh)
    previous_state = np.random.get_state()
    try:
        np.random.seed(seed)
        pool, _ = trimesh.sample.sample_surface(mesh, MESH_SURFACE_POOL_POINTS)
    finally:
        np.random.set_state(previous_state)
    pool = np.asarray(pool, dtype=float)
    rng = np.random.default_rng(seed ^ 0x9E3779B9)
    idx = rng.choice(len(pool), size=n_sample, replace=False)
    pts = pool[idx]
    centroid = pts.mean(axis=0)
    cs = float(np.sqrt(np.mean(np.sum((pts - centroid) ** 2, axis=1))))
    return centroid, cs, pts


def select_radial_endpoints(surface_points: np.ndarray, centroid: np.ndarray,
                              n: int = N_RADIAL_LINES) -> np.ndarray:
    """Pick n surface points that are roughly evenly distributed in direction
    from the centroid — produces a clean radial-line visualisation."""
    if len(surface_points) <= n:
        return surface_points
    dirs = surface_points - centroid
    norms = np.linalg.norm(dirs, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    unit = dirs / norms
    chosen_idx = [0]
    chosen_unit = [unit[0]]
    while len(chosen_idx) < n:
        best_i, best_min = -1, -1.0
        for i in range(len(surface_points)):
            if i in chosen_idx: continue
            min_dist = min(1.0 - float(np.dot(unit[i], cu)) for cu in chosen_unit)
            if min_dist > best_min:
                best_min, best_i = min_dist, i
        if best_i < 0: break
        chosen_idx.append(best_i)
        chosen_unit.append(unit[best_i])
    return surface_points[chosen_idx]


def parse_stl_bytes(raw_bytes):
    mesh = trimesh.load(io.BytesIO(raw_bytes), file_type="stl")
    if isinstance(mesh, trimesh.Scene):
        geoms = [g for _, g in mesh.geometry.items()
                  if isinstance(g, trimesh.Trimesh)]
        if not geoms:
            raise ValueError("STL loaded as Scene but contained no triangle meshes.")
        mesh = trimesh.util.concatenate(geoms)
    return mesh


def process_stl_data(raw):
    mesh = parse_stl_bytes(raw)
    centroid, cs, surface_points = compute_centroid_and_size(mesh)
    endpoints = select_radial_endpoints(surface_points, centroid)
    probability = predict_probability(cs)
    return {
        "centroid": centroid.tolist(),
        "centroid_size": float(cs),
        "probability": float(probability),
        "decision": "Male" if probability >= 0.5 else "Female",
        "plausibility": (
            "⚠ The estimated probability is close to 0.5. Classification uncertainty "
            "is high; report the probability together with the categorical estimate."
            if 0.40 <= probability <= 0.60 else ""
        ),
        "radial_endpoints": endpoints.tolist(),
        "mesh_seed": int(_stable_mesh_seed(mesh)),
        "vertices_count": int(len(mesh.vertices)),
        "faces_count": int(len(mesh.faces)),
        "trimesh_version": trimesh.__version__,
        "numpy_version": np.__version__,
    }
