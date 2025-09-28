import express from "express";
import pkg from "pg";

const { Pool } = pkg;
const app = express();
app.use(express.json());
app.use(express.static("public"));

const ADMIN_KEY = process.env.ADMIN_KEY || "admin123";

// ===== Postgres Config =====
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ===== Ensure Schema =====
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
ensureSchema();

// ===== Routes =====
app.get("/api/health", async (req,res)=>{
  try{
    await pool.query("select 1+1");
    res.json({ ok:true, db:"postgres" });
  }catch(e){
    res.status(500).json({ ok:false, error:e.message });
  }
});

// ดึงหนังสือทั้งหมด
app.get("/api/books", async (req,res)=>{
  const { rows } = await pool.query("select * from books order by id asc");
  res.json(rows);
});

// เพิ่มหนังสือ (admin เท่านั้น)
app.post("/api/books", async (req,res)=>{
  const key = req.headers["x-admin-key"];
  if(key !== ADMIN_KEY) return res.status(401).json({error:"unauthorized"});
  const { title, author="", category="", description="" } = req.body;
  const { rows } = await pool.query(
    `insert into books (title,author,category,description)
     values ($1,$2,$3,$4) returning *`,
    [title,author,category,description]
  );
  res.json(rows[0]);
});

// ยืมหนังสือ
app.post("/api/borrow/:id", async (req,res)=>{
  const key = req.headers["x-admin-key"];
  if(key !== ADMIN_KEY) return res.status(401).json({error:"unauthorized"});
  const { id } = req.params;
  const borrower = req.body?.borrower || "unknown";
  const { rows } = await pool.query(
    `update books set is_borrowed=true, borrower=$2, borrowed_at=now()
     where id=$1 and is_borrowed=false returning *`,
    [id, borrower]
  );
  if(!rows.length) return res.status(400).json({error:"not found or already borrowed"});
  res.json(rows[0]);
});

// คืนหนังสือ
app.post("/api/return/:id", async (req,res)=>{
  const key = req.headers["x-admin-key"];
  if(key !== ADMIN_KEY) return res.status(401).json({error:"unauthorized"});
  const { id } = req.params;
  const { rows } = await pool.query(
    `update books set is_borrowed=false, borrower='', returned_at=now()
     where id=$1 and is_borrowed=true returning *`,
    [id]
  );
  if(!rows.length) return res.status(400).json({error:"not found or not borrowed"});
  res.json(rows[0]);
});

const port = process.env.PORT || 3000;
app.listen(port, ()=> console.log("Server running on port", port));
