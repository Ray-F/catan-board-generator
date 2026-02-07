import { useState, useCallback, useEffect } from 'react';

// Types
type ResourceType = 'forest' | 'pasture' | 'field' | 'hill' | 'mountain' | 'desert';

interface Tile {
  resource: ResourceType;
  number: number | null;
}

// Resource configuration
const RESOURCE_CONFIG: Record<ResourceType, { color: string; label: string; emoji: string; patternId: string }> = {
  forest: { color: '#228B22', label: 'Wood', emoji: '🌲', patternId: 'pattern-forest' },
  pasture: { color: '#90EE90', label: 'Sheep', emoji: '🐑', patternId: 'pattern-pasture' },
  field: { color: '#FFD700', label: 'Wheat', emoji: '🌾', patternId: 'pattern-field' },
  hill: { color: '#CD853F', label: 'Brick', emoji: '🧱', patternId: 'pattern-hill' },
  mountain: { color: '#808080', label: 'Ore', emoji: '⛰️', patternId: 'pattern-mountain' },
  desert: { color: '#EDC9AF', label: 'Desert', emoji: '🏜️', patternId: 'pattern-desert' },
};

// Standard Catan tiles: 4 forest, 4 pasture, 4 field, 3 hill, 3 mountain, 1 desert
const TILES: ResourceType[] = [
  'forest', 'forest', 'forest', 'forest',
  'pasture', 'pasture', 'pasture', 'pasture',
  'field', 'field', 'field', 'field',
  'hill', 'hill', 'hill',
  'mountain', 'mountain', 'mountain',
  'desert',
];

// Standard number tokens: one 2, two each of 3-6 and 8-11, one 12
const NUMBERS: number[] = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];

// Hex grid layout (row sizes: 3, 4, 5, 4, 3 = 19 hexes)
const ROW_SIZES = [3, 4, 5, 4, 3];

// Adjacency map: for each hex index (0-18), list of adjacent hex indices
// Based on the standard Catan board layout
const ADJACENCY: number[][] = [
  [1, 3, 4],           // 0
  [0, 2, 4, 5],        // 1
  [1, 5, 6],           // 2
  [0, 4, 7, 8],        // 3
  [0, 1, 3, 5, 8, 9],  // 4
  [1, 2, 4, 6, 9, 10], // 5
  [2, 5, 10, 11],      // 6
  [3, 8, 12],          // 7
  [3, 4, 7, 9, 12, 13],// 8
  [4, 5, 8, 10, 13, 14],// 9
  [5, 6, 9, 11, 14, 15],// 10
  [6, 10, 15, 16],     // 11
  [7, 8, 13, 17],      // 12
  [8, 9, 12, 14, 17, 18],// 13
  [9, 10, 13, 15, 18], // 14 (only 5 neighbors - edge)
  [10, 11, 14, 16, 18],// 15 (only 5 neighbors - edge)
  [11, 15],            // 16
  [12, 13, 18],        // 17
  [13, 14, 15, 17],    // 18
];

// Seeded PRNG (mulberry32)
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Convert a 6-char alphanumeric string to a 32-bit seed
function hashToSeed(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return hash;
}

// Generate a random 6-char alphanumeric seed string
const SEED_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
function generateSeedString(): string {
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += SEED_CHARS[Math.floor(Math.random() * SEED_CHARS.length)];
  }
  return result;
}

// Parse hash into seed + constraint flag. Format: "seed-1" or "seed-0"
function parseHash(hash: string): { seed: string; enforceConstraint: boolean } | null {
  const match = hash.match(/^([a-z0-9]{6})-([01])$/);
  if (!match) return null;
  return { seed: match[1], enforceConstraint: match[2] === '1' };
}

function buildHash(seed: string, enforceConstraint: boolean): string {
  return `${seed}-${enforceConstraint ? '1' : '0'}`;
}

// Shuffle array using Fisher-Yates
function shuffle<T>(array: T[], random: () => number): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Check if two numbers violate adjacency constraint
function violatesConstraint(num1: number | null, num2: number | null): boolean {
  if (num1 === null || num2 === null) return false;
  // 6 and 8 cannot be adjacent (including same-number pairs)
  if ((num1 === 6 || num1 === 8) && (num2 === 6 || num2 === 8)) return true;
  // 2 and 12 cannot be adjacent (including same-number pairs)
  if ((num1 === 2 || num1 === 12) && (num2 === 2 || num2 === 12)) return true;
  return false;
}

