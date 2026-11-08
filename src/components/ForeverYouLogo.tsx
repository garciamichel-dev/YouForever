import React from 'react';
import { FOREVERYOU_NAVY_HEX } from '../utils/foreverYouLogoDraw';

export type ForeverYouLogoVariant =
  | 'horizontal'
  | 'stacked'
  | 'app_icon'
  | 'print_monochrome';

export interface ForeverYouInfinitySymbolProps {
  color?: string;
  className?: string;
  width?: number | string;
  height?: number | string;
  title?: string;
}

/**
 * Pure SVG vector implementation of the official ForeverYou `F + ∞ + Y` intertwined infinity monogram.
 * Scales cleanly at any size or DPI and adapts its stroke color to any palette.
 */
export const ForeverYouInfinitySymbol: React.FC<ForeverYouInfinitySymbolProps> = ({
  color = 'currentColor',
  className = '',
  width = 44,
  height = 24,
  title = 'ForeverYou',
}) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 200 108"
      width={width}
      height={height}
      fill="none"
      role="img"
      aria-label={title}
      className={`shrink-0 select-none ${className}`}
    >
      {/* Left loop outer arc + upper-left diagonal stopping before central crossing */}
      <path
        d="M 48 93 C 23 89, 12 72, 12 54 C 12 31, 30 14, 54 14 C 68 14, 79 21, 90 33"
        stroke={color}
        strokeWidth="15"
        strokeLinecap="butt"
        strokeLinejoin="round"
      />
      {/* Lower-right diagonal resuming after central crossing + right loop outer arc + continuous crossing ribbon */}
      <path
        d="M 110 68 C 121 82, 133 94, 148 94 C 172 94, 188 77, 188 54 C 188 31, 172 14, 148 14 C 131 14, 118 25, 100 47 C 83 68, 72 91, 58 94"
        stroke={color}
        strokeWidth="15"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Letter F integrated inside left loop */}
      <path
        d="M 48 93 L 48 54 C 48 41, 56 35, 76 35"
        stroke={color}
        strokeWidth="13.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M 48 61 L 69 61"
        stroke={color}
        strokeWidth="12.5"
        strokeLinecap="round"
      />
      {/* Letter Y integrated inside right loop */}
      <path
        d="M 140 91 L 140 59"
        stroke={color}
        strokeWidth="13.5"
        strokeLinecap="round"
      />
      <path
        d="M 140 60 C 136 50, 128 42, 120 38"
        stroke={color}
        strokeWidth="12.5"
        strokeLinecap="round"
      />
      <path
        d="M 140 60 C 144 50, 152 42, 160 38"
        stroke={color}
        strokeWidth="12.5"
        strokeLinecap="round"
      />
    </svg>
  );
};

export interface ForeverYouLogoProps {
  /**
   * - `horizontal`: Horizontal Lockup (Isotipo F∞Y + "ForeverYou" side by side) — ideal for navigation bars & headers
   * - `stacked`: Principal Vertical Lockup (Large Isotipo F∞Y above "ForeverYou") — ideal for login, consent & hero cards
   * - `app_icon`: Rounded deep-navy square with white F∞Y symbol — ideal for compact badges & app icons
   * - `print_monochrome`: Standalone F∞Y symbol adaptable to any template or book accent color
   */
  variant?: ForeverYouLogoVariant;
  /**
   * Theme preset when `color` is not explicitly provided:
   * - `navy`: Official ForeverYou deep navy (#0A182E) for light backgrounds
   * - `light`: Warm ivory/white for dark headers (e.g. Navbar)
   */
  theme?: 'navy' | 'light';
  /** Custom hex/CSS color override (e.g. book template accent color) */
  color?: string;
  /** Optional subtitle shown below or next to the wordmark */
  subtitle?: string;
  /** Size preset */
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  wordmarkClassName?: string;
}

const SIZE_MAP: Record<
  NonNullable<ForeverYouLogoProps['size']>,
  {
    symbolW: number;
    symbolH: number;
    stackedSymbolW: number;
    stackedSymbolH: number;
    iconBox: string;
    wordmarkSize: string;
    stackedWordmarkSize: string;
    gap: string;
  }
