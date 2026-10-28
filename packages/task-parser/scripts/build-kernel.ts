/**
 * Builds the WebAssembly SIMD kernel used by src/model/kernel.ts.
 * The text format is generated here (16 accumulators are tedious by hand),
 * compiled with wabt, and written as base64 to src/model/kernel-wasm.ts.
 * Usage: bun scripts/build-kernel.ts
 */
import { writeFile } from "node:fs/promises";

const BLOCK = [0, 1, 2, 3];
const pairs = BLOCK.flatMap((i) => BLOCK.map((j) => [i, j] as const));
const locals = [
  ...BLOCK.map((i) => `(local $x${i} i32)`),
  ...BLOCK.map((j) => `(local $w${j} i32)`),
  ...pairs.map(([i, j]) => `(local $a${i}${j} v128)`),
  ...BLOCK.map((i) => `(local $xv${i} v128)`),
  ...BLOCK.map((j) => `(local $wv${j} v128)`),
].join(" ");
const isum = (name: string) =>
  `(i32.add (i32.add (i32x4.extract_lane 0 (local.get ${name})) (i32x4.extract_lane 1 (local.get ${name}))) (i32.add (i32x4.extract_lane 2 (local.get ${name})) (i32x4.extract_lane 3 (local.get ${name}))))`;

/** `a += x · w` over 16 int8 lanes. */
const dotAdd = (relaxed: boolean) => (i: number, j: number) =>
  relaxed
    ? `(local.set $a${i}${j} (i32x4.relaxed_dot_i8x16_i7x16_add_s (local.get $wv${j}) (local.get $xv${i}) (local.get $a${i}${j})))`
    : `(local.set $a${i}${j} (i32x4.add (local.get $a${i}${j}) (i32x4.extadd_pairwise_i16x8_s (i16x8.add (i16x8.extmul_low_i8x16_s (local.get $xv${i}) (local.get $wv${j})) (i16x8.extmul_high_i8x16_s (local.get $xv${i}) (local.get $wv${j}))))))`;

/**
 * out[n, rows] (int32) = x[n, cols] · w[rows, cols]ᵀ, both int8, byte
 * offsets; callers scale the sums back. Activations must be within ±63
 * (7 bits): relaxed SIMD's dot product then gives the same exact sums on
 * every CPU, 16 products per instruction (ARM sdot). Without relaxed SIMD,
 * 16 products are taken to int16 (at most 63 · 127, so two of them still
 * fit), added in pairs and widened into the int32 sums.
 * n and rows must be multiples of 4, cols of 16.
 */
