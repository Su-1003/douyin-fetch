---
name: douyin-fetch
description: "取单条抖音视频的原片（mp4）与元数据，纯 Node 零依赖，不走 yt-dlp、不读浏览器 cookie、不用第三方解析站。当用户给出 v.douyin.com 短链或 www.douyin.com/video/<id> 链接并要求「下载 / 取片 / 提取音频源 / 看看这条视频的规格」时使用；也用于判断「为什么 yt-dlp 取抖音失败」时给出正确结论。触发词：抖音链接、取抖音视频、下载抖音、v.douyin.com、aweme、Fresh cookies are needed、x-secsdk-web-signature。"
user-invocable: true
metadata:
  dsh:
    compatibility: native
    requires:
      - node >= 20 (fetch / crypto 内置)
      - ffmpeg (仅验收时需要)
---

# 抖音取片（纯 Node 签名）

## 何时用

- 用户给了一条抖音链接（短链或视频页），要**原片文件**或**元数据**（作者、时长、码率档、字节数）。
- 用户说「yt-dlp 取抖音失败 / 要 fresh cookies」，要一个能用的办法。
- 后续要做片、需要先拿到原始素材与真实时长/帧率。

不要用于：批量刷号、抓他人的付费/私密作品、把番剧正片当素材二次分发。

## 硬前提（先验证，别直接跑）

```powershell
node --version           # 需要 >= 20
Test-Path "work\tools\douyin-fetch.js"   # 相对工作区根目录（E:\Agent\DeepSeek Harness\ShuJ）
```

- **不需要** yt-dlp，**不需要**浏览器，**不需要**任何 npm 包。
- 需要能访问 `www.douyin.com`。若 CLI 不读系统代理（本机常见），先设 `$env:HTTPS_PROXY='http://127.0.0.1:7897'`，或确认网络本身可用。

## 执行

在工作区根目录：

```powershell
# 只取元数据（不下载）
node work\tools\douyin-fetch.js "<短链或视频页URL>" --out work\<片名>\media --dry

# 真正下载（默认档 normal_1080_0）
node work\tools\douyin-fetch.js "<短链或视频页URL>" --out work\<片名>\media

# 指定码率档（先 --dry 看 gear 名）
node work\tools\douyin-fetch.js "<URL>" --out <dir> --gear normal_720_0
```

参数：`<URL>`（必填，短链或长链）· `--out <dir>`（默认 `work\anime-mv\media`）· `--dry`（只取元数据）· `--gear <name>`（默认 `normal_1080_0`，不存在则退到最高档）。

**exit code 语义**：`0` 成功 · `1` 参数/短链解析失败 · `2` detail 返回空（签名或参数问题）· `3` 视频 HTTP 下载失败。

## 产物

| 文件 | 内容 |
|---|---|
| `<out>\douyin-<aweme_id>.mp4` | 原片（网页端最高 1080p；作品源即使 4K 也拿不到） |
| `<out>\douyin-<aweme_id>.json` | `meta`（aweme_id / desc / author / duration_s / gear / bit_rate / bytes / music）+ 完整 `detail` |

## 验收（必做，别只看 exit 0）

```powershell
$f = Get-Item "<out>\douyin-<aweme_id>.mp4"
$f.Length                                   # 应 == 脚本输出 JSON 里的 bytes
ffprobe -v error -show_entries format=duration `
        -show_entries stream=codec_name,width,height,r_frame_rate `
        -of default=nw=1 $f.FullName
```

判据：**文件字节数 == `meta.bytes`**，且 `ffprobe` 的分辨率/时长与 `meta` 一致。
2026-11-10 基线：`15,385,766 B / 1920×1080 / 30 fps / h264 + aac / 40.066667 s`。

## 失败 → 动作（照表走，不要乱试）

| 现象 | 含义 | 动作 |
|---|---|---|
| `403 Blocked by ArgusSecurityPlugin Uifid Not Found` | uifid 没取到 | 检查能否读到首页响应头 `x-tt-trace-host`；必要时先 GET `https://www.douyin.com/` 拿头 |
| `FAIL: detail 空。status=200 bytes=0` | 签名参数不一致 | 核对 `enc` 字段顺序、`timestamp` 是否秒级、`aid` 是否 6383 |
| `status=11110 encrypt_data_miss` | 打到了旧 iesdouyin 接口 | 换 `www.douyin.com/aweme/v1/web/aweme/detail/` |
| 脚本报 `无法从链接解析 aweme_id` | 短链跳转被拦或不是视频页 | 让用户给 `www.douyin.com/video/<id>` 长链 |
| 一直 `Fresh cookies (not necessarily logged in) are needed`（yt-dlp） | **不要去修 yt-dlp** | 用本脚本；根因是缺签名，不是缺 cookie |
| `Failed to decrypt with DPAPI`（读浏览器 cookie） | Edge 的 app-bound 加密 | 不要读浏览器 cookie 库，本脚本用匿名 cookie |

## 签名失效时（SALT 会过期）

签名公式：`sig = md5(uifid + "_" + ts + "_" + SALT + "_" + urlencode(query))`，
`SALT = "A96D855A08C0A9707F8BEF0D9A527E4E"`（2026-11 的值），`aid = 6383`，
`query = {aweme_id, aid, uifid, timestamp}`（顺序即签名顺序）。

失效时的表现：参数看着都对，但突然 403 或 detail 为空。处理顺序：

1. 先看 yt-dlp PR #17826 / issue #9667 是否已更新 SALT；
2. 或从抖音前端 JS 里搜 `x-secsdk-web-signature` 附近的常量；
3. 改 `work\tools\douyin-fetch.js` 第 13 行 `SALT` 一个值即可，其余不动。

## 不要做

- 不要为了取抖音去装 puppeteer / playwright（脚本本来就是零依赖，装了等于把可移植性丢掉）。
- 不要把 yt-dlp 的 cookie 报错误读成「cookie 不够」——它是签名缺失的表象。
- 不要高频连打（网页端接口会风控）；批量请加 1–3 秒间隔。
- 不要把这条链路用于批量抓受版权保护的成片；做节奏参考（切点、时长、字幕位置）是安全的用法。
