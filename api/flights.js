// /api/flights — the rock-bottom flight engine for the Adventure Atlas.
//
// Fans out to every configured price source in parallel — cash (Kiwi/Tequila) and
// award (seats.aero) — then runs the cash-vs-points arbitrage brain against your
// point valuations, transfer map, and any live transfer bonuses to return the true
// cheapest way to pay for each trip: cash, miles you hold, or bank points
// transferred (bonus-aware) into the right program.
//
// It degrades gracefully: any source without its API key just reports
// configured:false and is skipped, so the endpoint is useful the moment ONE source
// is wired up, and gets stronger as you add keys.
//
// Query params:
//   ?from=GSP&to=MCO&depart=2026-08-15&return=2026-08-19
//   &adults=2&children=2&cabin=economy&currency=USD
//   &held=AMEX_MR:90000,AEROPLAN:12000     (optional; your point balances)
//
// Response: { query, sources, best, bestCash, bestAward, savingsVsCashUsd, options[] }
//
// Env (all optional — engine reports what's missing):
//   KIWI_API_KEY          cash fares (Tequila)
//   SEATS_AERO_API_KEY    award availability (seats.aero Pro)
//   SUPABASE_URL + SUPABASE_SERVICE_KEY   live valuation/bonus overlay

import { searchCash } from "./_lib/providers/kiwi.js";
import { searchAward } from "./_lib/providers/seatsaero.js";
import { loadValuations } from "./_lib/valuations.js";
import { rankOptions } from "./_lib/arbitrage.js";

export const config = { maxDuration: 30 };

// "AMEX_MR:90000,AEROPLAN:12000" -> { AMEX_MR: 90000, AEROPLAN: 12000 }
function parseHeld(str) {
  const held = {};
  if (!str) return held;
  for (const pair of String(str).split(",")) {
    const [k, v] = pair.split(":");
    if (k) held[k.trim().toUpperCase()] = v != null ? Number(v) : 0;
  }
  return held;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  const q = req.query || {};
  const { from, to, depart } = q;
  if (!from || !to || !depart) {
    return res.status(400).json({ error: "from, to, and depart (YYYY-MM-DD) are required" });
  }
  const args = {
    from: String(from).toUpperCase(),
    to: String(to).toUpperCase(),
    depart,
    ret: q.return || null,
    adults: Number(q.adults || 1),
    children: Number(q.children || 0),
    infants: Number(q.infants || 0),
    cabin: q.cabin || "economy",
    currency: (q.currency || "USD").toUpperCase(),
  };
  const held = parseHeld(q.held);

  try {
    // Fan out: cash + award + valuation config, all in parallel.
    const [cashRes, awardRes, valConfig] = await Promise.all([
      searchCash(args),
      searchAward(args),
      loadValuations(),
    ]);

    const ranked = rankOptions({
      cash: cashRes.items,
      awards: awardRes.items,
      held,
      config: valConfig,
    });

    return res.status(200).json({
      query: args,
      heldCurrencies: Object.keys(held),
      sources: {
        kiwi: { configured: cashRes.configured, count: cashRes.items.length, error: cashRes.error || null },
        seatsAero: { configured: awardRes.configured, count: awardRes.items.length, error: awardRes.error || null },
        valuations: valConfig.source,
      },
      best: ranked.best,
      bestCash: ranked.bestCash,
      bestAward: ranked.bestAward,
      savingsVsCashUsd: ranked.savingsVsCashUsd,
      options: ranked.options.slice(0, 20),
    });
  } catch (err) {
    console.error("flights engine failed:", err);
    return res.status(502).json({ error: "flight search failed", detail: String(err?.message || err) });
  }
}
