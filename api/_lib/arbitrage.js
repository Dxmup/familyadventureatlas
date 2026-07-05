// The arbitrage brain: given cash itineraries and award itineraries for the same
// trip, plus your point valuations / transfer map / live bonuses, decide the
// true rock-bottom way to pay — straight cash, miles you already hold, or bank
// points transferred (with any bonus) into the right airline program.
//
// Pure functions, no I/O — feed it data, get ranked options back. This is what
// no connector gives you: the cash-vs-points comparison.

// Best way to "fund" an award priced in `miles` of `program`, given the bank
// balances the user holds. Considers: already holding the program's miles, and
// transferring from each bank currency (applying live bonus). Returns the
// cheapest funding path in real dollars, or null if unreachable.
function cheapestFunding({ program, miles, taxes = 0 }, { valuations, transferMap, bonuses }, held) {
  const options = [];

  // 1. Directly hold the airline program's miles?
  if (held?.[program] != null) {
    options.push({
      path: `Redeem ${program} directly`,
      pointsSpent: miles, currency: program,
      dollarValueOfPoints: (miles * (valuations[program] || 0)) / 100,
      enough: held[program] >= miles,
    });
  }

  // 2. Transfer from each bank currency the user holds.
  for (const bank of Object.keys(transferMap)) {
    if (held?.[bank] == null) continue;
    const baseRatio = transferMap[bank][program];
    if (!baseRatio) continue; // no transfer path bank -> program
    const bonus = bonuses.find((b) => b.from === bank && b.to === program);
    const effRatio = baseRatio * (1 + (bonus?.bonusPct || 0) / 100);
    const bankPointsNeeded = Math.ceil(miles / effRatio);
    options.push({
      path: `Transfer ${bank} -> ${program}` + (bonus ? ` (+${bonus.bonusPct}% bonus)` : ""),
      pointsSpent: bankPointsNeeded, currency: bank,
      dollarValueOfPoints: (bankPointsNeeded * (valuations[bank] || 0)) / 100,
      enough: held[bank] >= bankPointsNeeded,
      bonus: bonus || null,
    });
  }

  if (!options.length) return null;
  // "Cost" of an award = the opportunity value of the points you burn + cash taxes.
  // Cheapest funding = lowest (dollarValueOfPoints + taxes), preferring paths you
  // can actually cover.
  options.sort((a, b) => {
    if (a.enough !== b.enough) return a.enough ? -1 : 1;
    return a.dollarValueOfPoints - b.dollarValueOfPoints;
  });
  const best = options[0];
  return { ...best, taxes, effectiveDollarCost: best.dollarValueOfPoints + taxes, alternatives: options };
}

// Rank a merged pool of options for one trip.
//   cash:   [{ id, source, priceUsd, route, ... }]
//   awards: [{ id, source, program, miles, taxesUsd, route, ... }]
//   held:   { AMEX_MR: 90000, AEROPLAN: 12000, ... }  (balances; presence = "have it")
//   config: output of loadValuations()
// Returns options sorted by effectiveUsd ascending, each annotated with how to pay.
export function rankOptions({ cash = [], awards = [], held = {}, config }) {
  const ranked = [];

  for (const c of cash) {
    ranked.push({
      kind: "cash",
      source: c.source,
      route: c.route,
      effectiveUsd: c.priceUsd,
      pay: { method: "cash", cashUsd: c.priceUsd },
      raw: c,
    });
  }

  for (const a of awards) {
    const funding = cheapestFunding(
      { program: a.program, miles: a.miles, taxes: a.taxesUsd || 0 },
      config, held
    );
    if (!funding) {
      // We can see the award seat but user has no path to fund it — still show it,
      // valued at the program's own cpp so it can be compared, flagged unreachable.
      const val = (a.miles * (config.valuations[a.program] || 0)) / 100 + (a.taxesUsd || 0);
      ranked.push({
        kind: "award",
        source: a.source, route: a.route,
        effectiveUsd: val,
        reachable: false,
        pay: { method: "points", program: a.program, miles: a.miles, taxesUsd: a.taxesUsd || 0,
               note: "No transfer path from your balances — value shown at program cpp." },
        raw: a,
      });
      continue;
    }
    ranked.push({
      kind: "award",
      source: a.source, route: a.route,
      effectiveUsd: funding.effectiveDollarCost,
      reachable: funding.enough,
      pay: {
        method: "points",
        program: a.program, miles: a.miles, taxesUsd: a.taxesUsd || 0,
        fundingPath: funding.path, pointsSpent: funding.pointsSpent,
        pointsCurrency: funding.currency, coversBalance: funding.enough,
        alternatives: funding.alternatives,
      },
      raw: a,
    });
  }

  ranked.sort((x, y) => x.effectiveUsd - y.effectiveUsd);

  const best = ranked[0] || null;
  const bestCash = ranked.filter((r) => r.kind === "cash").sort((a, b) => a.effectiveUsd - b.effectiveUsd)[0] || null;
  const bestAward = ranked.filter((r) => r.kind === "award").sort((a, b) => a.effectiveUsd - b.effectiveUsd)[0] || null;

  return {
    best,
    bestCash,
    bestAward,
    // How much cheaper the winning option is vs the best straight-cash fare.
    savingsVsCashUsd: best && bestCash ? +(bestCash.effectiveUsd - best.effectiveUsd).toFixed(2) : null,
    options: ranked,
  };
}
