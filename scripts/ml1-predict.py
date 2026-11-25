#!/usr/bin/env python3
"""ML1 PREDICT — inferensi booster ML1-B terserialisasi (jalur prospektif Item 19).

Memuat booster hasil refit V1+V2 dari tasks/ml1/model/ (lihat
scripts/ml1-train.py --model-out), lalu untuk setiap baris masukan JSONL
{match, champLam, champMu, champFallback, featB[32]} menghasilkan
{match, lam, mu} dengan komposisi resmi design beku §2/§5:

  lambda = clamp(exp(log lambda_champion + raw_score_home), 0.05, 6.0)
  mu     = clamp(exp(log mu_champion     + raw_score_away), 0.05, 6.0)

Booster.predict() TIDAK menyertakan init_score (terverifikasi Fase 0 sprint),
jadi raw_score diambil apa adanya. Baris champFallback=true abstain persis
seperti protokol sprint: lambda/mu = champion.

Hash booster diverifikasi terhadap model-manifest.json sebelum inferensi;
ketidakcocokan = exit 2 (fail-closed).

Pakai:
  ~/workspace/tools/ml1-venv/bin/python scripts/ml1-predict.py \
    --model-dir=tasks/ml1/model --input=<jsonl> --output=<jsonl>
"""
import argparse
import hashlib
import json
import math
import sys

import lightgbm as lgb
import numpy as np

LAM_MIN, LAM_MAX = 0.05, 6.0
N_FEATURES_B = 32


def clamp_lam(v: float) -> float:
    return min(LAM_MAX, max(LAM_MIN, v))


def file_sha(p: str) -> str:
    with open(p, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model-dir", required=True)
    ap.add_argument("--input", required=True)
    ap.add_argument("--output", required=True)
    args = ap.parse_args()

    import os
    manifest_path = os.path.join(args.model_dir, "model-manifest.json")
    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)
    boosters = {}
    for head in ("home", "away"):
        info = manifest["boosters"][head]
        p = os.path.join(args.model_dir, info["file"])
        actual = file_sha(p)
        if actual != info["sha256"]:
            print(f"ERROR: hash booster {head} tidak cocok manifest ({actual} != {info['sha256']})", file=sys.stderr)
            return 2
        boosters[head] = lgb.Booster(model_file=p)

    rows = []
    with open(args.input, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    for r in rows:
        if len(r["featB"]) != N_FEATURES_B:
            print(f"ERROR: featB {r.get('match')} berukuran {len(r['featB'])} != {N_FEATURES_B}", file=sys.stderr)
            return 2

    out_lines = []
    if rows:
        X = np.array([r["featB"] for r in rows], dtype=np.float64)
        raw_home = boosters["home"].predict(X, raw_score=True)
        raw_away = boosters["away"].predict(X, raw_score=True)
        for r, rh, ra in zip(rows, raw_home, raw_away):
            if r.get("champFallback"):
                lam, mu = r["champLam"], r["champMu"]
            else:
                lam = clamp_lam(math.exp(math.log(r["champLam"]) + float(rh)))
                mu = clamp_lam(math.exp(math.log(r["champMu"]) + float(ra)))
            out_lines.append(json.dumps({"match": r["match"], "lam": float(lam), "mu": float(mu)}, separators=(",", ":")))
    with open(args.output, "w", encoding="utf-8") as f:
        f.write("\n".join(out_lines) + ("\n" if out_lines else ""))
    print(json.dumps({"rows": len(rows), "model": manifest["model"], "manifest_pred_h_sha256": manifest["pred_h_sha256"]}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
