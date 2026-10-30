#!/usr/bin/env python3
"""
Bake components/hologram/faceDepth.ts from a real face scan.

Reads MediaPipe's canonical face model (468 vertices, from face scans),
rasterises it into a height field z = f(x, y) over the front of the head, fills
outward past the scan's boundary, and carries the forehead up into a cranium
the scan does not cover.

    pip install numpy
    curl -sLO https://raw.githubusercontent.com/google-ai-edge/mediapipe/master/mediapipe/modules/face_geometry/data/canonical_face_model.obj
    python3 scripts/bake-face-depth.py canonical_face_model.obj

Units: head height (chin -> crown) is 1.0; x in the same units; z forward.
"""
import sys, base64, numpy as np

SRC = sys.argv[1] if len(sys.argv) > 1 else "canonical_face_model.obj"
OUT = "components/hologram/faceDepth.ts"

NX, NY = 97, 129
X0, X1 = -0.42, 0.42
Y0, Y1 = -0.04, 1.03
SCALE = 20000
# The scan stops at the hairline, which sits at ~0.72 of head height. That one
# ratio is what fixes the scale of everything else.
HAIRLINE = 0.72

V, F = [], []
for line in open(SRC):
    p = line.split()
    if not p:
        continue
    if p[0] == "v":
        V.append([float(p[1]), float(p[2]), float(p[3])])
    elif p[0] == "f":
        F.append([int(t.split("/")[0]) - 1 for t in p[1:4]])
V, F = np.array(V), np.array(F)

s = HAIRLINE / (V[:, 1].max() - V[:, 1].min())
V[:, 1] = (V[:, 1] - V[:, 1].min()) * s
V[:, 0] *= s
V[:, 2] = (V[:, 2] - V[:, 2].min()) * s

gx = np.linspace(X0, X1, NX)
gy = np.linspace(Y0, Y1, NY)
GX, GY = np.meshgrid(gx, gy)
best = np.full(GX.shape, np.nan)

a, b, c = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
for i in range(len(F)):
    ax, ay, az = a[i]; bx, by, bz = b[i]; cx, cy, cz = c[i]
    i0 = max(0, int(np.searchsorted(gx, min(ax, bx, cx)) - 1))
    i1 = min(NX, int(np.searchsorted(gx, max(ax, bx, cx)) + 1))
    j0 = max(0, int(np.searchsorted(gy, min(ay, by, cy)) - 1))
    j1 = min(NY, int(np.searchsorted(gy, max(ay, by, cy)) + 1))
    if i0 >= i1 or j0 >= j1:
        continue
    sx, sy = GX[j0:j1, i0:i1], GY[j0:j1, i0:i1]
    d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    if abs(d) < 1e-12:
        continue
    l1 = ((by - cy) * (sx - cx) + (cx - bx) * (sy - cy)) / d
    l2 = ((cy - ay) * (sx - cx) + (ax - cx) * (sy - cy)) / d
    l3 = 1 - l1 - l2
    m = (l1 >= -1e-6) & (l2 >= -1e-6) & (l3 >= -1e-6)
    if not m.any():
        continue
    z = l1 * az + l2 * bz + l3 * cz
    sub = best[j0:j1, i0:i1]
    best[j0:j1, i0:i1] = np.where(m, np.maximum(np.where(np.isnan(sub), -1e9, sub), z), sub)

# The scan is near-symmetric; enforce it, or the key light reads as a lopsided face.
mir = best[:, ::-1]
best = np.where(np.isnan(best), mir, np.where(np.isnan(mir), best, (best + mir) / 2))
known = ~np.isnan(best)

# Diffusion-fill outward, so the surface continues past the scan's boundary
# instead of falling off a cliff there.
g = np.where(known, best, 0.0)
have = known.astype(float)
for _ in range(900):
    p = np.pad(g, 1, mode="edge"); k = np.pad(have, 1, mode="edge")
    num = p[:-2, 1:-1] + p[2:, 1:-1] + p[1:-1, :-2] + p[1:-1, 2:]
    den = k[:-2, 1:-1] + k[2:, 1:-1] + k[1:-1, :-2] + k[1:-1, 2:]
    g = np.where(known, best, np.where(den > 0, num / np.maximum(den, 1e-6), g))
    have = np.maximum(have, (den > 0).astype(float))
    if have.min() > 0:
        for _ in range(120):
            p = np.pad(g, 1, mode="edge")
            g = np.where(known, best, (p[:-2, 1:-1] + p[2:, 1:-1] + p[1:-1, :-2] + p[1:-1, 2:]) / 4)
        break

