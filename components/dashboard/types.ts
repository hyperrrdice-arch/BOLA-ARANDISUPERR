export interface MatchItem {
  id: string;
  utc_date: string;
  competition_id: string;
  competition_name: string;
  home_team: { id: string; name: string };
  away_team: { id: string; name: string };
  venue: { name: string; city: string } | null;
  is_neutral: boolean;
  odds_available: boolean;
  xg_available: boolean;
  shotmap_available: boolean;
}

export interface PlayerItem {
  name: string;
  pos: string;
  num?: number | null;
}

export interface ScorelineItem {
  homeGoals: number;
  awayGoals: number;
  prob: number;
}

export interface ValueBetItem {
  market_name: string;
  selection: string;
  bookmaker_odds: number;
  fair_odds: number;
  expected_value: number;
  ev_percentage: string;
  is_positive_ev: boolean;
  edge_rating: string;
  recommended_stake_percentage: number;
  rationale: string;
}

export interface QuantEngineData {
  dixon_coles: {
    lambda_home_xg: number;
    mu_away_xg: number;
    prob_home_win: number;
    prob_draw: number;
    prob_away_win: number;
    fair_odds: { home: number; draw: number; away: number };
    over_2_5_prob: number;
    btts_yes_prob: number;
    expected_total_goals: number;
    top_scorelines: ScorelineItem[];
    asian_handicap?: {
      ah_0_0_dnb: {
        home_prob: number;
        away_prob: number;
        fair_odds_home: number;
        fair_odds_away: number;
        push_prob: number;
      };
      ah_minus_0_5: {
        home_cover: number;
        away_cover: number;
        fair_odds_home: number;
        fair_odds_away: number;
      };
      ah_minus_1_0: {
        home_cover: number;
        push_prob: number;
        away_cover: number;
        fair_odds_home: number;
        fair_odds_away: number;
      };
    };
    clean_sheet?: {
      home_clean_sheet_prob: number;
      away_clean_sheet_prob: number;
      home_win_to_nil_prob: number;
      away_win_to_nil_prob: number;
    };
    expected_points?: {
      home_xpts: number;
      away_xpts: number;
    };
  };
  vig_stripping: {
    overround: number;
    margin_percentage: number;
    fair_odds: { home: number; draw: number; away: number };
  };
  value_bets: ValueBetItem[];
}

export interface SyndicateJudgeItem {
  model: string;
  title: string;
  verdict_summary: string;
  confidence_tier: "A_HIGH_VALUE" | "B_MODERATE" | "C_LEAN" | "PASS_AVOID";
  recommended_market: string;
  key_reasoning?: string;
  alternative_perspective?: string;
}

export interface SyndicateDualJudgement {
  judgement_1: SyndicateJudgeItem;
  judgement_2: SyndicateJudgeItem;
  consensus_level: "UNANIMOUS" | "CONCURRING" | "SPLIT_DECISION" | "DISSENT";
  supreme_verdict: string;
  final_recommended_market: string;
  final_confidence_tier: "A_HIGH_VALUE" | "B_MODERATE" | "C_LEAN" | "PASS_AVOID";
  final_stake_fraction: string;
}

export interface SyndicateArbiterVerdict {
  model: string;
  chief_risk_officer_synthesis: string;
  confidence_tier: "A_HIGH_VALUE" | "B_MODERATE" | "C_LEAN" | "PASS_AVOID";
  recommended_market: string;
  recommended_stake_fraction: string;
}

export interface SyndicateDebateData {
  bull_case: {
    model: string;
    thesis: string;
    key_drivers: string[];
    tactical_edge: string;
  };
  neutral_case?: {
    model: string;
    thesis: string;
    empirical_drivers: string[];
    equilibrium_assessment: string;
  };
  bear_case: {
    model: string;
    thesis: string;
    trap_warnings: string[];
    vulnerability_audit: string;
  };
  dual_judgement?: SyndicateDualJudgement;
  arbiter_verdict?: SyndicateArbiterVerdict;
}

export interface Analisis {
  pertandingan: {
    id: string;
    tim_kandang: string;
    tim_tamu: string;
    waktu: string;
    kompetisi: string;
    venue: string | null;
    wasit: string | null;
  };
  wasit_analisis: {
    nama: string | null;
    rata_rata_kartu: number | null;
    total_kartu_kuning?: number | null;
    total_kartu_merah?: number | null;
    level_ketegasan: "rendah" | "sedang" | "tinggi" | "tidak diketahui";
    catatan: string;
  };
  taktik_dan_lineup: {
    formasi_kandang: string | null;
    formasi_tamu: string | null;
    status_lineup: "resmi" | "prediksi" | "belum_tersedia";
    starting_xi_kandang: PlayerItem[];
    starting_xi_tamu: PlayerItem[];
    ulasan_benturan_taktik: string;
  };
  coverage_liga: {
    has_xg: boolean;
    has_odds: boolean;
    has_shotmap: boolean;
    has_player_stats: boolean;
  };
  form_dan_split: {
    form_kandang: string;
    form_tamu: string;
    rekor_kandang_spesifik: string;
    rekor_tandang_spesifik: string;
  };
  klasemen: string;
  bursa_pasar: {
    ringkasan_1x2: string;
    asian_handicap: string | null;
    over_under: string | null;
    btts: string | null;
    pergerakan_smart_money: string;
  };
  probabilitas_pasar: { kandang: number; seri: number; tandang: number } | null;
  statistik_mendalam: {
    shot_quality: {
      npxg_kandang: number | null;
      npxg_tamu: number | null;
      catatan: string;
    };
    pemain_kunci: Array<{
      nama: string;
      tim: string;
      peran: string;
      catatan: string;
    }>;
  };
  faktor_kunci: string[];
  prediksi: {
    hasil: string;
    keyakinan: "rendah" | "sedang" | "tinggi";
    alasan: string;
    konsensus_panel: string;
  };
  quant_engine?: QuantEngineData;
  syndicate_debate?: SyndicateDebateData;
  data_tidak_tersedia: string[];
  data_integrity_audit?: {
    is_strictly_grounded: boolean;
    dispatcher_model: string;
    cache_quota_saved: number;
    endpoints_called: string[];
    endpoints_skipped: string[];
  };
}

export interface CacheMetrics {
  hits: number;
  misses: number;
  totalEntries: number;
  savedCalls: number;
}

export interface BettingResult1xBet {
  status?: string;
  message?: string;
  raw_markets_count?: number;
  markets_classified?: Record<string, any>;
  quant_synthesis?: {
    verdict?: string;
    confidence?: string;
    top_picks?: Array<{
      market: string;
      selection: string;
      odds: number;
      confidence: string;
      reason: string;
    }>;
    risk_analysis?: string;
  };
  [key: string]: any;
}
