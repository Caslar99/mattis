// Browser-side layout check for the phone view: does anything in the middle of the table (deck, Chance
// card, count, stack, caption) run into a player's chip or face-down cards? Load on the local dev server:
//   const { check } = await import('/tests/layout_check.js'); await check();
export async function check(reps = 4) {
  window.fly = async () => {}; // skip animations
  const vis = e => e && e.offsetParent && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden';
  const ov = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
  const found = []; let runs = 0, minMid = Infinity, nofans = 0;
  for (let rep = 0; rep < reps; rep++) for (const n of [2, 3, 4, 5, 6, 7, 8]) for (const side of ['left', 'right']) for (const stackN of [0, 1, 3]) {
    settings.players = n; let t = 0; const want = side === 'left' ? 1 : n - 1;
    do { newGame(); clearTimeout(timer); t++; } while (game.r1.leader !== want && t < 80);
    let k = 0; while (game.stack.length < Math.min(stackN, n - 1) && game.round === 1 && k++ < 20) { if (game.turn === 0) break; M.act(game, M.aiMove(game)); }
    busy = false; holdStack = null; render(); clearTimeout(timer); await new Promise(r => setTimeout(r, 5)); runs++;
    const m = document.querySelector('.center').style.getPropertyValue('--mid-w'); if (m) minMid = Math.min(minMid, parseFloat(m));
    if (document.getElementById('seats').classList.contains('nofans')) nofans++;
    const named = [document.querySelector('.deckwrap'), document.getElementById('chance'), document.querySelector('.deck .count'), document.querySelector('.trick'), document.getElementById('caption'), ...document.querySelectorAll('.stackpile .played .card')].filter(vis);
    const seats = [...document.querySelectorAll('.seat .chip, .seat .fan')].filter(vis); seats.push(document.getElementById('meChip'));
    for (const a of named) for (const b of seats) { const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); if (ra.width && rb.width && ov(ra, rb)) found.push(`${n}p ${side}-leads stack=${game.stack.length}`); }
  }
  return { size: innerWidth + 'x' + innerHeight, layoutsChecked: runs, collisions: found.length ? [...new Set(found)] : 'none',
    smallestShrunkCard: minMid === Infinity ? 'never shrunk' : Math.round(minMid) + 'px', fansHidden: nofans, pageScrolls: document.documentElement.scrollHeight > innerHeight };
}
