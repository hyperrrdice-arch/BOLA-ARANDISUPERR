// scripts/test-live-agent.mjs
const start = Date.now();
console.log('Sending request to /api/agent for Arsenal vs Lille (mt_378442252)...');

try {
  const res = await fetch('http://localhost:3000/api/agent?match_id=mt_378442252&competition_id=comp_3498');
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`HTTP Status: ${res.status} (Elapsed: ${elapsed}s)`);

  const data = await res.json();
  if (data.error) {
    console.error('API Error:', data.error);
    process.exit(1);
  }

  console.log('\n================ MATCH ================');
  console.log(`${data.analisis.pertandingan.tim_kandang} vs ${data.analisis.pertandingan.tim_tamu}`);
  console.log(`Model Used Header: ${data.modelUsed}`);

  console.log('\n================ 5-AGENT MULTI-MODEL CONSORTIUM ================');
  console.log(`🟢 Bull (${data.analisis.syndicate_debate.bull_case.model}):`);
  console.log(`   Thesis: ${data.analisis.syndicate_debate.bull_case.thesis.slice(0, 150)}...`);
  console.log(`   Edge: ${data.analisis.syndicate_debate.bull_case.tactical_edge}`);

  console.log(`\n🔵 Neutral (${data.analisis.syndicate_debate.neutral_case.model}):`);
  console.log(`   Thesis: ${data.analisis.syndicate_debate.neutral_case.thesis.slice(0, 150)}...`);
  console.log(`   Assessment: ${data.analisis.syndicate_debate.neutral_case.equilibrium_assessment}`);

  console.log(`\n🔴 Bear (${data.analisis.syndicate_debate.bear_case.model}):`);
  console.log(`   Thesis: ${data.analisis.syndicate_debate.bear_case.thesis.slice(0, 150)}...`);
  console.log(`   Vulnerability: ${data.analisis.syndicate_debate.bear_case.vulnerability_audit}`);

  console.log('\n================ DUAL JUDICIAL BENCH ================');
  console.log(`⚖️ Hakim 1 (${data.analisis.syndicate_debate.dual_judgement.judgement_1.model}):`);
  console.log(`   Title: ${data.analisis.syndicate_debate.dual_judgement.judgement_1.title}`);
  console.log(`   Tier: ${data.analisis.syndicate_debate.dual_judgement.judgement_1.confidence_tier}`);
  console.log(`   Market: ${data.analisis.syndicate_debate.dual_judgement.judgement_1.recommended_market}`);
  console.log(`   Summary: ${data.analisis.syndicate_debate.dual_judgement.judgement_1.verdict_summary.slice(0, 150)}...`);

  console.log(`\n🛡️ Hakim 2 (${data.analisis.syndicate_debate.dual_judgement.judgement_2.model}):`);
  console.log(`   Title: ${data.analisis.syndicate_debate.dual_judgement.judgement_2.title}`);
  console.log(`   Tier: ${data.analisis.syndicate_debate.dual_judgement.judgement_2.confidence_tier}`);
  console.log(`   Market: ${data.analisis.syndicate_debate.dual_judgement.judgement_2.recommended_market}`);
  console.log(`   Summary: ${data.analisis.syndicate_debate.dual_judgement.judgement_2.verdict_summary.slice(0, 150)}...`);

  console.log('\n================ SUPREME SYNDICATE CONSENSUS ================');
  console.log(`Consensus Level: ${data.analisis.syndicate_debate.dual_judgement.consensus_level}`);
  console.log(`Supreme Verdict: ${data.analisis.syndicate_debate.dual_judgement.supreme_verdict}`);
  console.log(`Final Market: ${data.analisis.syndicate_debate.dual_judgement.final_recommended_market}`);
  console.log(`Kelly Stake Fraction: ${data.analisis.syndicate_debate.dual_judgement.final_stake_fraction}`);
  console.log(`Confidence Tier: ${data.analisis.syndicate_debate.dual_judgement.final_confidence_tier}`);

  console.log('\n================ QUANT ENGINE UPGRADES ================');
  console.log('xG Lambda/Mu:', data.analisis.quant_engine.dixon_coles.lambda_home_xg, 'vs', data.analisis.quant_engine.dixon_coles.mu_away_xg);
  console.log('Asian Handicap:', JSON.stringify(data.analisis.quant_engine.dixon_coles.asian_handicap, null, 2));
  console.log('Clean Sheet & Win to Nil:', JSON.stringify(data.analisis.quant_engine.dixon_coles.clean_sheet, null, 2));
  console.log('Expected Points (xPTS):', JSON.stringify(data.analisis.quant_engine.dixon_coles.expected_points, null, 2));

  console.log('\n>>> ALL SYSTEMS OPERATIONAL - 100% SUCCESS <<<');
} catch (err) {
  console.error('Fetch error:', err);
  process.exit(1);
}
