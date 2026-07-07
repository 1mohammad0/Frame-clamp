// server.js
// A tiny web server with one job: given a YouTube or Aparat video link,
// figure out the thumbnail image URLs and hand them back to the browser.

const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ---------- Helpers to detect the platform and extract IDs ----------

function extractYouTubeId(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");

    if (host === "youtu.be") {
      const id = u.pathname.split("/").filter(Boolean)[0];
      return id || null;
    }

    if (host.endsWith("youtube.com")) {
      if (u.pathname === "/watch") {
        return u.searchParams.get("v");
      }
      const parts = u.pathname.split("/").filter(Boolean);
      // /shorts/ID , /embed/ID , /v/ID
      if (["shorts", "embed", "v"].includes(parts[0])) {
        return parts[1] || null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function extractAparatId(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (!host.endsWith("aparat.com")) return null;

    const parts = u.pathname.split("/").filter(Boolean);
    // Typical Aparat URL: /v/xxxxxxx or /video/xxxxxxx/...
    const vIndex = parts.indexOf("v");
    if (vIndex !== -1 && parts[vIndex + 1]) return parts[vIndex + 1];

    const videoIndex = parts.indexOf("video");
    if (videoIndex !== -1 && parts[videoIndex + 1]) return parts[videoIndex + 1];

    return null;
  } catch {
    return null;
  }
}

// ---------- Main API endpoint ----------

app.post("/api/thumbnail", async (req, res) => {
  const { url } = req.body || {};

  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "لینک ویدیو ارسال نشده است." });
  }

  const ytId = extractYouTubeId(url);
  if (ytId) {
    // YouTube exposes several fixed-size thumbnail files per video ID, but
    // when a size doesn't exist for a given video, YouTube still answers
    // with HTTP 200 and a tiny generic grey placeholder image (always
    // exactly 1097 bytes) instead of a 404. We check for that placeholder
    // so we never hand the user a "thumbnail" that's really just grey
    // filler pretending to be a picture.
    const YOUTUBE_PLACEHOLDER_SIZE = 1097;
    const base = `https://img.youtube.com/vi/${ytId}`;
    const candidates = [
      { label: "بیشترین کیفیت (maxres)", key: "maxresdefault", src: `${base}/maxresdefault.jpg` },
      { label: "کیفیت بالا (sd)", key: "sddefault", src: `${base}/sddefault.jpg` },
      { label: "کیفیت متوسط (hq)", key: "hqdefault", src: `${base}/hqdefault.jpg` },
      { label: "کیفیت معمولی (mq)", key: "mqdefault", src: `${base}/mqdefault.jpg` },
      { label: "کیفیت پایین (default)", key: "default", src: `${base}/default.jpg` },
    ];

    const verified = [];
    for (const candidate of candidates) {
      try {
        const check = await fetch(candidate.src, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          },
        });
        if (!check.ok) continue;

        const contentType = check.headers.get("content-type") || "";
        if (!contentType.startsWith("image/")) continue;

        const contentLength = Number(check.headers.get("content-length") || 0);
        if (contentLength === YOUTUBE_PLACEHOLDER_SIZE) continue;

        verified.push(candidate);
      } catch {
        // Skip candidates we can't reach.
      }
    }

    if (verified.length === 0) {
      return res.status(404).json({
        error: "تامنیلی برای این ویدیوی یوتیوب پیدا نشد. لطفاً لینک را بررسی کن.",
      });
    }

    return res.json({
      platform: "youtube",
      videoId: ytId,
      thumbnails: verified,
    });
  }

  const aparatId = extractAparatId(url);
  if (aparatId) {
    const browserHeaders = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "application/json,text/plain,*/*",
    };

    try {
      const apiUrl = `https://www.aparat.com/etc/api/video/videohash/${aparatId}`;
      const response = await fetch(apiUrl, { headers: browserHeaders });

      if (!response.ok) {
        return res.status(502).json({
          error: "آپارات پاسخ ندادی یا ویدیو پیدا نشد. لطفاً لینک را بررسی کن و دوباره امتحان کن.",
        });
      }

      let data;
      try {
        data = await response.json();
      } catch {
        // Aparat sometimes answers with an HTML page instead of JSON when
        // it can't find the video or is rate-limiting the request.
        return res.status(502).json({
          error: "آپارات اطلاعات معتبری برنگرداند. ممکنه لینک اشتباه باشه یا ویدیو حذف شده باشه.",
        });
      }

      // Real Aparat API shape: { video: { big_poster, small_poster, ... } }
      const video = data?.video || null;
      if (!video) {
        return res.status(404).json({ error: "ویدیویی با این لینک روی آپارات پیدا نشد." });
      }

      const isPlaceholder = (u) => !u || u.includes("novideo.jpg");
      const candidates = [];
      if (!isPlaceholder(video.big_poster)) {
        candidates.push({ label: "کیفیت بالا", key: "big", src: video.big_poster });
      }
      if (!isPlaceholder(video.small_poster) && video.small_poster !== video.big_poster) {
        candidates.push({ label: "کیفیت معمولی", key: "small", src: video.small_poster });
      }

      if (candidates.length === 0) {
        return res.status(404).json({ error: "تامنیلی برای این ویدیوی آپارات پیدا نشد." });
      }

      // Verify each candidate is actually a live, fetchable image before
      // handing it to the browser. Without this check, a stale or blocked
      // CDN URL would still be shown to the user as if it worked, and the
      // resulting "download" would just be a broken file.
      const verified = [];
      for (const candidate of candidates) {
        try {
          const check = await fetch(candidate.src, { method: "GET", headers: browserHeaders });
          const type = check.headers.get("content-type") || "";
          if (check.ok && type.startsWith("image/")) {
            verified.push(candidate);
          }
        } catch {
          // Skip candidates we can't reach; we only offer links that work.
        }
      }

      if (verified.length === 0) {
        return res.status(502).json({
          error:
            "لینک تامنیل از آپارات دریافت شد ولی خود تصویر در دسترس نبود. کمی بعد دوباره امتحان کن.",
        });
      }

      return res.json({
        platform: "aparat",
        videoId: aparatId,
        thumbnails: verified,
      });
    } catch (err) {
      return res.status(500).json({ error: "خطا در ارتباط با آپارات. اتصال اینترنت سرور را بررسی کن." });
    }
  }

  return res.status(400).json({
    error: "لینک وارد شده معتبر نیست. لطفاً یک لینک از یوتیوب یا آپارات وارد کنید.",
  });
});