const linear = (relaxed: boolean) => `  (func (export "linear")
    (param $x i32) (param $n i32) (param $w i32) (param $rows i32)
    (param $cols i32) (param $out i32)
    (local $t i32) (local $r i32) (local $c i32)
    (local $ostride i32) (local $o i32)
    ${locals}
    (local.set $ostride (i32.shl (local.get $rows) (i32.const 2)))
    (block $rdone (loop $rloop
      (br_if $rdone (i32.ge_u (local.get $r) (local.get $rows)))
      (local.set $w0 (i32.add (local.get $w) (i32.mul (local.get $r) (local.get $cols))))
      ${BLOCK.slice(1)
        .map(
          (j) =>
            `(local.set $w${j} (i32.add (local.get $w${j - 1}) (local.get $cols)))`
        )
        .join("\n      ")}
      (local.set $t (i32.const 0))
      (block $tdone (loop $tloop
        (br_if $tdone (i32.ge_u (local.get $t) (local.get $n)))
        (local.set $x0 (i32.add (local.get $x) (i32.mul (local.get $t) (local.get $cols))))
        ${BLOCK.slice(1)
          .map(
            (i) =>
              `(local.set $x${i} (i32.add (local.get $x${i - 1}) (local.get $cols)))`
          )
          .join("\n        ")}
        ${pairs.map(([i, j]) => `(local.set $a${i}${j} (v128.const i32x4 0 0 0 0))`).join("\n        ")}
        (local.set $c (i32.const 0))
        (block $cdone (loop $cloop
          (br_if $cdone (i32.ge_u (local.get $c) (local.get $cols)))
          ${BLOCK.map((i) => `(local.set $xv${i} (v128.load (i32.add (local.get $x${i}) (local.get $c))))`).join("\n          ")}
          ${BLOCK.map((j) => `(local.set $wv${j} (v128.load (i32.add (local.get $w${j}) (local.get $c))))`).join("\n          ")}
          ${pairs.map(([i, j]) => dotAdd(relaxed)(i, j)).join("\n          ")}
          (local.set $c (i32.add (local.get $c) (i32.const 16)))
          (br $cloop)))
        (local.set $o (i32.add (local.get $out) (i32.add (i32.mul (local.get $t) (local.get $ostride)) (i32.shl (local.get $r) (i32.const 2)))))
        ${BLOCK.map(
          (i) =>
            `${BLOCK.map((j) => `(i32.store offset=${j * 4} (local.get $o) ${isum(`$a${i}${j}`)})`).join("\n        ")}
        (local.set $o (i32.add (local.get $o) (local.get $ostride)))`
        ).join("\n        ")}
        (local.set $t (i32.add (local.get $t) (i32.const 4)))
        (br $tloop)))
      (local.set $r (i32.add (local.get $r) (i32.const 4)))
      (br $rloop))))`;

/**
 * quantize: each token of x (float32 [n, cols], cols a multiple of 16) is
 * mapped from [min, max] onto ±63 around its midpoint, written as int8
 * [n, cols], with (scale, midpoint) per token in meta (float32 [n, 2]).
 * dequantize: out[t, r] = (sum · scale_t + midpoint_t · rowSum_r) ·
 * weightScale_r + bias_r, for int32 sums [n, rows] (rows a multiple of 4).
 */
