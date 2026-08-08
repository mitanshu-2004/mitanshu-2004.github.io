"""Re-plot the brace-for-impact survival result in the site's palette.

The numbers come straight from the experiment's own eval CSVs
(github.com/mitanshu-2004/brace-for-impact, results/eval_*.csv) and the Wilson
interval below is the same one scripts/analyze.py uses there — this script only
changes the colours and typography so the chart sits on a dark page instead of
matplotlib's white default. Nothing is recomputed differently.

Usage:
  python3 scripts/brace-survival-chart.py --results-dir ~/RL/brace/results \
      --out assets/media/brace-survival.png
  python3 scripts/brace-survival-chart.py --results-dir ~/RL/brace/results \
      --out assets/media/brace-survival-narrow.png --mobile

Name the narrow render "-narrow", not "-mobile": .gitignore drops `*-mobile.png`
as local screenshot scratch, and would silently swallow the asset.
"""

from __future__ import annotations

import argparse
import csv
import math
from collections import defaultdict
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

BG = "#131110"
INK = "#EDE8E2"
MUTED = "#A39B92"
LINE = "#2E2925"

ORDER = ("warned", "unwarned", "warning_removed")
PRETTY = {
  "warned": "warned",
  "unwarned": "not warned",
  "warning_removed": "warned, then warning switched off",
}
COLOURS = {
  "warned": "#FF6A2B",   # site accent
  "unwarned": "#6FA8DC",
  "warning_removed": "#A39B92",
}


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float, float]:
  """Wilson score interval for a binomial proportion. Returns (p, lo, hi)."""
  if n == 0:
    return 0.0, 0.0, 0.0
  p = k / n
  d = 1 + z * z / n
  centre = (p + z * z / (2 * n)) / d
  half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
  return p, max(0.0, centre - half), min(1.0, centre + half)


def load(path: Path) -> dict[float, list[dict]]:
  by_force: dict[float, list[dict]] = defaultdict(list)
  with path.open() as f:
    for row in csv.DictReader(f):
      by_force[float(row["force_n"])].append(row)
  return by_force


def main() -> None:
  ap = argparse.ArgumentParser()
  ap.add_argument("--results-dir", required=True)
  ap.add_argument("--out", required=True)
  ap.add_argument(
    "--mobile", action="store_true",
    help="taller canvas, bigger type, legend above the axes — a phone shows this "
         "chart at about a third of the desktop width, and type sized for 940px "
         "is unreadable once the browser scales it down that far",
  )
  a = ap.parse_args()

  # every size below is chosen so the chart stays legible *after* the browser
  # scales it to its display width, not at natural size
  if a.mobile:
    figsize, dpi, label_fs, tick_fs, legend_fs, marker, lw = (5.0, 5.6), 150, 14, 12.5, 13, 6, 2.2
  else:
    figsize, dpi, label_fs, tick_fs, legend_fs, marker, lw = (7.4, 4.6), 190, 10, 9, 9.5, 4.5, 1.7

  root = Path(a.results_dir).expanduser()
  data = {r: load(root / f"eval_{r}.csv") for r in ORDER if (root / f"eval_{r}.csv").exists()}
  if not data:
    raise SystemExit(f"no eval_*.csv under {root}")

  forces = sorted(set().union(*(set(d) for d in data.values())))

  fig, ax = plt.subplots(figsize=figsize, dpi=dpi)
  fig.patch.set_facecolor(BG)
  ax.set_facecolor(BG)

  for robot, by_force in data.items():
    xs, ys, lo, hi = [], [], [], []
    for force in forces:
      rows = by_force.get(force, [])
      k = sum(r["fell"] == "True" for r in rows)
      p, l, h = wilson(k, len(rows))
      xs.append(force)
      ys.append(100 * p)
      lo.append(100 * (p - l))
      hi.append(100 * (h - p))
      print(f"{robot:>16} {force:5.0f} N  {100 * p:5.2f}%  [{100 * l:.2f}, {100 * h:.2f}]  n={len(rows)}")
    ax.errorbar(
      xs, ys, yerr=[lo, hi], marker="o", markersize=marker, capsize=3, linewidth=lw,
      label=PRETTY[robot], color=COLOURS[robot],
    )

  ax.set_xlabel("shove strength (N)", color=MUTED, fontsize=label_fs)
  ax.set_ylabel("falls per shove (%)", color=MUTED, fontsize=label_fs)
  ax.tick_params(colors=MUTED, labelsize=tick_fs)
  ax.grid(color=LINE, linewidth=0.8)
  ax.set_axisbelow(True)
  for side in ("top", "right"):
    ax.spines[side].set_visible(False)
  for side in ("left", "bottom"):
    ax.spines[side].set_color(LINE)

  if a.mobile:
    # the third label is long; inside a narrow axes it would sit on top of the
    # curves, so it goes above the plot instead
    leg = ax.legend(
      frameon=False, fontsize=legend_fs, loc="lower left",
      bbox_to_anchor=(0, 1.01, 1, 0.2), mode="expand", ncol=1, handlelength=1.6,
    )
  else:
    leg = ax.legend(frameon=False, fontsize=legend_fs, loc="upper left")
  for text in leg.get_texts():
    text.set_color(INK)

  fig.tight_layout()
  fig.savefig(a.out, facecolor=BG)
  print(f"wrote {a.out}")


if __name__ == "__main__":
  main()
