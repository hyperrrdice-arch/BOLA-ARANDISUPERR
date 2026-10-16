/**
 * Sumber tunggal nama model 9Router.
 *
 * Settlement awal: hanya memindahkan lokasi definisi nama model, TIDAK mengubah
 * nilai default yang berlaku. Default per jalur sengaja dipisah (SYNDICATE vs
 * AGENT_ROUTE) karena kedua jalur hidup berdampingan dan salah satunya berjalan
 * nino-performa; menyeragamkannya akan mengubah model yang dipilih secara diam-diam.
 *
 * Model Bull & Neutral di SYNDICATE memakai nilai hasil keputusan pemilik:
 *   MODEL_BULL    = ag/gemini-3.8-flash-high
 *   MODEL_NEUTRAL = bai/glm-5.3-flash
 */

function envModel(namaEnv: string, defaultValue: string): string {
  const nilai = process.env[namaEnv];
  return nilai && nilai.trim().length > 0 ? nilai.trim() : defaultValue;
}

/** Default yang dipakai `lib/syndicate-orchestrator.ts` (jalur debat 5-agent). */
export const SYNDICATE = {
  MODEL_DEFAULT: envModel("NINE_ROUTER_MODEL", "bai/glm-5.3-flash"),
  MODEL_BULL: envModel("MODEL_BULL", "ag/gemini-3.8-flash-high"),
  MODEL_NEUTRAL: envModel("MODEL_NEUTRAL", "bai/glm-5.3-flash"),
  MODEL_BEAR: envModel("MODEL_BEAR", "bai/deepseek-v4.1-flash"),
  MODEL_JUDGEMENT_1: envModel("MODEL_JUDGEMENT_1", "ag/gemini-3.8-flash-high"),
  MODEL_JUDGEMENT_2: envModel("MODEL_JUDGEMENT_2", "bai/qwen3.8-flash"),
} as const;

/**
 * Default yang dipakai `app/api/agent/route.tsx`. Label-model di file itu hanya
 * teks pada template JSON (ditimpa `syndicate_debate` dari orchestrator), sehingga
 * nilainya praktis-mati; dipertahankan apa adanya agar tidak ada perubahan diam-diam.
 */
export const AGENT_ROUTE = {
  MODEL_DEFAULT: envModel("NINE_ROUTER_MODEL", "ag/gemini-3.8-flash"),
  MODEL_BULL: envModel("MODEL_BULL", "ag/gemini-3.8-flash-high"),
  MODEL_NEUTRAL: envModel("MODEL_NEUTRAL", "bai/glm-5.3-flash"),
  MODEL_BEAR: envModel("MODEL_BEAR", "bai/deepseek-v4.1-flash"),
  MODEL_JUDGEMENT_1: envModel("MODEL_JUDGEMENT_1", "ag/gemini-3.8-flash-high"),
  MODEL_JUDGEMENT_2: envModel("MODEL_JUDGEMENT_2", "bai/qwen3.8-flash"),
  MODEL_ARBITER: envModel("MODEL_ARBITER", "ag/gemini-3.8-flash-high"),
} as const;

/** Default yang dipakai `app/api/betting/route.ts` (pemanggilan ganda A/B). */
export const BETTING = {
  MODEL_DEFAULT: envModel("NINE_ROUTER_MODEL", "bai/glm-5.3-flash"),
  MODEL_A: envModel("BETTING_MODEL_A", "bai/qwen3.8-27b"),
  MODEL_B: envModel("BETTING_MODEL_B", "bai/deepseek-v4.1-flash"),
} as const;

/** Default yang dipakai `lib/stats-fetcher-agent.ts` (pemilih endpoint). */
export const STATS_FETCHER = {
  MODEL_DISPATCHER: envModel("MODEL_FETCHER_DISPATCHER", "bai/qwen3.8-27b"),
} as const;

/**
 * Kredensial wajib dari environment.
 *
 * Fallback hardcode sengaja TIDAK ada: kunci yang tertanam di kode akan tersimpan
 * permanen di riwayat git, dan kegagalan konfigurasi harus terlihat jelas daripada
 * diam-diam memakai kunci yang sudah bocor. Error menyebut nama env yang kurang.
 */
export function requireEnv(namaEnv: string): string {
  const nilai = process.env[namaEnv];
  if (!nilai || nilai.trim().length === 0) {
    throw new Error(
      `[Konfigurasi] Environment variable '${namaEnv}' belum diisi. ` +
        `Isi di .env.local (lihat .env.example).`
    );
  }
  return nilai.trim();
}

/**
 * Kunci API 9Router. Dibuat lazy (getter) supaya hanya modul yang benar-benar
 * memakai kredensial yang harus punya env terisi. Modul `models.ts` tetap bisa
 * di-import untuk menguji nama model tanpa env lengkap.
 */
export function getNineRouterApiKey(): string {
  return requireEnv("NINE_ROUTER_API_KEY");
}

export function getNineRouterBaseUrl(): string {
  return requireEnv("NINE_ROUTER_BASE_URL");
}
