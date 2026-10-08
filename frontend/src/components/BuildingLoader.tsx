import React, { useMemo } from 'react';
import clsx from 'clsx';

import kkrLogo from '../assets/kkr-logo.png';

interface BrickTile {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  delay: number;
}

function getBrickTiles(): BrickTile[] {
  const tiles: BrickTile[] = [];
  const numRows = 6;
  const rowHeight = 100 / numRows;

  for (let r = 0; r < numRows; r++) {
    const y = r * rowHeight;
    // Construction builds from bottom to top
    const rowBaseDelay = 0.1 + (numRows - 1 - r) * 0.22;

    if (r % 2 === 0) {
      // Even row: 6 full bricks
      const numCols = 6;
      const colWidth = 100 / numCols;
      for (let c = 0; c < numCols; c++) {
        const x = c * colWidth;
        const delay = rowBaseDelay + c * 0.035;
        tiles.push({
          id: `r${r}-c${c}`,
          x,
          y,
          w: colWidth,
          h: rowHeight,
          delay: Math.round(delay * 100) / 100,
        });
      }
    } else {
      // Odd row: Running bond shift (half brick on ends)
      const fullWidth = 100 / 6;
      const halfWidth = fullWidth / 2;

      // Left half brick
      tiles.push({
        id: `r${r}-c0-half`,
        x: 0,
        y,
        w: halfWidth,
        h: rowHeight,
        delay: Math.round(rowBaseDelay * 100) / 100,
      });

      // 5 middle full bricks
      for (let c = 0; c < 5; c++) {
        const x = halfWidth + c * fullWidth;
        const delay = rowBaseDelay + (c + 0.5) * 0.035;
        tiles.push({
          id: `r${r}-c${c + 1}`,
          x,
          y,
          w: fullWidth,
          h: rowHeight,
          delay: Math.round(delay * 100) / 100,
        });
      }

      // Right half brick
      tiles.push({
        id: `r${r}-c6-half`,
        x: 100 - halfWidth,
        y,
        w: halfWidth,
        h: rowHeight,
        delay: Math.round((rowBaseDelay + 5.5 * 0.035) * 100) / 100,
      });
    }
  }

  return tiles;
}

function BrickConstructedLogo({
  logoUrl = kkrLogo,
  compact = false,
}: {
  logoUrl?: string;
  compact?: boolean;
}) {
  const brickTiles = useMemo(() => getBrickTiles(), []);

  return (
    <div
      className={clsx(
        'kkr-brick-loader relative select-none flex items-center justify-center p-2',
        compact ? 'h-[min(5.5rem,22dvh)] w-[min(8rem,70vw)]' : 'h-[min(11.5rem,36dvh)] w-[min(17.5rem,80vw)]'
      )}
      aria-hidden
    >
      {/* Subtle ambient glow behind logo */}
      <div className="pointer-events-none absolute inset-[10%] rounded-full bg-[#00b4d8]/20 blur-2xl kkr-brick-glow" />

      {/* Blueprint Grid Floor Line */}
      <div className="pointer-events-none absolute bottom-1 inset-x-4 h-0.5 border-b border-dashed border-[#00c2ff]/40" />

      {/* Main Brick Construction Container */}
      <div className="relative h-full w-full overflow-hidden rounded-xl bg-white/40 p-2 shadow-inner border border-white/60">
        {/* Underlay Blueprint Lines */}
        <div className="pointer-events-none absolute inset-0 opacity-15 bg-[linear-gradient(to_right,#00c2ff_1px,transparent_1px),linear-gradient(to_bottom,#00c2ff_1px,transparent_1px)] bg-[size:16px_16px]" />

        {/* Dynamic Brick Matrix Slicing Any Logo Image */}
        <div className="relative h-full w-full">
          {brickTiles.map((b) => (
            <div
              key={b.id}
              className="kkr-brick absolute overflow-hidden rounded-[2px] border border-white/30"
              style={{
                left: `${b.x}%`,
                top: `${b.y}%`,
                width: `${b.w}%`,
                height: `${b.h}%`,
                animationDelay: `${b.delay}s`,
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.4), 0 2px 4px rgba(0,40,100,0.15)',
              }}
            >
              {/* Perfectly Sliced Image Frame */}
              <img
                src={logoUrl}
                alt=""
                className="absolute max-w-none object-contain pointer-events-none"
                style={{
                  left: `-${(b.x / b.w) * 100}%`,
                  top: `-${(b.y / b.h) * 100}%`,
                  width: `${(100 / b.w) * 100}%`,
                  height: `${(100 / b.h) * 100}%`,
                }}
              />
              {/* 3D Masonry Bevel Highlight */}
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/25 via-transparent to-black/20" />
            </div>
          ))}

          {/* Construction Laser Scanner Line */}
          <div className="kkr-brick-scanner absolute inset-x-0 h-1 bg-gradient-to-r from-transparent via-[#00ffff] to-transparent shadow-[0_0_12px_#00ffff]" />

          {/* Completion Shine Sweep */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="kkr-brick-shine-bar absolute top-0 -bottom-10 w-24 bg-gradient-to-r from-transparent via-white/50 to-transparent skew-x-[-25deg]" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function BuildingLoader({
  label = 'Loading workspace',
  sublabel,
  fullPage = false,
  compact = false,
  logoUrl = kkrLogo,
}: {
  label?: string;
  sublabel?: string;
  fullPage?: boolean;
  compact?: boolean;
  logoUrl?: string;
}) {
  if (compact) {
    return (
      <div className="flex h-full w-full items-center justify-center p-2" role="status" aria-label={label}>
        <BrickConstructedLogo logoUrl={logoUrl} compact />
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={clsx(
        'flex w-full flex-col items-center justify-center px-4 py-8',
        fullPage
          ? 'fixed inset-0 z-50 flex items-center justify-center bg-white/80 backdrop-blur-md'
          : 'min-h-[min(380px,70dvh)]'
      )}
    >
      <div className="relative flex flex-col items-center">
        {/* Glow backdrop behind card */}
        <div className="pointer-events-none absolute -inset-10 rounded-full bg-[radial-gradient(circle,rgba(0,180,255,0.14),transparent_70%)] blur-2xl" />

        {/* Component Card */}
        <div className="relative flex min-w-0 max-w-full flex-col items-center rounded-[28px] border border-blue-100/90 bg-white/95 px-4 py-6 shadow-[0_16px_40px_rgba(0,43,102,0.1)] backdrop-blur-xl sm:px-8 sm:py-8">
          <BrickConstructedLogo logoUrl={logoUrl} />

          <div className="mt-4 text-center">
            <h3 className="font-display text-lg font-bold tracking-tight text-[#002b66]">{label}</h3>
            {sublabel ? (
              <p className="mt-1.5 max-w-xs text-xs font-medium leading-relaxed text-slate">{sublabel}</p>
            ) : (
              <p className="mt-1.5 text-[10px] font-bold uppercase tracking-[0.22em] text-[#0082c8]">
                Constructing Workspace Ledger
              </p>
            )}
          </div>

          {/* Progress Bar */}
          <div className="relative mt-5 h-1.5 w-44 overflow-hidden rounded-full bg-blue-50/80 ring-1 ring-blue-100/60">
            <div className="kkr-brick-progress absolute inset-y-0 left-0 w-full rounded-full bg-gradient-to-r from-[#00c2ff] via-[#0077e6] to-[#002b66]" />
          </div>
        </div>
      </div>
    </div>
  );
}
