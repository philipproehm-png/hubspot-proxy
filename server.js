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

// ---------------- ROOT ----------------
app.get("/", (_req, res) => {
  res.send("OK");
});


// ======================================================
// 🔥 SHARED FUNCTION: LOAD JOB DATA FROM MICROSOFT GRAPH
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
// SEO ENDPOINT (GOOGLE INDEXIERBAR)
// ======================================================
app.get("/seo.html", async (_req, res) => {
  try {
    const jobs = await loadJobsFromGraph();

    const html = jobs.map(job => `
      <article class="job">

        <h2>${job.title || ""}</h2>

        <p>
          <strong>${job.category || ""}</strong>
          ${job.location ? " | " + job.location : ""}
        </p>

        ${job.description ? `<p>${job.description}</p>` : ""}

      </article>
    `).join("");

    res.setHeader("Content-Type", "text/html; charset=utf-8");

    res.send(`
<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <title>Jobs</title>
</head>
<body>

<h1>Job Listings</h1>

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
      <p>${err.message}</p>
    `);
  }
});


// ---------------- START SERVER ----------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Proxy listening on ${PORT}`);
});
