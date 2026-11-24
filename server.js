import express from "express";

const app = express();

// ---------------- CORS ----------------
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ---------------- HEALTH ----------------
app.get("/health", (_req, res) => {
  res.json({ status: "OK" });
});

// ---------------- ROOT (Jetzt mit Google Verifizierung) ----------------
app.get("/", (_req, res) => {
  res.send(`
<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="google-site-verification" content="Ad9iyvAAotewxJ2ulA5oyhN6GkJMHwZC_Y8kdFBXhMM" />
  <title>HarborX Proxy Service</title>
</head>
<body>
  <h1>HarborX Proxy Service</h1>
  <p>System aktiv.</p>
</body>
</html>
`);
});

// ======================================================
// SHARED FUNCTION: LOAD JOB DATA FROM MICROSOFT GRAPH
// ======================================================
async function loadJobsFromGraph() {
  const tokenResp = await fetch(
    `https://login.microsoftonline.com/${process.env.TENANT_ID}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
    }
  );
  const tokenData = await tokenResp.json();
  if (!tokenResp.ok) throw new Error(JSON.stringify(tokenData));
  const accessToken = tokenData.access_token;

  let graphUrl;
  if (process.env.ITEM_ID) {
    graphUrl = `https://graph.microsoft.com/v1.0/sites/${process.env.SITE_ID}/drives/${process.env.DRIVE_ID}/items/${process.env.ITEM_ID}?$select=@microsoft.graph.downloadUrl`;
  } else if (process.env.FILE_PATH) {
    graphUrl = `https://graph.microsoft.com/v1.0/sites/${process.env.SITE_ID}/drives/${process.env.DRIVE_ID}/root:${process.env.FILE_PATH}?$select=@microsoft.graph.downloadUrl`;
  } else {
    throw new Error("No ITEM_ID or FILE_PATH set");
  }

  const itemResp = await fetch(graphUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const itemData = await itemResp.json();
  const downloadUrl = itemData["@microsoft.graph.downloadUrl"];
  const fileResp = await fetch(downloadUrl);
  const data = await fileResp.json();

  return Array.isArray(data?.jobs) ? data.jobs : [];
}

// ======================================================
// JSON ENDPOINT (BLEIBT FUNKTIONAL IDENTISCH)
// ======================================================
app.get("/job-data.json", async (_req, res) => {
  try {
    const jobs = await loadJobsFromGraph();
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.send(JSON.stringify({ jobs }));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ======================================================
// SEO HELPERS (HTML-ESCAPING, validThrough & SCHEMA FIXES)
// ======================================================
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeJsonLd(obj) {
  return JSON.stringify(obj).replace(/</g, "\\u003c");
}

function formatIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function addMonths(date, months) {
  const copy = new Date(date.getTime());
  copy.setUTCMonth(copy.getUTCMonth() + months);
  return copy;
}

function parseFlexibleDate(raw) {
  if (!raw) return null;
  const text = String(raw).trim();
  const euMatch = text.match(/\b(\d{2})\.(\d{2})\.(\d{4})\b/);
  if (euMatch) {
    const [, dd, mm, yyyy] = euMatch;
    const parsed = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const isoMatch = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) {
    const [, yyyy, mm, dd] = isoMatch;
    const parsed = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function computeValidThrough(job, now = new Date()) {
  const explicitDeadline = parseFlexibleDate(
    job.validThrough || job.deadline || job.applicationDeadline || job.closeDate
  );
  if (explicitDeadline) {
    return formatIsoDate(explicitDeadline);
  }
  const startDate = parseFlexibleDate(job.startDate || job.datelabel);
  const rawDuration = job.durationMonths ?? job.duration;
  const durationMonths = Number(rawDuration);
  if (startDate) {
    const target =
      Number.isFinite(durationMonths) && durationMonths > 0
        ? addMonths(startDate, durationMonths)
        : addDays(startDate, 30);
    if (target.getTime() > now.getTime()) {
      return formatIsoDate(target);
    }
  }
  return formatIsoDate(addDays(now, 30));
}

function computeDatePosted(job, now = new Date()) {
  const explicitPosted = parseFlexibleDate(job.datePosted || job.createdAt);
  if (explicitPosted) {
    return formatIsoDate(explicitPosted);
  }
  // Stabiler Tages-/Monatswert statt sekundengenauem new Date().toISOString()
  return `${now.toISOString().slice(0, 7)}-01`;
}

function mapEmploymentType(rawType) {
  const val = String(rawType || "").trim().toLowerCase();
  if (val.includes("teilzeit") || val.includes("part")) return "PART_TIME";
  if (val.includes("freelance") || val.includes("projekt") || val.includes("contract")) {
    return "CONTRACTOR";
  }
  if (val.includes("temp") || val.includes("befristet")) return "TEMPORARY";
  if (val.includes("vollzeit") || val.includes("full")) return "FULL_TIME";
  return "CONTRACTOR";
}

const COUNTRY_MAP = {
  belgien: "BE",
  niederlande: "NL",
  portugal: "PT",
  "türkei": "TR",
  italien: "IT",
  spanien: "ES",
  deutschland: "DE",
  frankreich: "FR",
};

function parseJobLocation(rawLocation) {
  const cleaned = String(rawLocation || "")
    .replace(/\s*[-–|]\s*\d+\s*%\s*vor\s*ort.*$/i, "")
    .replace(/\s*[-–|]\s*vor\s*ort.*$/i, "")
    .replace(/\s*\([^)]*(remote|vor\s*ort)[^)]*\)\s*$/i, "")
    .trim();

  const lower = cleaned.toLowerCase();
  let addressCountry;
  for (const [name, code] of Object.entries(COUNTRY_MAP)) {
    if (lower.includes(name)) {
      addressCountry = code;
      break;
    }
  }

  return {
    "@type": "Place",
    address: {
      "@type": "PostalAddress",
      addressLocality: cleaned || String(rawLocation || ""),
      ...(addressCountry ? { addressCountry } : {}),
    },
  };
}

// ======================================================
// SEO ENDPOINT
// ======================================================
app.get("/seo.html", async (_req, res) => {
  try {
    const jobs = await loadJobsFromGraph();
    const html = jobs
      .map((job, idx) => {
        const rawId = String(job.deal_id || idx);
        const title = escapeHtml(job.title || "");
        const category = escapeHtml(job.category || "");
        const location = escapeHtml(job.location || "");
        const dealId = escapeHtml(rawId);
        const description = escapeHtml(job.description || "");
        const validThrough = computeValidThrough(job);
        const datePosted = computeDatePosted(job);
        const jobUrl = `https://harborx.de/projekte/nato-it-freelancer#job-${encodeURIComponent(rawId)}`;

        return `
<article class="job" id="job-${dealId}">
  <h2>
    <a href="${escapeHtml(jobUrl)}" target="_blank" rel="noopener">
      ${title}
    </a>
  </h2>
  <p>
    <strong>${category}</strong>
    ${location ? " | " + location : ""}
  </p>
  ${dealId ? `<p class="deal-id">Deal-ID: ${dealId}</p>` : ""}
  ${description ? `<div>${description}</div>` : ""}
  <script type="application/ld+json">
  ${safeJsonLd({
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: job.title || "",
    identifier: {
      "@type": "PropertyValue",
      name: "HarborX Deal ID",
      value: rawId,
    },
    description: job.description || "",
    datePosted,
    employmentType: mapEmploymentType(job.type),
    hiringOrganization: {
      "@type": "Organization",
      name: "HarborX GmbH",
      sameAs: "https://harborx.de",
    },
    jobLocation: parseJobLocation(job.location),
    url: jobUrl,
    validThrough,
  })}
  </script>
</article>
`;
      })
      .join("");

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`
<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <title>Exklusive NATO-Projektangebote für Tech-, IT- und Digitalexperten</title>
  <link rel="canonical" href="https://harborx.de/projekte/nato-it-freelancer" />
  <meta name="robots" content="index,follow">
  <meta name="google-site-verification" content="Ad9iyvAAotewxJ2ulA5oyhN6GkJMHwZC_Y8kdFBXhMM" />
</head>
<body>
  <h1>HarborX: NATO-Projektangebote für Freelancer</h1>
  <section>
    ${html}
  </section>
</body>
</html>
`);
  } catch (err) {
    console.error(err);
    res.status(500).send(`
<h1>SEO Fehler</h1>
<p>${escapeHtml(err.message)}</p>
`);
  }
});

// ======================================================
// SITEMAP ENDPOINT
// ======================================================
app.get("/sitemap.xml", (_req, res) => {
  res.set("Content-Type", "application/xml");
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://hubspot-proxy-svdo.onrender.com/seo.html</loc>
    <lastmod>${formatIsoDate(new Date())}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>`);
});

// ---------------- START SERVER ----------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Proxy listening on ${PORT}`);
});
