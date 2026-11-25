#!/usr/bin/env python3
"""ML1 TRAINER (Fase 2/3 — shadow murni).

Melatih dua head GBDT Poisson (home/away) di atas offset champion sesuai
design beku tasks/ml1/design.md §5:

  - Seleksi konfigurasi: latih di baris V1, skor = mean Poisson NLL
    (home+away, lambda/mu kandidat ter-clamp) di baris V2. Grid terkunci:
    num_boost_round {100,200,400} x lambda_l2 {1,10}; parameter lain tetap
    (max_depth=3, learning_rate=0.05, min_data_in_leaf=50, seed=20261125,
    num_threads=1, deterministic_force=true, objective='poisson').
  - Refit konfigurasi terpilih di V1+V2 -> prediksi H satu kali.
  - Offset: init_score = log(lambda_champion) / log(mu_champion).
    Komposisi resmi (terverifikasi Fase 0): lambda = exp(init + raw_score),
    lalu clamp [0.05, 6.0]. Booster.predict() TIDAK menyertakan init_score.
  - Baris fallback champion: kandidat abstain (lambda/mu = champion) di
    berkas prediksi; baris itu tetap ikut latih (paritas protokol Q1).

Keluaran (deterministik, tanpa timestamp):
  <outdir>/train-summary.json  — tabel grid, konfigurasi terpilih, versi.
  <outdir>/pred-v2.jsonl       — {match, lam, mu} baris V2 dari model V1.
  <outdir>/pred-h.jsonl        — {match, lam, mu} baris H dari model V1+V2.

Interpreter resmi: ~/workspace/tools/ml1-venv/bin/python (lightgbm 4.7.0).
"""
import argparse
import hashlib
import json
import math
import sys

import lightgbm as lgb
import numpy as np

SEED = 20261125
LAM_MIN, LAM_MAX = 0.05, 6.0
GRID_ROUNDS = [100, 200, 400]
GRID_L2 = [1.0, 10.0]
BASE_PARAMS = dict(
    objective="poisson",
    max_depth=3,
    learning_rate=0.05,
    min_data_in_leaf=50,
    seed=SEED,
    num_threads=1,
    deterministic_force=True,
    verbose=-1,
)


def poisson_nll(y: float, lam: float) -> float:
    return lam - y * math.log(lam)


def clamp_lam(v: float) -> float:
    return min(LAM_MAX, max(LAM_MIN, v))


def load_rows(path: str, model: str):
    rows = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    key = "featA" if model == "a" else "featB"
    for r in rows:
        r["_x"] = np.array(r[key], dtype=np.float64)
    return rows


def matrices(rows):
    X = np.stack([r["_x"] for r in rows])
    y_home = np.array([r["hs"] for r in rows], dtype=np.float64)
    y_away = np.array([r["as"] for r in rows], dtype=np.float64)
    init_home = np.log(np.array([r["champLam"] for r in rows], dtype=np.float64))
    init_away = np.log(np.array([r["champMu"] for r in rows], dtype=np.float64))
    return X, y_home, y_away, init_home, init_away


def train_head(X, y, init, rounds: int, l2: float):
    params = dict(BASE_PARAMS)
    params["lambda_l2"] = l2
    ds = lgb.Dataset(X, label=y, init_score=init)
    return lgb.train(params, ds, num_boost_round=rounds)


def predict_head(bst, X, init):
    raw = bst.predict(X, raw_score=True)
    return np.array([clamp_lam(math.exp(i + r)) for i, r in zip(init, raw)], dtype=np.float64)


def mean_nll(rows, lam, mu) -> float:
    s = 0.0
    for r, l_, m_ in zip(rows, lam, mu):
        s += poisson_nll(r["hs"], l_) + poisson_nll(r["as"], m_)
    return s / len(rows)


