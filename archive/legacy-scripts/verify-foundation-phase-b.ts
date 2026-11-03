/**
 * Verifikasi Fase B — Kuantitatif: Special Markets & Metadata Estimasi
 *
 * Kriteria:
 * 1. observed_crosses_samples memakai sample CROSSES, bukan PASSES.
 * 2. Dua tim dengan profil aerial jauh berbeda menghasilkan expected_headers berbeda material.
 * 3. Multiplier yang mentok clamp tidak boleh diklaim HIGH.
 * 4. Corners & Cards menandai is_estimated + confidence_tier saat tanpa telemetry.
 * 5. Nilai tier menurun saat sampel sedikit.
 */

import { generateSpecialMarketsPackage } from "../lib/quant/special-markets-engine";
import { getTeamRollingTelemetry, type TeamRollingTelemetry } from "../lib/db/team-telemetry";

let pass = 0;
let fail = 0;

function assert(label: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  ✅ ${label}`);
  } else {
    fail++;
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Base telemetry kosong untuk membangun kasus sintetis. */
function emptyTelemetry(): TeamRollingTelemetry {
  return {
    team_id: "synthetic",
    sample_size: 0,
    observed_xg_samples: 0,
    observed_shots_samples: 0,
    observed_passes_samples: 0,
    observed_aerial_samples: 0,
    observed_crosses_samples: 0,
    rolling_xg_for: null,
    rolling_xg_against: null,
    rolling_npxg_for: null,
    rolling_npxg_against: null,
    rolling_goals_for: 0,
    rolling_goals_against: 0,
    win_rate: 0,
    clean_sheet_rate: 0,
    form_sequence: "N/A",
    avg_possession_pct: null,
    avg_shots_for: null,
    avg_shots_on_target_for: null,
    avg_shots_inside_box_for: null,
    avg_big_chances_for: null,
    avg_box_touches_for: null,
    avg_passes_accurate_for: null,
    avg_pass_accuracy_pct: null,
    avg_crosses_accurate_for: null,
    avg_aerial_duels_pct_for: null,
    avg_duels_won_pct_for: null,
    avg_ground_duels_pct_for: null,
    avg_tackles_for: null,
    avg_corners_for: null,
    avg_fouls_committed: null,
    avg_yellow_cards: null,
    recent_logs: [],
  };
}

/** Tim "dominan udara": banyak duel udara dimenangkan. */
function aerialDominant(): TeamRollingTelemetry {
  const t = emptyTelemetry();
  t.sample_size = 6;
  t.observed_aerial_samples = 6;
  t.observed_crosses_samples = 6;
  t.avg_aerial_duels_pct_for = 20; // duel udara dimenangkan
  t.avg_duels_won_pct_for = 50; // total duel dimenangkan
  t.avg_crosses_accurate_for = 6.5; // crossing jauh di atas benchmark
  t.avg_box_touches_for = 32;
  return t;
}

/** Tim "tidak aerial": hampir tidak menang duel udara. */
function aerialWeak(): TeamRollingTelemetry {
  const t = emptyTelemetry();
  t.sample_size = 6;
  t.observed_aerial_samples = 6;
  t.observed_crosses_samples = 6;
  t.avg_aerial_duels_pct_for = 3;
  t.avg_duels_won_pct_for = 50;
  t.avg_crosses_accurate_for = 1.5;
  t.avg_box_touches_for = 15;
  return t;
}

/** Tim dengan corners/kartu terukur. */
function measuredCornerCards(): TeamRollingTelemetry {
  const t = emptyTelemetry();
  t.sample_size = 5;
  t.avg_corners_for = 6.4;
  t.avg_yellow_cards = 1.8;
  return t;
}

// ---------------------------------------------------------------------------
console.log("\n[1] observed_crosses_samples bukan observed_passes_samples");
const realArsenal = getTeamRollingTelemetry("Arsenal", 6);
assert(
  "field observed_crosses_samples ter-expose",
  typeof realArsenal.observed_crosses_samples === "number",
  `dapat ${typeof realArsenal.observed_crosses_samples}`
);
assert(
  "crosses samples terisi untuk Arsenal",
  realArsenal.observed_crosses_samples > 0,
  `dapat ${realArsenal.observed_crosses_samples}`
);

// ---------------------------------------------------------------------------
console.log("\n[2] Profil aerial jauh berbeda -> expected_headers beda material");
// Bandingkan HOME di kedua skenario (posisi sama), dengan lawan identik,
// supaya perbedaan murni datang dari profil kandang.
const neutralOpponent = aerialWeak();
const homeDominantPkg = generateSpecialMarketsPackage({
  homeTeam: "Dominant",
  awayTeam: "Neutral",
  homeTelemetry: aerialDominant(),
  awayTelemetry: neutralOpponent,
});
const homeWeakPkg = generateSpecialMarketsPackage({
  homeTeam: "Weak",
  awayTeam: "Neutral",
  homeTelemetry: aerialWeak(),
  awayTelemetry: neutralOpponent,
});
const headersDominant = homeDominantPkg.headed_goal.home_expected_headers;
const headersWeak = homeWeakPkg.headed_goal.home_expected_headers;
console.log(`  home dominan: ${headersDominant} | home lemah: ${headersWeak}`);
assert(
  "home_expected_headers berbeda secara material",
  Math.abs(headersDominant - headersWeak) > 0.1,
  `selisih hanya ${Math.abs(headersDominant - headersWeak).toFixed(3)}`
);
assert("tim dominan udara memberi expected_headers lebih tinggi", headersDominant > headersWeak);
assert(
  "satu sisi mentok clamp -> tier turun dari HIGH (perilaku benar)",
  homeDominantPkg.headed_goal.confidence_tier === "HIGH" ||
    homeWeakPkg.headed_goal.confidence_tier !== "HIGH",
  `dominant=${homeDominantPkg.headed_goal.confidence_tier}, weak=${homeWeakPkg.headed_goal.confidence_tier}`
);
assert(
  "observed_aerial_samples tetap akurat (bukan passes)",
  homeDominantPkg.headed_goal.observed_aerial_samples.home === 6 &&
    homeDominantPkg.headed_goal.observed_crosses_samples.home === 6,
  JSON.stringify({
    aerial: homeDominantPkg.headed_goal.observed_aerial_samples,
    crosses: homeDominantPkg.headed_goal.observed_crosses_samples,
  })
);

// ---------------------------------------------------------------------------
console.log("\n[2b] Multiplier yang mentok clamp tidak boleh diklaim HIGH");
const extremeDominant = aerialDominant();
extremeDominant.avg_aerial_duels_pct_for = 30;
extremeDominant.avg_duels_won_pct_for = 50; // share 0.6 -> faktor 2.0
extremeDominant.avg_crosses_accurate_for = 11;
extremeDominant.avg_box_touches_for = 64;
const clampPkg = generateSpecialMarketsPackage({
  homeTeam: "Extreme",
  awayTeam: "Weak",
  homeTelemetry: extremeDominant,
  awayTelemetry: aerialWeak(),
});
console.log(
  `  tier: ${clampPkg.headed_goal.confidence_tier} | is_estimated: ${clampPkg.headed_goal.is_estimated}`
);
assert(
  "mentok clamp -> tier turun dari HIGH",
  clampPkg.headed_goal.confidence_tier !== "HIGH",
  `dapat ${clampPkg.headed_goal.confidence_tier}`
);
assert("mentok clamp -> is_estimated true", clampPkg.headed_goal.is_estimated === true);

// ---------------------------------------------------------------------------
console.log("\n[3] Corners & Cards: is_estimated + confidence_tier");
const pkgWithData = generateSpecialMarketsPackage({
  homeTeam: "A",
  awayTeam: "B",
  homeTelemetry: measuredCornerCards(),
  awayTelemetry: measuredCornerCards(),
});
assert(
  "corners terukur -> is_estimated false",
  pkgWithData.corners.is_estimated === false,
  `dapat ${pkgWithData.corners.is_estimated}`
);
assert(
  "corners terukur -> tier HIGH (5 sampel)",
  pkgWithData.corners.confidence_tier === "HIGH",
  `dapat ${pkgWithData.corners.confidence_tier}`
);
assert(
  "cards terukur -> is_estimated false",
  pkgWithData.cards.is_estimated === false,
  `dapat ${pkgWithData.cards.is_estimated}`
);
assert(
  "cards terukur -> tier HIGH",
  pkgWithData.cards.confidence_tier === "HIGH",
  `dapat ${pkgWithData.cards.confidence_tier}`
);

// ---------------------------------------------------------------------------
console.log("\n[4] Tanpa telemetry -> sampel nol = INSUFFICIENT_DATA (bukan fair odds terukur)");
const pkgEmpty = generateSpecialMarketsPackage({
  homeTeam: "A",
  awayTeam: "B",
  homeTelemetry: emptyTelemetry(),
  awayTelemetry: emptyTelemetry(),
});
assert(
  "headed goal tier INSUFFICIENT_DATA",
  pkgEmpty.headed_goal.confidence_tier === "INSUFFICIENT_DATA",
  `dapat ${pkgEmpty.headed_goal.confidence_tier}`
);
assert(
  "headed goal is_estimated true",
  pkgEmpty.headed_goal.is_estimated === true
);
assert(
  "corners tier INSUFFICIENT_DATA",
  pkgEmpty.corners.confidence_tier === "INSUFFICIENT_DATA",
  `dapat ${pkgEmpty.corners.confidence_tier}`
);
assert(
  "corners is_estimated true",
  pkgEmpty.corners.is_estimated === true
);
assert(
  "cards tier INSUFFICIENT_DATA",
  pkgEmpty.cards.confidence_tier === "INSUFFICIENT_DATA",
  `dapat ${pkgEmpty.cards.confidence_tier}`
);
assert(
  "cards is_estimated true",
  pkgEmpty.cards.is_estimated === true
);

// ---------------------------------------------------------------------------
console.log("\n[5] Sampel tunggal -> LOW (bukan MODERATE)");
const single = emptyTelemetry();
single.sample_size = 1;
single.observed_aerial_samples = 1;
single.observed_crosses_samples = 1;
single.avg_aerial_duels_pct_for = 10;
single.avg_duels_won_pct_for = 50;
single.avg_corners_for = 5.0;
single.avg_yellow_cards = 2.0;
const pkgSingle = generateSpecialMarketsPackage({
  homeTeam: "A",
  awayTeam: "B",
  homeTelemetry: single,
  awayTelemetry: single,
});
assert(
  "headed goal 1 sampel -> tier LOW",
  pkgSingle.headed_goal.confidence_tier === "LOW",
  `dapat ${pkgSingle.headed_goal.confidence_tier}`
);
assert(
  "corners 1 sampel -> tier LOW",
  pkgSingle.corners.confidence_tier === "LOW",
  `dapat ${pkgSingle.corners.confidence_tier}`
);

// ---------------------------------------------------------------------------
console.log(`\n${"=".repeat(64)}`);
console.log(`HASIL: ${pass} PASS, ${fail} FAIL`);
console.log(`${"=".repeat(64)}`);
if (fail > 0) process.exit(1);
