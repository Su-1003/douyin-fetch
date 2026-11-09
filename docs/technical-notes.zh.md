# 不用 yt-dlp 取抖音视频：做法说明（2026-11-10 实测）

> 一句话：抖音网页版的 `aweme/detail` 接口现在要一个 **`x-secsdk-web-signature`** 请求头，
> 它是 `md5(uifid_timestamp_SALT_encodedQuery)`。自己算出这个头，就能直接拿到 `play_addr` 下载，
> 不需要登录、不需要浏览器、不需要 yt-dlp，也不需要第三方解析站。
>
> 参考实现：[douyin-fetch.js](../tools/douyin-fetch.js)（120 行，零依赖，Node ≥ 20）

---

## 1. 先说结论：为什么会卡住

| 做法 | 结果 | 判定 |
|---|---|---|
| yt-dlp（stable / nightly 都试过）+ `--cookies-from-browser edge` | `Failed to decrypt with DPAPI` | Edge cookie 用 app-bound 加密，导不出 |
| yt-dlp + 手工导出的 38 条真 cookie（Playwright 抓的） | `Fresh cookies (not necessarily logged in) are needed` | **cookie 再多也没用** |
| 旧接口 `iesdouyin.com/web/api/v2/aweme/iteminfo/` | 带 cookie → `{"status_code":11110,"status_msg":"encrypt_data_miss"}`；不带 → 空体 | 已废弃 |
| 让真浏览器页面自己发请求（Playwright 拦响应） | 拿到完整 JSON | ✅ 但必须起浏览器 |
| **自己算签名，纯 HTTP 请求** | 200 + 完整 JSON | ✅ 就是本文的做法 |

关键判断：**报错说「需要新 cookie」是误导**。cookie 是足够的（ttwid、s_v_web_id 都有），
真正缺的是签名。所以「重新导出 cookie」「换浏览器」「等游客态刷新」全都不会好。

---

## 2. 接口与鉴权结构

```
GET https://www.douyin.com/aweme/v1/web/aweme/detail/
    ?aweme_id=<视频ID>
    &aid=6383
    &uifid=<设备指纹>
    &timestamp=<秒级时间戳>
    &x-secsdk-web-signature=<md5 签名>
Headers:
    User-Agent: <桌面浏览器 UA>
    Referer:    https://www.douyin.com/video/<视频ID>
    Cookie:     ttwid=...; passport_csrf_token=...
```

三个参数是被签名绑定的：**uifid、timestamp、query 串**。任何一个对不上，签名就废，
返回的不是 401 而是「cookie 不足」那类含糊错误（403 时可能带
`Blocked by ArgusSecurityPlugin Uifid Not Found`）。

### 签名配方

```js
const SALT = "A96D855A08C0A9707F8BEF0D9A527E4E";   // 会过期，见 §6
const ts   = String(Math.floor(Date.now() / 1000));
const query = { aweme_id, aid: 6383, uifid, timestamp: ts };
const enc  = new URLSearchParams(query).toString();          // 注意顺序：与请求串完全一致
const sig  = md5(`${uifid}_${ts}_${SALT}_${enc}`);           // 32 位小写 hex
```

**顺序敏感**：`URLSearchParams` 的插入顺序就是签名顺序，请求 URL 必须用同一份 `enc` 拼出来，
不能重新构造一遍 query。

### uifid 从哪来（有三级回退）

1. cookie 里的 `UIFID_TEMP`；
2. cookie 里的 `uifid`；
3. **首页响应头 `x-tt-trace-host`** ← 这条是踩过坑才加的，前两个经常都没有。

### ttwid 从哪来

1. 先 GET `https://www.douyin.com/`，从 `Set-Cookie` 里捡；
2. 没有就 POST 注册：

```js
POST https://www.douyin.com/ttwid/register
Content-Type: application/json
{ "aid": 6383, "service": "www.douyin.com" }
```

注册是**免登录**的，返回的 `Set-Cookie` 里就有 ttwid。

---

## 3. 落地步骤（可照抄的流程）

1. **解析 aweme_id**：短链 `v.douyin.com/xxxx` 直接 `fetch` 跟随重定向，
   从最终 URL 或正文里抓 `/video/(\d{15,})`；长链直接正则。
