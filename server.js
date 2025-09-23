import express from "express";
import fetch from "node-fetch";

const app = express();
const port = process.env.PORT || 3000;

// Variante A (empfohlen, jetzt sofort lauffähig):
const ONEDRIVE_URL = process.env.ONEDRIVE_URL; // echter ?download=1-Link

// Variante B (nur falls du später wieder Graph möchtest):
const TENANT_ID = process.env.TENANT_ID;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SHARE_URL = process.env.SHARE_URL;

app.use((req, res, next) => {
  const o = req.headers.origin;
  res.header("Access-Control-Allow-Origin", o || "*");
  res.header("Vary", "Origin");
  res.header("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type,If-None-Match");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

app.get("/health", (_, res) => res.send("ok"));

async function fetchJson(url, ifNoneMatch) {
  const h = {};
  if (ifNoneMatch) h["If-None-Match"] = ifNoneMatch;
  const r = await fetch(url, { headers: h });
  if (r.status === 304) return { status: 304 };
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Upstream ${r.status}: ${t.slice(0,500)}`);
  }
  const raw = await r.text();
  let data;
  try { data = JSON.parse(raw); }
  catch(e){ throw new Error(`Non-JSON: ${e.message}. Preview: ${raw.slice(0,200)}`); }
  const etag = r.headers.get("etag");
  return { status: 200, data, etag };
}

// ---- Variante A: OneDrive-Downloadlink direkt ----
app.get("/data", async (req, res) => {
  try {
    if (!ONEDRIVE_URL) throw new Error("ONEDRIVE_URL not set");
    const out = await fetchJson(ONEDRIVE_URL, req.headers["if-none-match"]);
    if (out.status === 304) return res.status(304).end();
    if (out.etag) res.setHeader("ETag", out.etag);
    res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=120");
    res.type("application/json").status(200).send(JSON.stringify(out.data));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ---- Optional: /data-graph falls du später wieder Graph nutzen willst ----
async function getAccessToken() {
  const p = new URLSearchParams({
    client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
    scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials"
  });
  const r = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, { method:"POST", body:p });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error(`Token error ${r.status}: ${JSON.stringify(j)}`);
  return j.access_token;
}
function encodeSharingUrl(u){
  return "u!" + Buffer.from(u).toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
app.get("/data-graph", async (req,res)=>{
  try{
    if(!TENANT_ID||!CLIENT_ID||!CLIENT_SECRET||!SHARE_URL) throw new Error("Graph env vars missing");
    const token = await getAccessToken();
    const ep = `https://graph.microsoft.com/v1.0/shares/${encodeSharingUrl(SHARE_URL)}/driveItem?select=@microsoft.graph.downloadUrl`;
    const r = await fetch(ep, { headers:{ Authorization:`Bearer ${token}` }});
    const j = await r.json();
    if(!r.ok) throw new Error(`Graph ${r.status}: ${JSON.stringify(j)}`);
    const dl = j["@microsoft.graph.downloadUrl"]; if(!dl) throw new Error("downloadUrl not present");
    const out = await fetchJson(dl, req.headers["if-none-match"]);
    if (out.status === 304) return res.status(304).end();
    if (out.etag) res.setHeader("ETag", out.etag);
    res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=120");
    res.type("application/json").status(200).send(JSON.stringify(out.data));
  }catch(e){ res.status(500).json({ error:String(e) }); }
});

app.listen(port, () => console.log(`Proxy läuft auf Port ${port}`));
