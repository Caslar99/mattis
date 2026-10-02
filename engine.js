// Mattis game engine: pure game logic, no DOM. Works in the browser (window.Mattis) and Node (module.exports).
(function (root) {
  'use strict';

  const SUITS = ['♠', '♥', '♦', '♣'];
  const NAMES = ['You', 'Lars', 'Mette', 'Sofie', 'Jens', 'Ida', 'Mads', 'Freja'];
  const FACE = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
  const rankName = r => FACE[r] || String(r);
  const label = c => rankName(c.rank) + c.suit;
  const isRed = c => c.suit === '♥' || c.suit === '♦';

  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // "You take" vs "Mette takes"
  const say = (g, p, you, other) => (p === 0 ? 'You ' + you : g.players[p].name + ' ' + other);
  const log = (g, text, p = null) => g.log.push({ text, p, t: Date.now() });
  const listNames = (g, ps) => {
    const names = ps.map(p => g.players[p].name);
    return names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0];
  };

  function createGame(numPlayers, rng = Math.random) {
    const n = Math.max(2, Math.min(8, numPlayers | 0));
    const deck = [];
    for (const suit of SUITS) for (let rank = 2; rank <= 14; rank++) deck.push({ id: rankName(rank) + suit, suit, rank });
    shuffle(deck, rng);
    const players = [];
    for (let i = 0; i < n; i++) players.push({ name: NAMES[i], human: i === 0, hand: [], pile: [], out: false });
    for (let k = 0; k < 3; k++) for (const pl of players) pl.hand.push(deck.pop());
    const g = {
      n, rng, players, deck,
      trumpCard: deck[0], // bottom card of the deck, hidden until round 1 ends
      trumpOwner: null, trumpSuit: null,
      round: 1, turn: 0, r1: null,
      lastDraw: null, // { p, id } of the card just drawn in round 1, or { p, trump: true }
      stack: [], discard: [], lastTrick: null, lays: 0,
      finishOrder: [], over: false, loser: null, log: [],
    };
    const leader = Math.floor(rng() * n);
    log(g, say(g, leader, 'start round 1.', 'starts round 1.'), leader);
    startTrick(g, leader);
    return g;
  }

  // ---------- Round 1: collecting ----------
  // Everyone lays one card, clockwise from the leader. When all have laid:
  // - if two or more cards share a rank (any rank), those players battle: they lay again and the
  //   winner takes the whole stack. With several pairs, only the highest pair battles.
  // - otherwise the highest card takes the stack.

  // The last card (the trump) can never be gambled.
  const canGamble = g => g.round === 1 && g.deck.length >= 2;
  const canAct = (g, p) => g.players[p].hand.length > 0 || canGamble(g);

  function startTrick(g, leader) {
    const order = [];
    for (let i = 0; i < g.n; i++) order.push((leader + i) % g.n);
    g.r1 = { leader, order, idx: 0, plays: [], battle: 0 };
    g.turn = leader;
  }

  function drawCard(g, p) {
    if (g.deck.length >= 2) {
      const c = g.deck.pop();
      g.players[p].hand.push(c);
      g.lastDraw = { p, id: c.id };
    }
    else if (g.deck.length === 1) {
      g.deck.pop();
      g.trumpOwner = p;
      g.lastDraw = { p, trump: true };
      log(g, say(g, p, 'get', 'gets') + ' the last card: the hidden trump. It is revealed after round 1.', p);
    }
  }

  function r1Play(g, p, cardId) {
    if (g.over || g.round !== 1 || g.turn !== p) throw new Error('Not your turn');
    const pl = g.players[p];
    let card, gambled = false;
    g.lastDraw = null;
    if (cardId === 'gamble') {
      if (!canGamble(g)) throw new Error('Cannot gamble now');
      card = g.deck.pop();
      gambled = true;
    } else {
      const i = pl.hand.findIndex(c => c.id === cardId);
      if (i < 0) throw new Error('Card not in hand');
      card = pl.hand.splice(i, 1)[0];
      drawCard(g, p);
    }
    const r1 = g.r1;
    const entry = { card, by: p, gambled, battle: r1.battle }; // battle: 0 = normal lay, 1+ = battle round
    g.stack.push(entry);
    r1.plays.push(entry);
    g.lastTrick = null;
    log(g, say(g, p, gambled ? 'gamble and flip' : 'play', gambled ? 'gambles and flips' : 'plays') + ' ' + label(card) + '.', p);
    r1.idx++;
    if (r1.idx < r1.order.length) g.turn = r1.order[r1.idx];
    else resolveTrick(g);
  }

  function resolveTrick(g) {
    const r1 = g.r1;
    const count = {};
    for (const e of r1.plays) count[e.card.rank] = (count[e.card.rank] || 0) + 1;
    const pairRanks = Object.keys(count).filter(r => count[r] > 1).map(Number);
    if (!pairRanks.length) {
      const best = r1.plays.reduce((b, e) => (e.card.rank > b.card.rank ? e : b));
      return awardR1(g, best.by);
    }
    const top = Math.max(...pairRanks);
    const tied = r1.plays.filter(e => e.card.rank === top).map(e => e.by);
    // After the deck is gone a tied player may have nothing left to battle with.
    const fighters = tied.filter(p => canAct(g, p));
    if (fighters.length <= 1) return awardR1(g, fighters.length ? fighters[0] : tied[0]);
    r1.tiedIds = r1.plays.filter(e => e.card.rank === top).map(e => e.card.id);
    log(g, 'Battle! ' + listNames(g, fighters) + ' tied with ' + rankName(top) + '. They lay again, and the highest takes all.');
    r1.order = fighters;
    r1.idx = 0;
    r1.plays = [];
    r1.battle++;
    g.turn = fighters[0];
  }

  function awardR1(g, w) {
    g.players[w].pile.push(...g.stack.map(e => e.card));
    g.lastTrick = { entries: g.stack, winner: w };
    log(g, say(g, w, 'take', 'takes') + ' the stack (' + g.stack.length + ' cards).', w);
    g.stack = [];
    if (g.deck.length === 0) return endRound1(g);
    startTrick(g, w); // the winner starts the next round of cards
  }

  function endRound1(g) {
    g.round = 2;
    g.r1 = null;
    g.trumpSuit = g.trumpCard.suit;
    for (const pl of g.players) {
      pl.hand = pl.pile.concat(pl.hand);
      pl.pile = [];
    }
    g.players[g.trumpOwner].hand.push(g.trumpCard);
    g.stack = [];
    log(g, 'Round 1 over! The trump is ' + label(g.trumpCard) + '. ' + say(g, g.trumpOwner, 'have it and start round 2.', 'has it and starts round 2.'), g.trumpOwner);
    g.players.forEach((pl, i) => {
      if (!pl.hand.length) { pl.out = true; g.finishOrder.push(i); }
    });
    g.turn = g.players[g.trumpOwner].out ? nextActive(g, g.trumpOwner) : g.trumpOwner;
    checkOver(g);
  }

  // ---------- Round 2: get rid of your cards ----------

  function beats(card, top, trumpSuit) {
    if (card.suit === top.suit) return card.rank > top.rank;
    return card.suit === trumpSuit; // any trump beats a non-trump; a trump needs a higher trump (handled above)
  }

  function legalCards(g, p) {
    const hand = g.players[p].hand;
    if (g.round !== 2 || !g.stack.length) return hand.slice();
    const top = g.stack[g.stack.length - 1].card;
    return hand.filter(c => beats(c, top, g.trumpSuit));
  }

  // A run: same suit, consecutive ranks going up, e.g. 5♥ 6♥ 7♥ 8♥.
  function isRun(cards) {
    for (let i = 1; i < cards.length; i++) {
      if (cards[i].suit !== cards[0].suit || cards[i].rank !== cards[i - 1].rank + 1) return false;
    }
    return true;
  }

  // Check a round-2 play of one card or a run. Returns the cards sorted low to high, or null.
  function checkPlay(g, p, cardIds) {
    const hand = g.players[p].hand;
    const cards = [...new Set(cardIds)].map(id => hand.find(c => c.id === id));
    if (!cards.length || cards.some(c => !c)) return null;
    cards.sort((a, b) => a.rank - b.rank);
    if (!isRun(cards)) return null;
    if (!legalCards(g, p).includes(cards[0])) return null; // the lowest card must beat the top card
    return cards;
  }

  // Number of separate lays (a run counts as one) still on the stack.
  const laysOnStack = g => new Set(g.stack.map(e => e.lay)).size;

  const activeCount = g => g.players.filter(pl => !pl.out).length;
  function nextActive(g, p) {
    for (let i = 1; i <= g.n; i++) {
      const q = (p + i) % g.n;
      if (!g.players[q].out) return q;
    }
    return p;
  }

  function r2Play(g, p, cardIds) {
    if (g.over || g.round !== 2 || g.turn !== p) throw new Error('Not your turn');
    const pl = g.players[p];
    const cards = checkPlay(g, p, Array.isArray(cardIds) ? cardIds : [cardIds]);
    if (!cards) throw new Error('Those cards cannot be played');
    const before = activeCount(g);
    const lay = ++g.lays;
    for (const card of cards) {
      pl.hand.splice(pl.hand.indexOf(card), 1);
      g.stack.push({ card, by: p, lay });
    }
    g.lastTrick = null;
    log(g, say(g, p, 'play', 'plays') + ' ' + cards.map(label).join(' ') + (cards.length > 1 ? ' (a run!)' : '.'), p);
    if (!pl.hand.length) {
      pl.out = true;
      g.finishOrder.push(p);
      log(g, say(g, p, 'are', 'is') + ' out of cards. Safe!', p);
    }
    if (checkOver(g)) return;
    if (laysOnStack(g) >= before) {
      // Everyone has laid a card: the stack goes out and the last player to lay starts the next one.
      g.lastTrick = { entries: g.stack, cleared: true, by: p };
      g.discard.push(...g.stack.map(e => e.card));
      g.stack = [];
      g.turn = pl.out ? nextActive(g, p) : p;
      log(g, 'Stack cleared. ' + say(g, g.turn, 'lead', 'leads') + ' next.');
    } else {
      g.turn = nextActive(g, p);
    }
  }

  function r2PickUp(g, p) {
    if (g.over || g.round !== 2 || g.turn !== p) throw new Error('Not your turn');
    if (!g.stack.length) throw new Error('Nothing to pick up');
    const e = g.stack.shift(); // the first card laid on the stack
    g.players[p].hand.push(e.card);
    g.lastTrick = null;
    log(g, say(g, p, 'pick up', 'picks up') + ' ' + label(e.card) + '.', p);
    g.turn = nextActive(g, p);
  }

  function checkOver(g) {
    const left = [];
    g.players.forEach((pl, i) => { if (!pl.out) left.push(i); });
    if (left.length > 1) return false;
    g.over = true;
    g.loser = left.length ? left[0] : null;
    if (g.loser !== null) log(g, say(g, g.loser, 'are', 'is') + ' left holding cards and loses the game!', g.loser);
    return true;
  }

  // ---------- Computer players ----------

  const worth = c => (c.rank >= 11 ? c.rank - 9 : c.rank >= 9 ? 1 : 0); // J=2, Q=3, K=4, A=5

  function aiMove(g) {
    const p = g.turn, pl = g.players[p], rng = g.rng;
    if (g.round === 1) {
      const hand = pl.hand.slice().sort((a, b) => a.rank - b.rank);
      const gamble = canGamble(g);
      if (!hand.length) return 'gamble';
      const r1 = g.r1, plays = r1.plays;
      const lowest = hand[0], highest = hand[hand.length - 1];
      if (!plays.length) {
        if (r1.battle) return highest.id; // battles are over good stacks: go for it
        // Hand full of good cards? Risk the deck instead of giving one away.
        if (gamble && lowest.rank >= 12 && rng() < 0.6) return 'gamble';
        return lowest.id;
      }
      const best = Math.max(...plays.map(e => e.card.rank));
      const last = r1.idx === r1.order.length - 1;
      const value = g.stack.reduce((s, e) => s + worth(e.card), 0);
      if (r1.battle || value >= 3 || g.stack.length >= 4) {
        if (last) {
          const cheapest = hand.find(c => c.rank > best);
          if (cheapest) return cheapest.id;
        } else if (highest.rank > best) return highest.id;
        if (gamble && rng() < 0.4) return 'gamble';
        return lowest.id;
      }
      // Stack isn't worth it: lose on purpose with a low card.
      if (lowest.rank < best) return lowest.id;
      if (gamble && rng() < 0.5) return 'gamble';
      return lowest.id;
    }
    const isTrump = c => c.suit === g.trumpSuit;
    const legal = legalCards(g, p).sort((a, b) => isTrump(a) - isTrump(b) || a.rank - b.rank);
    if (!legal.length) return 'pickup';
    // Usually lead the lowest card, but not always: always-lowest leads can pass the same
    // unbeatable cards around forever.
    if (!g.stack.length && rng() < 0.3) return legal[Math.floor(rng() * legal.length)].id;
    // (a random lead stays a single card)
    const c = legal[0];
    const run = [c];
    // Shed more cards with a run when possible (save trump runs for the end game).
    if (!isTrump(c) || pl.hand.length <= 5) {
      for (let next; (next = pl.hand.find(h => h.suit === c.suit && h.rank === run[run.length - 1].rank + 1));) run.push(next);
    }
    if (g.stack.length && isTrump(c) && !isTrump(g.stack[g.stack.length - 1].card) && c.rank >= 12 && pl.hand.length > 5 && rng() < 0.5) {
      return 'pickup'; // don't burn a big trump early on a cheap card
    }
    return run.length > 1 ? run.map(x => x.id) : c.id;
  }

  function act(g, move) {
    if (g.round === 1) return r1Play(g, g.turn, move);
    if (move === 'pickup') return r2PickUp(g, g.turn);
    return r2Play(g, g.turn, move);
  }

  const api = { createGame, r1Play, r2Play, r2PickUp, legalCards, checkPlay, isRun, canGamble, beats, aiMove, act, label, rankName, isRed, SUITS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Mattis = api;
})(typeof window !== 'undefined' ? window : globalThis);
