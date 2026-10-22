// How the difficulties compare, and how they use trumf. Run: node tests/ai_tournament.js
const M = require('../engine.js');
function table(types, N) {
  const n = types.length, loss = {}, seats = {};
  const st = { trumf: 0, trumfEarly: 0, pickups: 0, volPickups: 0 };
  for (let t = 0; t < N; t++) {
    const seatTypes = types.map((_, i) => types[(i + t) % n]);
    const g = M.createGame(n);
    let k = 0;
    while (!g.over && k++ < 20000) {
      const p = g.turn;
      g.difficulty = seatTypes[p];
      const mv = M.aiMove(g);
      if (g.round === 2 && seatTypes[p] === 'hard') {
        const hand = g.players[p].hand;
        const others = g.players.filter((pl, i) => i !== p && !pl.out && pl.hand.length);
        const early = others.length > 1 && Math.min(...others.map(pl => pl.hand.length)) > 4 && hand.length > 6;
        const trumf = [].concat(mv).filter(id => (hand.find(c => c.id === id) || {}).suit === g.trumpSuit).length;
        st.trumf += trumf; if (early) st.trumfEarly += trumf;
        if (mv === 'pickup') { st.pickups++; if (M.legalCards(g, p).length && hand.length) st.volPickups++; }
      }
      M.act(g, mv);
    }
    seatTypes.forEach(d => { seats[d] = (seats[d] || 0) + 1; });
    loss[seatTypes[g.loser]] = (loss[seatTypes[g.loser]] || 0) + 1;
  }
  const rel = Object.fromEntries(Object.keys(seats).map(d => [d, (((loss[d] || 0) / N) / (seats[d] / (N * n))).toFixed(2)]));
  return { relativeLossRate: rel, hard: { earlyTrumfShare: (100 * st.trumfEarly / st.trumf).toFixed(0) + '%', voluntaryPickups: (100 * st.volPickups / st.pickups).toFixed(0) + '% of pick-ups' } };
}
console.log('(relative loss rate: 1.00 = fair share of losses, lower = stronger)');
console.log('easy/normal/hard  ', JSON.stringify(table(['easy', 'normal', 'hard'], 6000)));
console.log('normal vs hard x2 ', JSON.stringify(table(['normal', 'hard', 'normal', 'hard'], 6000)));
console.log('normal vs hard 1v1', JSON.stringify(table(['normal', 'hard'], 6000)));
