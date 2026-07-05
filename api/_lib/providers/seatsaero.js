// Award-availability provider: seats.aero Partner API.
//
// This is the piece with NO connector shortcut and the highest leverage for the
// POINTS half of "rock bottom" — award seats across 20+ mileage programs
// (Aeroplan, Alaska, ANA, Avianca LifeMiles, Flying Blue, and more) in one query.
//
// Returns normalized award itineraries:
//   { id, source, program, miles, taxesUsd, cabin, route, directOnly, date }
// which arbitrage.js converts to a dollar-equivalent using your valuations/transfers.
//
// Env: SEATS_AERO_API_KEY  (requires a seats.aero Pro subscription).
// Without it: { configured:false, items:[] } — the endpoint still works; the points
// half simply reports itself as not wired up until you add the key.
//
// ⚠️ Verify the exact endpoint path, query params, and response field names against
// the current Partner API docs (https://developers.seats.aero) before relying on
// this in production — this maps the documented shape but the API evolves. The
// normalized return contract below is what the rest of the engine depends on.

const SEATS_BASE = "https://seats.aero/partnerapi";

// seats.aero uses its own source/program codes; map airline program -> our canonical
// valuation keys (see valuations.js). Extend as you enable more programs.
const SOURCE_TO_PROGRAM = {
  aeroplan: "AEROPLAN", united: "UA_MP", american: "AA_AADVANTAGE", delta: "DL_SKYMILES",
  alaska: "ALASKA", flyingblue: "AF_KLM_FB", lifemiles: "AVIANCA_LM", ana: "ANA_MILEAGE",
  virginatlantic: "VS_FLYING_CLUB", ba: "BA_AVIOS", qantas: "BA_AVIOS", turkish: "TK_MILES",
  emirates: "EK_SKYWARDS", jetblue: "JETBLUE_TP", southwest: "SW_RR",
};

const CABIN_FIELD = { economy: "Y", premium: "W", business: "J", first: "F" };

export async function searchAward({ from, to, depart, cabin = "economy" }) {
  const key = process.env.SEATS_AERO_API_KEY;
  if (!key) return { source: "seats.aero", configured: false, items: [], note: "SEATS_AERO_API_KEY not set" };

  const params = new URLSearchParams({
    origin_airport: from, destination_airport: to,
    start_date: depart, end_date: depart,
    take: "50",
  });

  try {
    const res = await fetch(`${SEATS_BASE}/search?${params}`, {
      headers: { "Partner-Authorization": key, accept: "application/json" },
    });
    if (!res.ok) {
      return { source: "seats.aero", configured: true, items: [], error: `seats.aero ${res.status}` };
    }
    const data = await res.json();
    const rows = data.data || data.availability || [];
    const c = CABIN_FIELD[cabin] || "Y";

    const items = rows
      .map((r) => {
        // Availability rows carry per-cabin mileage cost + a boolean available flag.
        const available = r[`${c}Available`];
        const miles = r[`${c}MileageCost`] ?? r[`${c}Mileage`];
        if (!available || !miles) return null;
        const program = SOURCE_TO_PROGRAM[(r.Source || r.source || "").toLowerCase()] || null;
        if (!program) return null;
        return {
          id: `seats_${r.ID || r.id}`,
          source: "seats.aero",
          program,
          miles: Number(miles),
          taxesUsd: Number(r[`${c}TotalTaxes`] ?? r.TaxesUsd ?? 0) / 100 || 0, // often in cents
          cabin,
          route: `${r.Route?.OriginAirport || from}->${r.Route?.DestinationAirport || to}`,
          directOnly: !!(r[`${c}Direct`]),
          date: r.Date || depart,
        };
      })
      .filter(Boolean);

    return { source: "seats.aero", configured: true, items };
  } catch (err) {
    return { source: "seats.aero", configured: true, items: [], error: String(err?.message || err) };
  }
}
