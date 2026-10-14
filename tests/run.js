// Mattis rule tests + whole-game simulations. Run: node tests/run.js
const M = require('../engine.js');
const C = (rank, suit) => ({ id: M.rankName(rank) + suit, rank, suit });
let failed = 0;
const check = (ok, name) => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', name); };
const tryIt = f => { try { f(); return true; } catch { return false; } };

// ---------- Round 1 ----------
// Players 0..n-1 hold `hands`; the deck holds `deckTop` (drawn first-first) plus filler; player 0 leads.
function r1(hands, deckTop = [], { emptyDeck = false } = {}) {
  const g = M.createGame(hands.length);
  g.players.forEach((p, i) => { p.hand = hands[i]; p.pile = []; });
  const used = new Set(hands.flat().concat(deckTop).map(c => c.id));
  g.deck = emptyDeck ? [] : g.deck.filter(c => !used.has(c.id)).concat(deckTop.slice().reverse());
  if (emptyDeck) { g.trumpOwner = 0; g.players.forEach((p, i) => { p.pile = [{ ...C(14, '♣'), id: 'A♣' + i }]; }); }
  g.r1 = { leader: 0, order: hands.map((_, i) => i).filter(i => hands[i].length), idx: 0, plays: [], battle: 0 };
  g.turn = g.r1.order[0];
  return g;
}
const keepExtras = (g, p) => { if (g.r1 && g.r1.extra) M.r1Extra(g, p, 'keep'); };
const trick = cards => { const g = r1(cards.map(c => [c, C(2, '♣'), C(2, '♦')].map((x, k) => (k ? { ...x, id: x.id + cards.indexOf(c) + k } : x)))); cards.forEach((c, i) => { M.r1Play(g, i, c.id); keepExtras(g, i); }); return g; };
const outcome = g => (g.r1 && g.r1.battle ? 'battle:' + g.r1.order.join(',') : 'taken:' + g.lastTrick.winner);

check(outcome(trick([C(3, '♥'), C(3, '♠'), C(13, '♦')])) === 'battle:0,1', 'pairs battle even when not highest (3-3 with K out)');
check(outcome(trick([C(6, '♥'), C(9, '♠'), C(6, '♦'), C(9, '♣')])) === 'battle:1,3', 'several pairs: only the highest pair battles');
check(outcome(trick([C(5, '♥'), C(8, '♠'), C(12, '♦')])) === 'taken:2', 'no pair: highest card takes the stack');

let g = r1([[C(7, '♥'), C(7, '♠'), C(12, '♦')], [C(3, '♣'), C(4, '♣'), C(5, '♣')]], [C(9, '♦'), C(10, '♦')]);
M.r1Play(g, 0, ['7♥', '7♠']);
check(g.stack.length === 2 && g.players[0].hand.length === 3 && g.turn === 1, 'lay a pair, draw back to 3');
g = r1([[C(7, '♥'), C(8, '♠'), C(12, '♦')], [C(3, '♣'), C(4, '♣'), C(5, '♣')]]);
check(!tryIt(() => M.r1Play(g, 0, ['7♥', '8♠'])) && g.players[0].hand.length === 3, 'different values together are rejected');
g = r1([[C(7, '♥'), C(9, '♠'), C(12, '♦')], [C(3, '♣'), C(4, '♣'), C(5, '♣')]], [C(7, '♦'), C(2, '♦')]);
M.r1Play(g, 0, '7♥');
check(g.r1.extra && g.r1.extra.rank === 7 && g.turn === 0, 'drawing the same value offers to lay it too');
M.r1Extra(g, 0, '7♦');
check(g.stack.length === 2 && g.turn === 1, '...and laying it passes the turn');
g = r1([[C(7, '♥'), C(9, '♠'), C(12, '♦')], [C(3, '♣'), C(4, '♣'), C(5, '♣')]], [C(7, '♣'), C(10, '♦'), C(2, '♥')]);
M.r1Play(g, 0, 'gamble');
check(g.r1.extra && g.r1.extra.rank === 7, 'Chance card matching a hand card offers to lay it too');
g = r1([[C(7, '♥'), C(7, '♠'), C(2, '♦')], [C(12, '♣'), C(4, '♣'), C(5, '♣')]], [C(9, '♦'), C(10, '♦'), C(3, '♥')]);
M.r1Play(g, 0, ['7♥', '7♠']); keepExtras(g, 0); M.r1Play(g, 1, 'Q♣');
check(g.lastTrick && g.lastTrick.winner === 1, "your own pair isn't a battle");

// Tied but nobody can battle on (deck gone, no cards): the one who laid last wins.
g = r1([[C(7, '♥')], [C(7, '♠')]], [], { emptyDeck: true });
M.r1Play(g, 0, '7♥'); M.r1Play(g, 1, '7♠');
check(g.lastTrick && g.lastTrick.winner === 1, '7-7 tie, both out of cards: the one who laid last wins');
g = r1([[C(9, '♥')], [C(13, '♠')], [C(9, '♦')]], [], { emptyDeck: true });
M.r1Play(g, 0, '9♥'); M.r1Play(g, 1, 'K♠'); M.r1Play(g, 2, '9♦');
check(g.lastTrick && g.lastTrick.winner === 2, '9-9 tie with K out, both empty: last to lay the 9 wins');
g = r1([[C(5, '♥'), C(2, '♣')], [C(5, '♠')]], [], { emptyDeck: true });
M.r1Play(g, 0, '5♥'); M.r1Play(g, 1, '5♠');
check(g.lastTrick && g.lastTrick.winner === 0, 'tie where only one player still has cards: they win');