def write_preds(path: str, rows, lam, mu) -> str:
    lines = []
    for r, l_, m_ in zip(rows, lam, mu):
        if r["champFallback"]:
            l_, m_ = r["champLam"], r["champMu"]  # abstain: salin champion
        lines.append(json.dumps({"match": r["match"], "lam": float(l_), "mu": float(m_)}, separators=(",", ":")))
    body = "\n".join(lines) + "\n"
    with open(path, "w", encoding="utf-8") as f:
        f.write(body)
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--features", required=True)
    ap.add_argument("--model", choices=["a", "b"], required=True)
    ap.add_argument("--outdir", required=True)
    args = ap.parse_args()

    import os
    os.makedirs(args.outdir, exist_ok=True)

    rows = load_rows(args.features, args.model)
    by_fold = {f: [r for r in rows if r["fold"] == f] for f in ("V1", "V2", "H")}
    X1, yh1, ya1, ih1, ia1 = matrices(by_fold["V1"])
    X2, yh2, ya2, ih2, ia2 = matrices(by_fold["V2"])
    X12 = np.concatenate([X1, X2])
    yh12 = np.concatenate([yh1, yh2])
    ya12 = np.concatenate([ya1, ya2])
    ih12 = np.concatenate([ih1, ih2])
    ia12 = np.concatenate([ia1, ia2])
    XH, yhH, yaH, ihH, iaH = matrices(by_fold["H"])

    # --- Seleksi konfigurasi di V1 -> V2 (satu-satunya pemilihan) -----------
    grid = []
    best = None  # (nll, rounds, l2) dengan aturan seri design §5
    for rounds in GRID_ROUNDS:
        for l2 in GRID_L2:
            bh = train_head(X1, yh1, ih1, rounds, l2)
            ba = train_head(X1, ya1, ia1, rounds, l2)
            lam2 = predict_head(bh, X2, ih2)
            mu2 = predict_head(ba, X2, ia2)
            nll = mean_nll(by_fold["V2"], lam2, mu2)
            grid.append({"num_boost_round": rounds, "lambda_l2": l2, "nll_v2": nll})
            key = (nll, rounds, -l2)
            if best is None or key < best[0]:
                best = (key, rounds, l2, bh, ba, lam2, mu2)
    _, best_rounds, best_l2, bh_v1, ba_v1, lam2_best, mu2_best = best

    # --- Refit di V1+V2 -> H satu kali --------------------------------------
    bh_final = train_head(X12, yh12, ih12, best_rounds, best_l2)
    ba_final = train_head(X12, ya12, ia12, best_rounds, best_l2)
    lamH = predict_head(bh_final, XH, ihH)
    muH = predict_head(ba_final, XH, iaH)

    sha_v2 = write_preds(os.path.join(args.outdir, "pred-v2.jsonl"), by_fold["V2"], lam2_best, mu2_best)
    sha_h = write_preds(os.path.join(args.outdir, "pred-h.jsonl"), by_fold["H"], lamH, muH)

    with open(args.features, "rb") as f:
        features_sha = hashlib.sha256(f.read()).hexdigest()

    summary = {
        "model": f"ml1-{args.model}",
        "backend": {"lightgbm": lgb.__version__, "numpy": np.__version__, "interpreter": sys.executable},
        "features_sha256": features_sha,
        "rows": {f: len(by_fold[f]) for f in by_fold},
        "base_params": {k: v for k, v in BASE_PARAMS.items()},
        "grid": grid,
        "chosen": {"num_boost_round": best_rounds, "lambda_l2": best_l2},
        "nll_v2_chosen": mean_nll(by_fold["V2"], lam2_best, mu2_best),
        "pred_v2_sha256": sha_v2,
        "pred_h_sha256": sha_h,
    }
    with open(os.path.join(args.outdir, "train-summary.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, sort_keys=True)
    print(json.dumps({
        "model": summary["model"],
        "chosen": summary["chosen"],
        "nll_v2_chosen": summary["nll_v2_chosen"],
        "pred_v2_sha256": sha_v2,
        "pred_h_sha256": sha_h,
    }, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