// Check if placing a number at a position violates constraints
function isValidPlacement(
  tiles: Tile[],
  position: number,
  number: number,
  enforceConstraint: boolean
): boolean {
  if (!enforceConstraint) return true;

  for (const adjIdx of ADJACENCY[position]) {
    if (violatesConstraint(number, tiles[adjIdx].number)) {
      return false;
    }
  }
  return true;
}

// Generate a valid board
function generateBoard(enforceConstraint: boolean, random: () => number): Tile[] {
  const maxAttempts = 1000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const shuffledTiles = shuffle(TILES, random);
    const shuffledNumbers = shuffle(NUMBERS, random);

    const tiles: Tile[] = shuffledTiles.map(resource => ({
      resource,
      number: null,
    }));

    // Find desert index
    const desertIndex = tiles.findIndex(t => t.resource === 'desert');

    // Get non-desert indices
    const nonDesertIndices = tiles
      .map((_, i) => i)
      .filter(i => i !== desertIndex);

    // Try to place numbers
    let valid = true;
    const numbersToPlace = [...shuffledNumbers];

    if (enforceConstraint) {
      // Use backtracking for constrained placement
      const result = placeNumbersWithBacktracking(tiles, nonDesertIndices, numbersToPlace);
      if (result) {
        return tiles;
      }
      valid = false;
    } else {
      // Simple placement without constraints
      for (let i = 0; i < nonDesertIndices.length; i++) {
        tiles[nonDesertIndices[i]].number = numbersToPlace[i];
      }
      return tiles;
    }

    if (valid) return tiles;
  }

  // Fallback: return without constraint enforcement
  console.warn('Could not generate valid board with constraints, returning unconstrained board');
  return generateBoard(false, random);
}

// Backtracking algorithm for placing numbers with constraints
function placeNumbersWithBacktracking(
  tiles: Tile[],
  positions: number[],
  numbers: number[]
): boolean {
  if (numbers.length === 0) return true;

  const pos = positions[0];
  const remainingPositions = positions.slice(1);

  // Try each remaining number
  for (let i = 0; i < numbers.length; i++) {
    const num = numbers[i];

    if (isValidPlacement(tiles, pos, num, true)) {
      tiles[pos].number = num;
      const remainingNumbers = [...numbers.slice(0, i), ...numbers.slice(i + 1)];

      if (placeNumbersWithBacktracking(tiles, remainingPositions, remainingNumbers)) {
        return true;
      }

      tiles[pos].number = null;
    }
  }

  return false;
}