// ---------- Round 2 ----------
function r2(hand, top) {
  const g = M.createGame(3);
  g.round = 2; g.r1 = null; g.trumpSuit = '♠'; g.turn = 0; g.stack = top ? [{ card: top, by: 2, lay: 99 }] : [];
  g.players.forEach(p => { p.hand = []; p.pile = []; });
  g.players[0].hand = hand; g.players[1].hand = [C(2, '♣')]; g.players[2].hand = [C(3, '♣')];
  return g;
}
const run = () => [C(5, '♥'), C(6, '♥'), C(7, '♥'), C(8, '♥'), C(9, '♦'), C(10, '♠')];
check(tryIt(() => M.r2Play(r2(run(), C(5, '♥')), 0, ['6♥', '7♥', '8♥'])), 'run 6-8♥ beats 5♥');
check(!tryIt(() => M.r2Play(r2(run(), C(7, '♥')), 0, ['5♥', '6♥'])), 'run whose lowest card does not beat is rejected');
check(!tryIt(() => M.r2Play(r2(run(), null), 0, ['5♥', '7♥'])), 'run with a gap is rejected');
check(!tryIt(() => M.r2Play(r2(run(), null), 0, ['8♥', '9♦'])), 'run of mixed suits is rejected');
g = r2([C(4, '♥'), C(5, '♥'), C(6, '♥'), C(7, '♥'), C(8, '♥'), C(2, '♦')], null);
M.r2Play(g, 0, ['4♥', '5♥', '6♥', '7♥', '8♥']); M.r2PickUp(g, 1);
check(g.players[1].hand.length === 6 && !g.stack.length, 'picking up after a run takes the whole run');

// ---------- Whole games ----------
const problems = {};
const note = k => { problems[k] = (problems[k] || 0) + 1; };
let games = 0, battles = 0, oneBlue = 0, multiBlue = 0, noFighters = 0;
for (const d of M.DIFFICULTIES) for (let n = 2; n <= 8; n++) for (let t = 0; t < 500; t++) {
  const g = M.createGame(n, Math.random, d);
  let moves = 0, seenR2 = false;
  while (!g.over) {
    const wasR1 = g.round === 1;
    M.act(g, M.aiMove(g));
    if (++moves > 20000) { note('game never ends'); break; }
    const ids = [...g.deck, ...g.stack.map(e => e.card), ...g.discard, ...g.players.flatMap(p => [...p.hand, ...p.pile])].map(c => c.id);
    if (g.round === 1 && g.trumpOwner !== null) ids.push(g.trumpCard.id);
    if (ids.length !== 52 || new Set(ids).size !== 52) note('card lost or duplicated');
    if (wasR1 && g.lastTrick && !g.lastTrick.checked) {
      g.lastTrick.checked = true;
      const normal = g.lastTrick.entries.filter(e => !e.battle);
      const by = {}; normal.forEach(e => (by[e.card.rank] = by[e.card.rank] || new Set()).add(e.by));
      const pairRanks = Object.keys(by).filter(r => by[r].size > 1);
      if (pairRanks.length) battles++;
      if (pairRanks.length && g.deck.length && !g.lastTrick.entries.some(e => e.battle)) note('pair without battle');
      if (!pairRanks.length && g.lastTrick.entries.some(e => e.battle)) note('battle without pair');
    }
    if (wasR1 && g.round === 2 && !seenR2) {
      seenR2 = true;
      if (g.r2Deal.flat().length !== 52) note('round 1 ended with cards still in hands');
      if (g.blue.length === 1) {
        oneBlue++;
        const want = new Set([2, 3, 4, 5].map(r => M.rankName(r) + g.trumpSuit).concat(M.SUITS.filter(s => s !== g.trumpSuit).map(s => '5' + s)));
        const got = g.r2Start[g.blue[0]].map(c => c.id);
        if (got.length !== 7 || got.some(id => !want.has(id))) note('blå got the wrong cards');
        if (g.discard.length !== 9) note('wrong number of cards out of play');
      } else if (g.blue.length > 1) { multiBlue++; if (g.discard.length) note('cards removed with several blå'); }
    }
  }
  noFighters += g.log.filter(e => /nobody has cards left to battle/.test(e.text)).length;
  games++;
}
check(!Object.keys(problems).length, `${games} simulated games (all difficulties, 2-8 players): ${JSON.stringify(problems)}`);
console.log({ battles, oneBlue, multiBlue, tiesWithNobodyLeftToBattle: noFighters });
if (failed) { console.log(failed + ' FAILED'); process.exit(1); } else console.log('All tests passed.');
