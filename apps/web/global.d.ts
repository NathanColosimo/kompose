// Allow Next.js global CSS imports to participate in type-checking under TS 6.
declare module "*.css";

// Turbopack resolves a font import to its content-hashed URL.
declare module "*.woff2" {
  const url: string;
  export default url;
}