// ---------- Proxy download endpoint ----------
// Browsers can't force-download images from other domains directly due to
// CORS, so we fetch the image on the server and stream it back with headers
// that make the browser save it as a file instead of opening it.

// Map an image content-type to the right file extension, so the file we
// hand back always matches what's actually inside it. Forcing ".jpg" on a
// file that's really a PNG/WEBP is exactly what makes some systems refuse
// to open the downloaded file.
function extensionForContentType(contentType) {
  const type = (contentType || "").split(";")[0].trim().toLowerCase();
  const map = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/bmp": "bmp",
  };
  return map[type] || "jpg";
}

app.get("/api/preview", async (req, res) => {
  const { src } = req.query;
  if (!src || typeof src !== "string") {
    return res.status(400).send("آدرس تصویر مشخص نشده است.");
  }

  let parsed;
  try {
    parsed = new URL(src);
  } catch {
    return res.status(400).send("آدرس تصویر نامعتبر است.");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return res.status(400).send("این آدرس مجاز نیست.");
  }

  try {
    const response = await fetch(src, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "image/*,*/*;q=0.8",
      },
      redirect: "follow",
    });

    if (!response.ok) return res.status(502).send("دریافت تصویر ناموفق بود.");

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) {
      return res.status(502).send("فایل دریافتی یک تصویر معتبر نبود.");
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=3600");
    // No Content-Disposition here on purpose: this endpoint is for on-page
    // display (and right-click "Save image as"), while /api/download is
    // the explicit "force attachment" version used by the download button.
    res.send(buffer);
  } catch (err) {
    res.status(500).send("خطا در دریافت تصویر.");
  }
});

app.get("/api/download", async (req, res) => {
  const { src, filename } = req.query;
  if (!src || typeof src !== "string") {
    return res.status(400).send("آدرس تصویر مشخص نشده است.");
  }

  let parsed;
  try {
    parsed = new URL(src);
  } catch {
    return res.status(400).send("آدرس تصویر نامعتبر است.");
  }

  // Only allow http/https targets. We intentionally don't restrict to a
  // fixed list of hostnames here: YouTube and Aparat both serve thumbnails
  // from many rotating CDN subdomains (and Aparat sometimes uses entirely
  // separate CDN vendor domains), so a hostname allowlist is guaranteed to
  // go stale and block legitimate images. Safety instead comes from only
  // ever proxying URLs that our own /api/thumbnail endpoint just returned,
  // and from verifying the response really is an image before sending it.
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return res.status(400).send("این آدرس مجاز نیست.");
  }

  try {
    const response = await fetch(src, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "image/*,*/*;q=0.8",
      },
      redirect: "follow",
    });

    if (!response.ok) {
      return res.status(502).send("دریافت تصویر از سرور اصلی ناموفق بود.");
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) {
      // The source didn't actually hand back an image (could be an error
      // page, a login wall, etc). Save nothing rather than save a broken
      // file with a fake .jpg name.
      return res.status(502).send("فایل دریافتی یک تصویر معتبر نبود.");
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) {
      return res.status(502).send("فایل دریافتی خالی بود.");
    }

    const ext = extensionForContentType(contentType);
    const safeName = (filename || "thumbnail").replace(/[^a-zA-Z0-9_\-\.]/g, "_");

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", buffer.length);
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}.${ext}"`);
    res.send(buffer);
  } catch (err) {
    res.status(500).send("خطا در دانلود تصویر.");
  }
});

app.get("/health", (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Thumbnail downloader running on port ${PORT}`);
});