> = {
  xs: {
    symbolW: 24,
    symbolH: 13,
    stackedSymbolW: 44,
    stackedSymbolH: 24,
    iconBox: 'w-7 h-7 rounded-lg',
    wordmarkSize: 'text-sm',
    stackedWordmarkSize: 'text-base',
    gap: 'gap-1.5',
  },
  sm: {
    symbolW: 34,
    symbolH: 18,
    stackedSymbolW: 60,
    stackedSymbolH: 32,
    iconBox: 'w-8 h-8 rounded-lg',
    wordmarkSize: 'text-base',
    stackedWordmarkSize: 'text-lg',
    gap: 'gap-2',
  },
  md: {
    symbolW: 42,
    symbolH: 23,
    stackedSymbolW: 80,
    stackedSymbolH: 43,
    iconBox: 'w-10 h-10 rounded-xl',
    wordmarkSize: 'text-lg',
    stackedWordmarkSize: 'text-xl',
    gap: 'gap-2.5',
  },
  lg: {
    symbolW: 52,
    symbolH: 28,
    stackedSymbolW: 104,
    stackedSymbolH: 56,
    iconBox: 'w-12 h-12 rounded-2xl',
    wordmarkSize: 'text-xl',
    stackedWordmarkSize: 'text-2xl',
    gap: 'gap-3',
  },
  xl: {
    symbolW: 64,
    symbolH: 35,
    stackedSymbolW: 132,
    stackedSymbolH: 71,
    iconBox: 'w-14 h-14 rounded-2xl',
    wordmarkSize: 'text-2xl',
    stackedWordmarkSize: 'text-3xl',
    gap: 'gap-3.5',
  },
};

export const ForeverYouLogo: React.FC<ForeverYouLogoProps> = ({
  variant = 'horizontal',
  theme = 'navy',
  color,
  subtitle,
  size = 'md',
  className = '',
  wordmarkClassName = '',
}) => {
  const effectiveColor =
    color || (theme === 'light' ? '#F8FAFC' : FOREVERYOU_NAVY_HEX);
  const dims = SIZE_MAP[size];

  if (variant === 'print_monochrome') {
    return (
      <ForeverYouInfinitySymbol
        color={effectiveColor}
        width={dims.symbolW}
        height={dims.symbolH}
        className={className}
      />
    );
  }

  if (variant === 'app_icon') {
    return (
      <div
        data-testid="foreveryou-logo-app-icon"
        className={`inline-flex items-center justify-center shrink-0 shadow-sm ${dims.iconBox} ${className}`}
        style={{ backgroundColor: FOREVERYOU_NAVY_HEX }}
        title="ForeverYou"
      >
        <ForeverYouInfinitySymbol
          color="#FFFFFF"
          width={Math.round(dims.symbolW * 0.72)}
          height={Math.round(dims.symbolH * 0.72)}
        />
      </div>
    );
  }

  if (variant === 'stacked') {
    return (
      <div
        data-testid="foreveryou-logo-stacked"
        className={`inline-flex flex-col items-center text-center select-none ${className}`}
      >
        <ForeverYouInfinitySymbol
          color={effectiveColor}
          width={dims.stackedSymbolW}
          height={dims.stackedSymbolH}
        />
        <span
          className={`mt-1.5 font-sans font-bold tracking-tight leading-none ${dims.stackedWordmarkSize} ${wordmarkClassName}`}
          style={{
            color: effectiveColor,
            fontFamily: "'Plus Jakarta Sans', 'Manrope', sans-serif",
          }}
        >
          ForeverYou
        </span>
        {subtitle && (
          <span
            className="mt-1 text-[11px] font-medium tracking-wide opacity-75"
            style={{ color: effectiveColor }}
          >
            {subtitle}
          </span>
        )}
      </div>
    );
  }

  // Default: 'horizontal' lockup
  return (
    <div
      data-testid="foreveryou-logo-horizontal"
      className={`inline-flex items-center select-none ${dims.gap} ${className}`}
    >
      <ForeverYouInfinitySymbol
        color={effectiveColor}
        width={dims.symbolW}
        height={dims.symbolH}
      />
      <div className="flex flex-col justify-center">
        <span
          className={`font-sans font-bold tracking-tight leading-none ${dims.wordmarkSize} ${wordmarkClassName}`}
          style={{
            color: effectiveColor,
            fontFamily: "'Plus Jakarta Sans', 'Manrope', sans-serif",
          }}
        >
          ForeverYou
        </span>
        {subtitle && (
          <span className="block text-[11px] font-sans tracking-wide opacity-75 mt-0.5">
            {subtitle}
          </span>
        )}
      </div>
    </div>
  );
};
