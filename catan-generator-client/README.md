# Catan Board Generator

A web-based Catan board generator that creates random, shareable board layouts.

## Features

- Randomised hex tile and number token placement following standard Catan distribution
- **Seed-based generation** — each board has a unique 6-character code in the URL hash (e.g. `#a1b2c3-1`), so the same URL always produces the same board
- **Constraint enforcement** — optional rule preventing 6/8 and 2/12 number tokens from being placed adjacent to each other
- **Shareable URLs** — copy the URL to share a specific board with others
- **Browser history** — back/forward navigation moves between previously generated boards

## Getting Started

```bash
# Install dependencies
yarn install

# Start dev server
yarn dev

# Build for production
yarn build
```

## Tech Stack

- React + TypeScript
- Vite
- No external runtime dependencies — board generation uses a built-in seeded PRNG (mulberry32)

## License

MIT — see [LICENSE](LICENSE) for details.