# Cranium. Switching from the scan to a synthetic dome at one row leaves a
# ledge across the forehead: the value matches but the slope does not. So take
# a smooth lateral profile from the brow-to-hairline band, roll it off
# vertically, and cross-fade the two fields over a wide band instead.
band = (gy >= 0.60) & (gy <= 0.70)
lateral = g[band].mean(axis=0)
for _ in range(6):
    lateral = np.convolve(np.pad(lateral, 2, mode="edge"), np.ones(5) / 5, mode="valid")

ky = np.array([0.00, 0.40, 0.62, 0.72, 0.80, 0.87, 0.92, 0.96, 0.99, 1.03])
kv = np.array([1.00, 1.00, 1.00, 0.99, 0.955, 0.885, 0.775, 0.605, 0.375, 0.00])
dome = np.outer(np.interp(gy, ky, kv), lateral)

t = np.clip((gy - 0.58) / (0.86 - 0.58), 0, 1)
w = (t * t * (3 - 2 * t))[:, None]
g = g * (1 - w) + dome * w

# Feather across the scan's own boundary. That boundary is a ragged arc — from
# y~0.60 at the temples to 0.72 at the centre of the forehead — and although the
# fill matches the scan's *value* there, it does not match its *slope*, which
# renders as a hairline ledge across the forehead. Blending toward a heavily
# smoothed copy in a band around the boundary removes the ledge and leaves the
# interior of the face untouched.
dist = np.zeros_like(g)
cur = known.copy()
for step in range(1, 14):
    p = np.pad(cur, 1, mode="constant", constant_values=False)
    eroded = cur & p[:-2, 1:-1] & p[2:, 1:-1] & p[1:-1, :-2] & p[1:-1, 2:]
    dist[cur & ~eroded] = step
    cur = eroded
    if not cur.any():
        break
dist[cur] = 14

soft = g.copy()
for _ in range(60):
    p = np.pad(soft, 1, mode="edge")
    soft = (p[:-2, 1:-1] + p[2:, 1:-1] + p[1:-1, :-2] + p[1:-1, 2:]) / 4
alpha = np.clip((dist - 3) / 7, 0, 1)
alpha = alpha * alpha * (3 - 2 * alpha)
g = g * alpha + soft * (1 - alpha)

# Close off below the chin.
jC = int(np.argmin(np.abs(gy)))
for j in range(jC):
    g[j] = g[jC] * max(0.0, 1 - (gy[jC] - gy[j]) / 0.05)

for _ in range(2):
    p = np.pad(g, 1, mode="edge")
    g = 0.6 * g + 0.4 * (p[:-2, 1:-1] + p[2:, 1:-1] + p[1:-1, :-2] + p[1:-1, 2:]) / 4


def at(x, y):
    return float(np.interp(y, gy, [np.interp(x, gx, g[j]) for j in range(NY)]))


for name, (x, y) in {
    "nose tip": (0.0, 0.345), "eye socket": (0.155, 0.50), "brow": (0.10, 0.565),
    "mouth": (0.0, 0.19), "cheek": (0.225, 0.40), "chin": (0.0, 0.06),
    "forehead": (0.0, 0.72), "crown": (0.0, 0.95),
}.items():
    print(f"  {name:<12}{at(x, y):.4f}")
print(f"  {'tip - socket':<12}{at(0.0, 0.345) - at(0.155, 0.50):.4f}")

q = np.clip(np.round(g * SCALE), -32000, 32000).astype("<i2")
raw = base64.b64encode(q.tobytes()).decode()

open(OUT, "w").write(f'''/**
 * Facial depth field, baked from MediaPipe's canonical face model — 468
 * vertices derived from real face scans — by scripts/bake-face-depth.py.
 *
 * This exists because hand-authored features never converged. A sum of
 * Gaussians can be tuned until it has a nose-shaped bump, but what makes a
 * shape read as a face is the *relative* depth of its features — a nose tip
 * stands about 0.15 head-heights proud of the eye socket, not 0.3 — and those
 * are measurements, not matters of taste.
 *
 * Units: head height chin -> crown = 1.0; x in the same units; z forward from
 * the plane at the back of the face scan. Above the hairline, which the scan
 * does not cover, the forehead is carried up and rolled back into a cranium.
 *
 * Generated data — edit the generator, not this file.
 */

export const GRID = {{
  nx: {NX},
  ny: {NY},
  x0: {X0},
  x1: {X1},
  y0: {Y0},
  y1: {Y1},
  scale: {SCALE},
  /** Int16LE depth samples, row-major from y0 to y1, base64. */
  data:
    "{raw}",
}} as const;
''')
print(f"wrote {OUT} ({len(raw)} b64 chars)")