2. **建 cookie jar**：GET 首页 → 收 `Set-Cookie`（Node 19.7+ 用 `headers.getSetCookie()`；
   更老的版本手动按 `,(?=\s*[A-Za-z0-9_\-]+=)` 拆，否则 Expires 里的逗号会把 cookie 劈开）。
3. **补 ttwid**：缺就走上面的注册接口。
4. **算签名、发 detail 请求**，带 UA + Referer + cookie（`passport_csrf_token` 可以现造一个随机值）。
5. **挑码率档**：`aweme_detail.video.bit_rate[]`，每档有 `gear_name` / `bit_rate` / `play_addr.data_size` /
   `play_addr.url_list`。网页端最高给到 `normal_1080_0`（原片可能是 4K，但这里拿不到）。
6. **下载**：GET `play_addr.url_list[0]`，带 UA + `Referer: https://www.douyin.com/`。

---

## 4. 验收判据（别用「没报错」当成功）

```bash
node work/tools/douyin-fetch.js "https://v.douyin.com/Y2PgwIo7IR8/" --out work/logs/verify-douyin
# 期望：JSON 元数据 + OK 行
ffprobe -v error -show_entries format=duration -show_entries stream=codec_name,width,height,r_frame_rate \
        -of default=nw=1 work/logs/verify-douyin/douyin-7704290750053272872.mp4
```

本次实测：`15,385,766 B` / `1920×1080` / `30 fps` / `h264 + aac` / `40.066667 s`，
与 detail 里 `normal_1080_0` 的 `data_size = 15,385,766` **逐字节对上** —— 这才叫通。

---

## 5. 失败指纹 → 排查方向

| 现象 | 含义 | 怎么办 |
|---|---|---|
| `Fresh cookies (not necessarily logged in) are needed`（yt-dlp） | yt-dlp 没签名 | 别修 yt-dlp，换本脚本 |
| `403 Blocked by ArgusSecurityPlugin Uifid Not Found` | uifid 为空或没进签名 | 检查有没有三级回退（尤其响应头 `x-tt-trace-host`） |
| `detail 空。status=200 bytes=0` | 签名格式对但参数被拒 | 核对 `enc` 的字段顺序、timestamp 是否秒级、aid 是否 6383 |
| `status=11110 encrypt_data_miss` | 打到旧 iesdouyin 接口了 | 换 `www.douyin.com/aweme/v1/web/aweme/detail/` |
| `Failed to decrypt with DPAPI` | 浏览器 cookie 是 app-bound 加密 | 不要读浏览器 cookie 库，改成匿名 cookie（本脚本就是这么干的） |

---

## 6. 这套做法的边界

- **SALT 是活的**：`A96D855A08C0A9707F8BEF0D9A527E4E` 是 2026-11 的价值。
  抖音前端 JS 一换，签名就失效。失效表现通常是突然 403 / 空 detail，而参数看着都对。
  上游补丁 [yt-dlp PR #17826](https://github.com/yt-dlp/yt-dlp/pull/17826)（未合入）
  的实现可以直接拿来对；跟踪 [issue #9667](https://github.com/yt-dlp/yt-dlp/issues/9667)。
- **会随平台改版失效**，所以要写成脚本而不是手工步骤 —— 换 SALT 只需改一行。
- **只取自己有权处置的素材**：番剧正片等受版权保护的成片，不要用这个链路批量抓；
  拿来做节奏参考（切点、镜头时长、字幕位置）比拿来当素材安全得多。
- **频率**：这是网页端接口，高频连打会被风控；批量请加间隔。

---

## 7. 给其他 agent 的移植要点

- **零依赖**：只用 `fetch` + `crypto`（Node 20+ 都有）；别引入 axios/puppeteer，一旦引了就得装环境。
- **别写死 Windows 路径**：脚本里 `--out` 默认值可以给，但调用时显式传。
- **判据要机器可读**：成功时打一行 `OK: <path> (<bytes>)`，失败 `exit code` 区分
  （1 = 参数/解析失败，2 = detail 空，3 = 视频 HTTP 失败）。
- **入口要有三处，缺一处别人就用不上**：
  ①仓库/工作区 `AGENTS.md` 写命令；②全局 skill（`~/.dsh/skills/<name>/SKILL.md`）；
  ③PATH 上的命令（`~/.local/bin`）。前两处是「知道」，第三处才是「顺手」。
- **附上失败指纹表**（本文 §5）—— 别人的环境不会和你一样，报错才是通用语言。
