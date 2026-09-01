// Page cover presets, shared by the editable cover band (PageView) and the
// public read-only trip page (PublicPage). A cover is either an image
// (http/https/data URL) or one of these gradient preset keys; '' means none.
// Kept React-free so it lives in lib/ and is unit-testable; the returned shape
// is a subset of React's CSSProperties, so it drops straight into a `style`.

export const COVER_GRADIENTS: Record<string, string> = {
  g1: 'linear-gradient(120deg, #e05a86 0%, #ef88a8 100%)',
  g2: 'linear-gradient(120deg, #f59e8c 0%, #e05a86 60%, #8f2f44 100%)',
  g3: 'linear-gradient(120deg, #6b7cff 0%, #47bfff 100%)',
  g4: 'linear-gradient(120deg, #34d399 0%, #14b8a6 100%)',
  g5: 'linear-gradient(120deg, #fbbf24 0%, #f97316 100%)',
  g6: 'linear-gradient(120deg, #1a1917 0%, #34322f 60%, #e05a86 130%)',
};

export const GRADIENT_KEYS = Object.keys(COVER_GRADIENTS);

export interface CoverStyle {
  backgroundImage?: string;
  backgroundSize?: string;
  backgroundPosition?: string;
}

export function coverStyle(cover: string): CoverStyle {
  if (/^(https?:\/\/|data:image\/)/i.test(cover))
    return { backgroundImage: `url(${cover})`, backgroundSize: 'cover', backgroundPosition: 'center' };
  if (COVER_GRADIENTS[cover]) return { backgroundImage: COVER_GRADIENTS[cover] };
  return {};
}
