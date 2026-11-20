export interface StorefrontCover {
  displayName: string;
  tagline: string;
  accent: string;
  bannerSrc?: string | null;
  logoSrc?: string | null;
  unpublished?: boolean;
}
export interface StorefrontProductPreview {
  name: string;
  category: string;
  priceMinor: number;
  photoSrc?: string | null;
}
export declare const storefrontCoverCss: string;
export declare const storefrontProductCss: string;
export declare function storefrontAccentForeground(accent: string): string;
export declare function renderStorefrontCover(input: StorefrontCover): string;
export declare function renderStorefrontProductPreview(input: StorefrontProductPreview): string;
export declare function renderStorefrontProductSample(items: StorefrontProductPreview[]): string;
