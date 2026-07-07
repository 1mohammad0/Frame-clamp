const form = document.getElementById("thumb-form");
const input = document.getElementById("video-url");
const submitBtn = document.getElementById("submit-btn");
const errorBox = document.getElementById("error-box");
const results = document.getElementById("results");
const skeleton = document.getElementById("skeleton");
const filmstrip = document.getElementById("filmstrip");
const platformBadge = document.getElementById("platform-badge");
const videoIdEl = document.getElementById("video-id");

function setLoading(isLoading) {
  submitBtn.disabled = isLoading;
  submitBtn.classList.toggle("loading", isLoading);
  skeleton.hidden = !isLoading;
  if (isLoading) {
    results.hidden = true;
    errorBox.hidden = true;
  }
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
  results.hidden = true;
}

function platformLabel(platform) {
  return platform === "youtube" ? "YouTube" : "Aparat";
}

function renderResults(data) {
  filmstrip.innerHTML = "";
  platformBadge.textContent = platformLabel(data.platform);
  videoIdEl.textContent = data.videoId;

  data.thumbnails.forEach((thumb, i) => {
    const card = document.createElement("div");
    card.className = "frame-card";
    card.style.animationDelay = `${i * 60}ms`;

    const thumbWrap = document.createElement("div");
    thumbWrap.className = "frame-thumb-wrap";
    const img = document.createElement("img");
    img.src = `/api/preview?src=${encodeURIComponent(thumb.src)}`;
    img.alt = thumb.label;
    img.loading = "lazy";
    img.onerror = () => { card.remove(); };
    thumbWrap.appendChild(img);

    const info = document.createElement("div");
    info.className = "frame-info";
    const label = document.createElement("div");
    label.className = "frame-label";
    label.textContent = thumb.label;
    const meta = document.createElement("div");
    meta.className = "frame-meta";
    meta.textContent = thumb.src;
    info.appendChild(label);
    info.appendChild(meta);

    const downloadLink = document.createElement("a");
    downloadLink.className = "frame-download";
    downloadLink.href = `/api/download?src=${encodeURIComponent(thumb.src)}&filename=${encodeURIComponent(
      `${data.platform}-${data.videoId}-${thumb.key}`
    )}`;
    downloadLink.textContent = "⬇ دانلود";

    card.appendChild(thumbWrap);
    card.appendChild(info);
    card.appendChild(downloadLink);
    filmstrip.appendChild(card);
  });

  results.hidden = false;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const url = input.value.trim();
  if (!url) {
    showError("لطفاً یک لینک وارد کن.");
    return;
  }

  setLoading(true);
  try {
    const res = await fetch("/api/thumbnail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();

    if (!res.ok) {
      showError(data.error || "خطایی رخ داد.");
      return;
    }

    renderResults(data);
  } catch (err) {
    showError("ارتباط با سرور برقرار نشد. دوباره امتحان کن.");
  } finally {
    setLoading(false);
  }
});
