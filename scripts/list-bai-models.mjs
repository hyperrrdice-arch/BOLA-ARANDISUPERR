// scripts/list-bai-models.mjs
const API_KEY = process.env.NINE_ROUTER_API_KEY || "";
const BASE_URL = "http://localhost:20128/v1/models";

const res = await fetch(BASE_URL, {
  headers: { Authorization: `Bearer ${API_KEY}` }
});

const data = await res.json();
const bai = data.data.filter(m => m.id.startsWith("bai/")).map(m => m.id);
const atria = data.data.filter(m => m.id.startsWith("atria/")).map(m => m.id);
const ag = data.data.filter(m => m.id.startsWith("ag/")).map(m => m.id);
const allOther = data.data.filter(m => !m.id.startsWith("ag/")).map(m => m.id);

console.log("=== B.AI MODELS (" + bai.length + ") ===");
console.log(bai.join("\n"));
console.log("\n=== ATRIA MODELS (" + atria.length + ") ===");
console.log(atria.join("\n"));
console.log("\n=== ALL NON-GEMINI MODELS ===");
console.log(allOther.join("\n"));
