#!/usr/bin/env python3
"""把 Source Sans 3 的 latin 子集重切一遍：剔掉中文语境的弯引号 / 省略号码位。

为什么不用 CSS 的 `unicode-range`：`next/font/local` 的 `declarations` 在当前 Next 版本
（16.4 + Turbopack）下会把 `value` 字段丢掉，构建直接报 `missing field 'value'`。
直接从字体文件里去掉这几个码位，浏览器就会自然落到下一个中文字体（思源黑体）上。

代价：英文文本里的引号 / 省略号也会走中文字体，宽度略宽一点（权衡后的选择）。

用法（需要 fonttools + brotli）：
    python subset-latin.py <输入.woff2> <输出.woff2>
"""
import sys

from fontTools import subset

# 和 @fontsource 的 latin 子集同一套范围，只是去掉了 2018-201F（引号）与 2026（省略号）
RANGES = [
    (0x0000, 0x00FF), (0x0131, 0x0131), (0x0152, 0x0153), (0x02BB, 0x02BC),
    (0x02C6, 0x02C6), (0x02DA, 0x02DA), (0x02DC, 0x02DC), (0x0304, 0x0304),
    (0x0308, 0x0308), (0x0329, 0x0329),
    (0x2000, 0x2017), (0x2020, 0x2025), (0x2027, 0x206F),
    (0x20AC, 0x20AC), (0x2122, 0x2122), (0x2191, 0x2191), (0x2193, 0x2193),
    (0x2212, 0x2212), (0x2215, 0x2215), (0xFEFF, 0xFEFF), (0xFFFD, 0xFFFD),
]

CHECK = {0x2018: '‘', 0x2019: '’', 0x201C: '“', 0x201D: '”', 0x2026: '…'}


def main(src: str, dst: str) -> None:
    opts = subset.Options()
    opts.notdef_outline = True
    font = subset.load_font(src, opts)
    subsetter = subset.Subsetter(options=opts)
    subsetter.populate(unicodes=[c for a, b in RANGES for c in range(a, b + 1)])
    subsetter.subset(font)
    subset.save_font(font, dst, opts)

    cmap = subset.load_font(dst, opts).getBestCmap()
    state = ', '.join(f'{ch}{"还在" if cp in cmap else "已剔除"}' for cp, ch in CHECK.items())
    fail = [ch for cp, ch in CHECK.items() if cp in cmap]
    print(f'  {dst}: {state}')
    if fail:
        raise SystemExit(f'还有没剔干净的码位：{"".join(fail)}')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2])
