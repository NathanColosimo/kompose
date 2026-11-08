/**
 * React Native has no CSS color-mix(), so calendar tints are mixed here, in
 * Oklab like the web's `event-surface` utility.
 */

type Rgb = [number, number, number];

const HEX_PATTERN = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const HSL_PATTERN = /^hsl\(\s*([\d.]+)[\s,]+([\d.]+)%[\s,]+([\d.]+)%\s*\)$/i;

function parseHex(hex: string): Rgb {
  const digits =
    hex.length === 4
      ? hex
          .slice(1)
          .split("")
          .map((digit) => digit + digit)
          .join("")
      : hex.slice(1);
  return [0, 2, 4].map(
    (start) => Number.parseInt(digits.slice(start, start + 2), 16) / 255
  ) as Rgb;
}

function parseHsl(hue: number, saturation: number, lightness: number): Rgb {
  const s = saturation / 100;
  const l = lightness / 100;
  const k = (n: number) => (n + hue / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) =>
    l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [channel(0), channel(8), channel(4)];
}

/** Parses "#rgb", "#rrggbb", or "hsl(h, s%, l%)"; null for anything else. */
function parseColor(color: string): Rgb | null {
  const value = color.trim();
  if (HEX_PATTERN.test(value)) {
    return parseHex(value);
  }
  const hsl = HSL_PATTERN.exec(value);
  if (hsl) {
    return parseHsl(Number(hsl[1]), Number(hsl[2]), Number(hsl[3]));
  }
  return null;
}

const toLinear = (c: number) =>
  c <= 0.040_45 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const fromLinear = (c: number) =>
  c <= 0.003_130_8 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;

function toOklab([r, g, b]: Rgb): Rgb {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
  const l = Math.cbrt(
    0.412_221_470_8 * lr + 0.536_332_536_3 * lg + 0.051_445_992_9 * lb
  );
  const m = Math.cbrt(
    0.211_903_498_2 * lr + 0.680_699_545_1 * lg + 0.107_396_956_6 * lb
  );
  const s = Math.cbrt(
    0.088_302_461_9 * lr + 0.281_718_837_6 * lg + 0.629_978_700_5 * lb
  );
  return [
    0.210_454_255_3 * l + 0.793_617_785 * m - 0.004_072_046_8 * s,
    1.977_998_495_1 * l - 2.428_592_205 * m + 0.450_593_709_9 * s,
    0.025_904_037_1 * l + 0.782_771_766_2 * m - 0.808_675_766 * s,
  ];
}

function fromOklab([lightness, a, b]: Rgb): Rgb {
  const l = (lightness + 0.396_337_777_4 * a + 0.215_803_757_3 * b) ** 3;
  const m = (lightness - 0.105_561_345_8 * a - 0.063_854_172_8 * b) ** 3;
  const s = (lightness - 0.089_484_177_5 * a - 1.291_485_548 * b) ** 3;
  const rgb: Rgb = [
    4.076_741_662_1 * l - 3.307_711_591_3 * m + 0.230_969_929_2 * s,
    -1.268_438_004_6 * l + 2.609_757_401_1 * m - 0.341_319_396_5 * s,
    -0.004_196_086_3 * l - 0.703_418_614_7 * m + 1.707_614_701 * s,
  ];
  return rgb.map((c) => Math.min(1, Math.max(0, fromLinear(c)))) as Rgb;
}

/**
 * `amount` of `color` over `base`, as an rgb() string. Falls back to `base`
 * when either color can't be parsed.
 */
export function mixColor(color: string, base: string, amount: number): string {
  const top = parseColor(color);
  const bottom = parseColor(base);
  if (!(top && bottom)) {
    return base;
  }
  const a = toOklab(top);
  const b = toOklab(bottom);
  const mixed = fromOklab(
    a.map((channel, index) => channel * amount + b[index] * (1 - amount)) as Rgb
  );
  const [r, g, bl] = mixed.map((c) => Math.round(c * 255));
  return `rgb(${r}, ${g}, ${bl})`;
}
