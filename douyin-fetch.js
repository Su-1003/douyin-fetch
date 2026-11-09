#!/usr/bin/env node
// douyin-fetch.js — 纯 Node 取抖音视频（不需要浏览器、不需要 yt-dlp）
// 签名配方来自 yt-dlp PR #17826（x-secsdk-web-signature = md5(uifid_ts_SALT_query)），已实测可用。
//
// 用法:
//   node douyin-fetch.js <短链或视频页URL> [--out <dir>] [--dry] [--gear normal_1080_0]
// 产物:
//   <out>/douyin-<aweme_id>.mp4  与  <out>/douyin-<aweme_id>.json
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SALT = 'A96D855A08C0A9707F8BEF0D9A527E4E';
const AID = 6383;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0';

function parseArgs(argv) {
  const a = { out: path.resolve(__dirname, '..', 'anime-mv', 'media'), dry: false, gear: 'normal_1080_0', url: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--out') a.out = path.resolve(argv[++i]);
    else if (argv[i] === '--dry') a.dry = true;
    else if (argv[i] === '--gear') a.gear = argv[++i];
    else if (!a.url) a.url = argv[i];
  }
  return a;
}

function jarFrom(res) {
  // Node >= 19.7 有 getSetCookie；更老的 Node 退化成手动拆（逗号后面紧跟 name= 才算分隔）
  let raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  if (!raw.length) {
    const sc = res.headers.get('set-cookie');
    if (sc) raw = sc.split(/,(?=\s*[A-Za-z0-9_\-]+=)/);
  }
  const jar = {};
  for (const c of raw) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    if (i > 0) jar[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
  return jar;
}

async function resolveAwemeId(url) {
  const m = url.match(/\/video\/(\d+)/);
  if (m) return m[1];
  const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  const m2 = r.url.match(/\/video\/(\d+)/) || (await r.text()).match(/\/video\/(\d{15,})/);
  if (!m2) throw new Error('无法从链接解析 aweme_id: ' + r.url);
  return m2[1];
}

(async () => {
  const args = parseArgs(process.argv);
  if (!args.url) { console.error('usage: node douyin-fetch.js <url> [--out dir] [--dry] [--gear normal_1080_0]'); process.exit(1); }
  fs.mkdirSync(args.out, { recursive: true });

  const awemeId = await resolveAwemeId(args.url);
  const home = await fetch('https://www.douyin.com/', { headers: { 'User-Agent': UA } });
  const jar = jarFrom(home);
  const traceHost = home.headers.get('x-tt-trace-host') || '';
  if (!jar.ttwid) {
    Object.assign(jar, jarFrom(await fetch('https://www.douyin.com/ttwid/register', {
      method: 'POST',
      headers: { 'User-Agent': UA, 'content-type': 'application/json' },
      body: JSON.stringify({ aid: AID, service: 'www.douyin.com' }),
    })));
  }
  const uifid = jar.UIFID_TEMP || jar.uifid || traceHost;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const query = { aweme_id: awemeId, aid: AID, uifid, timestamp };
  const enc = new URLSearchParams(query).toString();
  const sig = crypto.createHash('md5').update(`${uifid}_${timestamp}_${SALT}_${enc}`).digest('hex');
  const detailUrl = `https://www.douyin.com/aweme/v1/web/aweme/detail/?${enc}&x-secsdk-web-signature=${sig}`;

  const res = await fetch(detailUrl, {
    headers: {
      'User-Agent': UA,
      'Referer': `https://www.douyin.com/video/${awemeId}`,
      'Cookie': `passport_csrf_token=${crypto.randomBytes(16).toString('hex')}; ` +
        Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '),
      'Accept': 'application/json',
    },
  });
  const text = await res.text();
  let j = null;
  try { j = JSON.parse(text); } catch (_) { }
  if (!j || !j.aweme_detail) {
    console.error('FAIL: detail 空。status=' + res.status + ' bytes=' + text.length);
    console.error('head: ' + text.slice(0, 200).replace(/\s+/g, ' '));
    process.exit(2);
  }

  const d = j.aweme_detail;
  const bl = (d.video.bit_rate || []).slice().sort((a, b) => b.bit_rate - a.bit_rate);
  const best = bl.find(b => b.gear_name === args.gear) || bl[0];
  const meta = {
    aweme_id: d.aweme_id,
    desc: d.desc,
    author: d.author && d.author.nickname,
    duration_s: d.video.duration / 1000,
    gear: best.gear_name,
    bit_rate: best.bit_rate,
    bytes: best.play_addr.data_size,
    music: d.music && d.music.title,
  };
  console.log(JSON.stringify(meta, null, 2));

  const base = path.join(args.out, 'douyin-' + d.aweme_id);
  fs.writeFileSync(base + '.json', JSON.stringify({ meta, detail: d }, null, 2), 'utf8');
  if (args.dry) { console.log('DRY: 不下载。元数据 -> ' + base + '.json'); return; }

  const vr = await fetch(best.play_addr.url_list[0], {
    headers: { 'User-Agent': UA, 'Referer': 'https://www.douyin.com/', 'Accept': '*/*' },
  });
  if (!vr.ok) { console.error('FAIL: 视频 HTTP ' + vr.status); process.exit(3); }
  const buf = Buffer.from(await vr.arrayBuffer());
  fs.writeFileSync(base + '.mp4', buf);
  console.log('OK: ' + base + '.mp4 (' + buf.length + ' bytes)');
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
