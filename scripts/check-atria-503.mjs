// scripts/check-atria-503.mjs
const API_KEY = process.env.NINE_ROUTER_API_KEY || "";
const BASE_URL = "http://localhost:20128/v1/chat/completions";

const res = await fetch(BASE_URL, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${API_KEY}`,
  },
  body: JSON.stringify({
    model: "atria/Atria-Dawn-Preview",
    messages: [{ role: "user", content: "Halo" }],
    stream: false,
  }),
});

console.log("Status:", res.status);
const txt = await res.text();
console.log("Body:", txt);