const CONVERSIONS = `  (func (export "quantize")
    (param $x i32) (param $n i32) (param $cols i32) (param $q i32) (param $meta i32)
    (local $t i32) (local $c i32) (local $row i32) (local $end i32) (local $out i32)
    (local $lo v128) (local $hi v128) (local $v v128) (local $mid v128) (local $inv v128)
    (local $min f32) (local $max f32) (local $half f32)
    (local $a v128) (local $b v128) (local $c2 v128) (local $d v128)
    (block $tdone (loop $tloop
      (br_if $tdone (i32.ge_u (local.get $t) (local.get $n)))
      (local.set $row (i32.add (local.get $x) (i32.shl (i32.mul (local.get $t) (local.get $cols)) (i32.const 2))))
      (local.set $end (i32.add (local.get $row) (i32.shl (local.get $cols) (i32.const 2))))
      (local.set $lo (v128.load (local.get $row)))
      (local.set $hi (local.get $lo))
      (local.set $c (local.get $row))
      (block $mdone (loop $mloop
        (br_if $mdone (i32.ge_u (local.get $c) (local.get $end)))
        (local.set $v (v128.load (local.get $c)))
        (local.set $lo (f32x4.min (local.get $lo) (local.get $v)))
        (local.set $hi (f32x4.max (local.get $hi) (local.get $v)))
        (local.set $c (i32.add (local.get $c) (i32.const 16)))
        (br $mloop)))
      (local.set $min (f32.min (f32.min (f32x4.extract_lane 0 (local.get $lo)) (f32x4.extract_lane 1 (local.get $lo))) (f32.min (f32x4.extract_lane 2 (local.get $lo)) (f32x4.extract_lane 3 (local.get $lo)))))
      (local.set $max (f32.max (f32.max (f32x4.extract_lane 0 (local.get $hi)) (f32x4.extract_lane 1 (local.get $hi))) (f32.max (f32x4.extract_lane 2 (local.get $hi)) (f32x4.extract_lane 3 (local.get $hi)))))
      (local.set $half (f32.mul (f32.sub (local.get $max) (local.get $min)) (f32.const 0.5)))
      (local.set $mid (f32x4.splat (f32.mul (f32.add (local.get $max) (local.get $min)) (f32.const 0.5))))
      (local.set $inv (f32x4.splat (select (f32.div (f32.const 63) (local.get $half)) (f32.const 0) (f32.gt (local.get $half) (f32.const 0)))))
      (f32.store (i32.add (local.get $meta) (i32.shl (local.get $t) (i32.const 3))) (f32.div (local.get $half) (f32.const 63)))
      (f32.store offset=4 (i32.add (local.get $meta) (i32.shl (local.get $t) (i32.const 3))) (f32x4.extract_lane 0 (local.get $mid)))
      (local.set $out (i32.add (local.get $q) (i32.mul (local.get $t) (local.get $cols))))
      (local.set $c (local.get $row))
      (block $qdone (loop $qloop
        (br_if $qdone (i32.ge_u (local.get $c) (local.get $end)))
        (local.set $a (i32x4.trunc_sat_f32x4_s (f32x4.nearest (f32x4.mul (f32x4.sub (v128.load (local.get $c)) (local.get $mid)) (local.get $inv)))))
        (local.set $b (i32x4.trunc_sat_f32x4_s (f32x4.nearest (f32x4.mul (f32x4.sub (v128.load offset=16 (local.get $c)) (local.get $mid)) (local.get $inv)))))
        (local.set $c2 (i32x4.trunc_sat_f32x4_s (f32x4.nearest (f32x4.mul (f32x4.sub (v128.load offset=32 (local.get $c)) (local.get $mid)) (local.get $inv)))))
        (local.set $d (i32x4.trunc_sat_f32x4_s (f32x4.nearest (f32x4.mul (f32x4.sub (v128.load offset=48 (local.get $c)) (local.get $mid)) (local.get $inv)))))
        (v128.store (local.get $out) (i8x16.narrow_i16x8_s (i16x8.narrow_i32x4_s (local.get $a) (local.get $b)) (i16x8.narrow_i32x4_s (local.get $c2) (local.get $d))))
        (local.set $out (i32.add (local.get $out) (i32.const 16)))
        (local.set $c (i32.add (local.get $c) (i32.const 64)))
        (br $qloop)))
      (local.set $t (i32.add (local.get $t) (i32.const 1)))
      (br $tloop))))
  (func (export "dequantize")
    (param $sums i32) (param $n i32) (param $rows i32) (param $meta i32)
    (param $scales i32) (param $rowSums i32) (param $bias i32) (param $out i32)
    (local $t i32) (local $r i32) (local $at i32) (local $scale v128) (local $mid v128)
    (block $tdone (loop $tloop
      (br_if $tdone (i32.ge_u (local.get $t) (local.get $n)))
      (local.set $scale (v128.load32_splat (i32.add (local.get $meta) (i32.shl (local.get $t) (i32.const 3)))))
      (local.set $mid (v128.load32_splat offset=4 (i32.add (local.get $meta) (i32.shl (local.get $t) (i32.const 3)))))
      (local.set $r (i32.const 0))
      (block $rdone (loop $rloop
        (br_if $rdone (i32.ge_u (local.get $r) (local.get $rows)))
        (local.set $at (i32.shl (i32.add (i32.mul (local.get $t) (local.get $rows)) (local.get $r)) (i32.const 2)))
        (v128.store (i32.add (local.get $out) (local.get $at))
          (f32x4.add
            (f32x4.mul
              (f32x4.add
                (f32x4.mul (f32x4.convert_i32x4_s (v128.load (i32.add (local.get $sums) (local.get $at)))) (local.get $scale))
                (f32x4.mul (local.get $mid) (v128.load (i32.add (local.get $rowSums) (i32.shl (local.get $r) (i32.const 2))))))
              (v128.load (i32.add (local.get $scales) (i32.shl (local.get $r) (i32.const 2)))))
            (v128.load (i32.add (local.get $bias) (i32.shl (local.get $r) (i32.const 2))))))
        (local.set $r (i32.add (local.get $r) (i32.const 4)))
        (br $rloop)))
      (local.set $t (i32.add (local.get $t) (i32.const 1)))
      (br $tloop))))`;

