import express from "express";

const app = express();

const {
  TENANT_ID,
  CLIENT_ID,
  CLIENT_SECRET,
  SITE_ID,
  DRIVE_ID,
  ITEM_ID,     // optional
  FILE_PATH    // optional: z.B. /HR/Online-Jobs/hubfs/139531838/job_data.json
} = process.env;

async function getGraphToken() {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: "client_credentials",
    scope: "https://graph.microsoft.com/.default"
  });
  const r = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (!r.ok) throw new Error(`Token error ${r.status}: ${await r.text()}`);
  const j = await r.json();
  if (!j.access_token) throw new Error("No access_token");
  return j.access_token;
}

async function getDownloadUrl(token) {
  // Wenn ITEM_ID gesetzt ist, nutzen wir sie; sonst Pfad
  let url;
  if (ITEM_ID) {
    url = `https://graph.microsoft.com/v1.0/sites/${SITE_ID}/drives/${encodeURIComponent(DRIVE_ID)}/items/${ITEM_ID}?$select=@microsoft.graph.downloadUrl`;
  } else if (FILE_PATH) {
    // Pfad muss URL-encoded werden, Slashes bleiben
    const encPath = encodeURI(FILE_PATH);
    url = `https://graph.microsoft.com/v1.0/sites/${SITE_ID}/drives/${encodeURIComponent(DRIVE_ID)}/root:${encPath}?$select=@microsoft.graph.downloadUrl`;
  } else {
    throw new Error("Neither ITEM_ID nor FILE_PATH is set");
  }

  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Graph item error ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const dl = j["@microsoft.graph.downloadUrl"];
  if (!dl) throw new Error("No @microsoft.graph.downloadUrl in response");
  return dl;
}

app.get("/", (_req, res) => res.send("OK"));

app.get("/job-data.json", async (_req, res) => {
  try {
    const token = await getGraphToken();
    const dl = await getDownloadUrl(token);
    const f = await fetch(dl, { redirect: "follow" });
    if (!f.ok) return res.status(502).send(`Download error ${f.status}`);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=60");
    const text = await f.text();
    res.send(text);
  } catch (e) {
    console.error(e);
    res.status(500).send(String(e));
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Proxy listening on :${port}`));
