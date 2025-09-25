import express from "express";

const app = express();

// --- CORS inkl. Preflight ---
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*"); // hier ggf. auf deine Domain(en) einschränken
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204); // Preflight sofort beantworten
  }
  next();
});

// Healthcheck zum Debuggen
app.get("/health", (_req, res) => {
  res.json({
    status: "OK",
    mode: process.env.ITEM_ID
      ? "ITEM_ID"
      : process.env.FILE_PATH
      ? "FILE_PATH"
      : "NONE",
  });
});

// Root-Route
app.get("/", (_req, res) => {
  res.send("OK");
});

// --- JSON-Proxy ---
app.get("/job-data.json", async (_req, res) => {
  try {
    // Token holen
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
    if (!tokenResp.ok) throw new Error("Token error: " + JSON.stringify(tokenData));
    const accessToken = tokenData.access_token;

    // Graph-Endpunkt vorbereiten
    let graphUrl;
    if (process.env.ITEM_ID) {
      graphUrl = `https://graph.microsoft.com/v1.0/sites/${process.env.SITE_ID}/drives/${process.env.DRIVE_ID}/items/${process.env.ITEM_ID}?$select=@microsoft.graph.downloadUrl`;
    } else if (process.env.FILE_PATH) {
      graphUrl = `https://graph.microsoft.com/v1.0/sites/${process.env.SITE_ID}/drives/${process.env.DRIVE_ID}/root:${process.env.FILE_PATH}?$select=@microsoft.graph.downloadUrl`;
    } else {
      throw new Error("Neither ITEM_ID nor FILE_PATH set");
    }

    // Download-URL holen
    const itemResp = await fetch(graphUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const itemData = await itemResp.json();
    if (!itemResp.ok) throw new Error("Graph item error: " + JSON.stringify(itemData));
    const downloadUrl = itemData["@microsoft.graph.downloadUrl"];
    if (!downloadUrl) throw new Error("No downloadUrl in Graph response");

    // Datei abrufen und weiterreichen
    const fileResp = await fetch(downloadUrl);
    if (!fileResp.ok) throw new Error("Download error: " + fileResp.statusText);

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store, must-revalidate"); // kein Caching
    const data = await fileResp.text();
    res.send(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Proxy listening on ${PORT}`);
});
