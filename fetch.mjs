// Refresh live.m3u for GitHub Pages — run by .github/workflows/refresh.yml
// (workflow_dispatch only; an external 5-minute trigger dispatches it).
// Same upstream protocol as wudaliansai-live (AES-128-CBC KGQ API,
// reverse-engineered 2026-11-14), filtered to basketball, plus a static
// section of sports TV channels that air NBA games in China.
// The playlist carries DIRECT stream URLs (line_list[0].url) because
// GitHub Pages cannot do dynamic redirects. Stream URLs are time-limited,
// so the playlist must be refreshed often.

import { writeFileSync } from "node:fs";

const CONFIG_URL =
  "https://pool-sg.oss-ap-southeast-1.aliyuncs.com/kgq/kgqapi-android.json";
const FALLBACK_URL =
  "https://cdn.jsdelivr.net/gh/jkwu5472/first/media.m3u8";
const NOTICE_LOGO =
  "https://cdn.jsdelivr.net/gh/jkwu5472/first/notice.jpg";

const FALLBACK_DOMAINS = [
  "https://api.08zbidl.com",
  "https://api.46d5umpk.com",
  "https://api.5h5hbfhh.com",
  "https://api.8kxv29.com",
  "https://api.bmjb2mk7.com",
  "https://api.cjxxpgkq.com",
  "https://api.il8phx6.com",
  "https://api.lav5041.com",
  "https://api.qchyzkww.com",
  "https://api.rqqakqyn.com",
  "https://api.tezpgdzn.com",
  "https://api.tkfupxqu.com",
  "https://api.txxhuc.com",
  "https://api.zejzeu7p.com",
];

const KEY_STR = "KANGEQIU@8868!~.";
const IV_STR = "0200010900030207";

// Static sports channels that broadcast NBA in China. Sources: public
// M3U lists (fanmingming/live itv.m3u, iptv-org). These endpoints answer,
// but their CDNs reject datacenter IPs, so playback could NOT be verified
// from the build environment — they are expected to work on home broadband.
const CHANNELS = [
  {
    name: "五星体育",
    logo: "https://live.fanmingming.com/tv/五星体育.png",
    url: "http://gslbserv.itv.cmvideo.cn/5000000010000017540/1.m3u8?channel-id=bestzb&Contentid=5000000010000017540&livemode=1&stbId=3",
  },
  {
    name: "劲爆体育",
    logo: "https://live.fanmingming.com/tv/劲爆体育.png",
    url: "http://gslbserv.itv.cmvideo.cn/5000000002000029972/1.m3u8?channel-id=bestzb&Contentid=5000000002000029972&livemode=1&stbId=3",
  },
  {
    name: "NewTV精品体育",
    logo: "https://live.fanmingming.com/tv/NEWTV精品体育.png",
    url: "http://gslbserv.itv.cmvideo.cn/1000000004000014634/1.m3u8?channel-id=ystenlive&Contentid=1000000004000014634&livemode=1&stbId=3",
  },
  {
    name: "NewTV超级体育",
    logo: "https://live.fanmingming.com/tv/NEWTV超级体育.png",
    url: "http://gslbserv.itv.cmvideo.cn/1000000001000009601/1.m3u8?channel-id=ystenlive&Contentid=1000000001000009601&livemode=1&stbId=3",
  },
  {
    name: "iHOT爱体育",
    logo: "https://live.fanmingming.com/tv/IHOT爱体育.png",
    url: "http://gslbserv.itv.cmvideo.cn/6000000006000290630/1.m3u8?channel-id=wasusyt&Contentid=6000000006000290630&livemode=1&stbId=3",
  },
  {
    name: "CCTV-5+ 体育赛事",
    logo: "https://i.imgur.com/OK8mdJV.png",
    url: "https://php.jdshipin.com/TVOD/iptv.php?id=cctv5p",
  },
];

const te = new TextEncoder();
const td = new TextDecoder();

let _cryptoKey = null;
async function getKey() {
  if (!_cryptoKey) {
    _cryptoKey = await crypto.subtle.importKey(
      "raw",
      te.encode(KEY_STR),
      { name: "AES-CBC" },
      false,
      ["encrypt", "decrypt"],
    );
  }
  return _cryptoKey;
}

function b64encode(bytes) {
  let bin = "";
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin);
}

function b64decode(b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr.buffer;
}

async function aesEncryptB64(plaintext) {
  const key = await getKey();
  const ct = await crypto.subtle.encrypt(
    { name: "AES-CBC", iv: te.encode(IV_STR) },
    key,
    te.encode(plaintext),
  );
  return b64encode(ct);
}

