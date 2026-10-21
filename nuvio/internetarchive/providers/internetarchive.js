// Internet Archive (archive.org) — public-domain / openly licensed films and classic TV.
// Nuvio provider. Promise chains only (no async/await) for QuickJS/Hermes.
var UA = "Mozilla/5.0 (Linux; Android 14) RawaqArchive/1.0";
var COLLECTIONS = ["feature_films", "classic_tv", "silent_films", "film_noir", "sci-fi_horror",
  "comedy_films", "classic_cartoons", "moviesandfilms", "cinemocracy", "Film_Noir",
  "opensource_movies", "community"];

var CURATED = COLLECTIONS.filter(function (c) { return c !== "opensource_movies" && c !== "community"; });
var MIN_AGE = 20; // community uploads accepted only for titles at least 20 years old
var PIRATE = /egy ?dead|mycima|cima4u|akwam|arabseed|shahid4u|faselhd|egybest|wecima|yts|yify|rarbg|psa|pahe|tamilblasters|web[ ._-]?dl|webrip|bluray|brrip|hdcam|x26[45]|hevc/i;

function j(url) {
  return fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json,application/sparql-results+json" } })
    .then(function (r) { return r.json(); });
}

function wikidata(tmdbId, mediaType) {
  var prop = mediaType === "tv" ? "P4983" : "P4947";
  var q = 'SELECT ?label ?ar ?date ?ia WHERE { ?item wdt:' + prop + ' "' + tmdbId + '" . ' +
    'OPTIONAL{?item wdt:P724 ?ia} OPTIONAL{?item wdt:P577 ?date} ' +
    'OPTIONAL{?item rdfs:label ?label FILTER(lang(?label)="en")} ' +
    'OPTIONAL{?item rdfs:label ?ar FILTER(lang(?ar)="ar")} } LIMIT 20';
  return j("https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(q))
    .then(function (d) {
      var info = { title: null, ar: null, year: null, ia: [] };
      (d.results.bindings || []).forEach(function (b) {
        if (!info.title && b.label) info.title = b.label.value;
        if (!info.ar && b.ar) info.ar = b.ar.value;
        if (b.date) { var m = /(\d{4})/.exec(b.date.value); if (m && (!info.year || +m[1] < info.year)) info.year = +m[1]; }
        if (b.ia && info.ia.indexOf(b.ia.value) < 0) info.ia.push(b.ia.value);
      });
      return info;
    })
    .catch(function () { return { title: null, ar: null, year: null, ia: [] }; });
}

function norm(s) { return String(s || "").toLowerCase().replace(/\(.*?\)/g, " ").replace(/[^a-z0-9\u0600-\u06ff]+/g, " ").trim(); }

function titleOk(docTitle, info) {
  var n = norm(docTitle).replace(/\b(19|20)\d{2}\b/g, " ").replace(/\s+/g, " ").trim();
  return [info.title, info.ar].some(function (t) {
    if (!t) return false;
    var w = norm(t);
    if (!w) return false;
    if (n === w) return true;
    // allow small extras like "full movie", "فيلم", "hd", "1080p"
    var rest = n.replace(w, " ").replace(/\b(full|movie|film|hd|sd|\d{3,4}p|eng|english|arabic|subs?|فيلم|كامل|مسلسل|الحلقة|حلقة)\b/g, " ").trim();
    return n.indexOf(w) >= 0 && rest.replace(/[\d\s]/g, "").length <= 6;
  });
}

function search(info, mediaType) {
  var titles = [info.title, info.ar].filter(Boolean).map(function (t) { return 'title:("' + t.replace(/["\\]/g, " ") + '")'; });
  if (!titles.length) return Promise.resolve([]);
  var q = '(' + titles.join(" OR ") + ') AND mediatype:movies AND collection:(' + COLLECTIONS.join(" OR ") + ')';
  var url = "https://archive.org/advancedsearch.php?q=" + encodeURIComponent(q) +
    "&fl[]=identifier&fl[]=title&fl[]=year&fl[]=collection&fl[]=downloads&sort[]=downloads+desc&rows=" + (mediaType === "tv" ? 40 : 15) + "&output=json";
  return j(url).then(function (d) {
    return (d.response && d.response.docs || []).filter(function (doc) {
      var t = Array.isArray(doc.title) ? doc.title[0] : doc.title;
      if (!titleOk(t, info)) return false;
      var cols = [].concat(doc.collection || []);
      var curated = cols.some(function (c) { return CURATED.indexOf(c) >= 0; });
      if (!curated) {
        // community uploads: only old titles, never rips tagged by pirate sites / release groups
        if (PIRATE.test(t) || PIRATE.test(doc.identifier)) return false;
        if (!info.year || info.year > new Date().getFullYear() - MIN_AGE) return false;
      }
      if (mediaType !== "tv" && info.year && doc.year && Math.abs(parseInt(doc.year, 10) - info.year) > 1) return false;
      var ty = /\b(19|20)\d{2}\b/.exec(t || "");
      if (mediaType !== "tv" && info.year && ty && Math.abs(+ty[0] - info.year) > 1) return false;
      return true;
    }).sort(function (a, b) {
      if (mediaType !== "tv") return 0;
      var at = episodeMatch(a.title, info.season, info.episode) ? 1 : 0, bt = episodeMatch(b.title, info.season, info.episode) ? 1 : 0;
      return bt - at;
    }).slice(0, 4).map(function (doc) { return doc.identifier; });
  }).catch(function () { return []; });
}

function pad(n) { return (n < 10 ? "0" : "") + n; }

function episodeMatch(name, season, episode) {
  var s = String(name).toLowerCase();
  var res = [
    new RegExp("s0?" + season + "[ ._-]*e0?" + episode + "(?!\\d)"),
    new RegExp("(?:^|\\D)" + season + "x" + pad(episode) + "(?!\\d)"),
    new RegExp("(?:episode|ep)[ ._-]*0?" + episode + "(?!\\d)"),
    new RegExp("(?:\u0627\u0644\u062d\u0644\u0642\u0629|\u062d\u0644\u0642\u0629|\u062d)[ ._-]*0?" + episode + "(?!\\d)")
  ];
  return res.some(function (r) { return r.test(s); });
}

function quality(f) {
  var h = parseInt(f.height || 0, 10);
  if (h >= 2000) return "4K"; if (h >= 1000) return "1080p"; if (h >= 700) return "720p";
  if (h >= 470) return "480p"; if (h > 0) return h + "p";
  if (/512kb/i.test(f.name)) return "360p";
  return "SD";
}

function size(b) {
  b = +b || 0; if (!b) return undefined;
  return b > 1073741824 ? (b / 1073741824).toFixed(2) + " GB" : Math.round(b / 1048576) + " MB";
}

function files(id, mediaType, season, episode, info) {
  return j("https://archive.org/metadata/" + encodeURIComponent(id)).then(function (m) {
    if (!m || !m.files || m.is_dark) return [];
    var title = (m.metadata && m.metadata.title) || id;
    var vids = m.files.filter(function (f) {
      return /\.(mp4|m4v|mkv|webm|ogv)$/i.test(f.name) && f.source !== "metadata";
    });
    if (/trailer|teaser|promo/i.test(title)) return [];
    if (info && !titleOk(title, info)) return [];
    if (PIRATE.test(title) || PIRATE.test(id)) return [];
    var minLen = mediaType === "tv" ? 600 : 2400, minSize = mediaType === "tv" ? 30e6 : 120e6;
    vids = vids.filter(function (f) {
      if (/trailer|teaser|sample|promo/i.test(f.name) || PIRATE.test(f.name)) return false;
      var len = parseFloat(f.length || 0);
      if (len > 0) return len >= minLen;
      return (+f.size || 0) >= minSize;
    });
    if (mediaType === "tv" && !episodeMatch(title, season, episode))
      vids = vids.filter(function (f) { return episodeMatch(f.name, season, episode); });
    var partRe = /(\d+\s*of\s*\d+|part[ ._-]?\d+|cd[ ._-]?\d)/i;
    var whole = vids.filter(function (f) { return !partRe.test(f.name); });
    if (whole.length) vids = whole;
    // prefer mp4 first, then bigger files
    vids.sort(function (a, b) {
      var am = /\.mp4$/i.test(a.name) ? 1 : 0, bm = /\.mp4$/i.test(b.name) ? 1 : 0;
      return (bm - am) || ((+b.size || 0) - (+a.size || 0));
    });
    return vids.slice(0, 3).map(function (f) {
      return {
        name: "Internet Archive",
        title: title + "\n" + f.name,
        url: "https://archive.org/download/" + encodeURIComponent(id) + "/" + f.name.split("/").map(encodeURIComponent).join("/"),
        quality: quality(f),
        size: size(f.size),
        headers: { "User-Agent": UA }
      };
    });
  }).catch(function () { return []; });
}

function collect(ids, mediaType, season, episode, info) {
  ids = ids.filter(function (v, i, a) { return a.indexOf(v) === i; }).slice(0, 4);
  return Promise.all(ids.map(function (id) { return files(id, mediaType, season, episode, info); }))
    .then(function (lists) {
      var out = [], seen = {};
      lists.forEach(function (l) { l.forEach(function (s) { if (!seen[s.url]) { seen[s.url] = 1; out.push(s); } }); });
      return out;
    });
}

var TMDB_KEY = "68e094699525b18a70bab2f86b1fa706"; // public community key used by Nuvio providers

function tmdb(tmdbId, mediaType, lang) {
  var path = (mediaType === "tv" ? "tv/" : "movie/") + tmdbId;
  return j("https://api.themoviedb.org/3/" + path + "?language=" + lang + "&api_key=" + TMDB_KEY)
    .catch(function () { return {}; });
}

function details(tmdbId, mediaType) {
  return Promise.all([wikidata(tmdbId, mediaType), tmdb(tmdbId, mediaType, "en-US"), tmdb(tmdbId, mediaType, "ar")])
    .then(function (r) {
      var info = r[0], en = r[1] || {}, ar = r[2] || {};
      var enT = en.title || en.name, arT = ar.title || ar.name, orig = en.original_title || en.original_name;
      if (enT) info.title = enT;
      if (arT && /[\u0600-\u06ff]/.test(arT)) info.ar = arT;
      else if (orig && /[\u0600-\u06ff]/.test(orig)) info.ar = orig;
      var d = en.release_date || en.first_air_date;
      if (d && /^\d{4}/.test(d)) info.year = +d.slice(0, 4);
      return info;
    });
}

function getStreams(tmdbId, mediaType, season, episode) {
  mediaType = mediaType === "tv" || mediaType === "series" ? "tv" : "movie";
  return details(tmdbId, mediaType).then(function (info) {
    info.season = season; info.episode = episode;
    return collect(info.ia, mediaType, season, episode, info).then(function (out) {
      if (out.length) return out;
      return search(info, mediaType).then(function (ids) { return collect(ids, mediaType, season, episode, null); });
    });
  }).catch(function (e) { console.error("[InternetArchive] " + (e && e.message)); return []; });
}

module.exports = { getStreams: getStreams };
