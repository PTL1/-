// ===== Library Server - All-in-One =====
import express from "express";
import pkg from "pg";
import path from "path";
import { fileURLToPath } from "url";

const { Pool } = pkg;
const app = express();
app.use(express.json());

// ---- serve index.html (วางไว้ root repo) ----
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));

// ---- ENV ----
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is missing"); process.exit(1);
}
const ADMIN_KEY = process.env.ADMIN_KEY || "admin123";

// ---- Postgres ----
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ---- Ensure Schema ----
async function ensureSchema() {
  await pool.query(`
    create table if not exists books (
      id serial primary key,
      title text not null,
      author text,
      category text,
      description text,
      is_borrowed boolean default false,
      borrower text,
      borrowed_at timestamptz,
      returned_at timestamptz
    );
  `);
}
ensureSchema().catch(e => { console.error("Schema error:", e); process.exit(1); });

// ---- Utils ----
function okAdmin(req, res) {
  const key = req.headers["x-admin-key"] || req.body?.adminKey || req.query?.adminKey;
  if (key !== ADMIN_KEY) { res.status(401).json({ error: "unauthorized" }); return false; }
  return true;
}
const mapRow = r => ({
  id: r.id,
  title: r.title || "",
  author: r.author || "",
  category: r.category || "",
  description: r.description || "",
  isBorrowed: !!r.is_borrowed,
  borrower: r.borrower || "",
  borrowedAt: r.borrowed_at ? new Date(r.borrowed_at).toISOString() : "",
  returnedAt: r.returned_at ? new Date(r.returned_at).toISOString() : ""
});

// ---- Health ----
app.get("/api/health", async (req, res) => {
  try { await pool.query("select 1"); res.json({ ok: true, db: "postgres" }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ---- List + Search ----
// /api/books?q=keyword (ค้นหาใน title/author/category)
app.get("/api/books", async (req, res) => {
  try {
    const q = (req.query.q || "").toString().trim();
    let out;
    if (q) {
      const like = `%${q}%`;
      const { rows } = await pool.query(
        `select * from books
         where lower(title) like lower($1)
            or lower(author) like lower($1)
            or lower(category) like lower($1)
         order by id asc`,
        [like]
      );
      out = rows;
    } else {
      const { rows } = await pool.query("select * from books order by id asc");
      out = rows;
    }
    res.json(out.map(mapRow));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- Create ----
app.post("/api/books", async (req, res) => {
  try {
    if (!okAdmin(req, res)) return;
    const { title, author = "", category = "", description = "" } = req.body || {};
    if (!title) return res.status(400).json({ error: "title required" });
    const { rows } = await pool.query(
      `insert into books (title,author,category,description,is_borrowed)
       values ($1,$2,$3,$4,false) returning *`,
      [title, author, category, description]
    );
    res.json(mapRow(rows[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- Update ----
app.put("/api/books/:id", async (req, res) => {
  try {
    if (!okAdmin(req, res)) return;
    const id = Number(req.params.id);
    const { title, author, category, description } = req.body || {};
    const { rows } = await pool.query(
      `update books set
        title = coalesce($2, title),
        author = coalesce($3, author),
        category = coalesce($4, category),
        description = coalesce($5, description)
       where id=$1 returning *`,
      [id, title, author, category, description]
    );
    if (!rows.length) return res.status(404).json({ error: "not found" });
    res.json(mapRow(rows[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- Delete ----
app.delete("/api/books/:id", async (req, res) => {
  try {
    if (!okAdmin(req, res)) return;
    const id = Number(req.params.id);
    const { rowCount } = await pool.query("delete from books where id=$1", [id]);
    if (!rowCount) return res.status(404).json({ error: "not found" });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- Borrow ----
app.post("/api/borrow/:id", async (req, res) => {
  try {
    if (!okAdmin(req, res)) return;
    const id = Number(req.params.id);
    const borrower = (req.body?.borrower || "unknown").toString();
    const { rows } = await pool.query(
      `update books set is_borrowed=true, borrower=$2, borrowed_at=now(), returned_at=null
       where id=$1 and is_borrowed=false returning *`,
      [id, borrower]
    );
    if (!rows.length) return res.status(400).json({ error: "not found or already borrowed" });
    res.json(mapRow(rows[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- Return ----
app.post("/api/return/:id", async (req, res) => {
  try {
    if (!okAdmin(req, res)) return;
    const id = Number(req.params.id);
    const { rows } = await pool.query(
      `update books set is_borrowed=false, borrower='', returned_at=now()
       where id=$1 and is_borrowed=true returning *`,
      [id]
    );
    if (!rows.length) return res.status(400).json({ error: "not found or not borrowed" });
    res.json(mapRow(rows[0]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- Start ----
const port = process.env.PORT || 3000;
app.listen(port, () => console.log("Server running on port", port));