async function aesDecryptB64(b64) {
  const key = await getKey();
  const pt = await crypto.subtle.decrypt(
    { name: "AES-CBC", iv: te.encode(IV_STR) },
    key,
    b64decode(b64),
  );
  return td.decode(pt);
}

async function encQuery(plaintext) {
  const parameter = encodeURIComponent(await aesEncryptB64(plaintext));
  const key = encodeURIComponent(await aesEncryptB64("key"));
  return `parameter=${parameter}&key=${key}`;
}

async function apiCall(host, path, plaintext = "") {
  const url = `${host}${path}?${await encQuery(plaintext)}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) return null;
  const json = await res.json();
  if (json.code !== 200 || typeof json.data !== "string") return null;
  try {
    return JSON.parse(await aesDecryptB64(json.data));
  } catch {
    return null;
  }
}

async function getCandidateDomains() {
  try {
    const res = await fetch(CONFIG_URL);
    if (res.ok) {
      const json = await res.json();
      if (json?.code === 200 && typeof json.data === "string") {
        const list = JSON.parse(await aesDecryptB64(json.data));
        const hosts = (Array.isArray(list) ? list : [])
          .map((h) => h.host)
          .filter((h) => typeof h === "string" && h.startsWith("https://"));
        if (hosts.length) return hosts;
      }
    }
  } catch {
    // fall through
  }
  return FALLBACK_DOMAINS;
}

async function healthCheck(domain) {
  const list = await apiCall(domain, "/gz/initialize/getApiUrlList", "");
  return Array.isArray(list) ? list : null;
}

async function pickHealthyDomain() {
  const candidates = await getCandidateDomains();
  const tried = new Set();
  const queue = [...candidates];
  for (const d of FALLBACK_DOMAINS) if (!queue.includes(d)) queue.push(d);
  for (const domain of queue) {
    if (tried.has(domain)) continue;
    tried.add(domain);
    try {
      const list = await healthCheck(domain);
      if (list) return domain;
    } catch {
      // try next
    }
  }
  return null;
}

async function fetchLiveList(domain) {
  const list = await apiCall(domain, "/gz/live/sports", "");
  return Array.isArray(list) ? list : [];
}

function statusSuffix(m) {
  if (m.m_status === 1) {
    return m.line_name || m.line_list?.[0]?.name || "直播中";
  }
  if (m.m_status === 2) return m.match_status_info || "完场";
  return "未开赛";
}

function matchName(m) {
  const home = m.home?.name || "";
  const away = m.visiting?.name || "";
  return `${home} vs ${away}`.trim();
}

function groupFor(m) {
  const league = (m.event_name || "").toUpperCase();
  if (league.includes("NBA")) return "NBA";
  return "篮球";
}

function buildM3U(items) {
  const lines = [
    "#EXTM3U",
    `#EXTINF:-1 tvg-name="注意事项" tvg-logo="${NOTICE_LOGO}" group-title="注意事项",注意事项`,
    FALLBACK_URL,
  ];
  for (const m of items) {
    const name = matchName(m);
    const status = statusSuffix(m);
    const logo = m.home?.logo || "";
    lines.push(
      `#EXTINF:-1 tvg-name="${name}|${status}" tvg-logo="${logo}" group-title="${groupFor(m)}",${name}|${status}`,
    );
    // Direct stream URL for live matches; fallback media otherwise.
    const url =
      m.m_status === 1 && m.line_list?.[0]?.url
        ? m.line_list[0].url
        : FALLBACK_URL;
    lines.push(url);
  }
  for (const c of CHANNELS) {
    lines.push(
      `#EXTINF:-1 tvg-name="${c.name}" tvg-logo="${c.logo}" group-title="体育频道",${c.name}`,
    );
    lines.push(c.url);
  }
  return lines.join("\n") + "\n";
}

const domain = await pickHealthyDomain();
if (!domain) {
  console.error("no healthy upstream domain, keeping old live.m3u");
  process.exit(1);
}
const all = await fetchLiveList(domain);
const items = all.filter((m) => m.ball_type === 2);
writeFileSync("live.m3u", buildM3U(items));
const live = items.filter((m) => m.m_status === 1).length;
const nba = items.filter((m) => (m.event_name || "").toUpperCase().includes("NBA")).length;
console.log(
  `wrote live.m3u: ${items.length} basketball matches (${nba} NBA), ${live} live, domain ${domain}`,
);
