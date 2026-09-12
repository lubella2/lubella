/**
 * The LuBella lockup, redrawn as a component so it can be tinted and scaled
 * without shipping an image. The leaf sprig and the script wordmark mirror the
 * shop's logo; colours come from the shared brand tokens.
 */
export function Logo({
  size = 32, showStrapline = false, className = '',
}: { size?: number; showStrapline?: boolean; className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className="shrink-0">
        <rect width="64" height="64" rx="14" fill="#FBEDF3" />
        <g transform="translate(32 46)">
          <path d="M0 0 C -3.5 -7 -5.5 -14 -4 -21 C -1 -25 2 -24 3 -20 C 4.5 -14 3 -7 0 0 Z" fill="#D1809A" />
          <path d="M0 0 C -7 -3 -12 -8 -14 -15 C -10 -17 -5 -14 -2.5 -8 C -1.5 -5 -0.5 -3 0 0 Z" fill="#B96482" />
          <path d="M0 0 C 7 -3 12 -8 14 -15 C 10 -17 5 -14 2.5 -8 C 1.5 -5 0.5 -3 0 0 Z" fill="#B96482" />
          <rect x="-1" y="0" width="2" height="6" rx="1" fill="#D1809A" />
        </g>
      </svg>
      <div className="leading-none min-w-0">
        <div
          className="font-display italic text-brand-rose truncate"
          style={{ fontSize: size * 0.72 }}
        >
          LuBella
        </div>
        {showStrapline && (
          <div
            className="tracking-[0.18em] text-brand-charcoal font-medium mt-0.5"
            style={{ fontSize: Math.max(7, size * 0.2) }}
          >
            COSMETICS &amp; ACCESSORIES
          </div>
        )}
      </div>
    </div>
  );
}

/** Full-colour lockup for the customer portal hero. */
export function LogoHero({ className = '' }: { className?: string }) {
  return (
    <div className={`text-center ${className}`}>
      <svg width="88" height="60" viewBox="0 0 88 60" className="mx-auto" aria-hidden="true">
        <g transform="translate(44 52)">
          <path d="M0 0 C -5 -10 -8 -20 -6 -30 C -2 -36 3 -34 4 -28 C 6 -19 4 -9 0 0 Z" fill="#D1809A" />
          <path d="M0 0 C -10 -4 -17 -12 -20 -21 C -14 -24 -7 -20 -3.5 -11 C -2 -7 -1 -4 0 0 Z" fill="#B96482" />
          <path d="M0 0 C 10 -4 17 -12 20 -21 C 14 -24 7 -20 3.5 -11 C 2 -7 1 -4 0 0 Z" fill="#B96482" />
          <rect x="-1.5" y="0" width="3" height="8" rx="1.5" fill="#D1809A" />
        </g>
      </svg>
      <p className="font-display italic text-brand-rose text-[2.6rem] leading-none mt-1">LuBella</p>
      <p className="tracking-[0.3em] text-brand-charcoal text-[0.6rem] sm:text-xs mt-1.5 font-medium">
        COSMETICS &amp; ACCESSORIES
      </p>
    </div>
  );
}
