import { getTheStatsDb, upsertSquadPlayer } from "../lib/db/thestats-dataset";

const API_BASE = "https://api.thestatsapi.com/api";
const apiKey = process.env.STATS_API_KEY;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchTeamSquad(teamId: string, teamName: string) {
  console.log(`Mengambil skuad untuk ${teamName} (${teamId})...`);
  await sleep(1000);

  // 1. Injuries
  const injRes = await fetch(`${API_BASE}/football/teams/${teamId}/injuries-suspensions`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const injJson = await injRes.json().catch(() => null);
  const injuryMap = new Map<string, string>();
  if (injJson?.data?.injuries) {
    for (const inj of injJson.data.injuries) {
      if (inj.player?.id) {
        injuryMap.set(inj.player.id, `INJURY: ${inj.type || "Injured"} (${inj.expected_return || "Unknown"})`);
      }
    }
  }

  await sleep(1000);

  // 2. Players
  const pRes = await fetch(`${API_BASE}/football/teams/${teamId}/players`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const pJson = await pRes.json().catch(() => null);
  const players = pJson?.data || [];

  for (const p of players) {
    const status = injuryMap.get(p.id) || "FIT";
    upsertSquadPlayer({
      player_id: p.id,
      team_id: teamId,
      name: p.name || `${p.first_name || ""} ${p.last_name || ""}`.trim(),
      first_name: p.first_name,
      last_name: p.last_name,
      position: p.position,
      jersey_number: p.current_team?.jersey_number ?? p.jersey_number,
      age: p.age,
      nationality: p.nationality,
      market_value: p.market_value,
      preferred_foot: p.preferred_foot,
      injury_status: status,
      is_active: 1,
    });
  }

  console.log(`-> Sukses: ${players.length} pemain ${teamName} tersimpan!`);
}

async function main() {
  const missingTeams = [
    { id: "tm_8091", name: "Everton" },
    { id: "tm_9825", name: "Ipswich Town" },
    { id: "tm_0256", name: "Leeds United" },
  ];

  for (const t of missingTeams) {
    await fetchTeamSquad(t.id, t.name);
  }
}

main().catch(console.error);
