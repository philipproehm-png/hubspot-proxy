import express from "express";
import fetch from "node-fetch";

const app = express();
const port = process.env.PORT || 3000;

const tenantId = process.env.TENANT_ID;
const clientId = process.env.CLIENT_ID;
const clientSecret = process.env.CLIENT_SECRET;
const shareUrl = process.env.SHARE_URL;

// Hilfsfunktion: Access Token holen
async function getAccessToken() {
  const params = new URLSearchParams();
  params.append("client_id", clientId);
  params.append("scope", "https://graph.microsoft.com/.default");
  params.append("client_secret", clientSecret);
  params.append("grant_type", "client_credentials");

  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    { method: "POST", body: params }
  );
  const data = await res.json();
  if (!data.access_token) {
    throw new Error("Kein Access Token erhalten: " + JSON.stringify(data));
  }
  return data.access_token;
}

// Hilfsfunktion: Download-URL holen
async function getDownloadUrl(token) {
  const encoded = Buffer.from(shareUrl).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const graphUrl = `https://graph.microsoft.com/v1.0/shares/u!${encoded}/driveItem`;

  const res = await fetch(graphUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!data["@microsoft.graph.downloadUrl"]) {
    throw new Error("Keine DownloadUrl gefunden: " + JSON.stringify(data));
  }
  return data["@microsoft.graph.downloadUrl"];
}

app.get("/health", (req, res) => {
  res.send("ok");
});

app.get("/data", async (req, res) => {
  try {
    const token = await getAccessToken();
    const dlUrl = await getDownloadUrl(token);

    const fileRes = await fetch(dlUrl);
    const json = await fileRes.json();

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json");
    res.json(json);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => {
  console.log(`Proxy läuft auf Port ${port}`);
});