const f4 = (value: number) => `(f32x4.splat (f32.const ${value}))`;

/**
 * gelu: exact GELU, x·Φ(x), in place over `count` floats (a multiple of 4),
 * as network.ts geluExact: erf by Abramowitz and Stegun 7.1.26, exp as
 * 2^i · 2^f with a degree-5 polynomial for 2^f (relative error ~2e-7).
 */
const GELU = `  (func $exp (param $x v128) (result v128)
    (local $t v128) (local $i v128) (local $f v128)
    (local.set $t (f32x4.mul (f32x4.max (f32x4.min (local.get $x) ${f4(88)}) ${f4(-87)}) ${f4(Math.LOG2E)}))
    (local.set $i (f32x4.floor (local.get $t)))
    (local.set $f (f32x4.sub (local.get $t) (local.get $i)))
    (f32x4.mul
      (f32x4.add ${f4(1)} (f32x4.mul (local.get $f) (f32x4.add ${f4(Math.LN2)} (f32x4.mul (local.get $f) (f32x4.add ${f4(0.240_226_5)} (f32x4.mul (local.get $f) (f32x4.add ${f4(0.055_504_11)} (f32x4.mul (local.get $f) (f32x4.add ${f4(0.009_618_129)} (f32x4.mul (local.get $f) ${f4(0.001_333_355)}))))))))))
      (i32x4.shl (i32x4.add (i32x4.trunc_sat_f32x4_s (local.get $i)) (i32x4.splat (i32.const 127))) (i32.const 23))))
  (func (export "gelu") (param $at i32) (param $count i32)
    (local $end i32) (local $v v128) (local $z v128) (local $t v128) (local $erf v128)
    (local.set $end (i32.add (local.get $at) (i32.shl (local.get $count) (i32.const 2))))
    (block $done (loop $next
      (br_if $done (i32.ge_u (local.get $at) (local.get $end)))
      (local.set $v (v128.load (local.get $at)))
      (local.set $z (f32x4.mul (f32x4.abs (local.get $v)) ${f4(Math.SQRT1_2)}))
      (local.set $t (f32x4.div ${f4(1)} (f32x4.add ${f4(1)} (f32x4.mul ${f4(0.327_591_1)} (local.get $z)))))
      (local.set $erf (f32x4.sub ${f4(1)}
        (f32x4.mul
          (f32x4.mul (local.get $t) (f32x4.add ${f4(0.254_829_592)} (f32x4.mul (local.get $t) (f32x4.add ${f4(-0.284_496_736)} (f32x4.mul (local.get $t) (f32x4.add ${f4(1.421_413_741)} (f32x4.mul (local.get $t) (f32x4.add ${f4(-1.453_152_027)} (f32x4.mul (local.get $t) ${f4(1.061_405_429)})))))))))
          (call $exp (f32x4.neg (f32x4.mul (local.get $z) (local.get $z)))))))
      ;; erf takes the sign of v.
      (local.set $erf (v128.or (local.get $erf) (v128.and (local.get $v) (v128.const i32x4 0x80000000 0x80000000 0x80000000 0x80000000))))
      (v128.store (local.get $at) (f32x4.mul (f32x4.mul ${f4(0.5)} (local.get $v)) (f32x4.add ${f4(1)} (local.get $erf))))
      (local.set $at (i32.add (local.get $at) (i32.const 16)))
      (br $next))))`;

