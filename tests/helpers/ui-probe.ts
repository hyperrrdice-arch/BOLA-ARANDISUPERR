/**
 * UI PROBE (K6) — dijalankan sebagai subprocess dengan cwd = sandbox.
 *
 * Memanggil adapter jadwal/detail sebenarnya (lib/web/data.ts) terhadap
 * DB fixture K6 dan mencetak satu baris "PROBE_JSON " berisi:
 *  - schedule: listSchedule untuk jendela 20–23 Nov 2026 UTC,
 *  - states: getMatchState per id skenario status,
 *  - packDetail: ringkasan getMatchDetail laga berpaket (UID, pilihan
 *    resmi, tiket resmi, keadaan),
 *  - infoCatalogOnly / infoUnknown: getFixtureInfo untuk laga katalog
 *    tanpa paket dan ID asing,
 *  - cakupan: cakupanJadwal().
 * Probe tidak menilai apa pun; suite yang menilai.
 *
 * JAM BEKU (LANJUT-3): adapter jadwal membaca jam dinding lewat
 * Date.now() (lib/web/data.ts). Bila env UI_PROBE_NOW_MS diset, jam
 * proses probe dibekukan ke instant itu SEBELUM lib/web/data dimuat —
 * inilah proses yang benar-benar membaca jadwal, jadi di sinilah
 * bekunya. Tanpa env, perilaku lama (jam nyata) dipertahankan.
 * Perilaku produk tidak berubah; yang dibekukan hanya jam uji.
 */
const frozenNowMs = Number(process.env.UI_PROBE_NOW_MS);
if (process.env.UI_PROBE_NOW_MS && Number.isFinite(frozenNowMs)) {
  Date.now = () => frozenNowMs;
}

async function main(): Promise<void> {
  const {
    cakupanJadwal,
    getFixtureInfo,
    getMatchDetail,
    getMatchState,
    listSchedule,
  } = await import("../../lib/web/data");

  const schedule = listSchedule("2026-11-20T00:00:00.000Z", "2026-11-23T00:00:00.000Z").map(
    (i) => ({
      match_id: i.match_id,
      fixture_uid: i.fixture_uid,
      home: i.home,
      away: i.away,
      competition_name: i.competition_name,
      competition_country: i.competition_country,
      kickoff_utc: i.kickoff_utc,
      status: i.status,
      home_goals: i.home_goals,
      away_goals: i.away_goals,
      jadwal_asal_utc: i.jadwal_asal_utc,
      jadwal_ulang_utc: i.jadwal_ulang_utc,
      package_id: i.package_id,
    }),
  );

  const stateIds = [
    "sm_k6_cancelled",
    "sm_k6_abandoned",
    "sm_k6_live",
    "sm_k6_postponed",
    "sm_k6_unknown",
  ];
  const states: Record<string, unknown> = {};
  for (const id of stateIds) {
    try {
      const st = getMatchState(id);
      states[id] = st
        ? { status: st.status, home_goals: st.home_goals, away_goals: st.away_goals }
        : null;
    } catch (e) {
      states[id] = { error: e instanceof Error ? e.message : String(e) };
    }
  }

  let packDetail: unknown = null;
  try {
    const d = getMatchDetail("sm_k6_pack");
    packDetail = d
      ? {
          fixtureUid: d.fixtureUid,
          keadaan: d.keadaan,
          officialPicks: d.officialPicks.map((p) => ({
            pick_uid: p.pick_uid,
            market: p.market,
            published_prob: p.published_prob,
            probability_basis: p.probability_basis,
            published_at_utc: p.published_at_utc,
          })),
          officialTickets: d.officialTickets.map((t) => ({
            slip_uid: t.slip_uid,
            state: t.state,
            combined_prob: t.combined_prob,
          })),
        }
      : null;
  } catch (e) {
    packDetail = { error: e instanceof Error ? e.message : String(e) };
  }

  let detailCatalogOnly: unknown = "unset";
  try {
    detailCatalogOnly = getMatchDetail("sm_k6_dinihari") ? "ada" : null;
  } catch (e) {
    detailCatalogOnly = { error: e instanceof Error ? e.message : String(e) };
  }

  console.log(
    `PROBE_JSON ${JSON.stringify({
      schedule,
      states,
      packDetail,
      detailCatalogOnly,
      infoCatalogOnly: getFixtureInfo("sm_k6_dinihari"),
      infoUnknown: getFixtureInfo("asing-xyz-123"),
      cakupan: cakupanJadwal(),
    })}`,
  );
}

void main();