// SVG pattern definitions for hex tile textures
function HexPatterns() {
  return (
    <defs>
      {/* Forest: small triangles on green */}
      <pattern id="pattern-forest" width="12" height="12" patternUnits="userSpaceOnUse">
        <rect width="12" height="12" fill="#228B22" />
        <polygon points="6,1 10,9 2,9" fill="#1a6e1a" />
      </pattern>

      {/* Pasture: scattered circles on light green */}
      <pattern id="pattern-pasture" width="14" height="14" patternUnits="userSpaceOnUse">
        <rect width="14" height="14" fill="#90EE90" />
        <circle cx="3" cy="3" r="2" fill="#7ad67a" />
        <circle cx="10" cy="10" r="2" fill="#7ad67a" />
        <circle cx="10" cy="3" r="1.2" fill="#7ad67a" />
        <circle cx="3" cy="10" r="1.2" fill="#7ad67a" />
      </pattern>

      {/* Field: diagonal lines on gold */}
      <pattern id="pattern-field" width="8" height="8" patternUnits="userSpaceOnUse">
        <rect width="8" height="8" fill="#FFD700" />
        <line x1="0" y1="8" x2="8" y2="0" stroke="#e6c200" strokeWidth="1.5" />
        <line x1="-2" y1="2" x2="2" y2="-2" stroke="#e6c200" strokeWidth="1.5" />
        <line x1="6" y1="10" x2="10" y2="6" stroke="#e6c200" strokeWidth="1.5" />
      </pattern>

      {/* Hill: brick grid on brown */}
      <pattern id="pattern-hill" width="16" height="10" patternUnits="userSpaceOnUse">
        <rect width="16" height="10" fill="#CD853F" />
        <rect x="0" y="0" width="16" height="5" fill="none" stroke="#b8742e" strokeWidth="0.8" />
        <line x1="8" y1="0" x2="8" y2="5" stroke="#b8742e" strokeWidth="0.8" />
        <rect x="0" y="5" width="16" height="5" fill="none" stroke="#b8742e" strokeWidth="0.8" />
        <line x1="0" y1="5" x2="0" y2="10" stroke="#b8742e" strokeWidth="0.8" />
        <line x1="16" y1="5" x2="16" y2="10" stroke="#b8742e" strokeWidth="0.8" />
      </pattern>

      {/* Mountain: chevrons/zigzags on grey */}
      <pattern id="pattern-mountain" width="14" height="10" patternUnits="userSpaceOnUse">
        <rect width="14" height="10" fill="#808080" />
        <polyline points="0,8 7,2 14,8" fill="none" stroke="#6b6b6b" strokeWidth="1.5" />
      </pattern>

      {/* Desert: stipple dots on sandy background */}
      <pattern id="pattern-desert" width="10" height="10" patternUnits="userSpaceOnUse">
        <rect width="10" height="10" fill="#EDC9AF" />
        <circle cx="2" cy="2" r="0.7" fill="#d4b69a" />
        <circle cx="7" cy="4" r="0.7" fill="#d4b69a" />
        <circle cx="4" cy="8" r="0.7" fill="#d4b69a" />
        <circle cx="9" cy="9" r="0.7" fill="#d4b69a" />
        <circle cx="1" cy="6" r="0.5" fill="#d4b69a" />
        <circle cx="8" cy="1" r="0.5" fill="#d4b69a" />
      </pattern>
    </defs>
  );
}

// Hex component
function Hex({ tile, size = 60 }: { tile: Tile; size?: number }) {
  const config = RESOURCE_CONFIG[tile.resource];
  const isRed = tile.number === 6 || tile.number === 8;

  // Calculate hex points
  const outerPoints = [];
  const innerScale = 0.88;
  const innerPoints = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    const ox = size + size * Math.cos(angle);
    const oy = size + size * Math.sin(angle);
    outerPoints.push(`${ox},${oy}`);
    const ix = size + size * innerScale * Math.cos(angle);
    const iy = size + size * innerScale * Math.sin(angle);
    innerPoints.push(`${ix},${iy}`);
  }

  return (
    <svg width={size * 2} height={size * 2} style={{ overflow: 'visible' }}>
      <polygon
        points={outerPoints.join(' ')}
        fill="#F5DEB3"
        stroke="#333"
        strokeWidth="2"
      />
      <polygon
        points={innerPoints.join(' ')}
        fill={`url(#${config.patternId})`}
        stroke="none"
      />
      {tile.number && (
        <>
          <circle
            cx={size}
            cy={size}
            r={size * 0.42}
            fill="#FFF8DC"
            stroke="#333"
            strokeWidth="1"
          />
          <text
            x={size}
            y={size + 5}
            textAnchor="middle"
            fontSize={size * 0.4}
            fontWeight="bold"
            fill={isRed ? '#CC0000' : '#333'}
          >
            {tile.number}
          </text>
          <text
            x={size}
            y={size + 16}
            textAnchor="middle"
            fontSize={size * 0.17}
            fill="#666"
          >
            {'•'.repeat(6 - Math.abs(7 - tile.number))}
          </text>
        </>
      )}
    </svg>
  );
}

// Read state from URL hash or generate defaults
function getStateFromHash(): { seed: string; enforceConstraint: boolean } {
  const hash = window.location.hash.replace('#', '');
  const parsed = parseHash(hash);
  if (parsed) return parsed;
  const seed = generateSeedString();
  const enforceConstraint = true;
  window.location.hash = buildHash(seed, enforceConstraint);
  return { seed, enforceConstraint };
}

// Generate board from a seed string
function generateBoardFromSeed(seed: string, enforceConstraint: boolean): Tile[] {
  const random = mulberry32(hashToSeed(seed));
  return generateBoard(enforceConstraint, random);
}