/**
 * attention: softmax(q·kᵀ · scale) · v for every head, from qkv (float32
 * [n, 3·dim]: queries, keys, values) to out (float32 [n, dim]). scores is
 * scratch for n + 4 floats. Head size must be a multiple of 16.
 */
const ATTENTION = `  (func (export "attention")
    (param $qkv i32) (param $n i32) (param $dim i32) (param $heads i32)
    (param $scale f32) (param $scores i32) (param $out i32)
    (local $h i32) (local $t i32) (local $j i32) (local $c i32) (local $size i32)
    (local $stride i32) (local $q i32) (local $k i32) (local $v i32) (local $o i32)
    (local $acc v128) (local $e v128) (local $max f32) (local $sum f32) (local $s f32)
    (local $a0 v128) (local $a1 v128) (local $a2 v128) (local $a3 v128)
    (local.set $size (i32.div_u (local.get $dim) (local.get $heads)))
    (local.set $stride (i32.mul (local.get $dim) (i32.const 12)))
    ;; Lanes past n score -1e30, so their exp is 0.
    (v128.store (i32.add (local.get $scores) (i32.shl (local.get $n) (i32.const 2))) ${f4(-1e30)})
    (block $hdone (loop $hloop
      (br_if $hdone (i32.ge_u (local.get $h) (local.get $heads)))
      (local.set $t (i32.const 0))
      (block $tdone (loop $tloop
        (br_if $tdone (i32.ge_u (local.get $t) (local.get $n)))
        (local.set $q (i32.add (local.get $qkv) (i32.add (i32.mul (local.get $t) (local.get $stride)) (i32.shl (i32.mul (local.get $h) (local.get $size)) (i32.const 2)))))
        (local.set $max (f32.const -1e30))
        (local.set $j (i32.const 0))
        (block $jdone (loop $jloop
          (br_if $jdone (i32.ge_u (local.get $j) (local.get $n)))
          (local.set $k (i32.add (local.get $qkv) (i32.add (i32.mul (local.get $j) (local.get $stride)) (i32.shl (i32.add (local.get $dim) (i32.mul (local.get $h) (local.get $size))) (i32.const 2)))))
          ${[0, 1, 2, 3].map((i) => `(local.set $a${i} (v128.const f32x4 0 0 0 0))`).join("\n          ")}
          (local.set $c (i32.const 0))
          (block $cdone (loop $cloop
            (br_if $cdone (i32.ge_u (local.get $c) (local.get $size)))
            ${[0, 1, 2, 3].map((i) => `(local.set $a${i} (f32x4.add (local.get $a${i}) (f32x4.mul (v128.load offset=${i * 16} (i32.add (local.get $q) (i32.shl (local.get $c) (i32.const 2)))) (v128.load offset=${i * 16} (i32.add (local.get $k) (i32.shl (local.get $c) (i32.const 2)))))))`).join("\n            ")}
            (local.set $c (i32.add (local.get $c) (i32.const 16)))
            (br $cloop)))
          (local.set $acc (f32x4.add (f32x4.add (local.get $a0) (local.get $a1)) (f32x4.add (local.get $a2) (local.get $a3))))
          (local.set $s (f32.mul (local.get $scale) (f32.add (f32.add (f32x4.extract_lane 0 (local.get $acc)) (f32x4.extract_lane 1 (local.get $acc))) (f32.add (f32x4.extract_lane 2 (local.get $acc)) (f32x4.extract_lane 3 (local.get $acc))))))
          (f32.store (i32.add (local.get $scores) (i32.shl (local.get $j) (i32.const 2))) (local.get $s))
          (local.set $max (f32.max (local.get $max) (local.get $s)))
          (local.set $j (i32.add (local.get $j) (i32.const 1)))
          (br $jloop)))
        (local.set $sum (f32.const 0))
        (local.set $j (i32.const 0))
        (block $edone (loop $eloop
          (br_if $edone (i32.ge_u (local.get $j) (local.get $n)))
          (local.set $e (call $exp (f32x4.sub (v128.load (i32.add (local.get $scores) (i32.shl (local.get $j) (i32.const 2)))) (f32x4.splat (local.get $max)))))
          (v128.store (i32.add (local.get $scores) (i32.shl (local.get $j) (i32.const 2))) (local.get $e))
          (local.set $sum (f32.add (local.get $sum) (f32.add (f32.add (f32x4.extract_lane 0 (local.get $e)) (f32x4.extract_lane 1 (local.get $e))) (f32.add (f32x4.extract_lane 2 (local.get $e)) (f32x4.extract_lane 3 (local.get $e))))))
          (local.set $j (i32.add (local.get $j) (i32.const 4)))
          (br $eloop)))
        ;; The -1e30 lanes were overwritten by the last group: restore them.
        (v128.store (i32.add (local.get $scores) (i32.shl (local.get $n) (i32.const 2))) ${f4(-1e30)})
        (local.set $o (i32.add (local.get $out) (i32.shl (i32.add (i32.mul (local.get $t) (local.get $dim)) (i32.mul (local.get $h) (local.get $size))) (i32.const 2))))
        (local.set $c (i32.const 0))
        (block $vdone (loop $vloop
          (br_if $vdone (i32.ge_u (local.get $c) (local.get $size)))
          ${[0, 1, 2, 3].map((i) => `(local.set $a${i} (v128.const f32x4 0 0 0 0))`).join("\n          ")}
          (local.set $v (i32.add (local.get $qkv) (i32.shl (i32.add (i32.shl (local.get $dim) (i32.const 1)) (i32.add (i32.mul (local.get $h) (local.get $size)) (local.get $c))) (i32.const 2))))
          (local.set $j (i32.const 0))
          (block $mdone (loop $mloop
            (br_if $mdone (i32.ge_u (local.get $j) (local.get $n)))
            (local.set $e (v128.load32_splat (i32.add (local.get $scores) (i32.shl (local.get $j) (i32.const 2)))))
            ${[0, 1, 2, 3].map((i) => `(local.set $a${i} (f32x4.add (local.get $a${i}) (f32x4.mul (local.get $e) (v128.load offset=${i * 16} (local.get $v)))))`).join("\n            ")}
            (local.set $v (i32.add (local.get $v) (local.get $stride)))
            (local.set $j (i32.add (local.get $j) (i32.const 1)))
            (br $mloop)))
          (local.set $e (f32x4.splat (f32.div (f32.const 1) (local.get $sum))))
          ${[0, 1, 2, 3].map((i) => `(v128.store offset=${i * 16} (i32.add (local.get $o) (i32.shl (local.get $c) (i32.const 2))) (f32x4.mul (local.get $a${i}) (local.get $e)))`).join("\n          ")}
          (local.set $c (i32.add (local.get $c) (i32.const 16)))
          (br $vloop)))
        (local.set $t (i32.add (local.get $t) (i32.const 1)))
        (br $tloop)))
      (local.set $h (i32.add (local.get $h) (i32.const 1)))
      (br $hloop))))`;

