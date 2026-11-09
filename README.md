# douyin-fetch

**中文** · [English](README.en.md)

取单条抖音视频的原片（mp4）与元数据，**零依赖** —— 只用 Node 内置的 `fetch` 与 `crypto`（Node ≥ 20）。
不走 yt-dlp、不读浏览器 cookie、不用第三方解析站、不起浏览器。

> Fetch a single Douyin video (mp4 + metadata) with zero dependencies, using only Node's built-in
> `fetch` and `crypto`. It computes the `x-secsdk-web-signature` header itself, so it needs no cookies,
> no browser and no yt-dlp.

## 为什么 yt-dlp 取不了抖音

抖音网页版的 `aweme/detail` 接口现在要求一个 `x-secsdk-web-signature` 请求头：

```
sig = md5(uifid + "_" + timestamp + "_" + SALT + "_" + urlencode(query))
query = { aweme_id, aid: 6383, uifid, timestamp }   // 顺序即签名顺序
```

yt-dlp 的 `DouyinIE` 直接请求该接口、不带签名，所以永远报
`Fresh cookies (not necessarily logged in) are needed` —— **它缺的是签名，不是 cookie**。
实测：手工导出 38 条真实 cookie（含 `ttwid` / `s_v_web_id`）仍然失败。
上游修复见 yt-dlp PR [#17826](https://github.com/yt-dlp/yt-dlp/pull/17826)（2026-11 尚未合入），
跟踪 issue [#9667](https://github.com/yt-dlp/yt-dlp/issues/9667)。

旧接口 `https://www.iesdouyin.com/web/api/v2/aweme/iteminfo/` 已废：带 cookie 返回
`{"status_code":11110,"status_msg":"encrypt_data_miss"}`，不带 cookie 返回空体。

## 用法

```bash
# 只取元数据（不下载）
node douyin-fetch.js "https://v.douyin.com/xxxxxx/" --out ./media --dry

# 下载（默认档 normal_1080_0）
node douyin-fetch.js "https://v.douyin.com/xxxxxx/" --out ./media

# 指定码率档（先 --dry 看 gear 名）
node douyin-fetch.js "https://www.douyin.com/video/<id>" --out ./media --gear normal_720_0
```

| 参数 | 说明 |
|---|---|
| `<url>` | 必填，`v.douyin.com` 短链或 `www.douyin.com/video/<id>` 长链 |
| `--out <dir>` | 输出目录 |
| `--dry` | 只取元数据，不下载 |
| `--gear <name>` | 指定码率档，默认 `normal_1080_0`，不存在则退到最高档 |

产物：`douyin-<aweme_id>.mp4` 与 `douyin-<aweme_id>.json`（含 `meta` 与完整 `detail`）。

**exit code**：`0` 成功 · `1` 参数/短链解析失败 · `2` detail 返回空（签名或参数问题）· `3` 视频下载 HTTP 失败。

## 验收（别只看 exit 0）

```bash
ffprobe -v error -show_entries format=duration \
        -show_entries stream=codec_name,width,height,r_frame_rate \
        -of default=nw=1 douyin-<aweme_id>.mp4
```

判据：**文件字节数 == `meta.bytes`**，且 ffprobe 的分辨率/时长与 `meta` 一致。
参考基线（2026-11-10 实测）：`15,385,766 B / 1920×1080 / 30 fps / h264 + aac / 40.066667 s`。

## 会过期的地方

`SALT` 是抖音前端的常量，当前值 `A96D855A08C0A9707F8BEF0D9A527E4E`（见脚本第 13 行）。
抖音前端 JS 一换，签名就失效，表现为**参数看着都对、但突然 403 或 detail 为空**。
遇到时：先看上游 PR #17826 / issue #9667 是否更新了常量，或从前端 JS 里搜
`x-secsdk-web-signature` 附近的字符串，改那一行即可。

## 给 agent 用

`SKILL.md` 是一份 agent 技能说明（何时用、跑哪条命令、exit code 语义、失败→动作表、验收判据）。
把它放进 agent 的技能目录即可让别的 agent 认领这类任务；执行体始终是本仓库的 `douyin-fetch.js`。

## 失败指纹

| 现象 | 含义 | 动作 |
|---|---|---|
| `403 Blocked by ArgusSecurityPlugin Uifid Not Found` | uifid 没取到 | 检查能否读到首页响应头 `x-tt-trace-host` |
| `detail 空。status=200 bytes=0` | 签名参数不一致 | 核对 `enc` 字段顺序、`timestamp` 秒级、`aid=6383` |
| `status=11110 encrypt_data_miss` | 打到了旧 iesdouyin 接口 | 换 `www.douyin.com/aweme/v1/web/aweme/detail/` |
| `Fresh cookies ... are needed`（yt-dlp） | 缺签名，不是缺 cookie | 用本脚本，别修 yt-dlp |
| `Failed to decrypt with DPAPI` | Edge cookie 是 app-bound 加密 | 不要读浏览器 cookie 库 |

## 边界

- 网页端最高 1080p；作品源即使是 4K 也拿不到。
- 只适合**单条**取片。批量刷号会触发风控，也会踩版权；建议加 1–3 秒间隔。
- 不做付费/私密作品，不把番剧正片当素材二次分发。做节奏参考（切点、镜头时长、字幕位置）是安全用法。

## 文档

- `docs/technical-notes.zh.md` —— 完整技术说明（接口结构、签名推导、落地流程、失败指纹、移植要点）
- `docs/technical-notes.zh.docx` —— 同一份说明的排版版本，便于直接分发阅读
- `SKILL.md` —— 给 agent 的技能文件

## License

MIT