// Main board component
export function CatanBoard() {
  const [{ seed: initialSeed, enforceConstraint: initialConstraint }] = useState(getStateFromHash);
  const [enforceConstraint, setEnforceConstraint] = useState(initialConstraint);
  const [seed, setSeed] = useState(initialSeed);
  const [tiles, setTiles] = useState<Tile[]>(() => generateBoardFromSeed(initialSeed, initialConstraint));

  const regenerate = useCallback(() => {
    const newSeed = generateSeedString();
    window.location.hash = buildHash(newSeed, enforceConstraint);
    setSeed(newSeed);
    setTiles(generateBoardFromSeed(newSeed, enforceConstraint));
  }, [enforceConstraint]);

  // When constraint checkbox changes, update hash and regenerate with same seed
  const handleConstraintChange = useCallback((checked: boolean) => {
    setEnforceConstraint(checked);
    window.location.hash = buildHash(seed, checked);
    setTiles(generateBoardFromSeed(seed, checked));
  }, [seed]);

  // Listen for hashchange (browser back/forward)
  useEffect(() => {
    const onHashChange = () => {
      const hash = window.location.hash.replace('#', '');
      const parsed = parseHash(hash);
      if (!parsed) return;
      if (parsed.seed !== seed || parsed.enforceConstraint !== enforceConstraint) {
        setSeed(parsed.seed);
        setEnforceConstraint(parsed.enforceConstraint);
        setTiles(generateBoardFromSeed(parsed.seed, parsed.enforceConstraint));
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [seed, enforceConstraint]);

  // Calculate hex positions (pointy-top hexagons)
  const hexSize = 50;
  const hexWidth = hexSize * Math.sqrt(3);  // ~86.6 for pointy-top
  const hexHeight = hexSize * 2;             // 100 for pointy-top
  const horizontalSpacing = hexWidth;
  const verticalSpacing = hexHeight * 0.75;

  let tileIndex = 0;
  const hexElements: React.JSX.Element[] = [];

  for (let row = 0; row < ROW_SIZES.length; row++) {
    const rowSize = ROW_SIZES[row];
    const rowOffset = (5 - rowSize) / 2; // Center each row

    for (let col = 0; col < rowSize; col++) {
      const x = (rowOffset + col) * horizontalSpacing;
      const y = row * verticalSpacing;

      hexElements.push(
        <g key={tileIndex} transform={`translate(${x}, ${y})`}>
          <Hex tile={tiles[tileIndex]} size={hexSize} />
        </g>
      );
      tileIndex++;
    }
  }

  const boardWidth = 4 * horizontalSpacing + hexWidth;
  const boardHeight = 4 * verticalSpacing + hexHeight;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px' }}>
      <h1>Catan Board Generator</h1>

      <div style={{ display: 'flex', gap: '20px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={enforceConstraint}
            onChange={(e) => handleConstraintChange(e.target.checked)}
            style={{ width: '18px', height: '18px', cursor: 'pointer' }}
          />
          <span>No adjacent similar numbers</span>
          <span
            className="tooltip-icon"
            data-tooltip="6 & 8 cannot be adjacent to each other. 2 & 12 cannot be adjacent to each other."
          >?</span>
        </label>

        <button
          onClick={regenerate}
          style={{
            padding: '12px 24px',
            fontSize: '16px',
            fontWeight: 'bold',
            cursor: 'pointer',
          }}
        >
          Generate New Board
        </button>

      </div>

      <svg
        width={boardWidth}
        height={boardHeight}
        viewBox={`-10 -10 ${boardWidth + 20} ${boardHeight + 20}`}
        style={{ maxWidth: '100%', height: 'auto' }}
      >
        <HexPatterns />
        {hexElements}
      </svg>

      <div style={{ display: 'flex', gap: '15px', flexWrap: 'wrap', justifyContent: 'center', marginTop: '10px' }}>
        {Object.entries(RESOURCE_CONFIG).map(([resource, config]) => (
          <div key={resource} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <div
              style={{
                width: '20px',
                height: '20px',
                backgroundColor: config.color,
                border: '1px solid #333',
                borderRadius: '3px',
              }}
            />
            <span>{config.emoji} {config.label}</span>
          </div>
        ))}
      </div>

      <span style={{ fontFamily: 'monospace', fontSize: '14px', color: 'rgba(240, 230, 211, 0.5)' }}>
        Seed: <strong style={{ color: 'rgba(240, 230, 211, 0.7)' }}>{seed}</strong>
      </span>
    </div>
  );
}