const sumLanes = (v: string) =>
  `(f32.add (f32.add (f32x4.extract_lane 0 ${v}) (f32x4.extract_lane 1 ${v})) (f32.add (f32x4.extract_lane 2 ${v}) (f32x4.extract_lane 3 ${v})))`;

/**
 * layer_norm: out = (x − mean) / √(variance + epsilon) · gain + bias for
 * each token of x (float32 [n, dim], dim a multiple of 4).
 */
const LAYER_NORM = `  (func (export "layer_norm")
    (param $x i32) (param $n i32) (param $dim i32) (param $gain i32)
    (param $bias i32) (param $epsilon f32) (param $out i32)
    (local $t i32) (local $c i32) (local $row i32) (local $o i32) (local $bytes i32)
    (local $acc v128) (local $d v128) (local $mean v128) (local $inv v128)
    (local.set $bytes (i32.shl (local.get $dim) (i32.const 2)))
    (block $tdone (loop $tloop
      (br_if $tdone (i32.ge_u (local.get $t) (local.get $n)))
      (local.set $row (i32.add (local.get $x) (i32.mul (local.get $t) (local.get $bytes))))
      (local.set $o (i32.add (local.get $out) (i32.mul (local.get $t) (local.get $bytes))))
      (local.set $acc (v128.const f32x4 0 0 0 0))
      (local.set $c (i32.const 0))
      (block $sdone (loop $sloop
        (br_if $sdone (i32.ge_u (local.get $c) (local.get $bytes)))
        (local.set $acc (f32x4.add (local.get $acc) (v128.load (i32.add (local.get $row) (local.get $c)))))
        (local.set $c (i32.add (local.get $c) (i32.const 16)))
        (br $sloop)))
      (local.set $mean (f32x4.splat (f32.div ${sumLanes("(local.get $acc)")} (f32.convert_i32_u (local.get $dim)))))
      (local.set $acc (v128.const f32x4 0 0 0 0))
      (local.set $c (i32.const 0))
      (block $vdone (loop $vloop
        (br_if $vdone (i32.ge_u (local.get $c) (local.get $bytes)))
        (local.set $d (f32x4.sub (v128.load (i32.add (local.get $row) (local.get $c))) (local.get $mean)))
        (local.set $acc (f32x4.add (local.get $acc) (f32x4.mul (local.get $d) (local.get $d))))
        (local.set $c (i32.add (local.get $c) (i32.const 16)))
        (br $vloop)))
      (local.set $inv (f32x4.splat (f32.div (f32.const 1) (f32.sqrt (f32.add (f32.div ${sumLanes("(local.get $acc)")} (f32.convert_i32_u (local.get $dim))) (local.get $epsilon))))))
      (local.set $c (i32.const 0))
      (block $ndone (loop $nloop
        (br_if $ndone (i32.ge_u (local.get $c) (local.get $bytes)))
        (v128.store (i32.add (local.get $o) (local.get $c))
          (f32x4.add
            (f32x4.mul (f32x4.mul (f32x4.sub (v128.load (i32.add (local.get $row) (local.get $c))) (local.get $mean)) (local.get $inv)) (v128.load (i32.add (local.get $gain) (local.get $c))))
            (v128.load (i32.add (local.get $bias) (local.get $c)))))
        (local.set $c (i32.add (local.get $c) (i32.const 16)))
        (br $nloop)))
      (local.set $t (i32.add (local.get $t) (i32.const 1)))
      (br $tloop))))`;

const kernel = (relaxed: boolean) => `(module
  (memory (export "memory") 1)
${linear(relaxed)}
${CONVERSIONS}
${GELU}
${ATTENTION}
${LAYER_NORM}
)
`;

const wabt = await (await import("wabt")).default();
function compile(relaxed: boolean) {
  const module = wabt.parseWat("kernel.wat", kernel(relaxed), {
    relaxed_simd: relaxed,
    simd: true,
  });
  module.validate();
  return Buffer.from(module.toBinary({}).buffer).toString("base64");
}
const plainKernel = compile(false);
const relaxedKernel = compile(true);
await writeFile(
  new URL("../src/model/kernel-wasm.ts", import.meta.url),
  `/** Generated by scripts/build-kernel.ts; do not edit. */
export const KERNEL_WASM =
  "${plainKernel}";
/** The same kernel with relaxed SIMD's int8 dot product. */
export const KERNEL_RELAXED_WASM =
  "${relaxedKernel}";
`
);
console.log(
  `kernels: ${plainKernel.length} / ${relaxedKernel.length} base64 chars`
);
