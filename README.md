# Mattis

A browser version of the card game Mattis: you against 1–7 computer players.

- **Round 1:** everyone lays a card; the highest takes the stack. Ties on the highest card battle it out. The last card in the deck is the hidden trump.
- **Round 2:** get rid of your cards. The last player holding cards loses.

Plain HTML/JS with no build step. Open `index.html` or deploy as a static site.
`engine.js` holds the game rules and computer players; `index.html` holds the UI.

Card artwork from [SVG-cards](https://github.com/htdebeer/SVG-cards) by David Bellot and Huub de Beer, LGPL-2.1 (see `cards/LICENSE`). Avatars from [DiceBear](https://www.dicebear.com).
