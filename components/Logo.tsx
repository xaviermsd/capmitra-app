/* eslint-disable @next/next/no-img-element */

/** CapMitra app icon (brand asset). */
export function LogoMark({ size = 34 }: { size?: number }) {
  return <img src="/brand/icon-96.png" width={size} height={size} alt="" className="logo-mark" draggable={false} />;
}

/** Icon + "CapMitra" wordmark in Plus Jakarta Sans with the EDIT badge. */
export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="wordmark" aria-label="CapMitra Edit">
      <LogoMark />
      {!compact ? (
        <span className="wordmark-text" aria-hidden="true">
          <span className="wm-main">CapMitra<span className="wm-badge-edit">EDIT</span></span>
        </span>
      ) : null}
    </span>
  );
}

/** Animated waveform used by loaders (pure SVG + CSS). */
export function WaveLoader({ bars = 9 }: { bars?: number }) {
  return (
    <span className="wave-loader" aria-hidden="true">
      {Array.from({ length: bars }, (_, i) => (
        <i key={i} style={{ animationDelay: `${(i % 5) * 0.11 + Math.floor(i / 5) * 0.05}s` }} />
      ))}
    </span>
  );
}
