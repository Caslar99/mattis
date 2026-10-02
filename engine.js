// Mattis game engine: pure game logic, no DOM. Works in the browser (window.Mattis) and Node (module.exports).
(function (root) {
  'use strict';

  const SUITS = ['♠', '♥', '♦', '♣'];
  const NAMES = ['You', 'Mette', 'Lars', 'Sofie', 'Jens', 'Ida', 'Mads', 'Freja'];
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
  const log = (g, text) => g.log.push(text);

  function createGame(numPlayers, rng = Math.random) {
    const n = Math.max(2, Math.min(8, numPlayers | 0));
    const deck = [];
    for (const suit of SUITS) for (let rank = 2; rank <= 14; rank++) deck.push({ id: rankName(rank) + suit, suit, rank });
    shuffle(deck, rng);
    const players = [];
    for (let i = 0; i < n; i++) players.push({ name: NAMES[i], human: i === 0, hand: [], pile: [], out: false });
    for (let k = 0; k < 3; k++) for (const pl of players) pl.hand.push(deck.pop());
    const leader = Math.floor(rng() * n);
    const g = {
      n, rng, players, deck,
      trumpCard: deck[0], // bottom card of the deck, hidden until round 1 ends
      trumpOwner: null, trumpSuit: null,
      round: 1, turn: leader,
      r1: { leader, responder: (leader + 1) % n, phase: 'lead', lead: null },
      stack: [], discard: [], lastTrick: null,
      finishOrder: [], over: false, loser: null, log: [],
    };
    log(g, say(g, leader, 'start round 1.', 'starts round 1.'));
    return g;
  }

  // ---------- Round 1: collecting ----------

  // The last card (the trump) can never be gambled.
  const canGamble = g => g.round === 1 && g.deck.length >= 2;

  function drawCard(g, p) {
    if (g.deck.length >= 2) g.players[p].hand.push(g.deck.pop());
    else if (g.deck.length === 1) {
      g.deck.pop();
      g.trumpOwner = p;
      log(g, say(g, p, 'get', 'gets') + ' the last card: the hidden trump. It is revealed after round 1.');
    }
  }

  function r1Play(g, p, cardId) {
    if (g.over || g.round !== 1 || g.turn !== p) throw new Error('Not your turn');
    const pl = g.players[p];
    let card, gambled = false;
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
    g.stack.push({ card, by: p, gambled });
    g.lastTrick = null;
    log(g, say(g, p, gambled ? 'gamble and flip' : 'play', gambled ? 'gambles and flips' : 'plays') + ' ' + label(card) + '.');

    const r1 = g.r1;
    if (r1.phase === 'lead') {
      r1.lead = card;
      r1.phase = 'answer';
      g.turn = r1.responder;
    } else if (card.rank === r1.lead.rank) {
      log(g, 'Same rank: ' + g.players[r1.leader].name + ' and ' + g.players[r1.responder].name + ' battle on!');
      r1.phase = 'lead';
      g.turn = r1.leader;
    } else {
      awardR1(g, card.rank > r1.lead.rank ? r1.responder : r1.leader);
      return;
    }
    settleR1(g);
  }

  function awardR1(g, w) {
    g.players[w].pile.push(...g.stack.map(e => e.card));
    g.lastTrick = { entries: g.stack, winner: w };
    log(g, say(g, w, 'take', 'takes') + ' the stack (' + g.stack.length + ' cards).');
    g.stack = [];
    if (g.deck.length === 0) return endRound1(g);
    // The winner of a battle continues and leads the next one.
    g.r1 = { leader: w, responder: (w + 1) % g.n, phase: 'lead', lead: null };
    g.turn = w;
    settleR1(g);
  }

  // Once the deck is gone, a player can run out of cards mid-battle. Then the other side wins it.
  function settleR1(g) {
    if (g.round !== 1 || g.players[g.turn].hand.length || canGamble(g)) return;
    const r1 = g.r1;
    if (g.stack.length) awardR1(g, g.turn === r1.leader ? r1.responder : r1.leader);
    else endRound1(g);
  }

  function endRound1(g) {
    g.round = 2;
    g.trumpSuit = g.trumpCard.suit;
    for (const pl of g.players) {
      pl.hand = pl.pile.concat(pl.hand);
      pl.pile = [];
    }
    g.players[g.trumpOwner].hand.push(g.trumpCard);
    g.stack = [];
    log(g, 'Round 1 over! The trump is ' + label(g.trumpCard) + '. ' + say(g, g.trumpOwner, 'have it and start round 2.', 'has it and starts round 2.'));
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
    if (g.round !== 2) return hand.slice();
    if (!g.stack.length) return hand.slice();
    const top = g.stack[g.stack.length - 1].card;
    return hand.filter(c => beats(c, top, g.trumpSuit));
  }

  const activeCount = g => g.players.filter(pl => !pl.out).length;
  function nextActive(g, p) {
    for (let i = 1; i <= g.n; i++) {
      const q = (p + i) % g.n;
      if (!g.players[q].out) return q;
    }
    return p;
  }

  function r2Play(g, p, cardId) {
    if (g.over || g.round !== 2 || g.turn !== p) throw new Error('Not your turn');
    const pl = g.players[p];
    const card = legalCards(g, p).find(c => c.id === cardId);
    if (!card) throw new Error('That card cannot be played');
    const before = activeCount(g);
    pl.hand.splice(pl.hand.indexOf(card), 1);
    g.stack.push({ card, by: p });
    g.lastTrick = null;
    log(g, say(g, p, 'play', 'plays') + ' ' + label(card) + '.');
    if (!pl.hand.length) {
      pl.out = true;
      g.finishOrder.push(p);
      log(g, say(g, p, 'are', 'is') + ' out of cards. Safe!');
    }
    if (checkOver(g)) return;
    if (g.stack.length >= before) {
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
    log(g, say(g, p, 'pick up', 'picks up') + ' ' + label(e.card) + '.');
    g.turn = nextActive(g, p);
  }

  function checkOver(g) {
    const left = [];
    g.players.forEach((pl, i) => { if (!pl.out) left.push(i); });
    if (left.length > 1) return false;
    g.over = true;
    g.loser = left.length ? left[0] : null;
    if (g.loser !== null) log(g, say(g, g.loser, 'are', 'is') + ' left holding cards and loses the game!');
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
      if (g.r1.phase === 'lead') {
        // Hand full of good cards? Risk the deck instead of giving one away.
        if (gamble && hand[0].rank >= 12 && rng() < 0.6) return 'gamble';
        return hand[0].id;
      }
      const top = g.r1.lead.rank;
      const value = g.stack.reduce((s, e) => s + worth(e.card), 0);
      const winner = hand.find(c => c.rank > top); // cheapest winning card
      if (value >= 3 || g.stack.length >= 4) {
        if (winner) return winner.id;
        const tie = hand.find(c => c.rank === top);
        if (tie) return tie.id;
        if (gamble && rng() < 0.5) return 'gamble';
        return hand[0].id;
      }
      // Stack isn't worth it: lose on purpose with a low card.
      const lower = hand.find(c => c.rank < top);
      if (lower) return lower.id;
      if (gamble && rng() < 0.5) return 'gamble';
      return hand[0].id;
    }
    const isTrump = c => c.suit === g.trumpSuit;
    const legal = legalCards(g, p).sort((a, b) => isTrump(a) - isTrump(b) || a.rank - b.rank);
    if (!legal.length) return 'pickup';
    // Usually lead the lowest card, but not always: always-lowest leads can pass the same
    // unbeatable cards around forever.
    if (!g.stack.length && rng() < 0.3) return legal[Math.floor(rng() * legal.length)].id;
    const c = legal[0];
    if (g.stack.length && isTrump(c) && !isTrump(g.stack[g.stack.length - 1].card) && c.rank >= 12 && pl.hand.length > 5 && rng() < 0.5) {
      return 'pickup'; // don't burn a big trump early on a cheap card
    }
    return c.id;
  }

  function act(g, move) {
    if (g.round === 1) return r1Play(g, g.turn, move);
    if (move === 'pickup') return r2PickUp(g, g.turn);
    return r2Play(g, g.turn, move);
  }

  const api = { createGame, r1Play, r2Play, r2PickUp, legalCards, canGamble, beats, aiMove, act, label, rankName, isRed, SUITS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Mattis = api;
})(typeof window !== 'undefined' ? window : globalThis);
