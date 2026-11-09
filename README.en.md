# douyin-fetch

**English** · [中文](README.md)

Fetch a single Douyin video's original file (mp4) and metadata — **zero dependencies**, using only
Node's built-in `fetch` and `crypto` (Node ≥ 20). No yt-dlp. No browser cookies. No third-party
parsing sites. No headless browser.

The point of the script is one thing yt-dlp gets wrong: Douyin's `aweme/detail` endpoint now requires an
`x-secsdk-web-signature` request header. Compute it yourself and you get the video; skip it and every
request fails with what looks like a cookie error.

```
sig = md5(uifid + "_" + timestamp + "_" + SALT + "_" + urlencode(query))
query = { aweme_id, aid: 6383, uifid, timestamp }   // order matters: it is the signing order
```

## Why yt-dlp cannot fetch Douyin

yt-dlp's `DouyinIE` calls that endpoint without the signature, so it always reports
`Fresh cookies (not necessarily logged in) are needed` — **the missing piece is the signature, not cookies.**
Measured: 38 real cookies exported by hand (including `ttwid` and `s_v_web_id`) still fail.

The upstream fix is yt-dlp PR [#17826](https://github.com/yt-dlp/yt-dlp/pull/17826) (still open as of 2026-11),
tracked in issue [#9667](https://github.com/yt-dlp/yt-dlp/issues/9667).

The legacy endpoint `https://www.iesdouyin.com/web/api/v2/aweme/iteminfo/` is dead: with cookies it returns
`{"status_code":11110,"status_msg":"encrypt_data_miss"}`, without cookies it returns an empty body.

## Usage

```bash
# metadata only (no download)
node douyin-fetch.js "https://v.douyin.com/xxxxxx/" --out ./media --dry

# download (default gear: normal_1080_0)
node douyin-fetch.js "https://v.douyin.com/xxxxxx/" --out ./media

# pick a specific bitrate gear (run --dry first to list gear names)
node douyin-fetch.js "https://www.douyin.com/video/<id>" --out ./media --gear normal_720_0
```

| Flag | Meaning |
|---|---|
| `<url>` | required; `v.douyin.com` short link or `www.douyin.com/video/<id>` |
| `--out <dir>` | output directory |
| `--dry` | metadata only, no download |
| `--gear <name>` | target bitrate gear, default `normal_1080_0`, falls back to the best available |

Output: `douyin-<aweme_id>.mp4` plus `douyin-<aweme_id>.json` (`meta` summary + full `detail`).

**Exit codes**: `0` success · `1` bad argument / short link could not be resolved ·
`2` empty `detail` (signature or parameters wrong) · `3` video download failed at HTTP level.

## Verify it actually worked

Do not treat "no error printed" as success. Check bytes and probe:

```bash
ffprobe -v error -show_entries format=duration \
        -show_entries stream=codec_name,width,height,r_frame_rate \
        -of default=nw=1 douyin-<aweme_id>.mp4
```

Criterion: **file size == `meta.bytes`**, and ffprobe's resolution/duration match `meta`.
Reference baseline (measured 2026-11-10): `15,385,766 B / 1920×1080 / 30 fps / h264 + aac / 40.066667 s`.

## What expires

`SALT` is a constant taken from Douyin's front-end bundle. Current value:
`A96D855A08C0A9707F8BEF0D9A527E4E` (line 13 of the script). When the front end ships a new build the
signature stops matching — the symptom is "parameters look right, but suddenly 403 or an empty detail".
Fix: check whether upstream PR #17826 / issue #9667 updated the constant, or grep the front-end JS for the
string next to `x-secsdk-web-signature`, then change that single line.

## For agents

`SKILL.md` is an agent skill description: when to use it, which command to run, exit-code semantics,
failure→action table, and the acceptance criterion. Drop it into an agent's skill directory and the agent
can claim this kind of task. The executable is always `douyin-fetch.js` from this repo.

## Failure fingerprints

| Symptom | Meaning | Action |
|---|---|---|
| `403 Blocked by ArgusSecurityPlugin Uifid Not Found` | `uifid` not obtained | check whether the `x-tt-trace-host` response header of the home page is readable |
| `detail empty, status=200 bytes=0` | signature parameters inconsistent | check `enc` field order, second-level `timestamp`, `aid=6383` |
| `status=11110 encrypt_data_miss` | hit the legacy iesdouyin endpoint | switch to `www.douyin.com/aweme/v1/web/aweme/detail/` |
| `Fresh cookies ... are needed` (yt-dlp) | missing signature, not missing cookies | use this script; do not patch yt-dlp |
| `Failed to decrypt with DPAPI` | Edge cookies are app-bound encrypted | do not read the browser cookie store |

## Limits

- The web endpoint caps at 1080p; a 4K source still comes back as 1080p.
- Built for **single** videos. Bulk scraping triggers risk control and runs into copyright issues; keep 1–3 s between calls.
- No paid or private works; do not redistribute copyrighted footage. Using clips as rhythm reference
  (cut points, shot lengths, subtitle placement) is the safe use.

## Docs

- [docs/technical-notes.zh.md](docs/technical-notes.zh.md) — full technical write-up, **Chinese only**
  (endpoint structure, signature derivation, implementation flow, failure fingerprints, porting notes)
- [docs/technical-notes.zh.docx](docs/technical-notes.zh.docx) — the same write-up as a typeset 5-page document
- `SKILL.md` — agent skill file

## License

MIT
