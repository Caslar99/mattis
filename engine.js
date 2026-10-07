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

  const DIFFICULTIES = ['easy', 'normal', 'hard'];

  function createGame(numPlayers, rng = Math.random, difficulty = 'normal') {
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
      difficulty: DIFFICULTIES.includes(difficulty) ? difficulty : 'normal',
      round: 1, turn: 0, r1: null,
      r2Start: null, // everyone's hand at the start of round 2, for the end-of-game summary
      lastDraws: [],
      lastOwnCards: null, // { p, cards } when the last player with cards took them at the end of round 1
      blue: [], blueMoves: null, r2Deal: null, // cards drawn by the last round-1 action: { p, id } or { p, trump: true }
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

  // Players with cards lay, clockwise from the leader. Once the deck is gone nobody draws, players
  // without cards sit out, and when only one player still has cards they take them: round 1 is over.
  function startTrick(g, leader) {
    const order = [];
    for (let i = 0; i < g.n; i++) if (canAct(g, (leader + i) % g.n)) order.push((leader + i) % g.n);
    if (order.length <= 1) {
      if (order.length === 1 && g.players[order[0]].hand.length) {
        const pl = g.players[order[0]];
        g.lastOwnCards = { p: order[0], cards: pl.hand.slice() };
        log(g, say(g, order[0], 'are the only one with cards left and take', 'is the only one with cards left and takes') + ' ' + pl.hand.map(label).join(' ') + '.', order[0]);
        pl.pile.push(...pl.hand);
        pl.hand = [];
      }
      return endRound1(g);
    }
    g.r1 = { leader: order[0], order, idx: 0, plays: [], battle: 0 };
    g.turn = order[0];
  }

  function drawCard(g, p) {
    if (g.deck.length >= 2) {
      const c = g.deck.pop();
      g.players[p].hand.push(c);
      g.lastDraws.push({ p, id: c.id });
    }
    else if (g.deck.length === 1) {
      g.deck.pop();
      g.trumpOwner = p;
      g.lastDraws.push({ p, trump: true });
      log(g, say(g, p, 'get', 'gets') + ' the last card: the hidden trumf. It is revealed after round 1.', p);
    }
  }

  // Lay one card, several cards of the same value, or 'gamble' (the top card of the deck).
  function r1Play(g, p, move) {
    if (g.over || g.round !== 1 || g.turn !== p) throw new Error('Not your turn');
    if (g.r1.extra) throw new Error('First lay the matching card or keep it');
    g.lastDraws = [];
    if (move === 'gamble') {
      if (!canGamble(g)) throw new Error('Cannot gamble now');
      layCards(g, p, [g.deck.pop()], 'gamble');
      return nextLayer(g);
    }
    const cards = takeSameValue(g, p, Array.isArray(move) ? move : [move]);
    layCards(g, p, cards, 'hand');
    offerExtra(g, p, cards[0].rank);
  }

  // After laying and drawing, a player holding another card of the value they just laid may lay
  // it too ('keep' declines). This repeats if the new draw matches again.
  function r1Extra(g, p, move) {
    const r1 = g.r1;
    if (g.over || g.round !== 1 || g.turn !== p || !r1.extra) throw new Error('Nothing to add');
    g.lastDraws = [];
    const rank = r1.extra.rank;
    r1.extra = null;
    if (move === 'keep') return nextLayer(g);
    const cards = takeSameValue(g, p, Array.isArray(move) ? move : [move]);
    if (cards[0].rank !== rank) {
      g.players[p].hand.push(...cards);
      r1.extra = { p, rank };
      throw new Error('Only a card of the same value can be added');
    }
    layCards(g, p, cards, 'extra');
    offerExtra(g, p, rank);
  }

  function takeSameValue(g, p, ids) {
    const hand = g.players[p].hand;
    const cards = [...new Set(ids)].map(id => hand.find(c => c.id === id));
    if (!cards.length || cards.some(c => !c)) throw new Error('Card not in hand');
    if (cards.some(c => c.rank !== cards[0].rank)) throw new Error('Several cards must have the same value');
    for (const c of cards) hand.splice(hand.indexOf(c), 1);
    return cards;
  }

  function layCards(g, p, cards, how) {
    const r1 = g.r1;
    for (const card of cards) {
      // battle: 0 = normal lay, 1+ = battle round
      const entry = { card, by: p, gambled: how === 'gamble', extra: how === 'extra', battle: r1.battle };
      g.stack.push(entry);
      r1.plays.push(entry);
    }
    g.lastTrick = null;
    const names = cards.map(label).join(' ');
    if (how === 'gamble') log(g, say(g, p, 'gamble and flip', 'gambles and flips') + ' ' + names + '.', p);
    else if (how === 'extra') log(g, say(g, p, 'also lay', 'also lays') + ' ' + names + '.', p);
    else log(g, say(g, p, 'play', 'plays') + ' ' + names + (cards.length > 1 ? ' (same value!)' : '.'), p);
    if (how !== 'gamble') for (let i = 0; i < cards.length; i++) drawCard(g, p);
  }

  function offerExtra(g, p, rank) {
    if (g.players[p].hand.some(c => c.rank === rank)) g.r1.extra = { p, rank };
    else nextLayer(g);
  }

  function nextLayer(g) {
    const r1 = g.r1;
    r1.idx++;
    if (r1.idx < r1.order.length) g.turn = r1.order[r1.idx];
    else resolveTrick(g);
  }

  function resolveTrick(g) {
    const r1 = g.r1;
    // Battles are between different players: several cards of one value from the same player don't count.
    const players = {};
    for (const e of r1.plays) (players[e.card.rank] = players[e.card.rank] || new Set()).add(e.by);
    const pairRanks = Object.keys(players).filter(r => players[r].size > 1).map(Number);
    if (!pairRanks.length) {
      const best = r1.plays.reduce((b, e) => (e.card.rank > b.card.rank ? e : b));
      return awardR1(g, best.by);
    }
    const top = Math.max(...pairRanks);
    const tied = [...new Set(r1.plays.filter(e => e.card.rank === top).map(e => e.by))];
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
    // Blå: collected nothing in round 1 (the trump holder has the trump, so is never blå).
    g.blue = [];
    g.players.forEach((pl, i) => { pl.blue = !pl.hand.length && i !== g.trumpOwner; if (pl.blue) g.blue.push(i); });
    g.players[g.trumpOwner].hand.push(g.trumpCard);
    g.r2Deal = g.players.map(pl => pl.hand.slice()); // hands as dealt, before any blå hand-over
    g.stack = [];
    log(g, 'Round 1 over! The trumf is ' + label(g.trumpCard) + '. ' + say(g, g.trumpOwner, 'have it and start round 2.', 'has it and starts round 2.'), g.trumpOwner);
    g.blueMoves = null;
    if (g.blue.length === 1) {
      // One blå player: everyone gives up their 2-5s. The blå player gets the trump 2-5 and the
      // other 5s; the non-trump 2-4s leave the game.
      const b = g.blue[0], moved = [], out = [];
      g.players.forEach((pl, i) => {
        for (const c of pl.hand.filter(c => c.rank <= 5)) {
          pl.hand.splice(pl.hand.indexOf(c), 1);
          if (c.suit === g.trumpSuit || c.rank === 5) moved.push({ card: c, from: i });
          else { out.push({ card: c, from: i }); g.discard.push(c); }
        }
      });
      g.players[b].hand.push(...moved.map(m => m.card));
      g.blueMoves = { to: b, moved, out };
      log(g, say(g, b, 'are', 'is') + ' blå! Everyone gives up their 2, 3, 4 and 5. ' + say(g, b, 'get', 'gets') +
        ' the trumf 2-5 and the other 5s; the other 2s, 3s and 4s leave the game.', b);
    } else if (g.blue.length > 1) {
      log(g, listNames(g, g.blue) + ' are blå: they start with no cards and must pick up what is laid.');
    }
    g.r2Start = g.players.map(pl => pl.hand.slice());
    // Out before round 2 starts: anyone left with no cards who isn't waiting as blå.
    g.players.forEach((pl, i) => {
      if (!pl.hand.length && !(pl.blue && g.blue.length > 1)) { pl.out = true; g.finishOrder.push(i); }
    });
    if (checkOver(g)) return;
    g.turn = g.players[g.trumpOwner].out ? nextActive(g, g.trumpOwner) : g.trumpOwner;
    settleTurn(g);
  }

  // A blå player still waiting for cards: on their turn they must pick up, or, with nothing on the
  // stack to pick up, they're out and safe.
  function settleTurn(g) {
    while (!g.over) {
      const pl = g.players[g.turn];
      if (pl.out || pl.hand.length || g.stack.length) return;
      pl.out = true;
      g.finishOrder.push(g.turn);
      log(g, say(g, g.turn, 'have', 'has') + ' no cards and nothing to pick up: out and safe!', g.turn);
      if (checkOver(g)) return;
      g.turn = nextActive(g, g.turn);
    }
  }

  // The move a player has no choice about, if any: picking up with no cards, or leading their only card.
  function forcedMove(g) {
    if (g.over || g.round !== 2) return null;
    const hand = g.players[g.turn].hand;
    if (!hand.length && g.stack.length) return 'pickup';
    if (hand.length === 1 && !g.stack.length) return hand[0].id;
    return null;
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
    settleTurn(g);
  }

  // The cards of the first lay still on the stack (a run's cards share one lay id).
  const firstLay = g => g.stack.filter(e => e.lay === g.stack[0].lay);

  function r2PickUp(g, p) {
    if (g.over || g.round !== 2 || g.turn !== p) throw new Error('Not your turn');
    if (!g.stack.length) throw new Error('Nothing to pick up');
    // Pick up the first lay on the stack: one card, or the whole run if it was a run.
    const taken = firstLay(g);
    g.stack.splice(0, taken.length);
    g.players[p].hand.push(...taken.map(e => e.card));
    g.lastTrick = null;
    log(g, say(g, p, 'pick up', 'picks up') + ' ' + taken.map(e => label(e.card)).join(' ') + '.', p);
    g.turn = nextActive(g, p);
    settleTurn(g);
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
    const forced = forcedMove(g);
    if (forced) return forced;
    if (g.difficulty === 'easy') return aiEasy(g);
    if (g.difficulty === 'hard') return g.round === 1 ? aiHardR1(g) : aiHardR2(g);
    return aiNormal(g);
  }

  function aiNormal(g) {
    const p = g.turn, pl = g.players[p];
    if (g.round === 1) {
      const move = aiR1(g, p);
      if (g.r1.extra) return move;
      // Got more of a low value? Dump them together.
      const card = move !== 'gamble' && pl.hand.find(c => c.id === move);
      const same = card ? pl.hand.filter(c => c.rank === card.rank) : [];
      return same.length > 1 && card.rank <= 8 ? same.map(c => c.id) : move;
    }
    return aiR2(g, p);
  }

  function aiR1(g, p) {
    const pl = g.players[p], rng = g.rng;
    if (g.r1.extra) {
      const same = pl.hand.filter(c => c.rank === g.r1.extra.rank);
      return g.r1.extra.rank <= 8 || rng() < 0.3 ? same.map(c => c.id) : 'keep';
    }
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

  function aiR2(g, p) {
    const pl = g.players[p], rng = g.rng;
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

  // ----- Easy: plays sensibly only part of the time; otherwise random, sometimes picks up for no reason -----
  function aiEasy(g) {
    const p = g.turn, hand = g.players[p].hand, rng = g.rng;
    if (rng() < 0.6) return aiNormal(g);
    const pick = arr => arr[Math.floor(rng() * arr.length)];
    if (g.round === 1) {
      if (g.r1.extra) return rng() < 0.5 ? hand.filter(c => c.rank === g.r1.extra.rank).map(c => c.id) : 'keep';
      if (canGamble(g) && (!hand.length || rng() < 0.15)) return 'gamble';
      return pick(hand).id;
    }
    const legal = legalCards(g, p);
    if (g.stack.length && (!legal.length || rng() < 0.04)) return 'pickup';
    return pick(legal).id;
  }

  // ----- Hard: weighs stacks, steers battles, plans runs and trumps -----
  // In round 1 high cards are worth collecting, but low cards are a burden to shed in round 2.
  const hardWorth = c => (c.rank >= 11 ? c.rank - 9 : c.rank >= 9 ? 0.5 : -0.6);

  function aiHardR1(g) {
    const p = g.turn, pl = g.players[p], rng = g.rng, r1 = g.r1;
    const hand = pl.hand.slice().sort((a, b) => a.rank - b.rank);
    const sameAs = c => hand.filter(h => h.rank === c.rank);
    // Shed low cards together; keep good ones single.
    const lay = c => (c.rank <= 8 && sameAs(c).length > 1 ? sameAs(c).map(h => h.id) : c.id);
    if (r1.extra) return r1.extra.rank <= 8 ? hand.filter(c => c.rank === r1.extra.rank).map(c => c.id) : 'keep';
    const gamble = canGamble(g);
    if (!hand.length) return 'gamble';
    const plays = r1.plays;
    const others = new Set(plays.filter(e => e.by !== p).map(e => e.card.rank));
    const pairs = c => others.has(c.rank); // laying this would start a battle
    const lowest = hand[0], highest = hand[hand.length - 1];
    const stackWorth = g.stack.reduce((s, e) => s + hardWorth(e.card), 0);

    if (!plays.length) {
      if (r1.battle) return stackWorth > 0 ? highest.id : lowest.id;
      if (gamble && lowest.rank >= 11) return 'gamble'; // every card is worth keeping
      return lay(lowest);
    }
    const best = Math.max(...plays.map(e => e.card.rank));
    const last = r1.idx === r1.order.length - 1;
    // Picky: every card collected must be shed in round 2, so only take clearly good stacks.
    const want = r1.battle ? stackWorth > 0 : stackWorth + (last ? 0 : 1) > 4;
    if (want) {
      if (last) {
        const clean = hand.find(c => c.rank > best && !pairs(c));
        if (clean) return clean.id;
        // Can't beat it cleanly: match the top card and battle for it, if we have ammunition.
        const match = hand.find(c => c.rank === best);
        if (match && hand.some(c => c !== match && c.rank >= 11)) return match.id;
      } else {
        const strong = hand.slice().reverse().find(c => c.rank > best && !pairs(c));
        if (strong && strong.rank >= 11) return strong.id;
      }
      if (gamble && rng() < 0.3) return 'gamble';
    }
    // Not worth it (or can't win it): dodge with a low card that doesn't drag us into a battle.
    const dodge = hand.find(c => c.rank < best && !pairs(c));
    if (dodge) return lay(dodge);
    if (gamble) return 'gamble';
    return (hand.find(c => !pairs(c)) || lowest).id;
  }

  function aiHardR2(g) {
    const p = g.turn, hand = g.players[p].hand, rng = g.rng;
    const isTrump = c => c.suit === g.trumpSuit;
    const asc = (a, b) => a.rank - b.rank;
    const runFrom = c => {
      const run = [c];
      for (let next; (next = hand.find(h => h.suit === c.suit && h.rank === run[run.length - 1].rank + 1));) run.push(next);
      return run;
    };
    const ids = cards => (cards.length > 1 ? cards.map(c => c.id) : cards[0].id);
    if (!g.stack.length) {
      // A little randomness keeps unbeatable leads from cycling forever.
      if (rng() < 0.2) return hand[Math.floor(rng() * hand.length)].id;
      const plain = hand.filter(c => !isTrump(c));
      const pool = plain.length ? plain : hand;
      let best = null;
      for (const c of pool) {
        const run = runFrom(c);
        if (!best || run.length > best.length || (run.length === best.length && c.rank < best[0].rank)) best = run;
      }
      if (best.length > 1) return ids(best);
      const count = s => hand.filter(c => c.suit === s).length;
      return pool.slice().sort((a, b) => count(b.suit) - count(a.suit) || asc(a, b))[0].id;
    }
    const legal = legalCards(g, p).sort(asc);
    if (!legal.length) return 'pickup';
    const top = g.stack[g.stack.length - 1].card;
    const sameSuit = legal.filter(c => c.suit === top.suit);
    if (sameSuit.length) {
      const c = sameSuit[0];
      return !isTrump(c) || hand.length <= 5 ? ids(runFrom(c)) : c.id;
    }
    // Only a trump beats it: always worth it. A trump sheds a card; picking up only adds cards.
    return legal[0].id;
  }

  function act(g, move) {
    if (g.round === 1) return g.r1.extra ? r1Extra(g, g.turn, move) : r1Play(g, g.turn, move);
    if (move === 'pickup') return r2PickUp(g, g.turn);
    return r2Play(g, g.turn, move);
  }

  const api = { createGame, DIFFICULTIES, firstLay, forcedMove, r1Play, r1Extra, r2Play, r2PickUp, legalCards, checkPlay, isRun, canGamble, beats, aiMove, act, label, rankName, isRed, SUITS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Mattis = api;
})(typeof window !== 'undefined' ? window : globalThis);
