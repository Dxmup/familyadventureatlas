// Cash-fare provider: Kiwi.com Tequila API.
//
// Returns normalized cash itineraries: { id, source, priceUsd, route, deep_link, ... }.
// Tequila is the engine behind Kiwi's virtual-interlining / self-transfer / hidden-city
// style itineraries — the creative routings legacy GDS APIs never surface.
//
// Env: KIWI_API_KEY  (Tequila apikey). Without it, returns { configured:false, items:[] }
// so the endpoint still works and this source simply reports itself as not wired up.
//
// NOTE: Tequila access is increasingly gated (MAU thresholds). If you can't get a
// Tequila key, swap this module's fetch for Duffel (`DUFFEL_TOKEN`) or a SerpAPI
// Google Flights call — the normalized return shape below is the contract the rest
// of the engine depends on, so only this file changes.

const TEQUILA_BASE = "https://api.tequila.kiwi.com";

// dd/mm/yyyy is what Tequila's /v2/search expects.
function toTequilaDate(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export async function searchCash({ from, to, depart, ret, adults = 1, children = 0, infants = 0, currency = "USD" }) {
  const key = process.env.KIWI_API_KEY;
  if (!key) return { source: "kiwi", configured: false, items: [], note: "KIWI_API_KEY not set" };

  const params = new URLSearchParams({
    fly_from: from, fly_to: to,
    date_from: toTequilaDate(depart), date_to: toTequilaDate(depart),
    adults: String(adults), children: String(children), infants: String(infants),
    curr: currency, limit: "20", sort: "price",
    vehicle_type: "aircraft",
  });
  if (ret) {
    params.set("return_from", toTequilaDate(ret));
    params.set("return_to", toTequilaDate(ret));
  }

  try {
    const res = await fetch(`${TEQUILA_BASE}/v2/search?${params}`, {
      headers: { apikey: key, accept: "application/json" },
    });
    if (!res.ok) {
      return { source: "kiwi", configured: true, items: [], error: `Tequila ${res.status}` };
    }
    const data = await res.json();
    const items = (data.data || []).map((it) => ({
      id: `kiwi_${it.id}`,
      source: "kiwi",
      priceUsd: it.price, // already in requested currency
      route: (it.route || []).map((r) => `${r.flyFrom}->${r.flyTo}`).join(", "),
      airlines: it.airlines,
      durationSec: it.duration?.total,
      deep_link: it.deep_link,
    }));
    return { source: "kiwi", configured: true, items };
  } catch (err) {
    return { source: "kiwi", configured: true, items: [], error: String(err?.message || err) };
  }
}
