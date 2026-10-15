# 字体（自托管）

**2026-10-09 起：整站统一黑体，三套字体全部自托管，不走 Google Fonts。**
字体文件不进 git（都是 SIL OFL 许可，可自由再分发，但体积大），用 `web/scripts/fetch-fonts.sh` 生成。

## 现在用的三套

| 用途 | 字体 | 字重 | 来源 / 版本 | 自托管位置 | 体积 |
| --- | --- | --- | --- | --- | --- |
| 拉丁（全站） | Source Sans 3 | 400 / 600 | `@fontsource/source-sans-3@5.3.0` 的 latin 子集，再剔掉引号 / 省略号 | `web/fonts/source-sans-3/`（由 next/font/local 打进 `/_next/static/media/`） | 36KB × 2 |
| 中文（全站） | Noto Sans SC 思源黑体 | 400 / 600 | `@fontsource/noto-sans-sc@5.3.0` | `web/public/fonts/noto-sans-sc/` + `noto-sans-sc.css` | 7.3MB（204 片，按需取） |
| 等宽（代码 / 时间 / 数字） | Sarasa Mono SC 等距更纱黑体 | 400 / 700 | 官方 `be5invis/Sarasa-Gothic` v1.0.42 的 `SarasaMonoSC-TTF`，用 `cn-font-split` 切块 | `web/public/fonts/sarasa-mono-sc/` + `sarasa-mono-sc.css` | 32MB（518 片，按需取） |

- 五个 token 的关系（`web/app/globals.css` 的 `@theme`）：`--font-ui` = `--font-read` = `--font-title` = `--font-sans`；
  `--font-sans` 的第一项是 `var(--font-latin)`（next/font/local 注入的字族，实际名字叫 `latin`）+ 它的度量对齐兜底 `latin Fallback`
  （`ascent-override:108.71% / descent-override:42.47% / size-adjust:94.19%`，Next 自动算的），后面才是 `Noto Sans SC`。
- 等宽栈里**不能**再放别的比例等宽字体（比如 JetBrains Mono）：放前面会抢走拉丁字符，中文的 2 倍宽对齐就坏了。
- `<html lang="zh-CN">` 必须留着，否则日文系统下汉字可能选到日文字形变体。
- **字体文件内部的字体名是 @fontsource 留下的旧字符串**（Noto Sans SC 的片子里写的是 "Noto Sans SC Thin"、
  Source Sans 3 的写着 "ExtraLight"），它们只影响开发者工具里的显示名，不影响渲染：
  `OS/2.usWeightClass` 是正确的 400 / 600 / 700，实际字重以 CSS 里的 `font-weight` 为准。
  另外 next/font/local 生成的字族名是 `latin` / `latin Fallback`（不是 "Source Sans 3"），也别被绕进去。

## 中文为什么要切块

中文字库整包是几 MB 到几十 MB，整包下载不可接受。做法是把字体按码位切成上百片，每片用
`unicode-range` 声明它管哪些字，浏览器**只下页面真正用到的片**：

- Noto Sans SC：101 片/字重（另有 1 片 1.1MB 的全量兜底，生僻字才会下）；单片中位 25KB。
- Sarasa Mono SC：258/260 片每个字重；最大一片 276KB（它把 Latin/Greek/Cyrillic/符号装在一片里），
  单片中位 54KB。
- 两份 CSS 在 nginx 上走 `text/css` gzip：Noto 189KB → 60KB，Sarasa 416KB → 142KB，都是首屏阻塞、
  之后一年 immutable 缓存。
- 首屏预加载（`web/app/layout.tsx` 的 `PRELOAD_FONTS`）：只放 Noto 的 118 / 119 两片（覆盖
  「是不了在人上大」「一有的中」，合计 64KB）。**重新生成字体后 hash / 编号会变，要同步这两个值**，
  `fetch-fonts.sh` 跑完会打印该填什么。

## 首屏下载量（实测，2026-10-09）

| 项目 | 实测 |
| --- | --- |
| 主界面第一次打开 | 字体文件 63 个、约 2.8MB（含 Sarasa 的 276KB 拉丁片 ×2 与一堆中文片；之后全部命中浏览器缓存） |
| 其中 Noto 中文片 | ~30 片 / ~0.9MB |
| 其中 Sarasa 片 | ~17 片 / ~1.9MB（正文里的代码块、工具行含中文时会把中文片也拉下来） |

嫌重的话有三条路（都改 `fetch-fonts.sh` 里的切块参数后重跑）：把切块粒度调大（少文件、单片更大）、
Sarasa 只留常用汉字（`--autoSubset`，生僻字回落 Noto，等宽对齐在生僻字上失效）、或者等宽改回系统字体。

## 引号 / 省略号

中文句子里 `“”‘’…` 要用思源黑体的宽度才正常。做法不是写 `unicode-range`（`next/font/local` 的
`declarations` 在当前 Next 版本里会丢 `value` 字段，构建直接报错），而是**在字体文件里把这几个码位剔掉**：
`fetch-fonts.sh` 里的 `subset-latin.py` 用 pyftsubset 重切 Source Sans 3，去掉 U+2018–201F 与 U+2026。
代价是英文文本里的引号 / 省略号也会走中文字体，略宽一点。

## nginx

- `location /fonts/`：一年 `immutable`（和 `/_next/static/` 一样，`private` 是因为整站有 cookie 门）。
  **换字体必须换文件名**，否则浏览器一年内不会重新取。
- `gzip_types`：站点级开了 gzip（nginx 默认只压 text/html，字体分片 CSS / JS / JSON 都得压上）。

## 重新生成

```bash
cd web
bash scripts/fetch-fonts.sh          # 约 15 分钟；依赖 curl / tar / 7z / node / python3
bash scripts/dev-restart.sh          # 构建 + 重启（缺字体时它会自动先跑 fetch-fonts.sh）
```

数据来源与许可：
- Source Sans 3 — SIL OFL 1.1（Adobe），`public/fonts/LICENSE-SourceSans3.txt`
- Noto Sans SC — SIL OFL 1.1（Google），`public/fonts/LICENSE-NotoSansSC.txt`
- Sarasa Mono SC — SIL OFL 1.1（Belleve Invis），https://github.com/be5invis/Sarasa-Gothic
