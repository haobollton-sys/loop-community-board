import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined });
const PgSession = connectPgSimple(session);
const isProduction = process.env.NODE_ENV === 'production';
if (!process.env.SESSION_SECRET) console.warn('⚠️ SESSION_SECRET is missing. Set it before deployment.');
if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '32kb' }));
app.use(express.urlencoded({ extended: false, limit: '16kb' }));
app.use(session({
  store: new PgSession({ pool, tableName: 'session', createTableIfMissing: true }),
  name: 'board.sid',
  secret: process.env.SESSION_SECRET || 'dev-only-change-me',
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: isProduction, maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const safeUser = u => ({ id: u.id, username: u.username, role: u.role, created_at: u.created_at });
const requireAuth = (req, res, next) => req.session.user ? next() : res.status(401).json({ error: 'Connectez-vous pour continuer.' });
const requireAdmin = (req, res, next) => req.session.user?.role === 'admin' ? next() : res.status(403).json({ error: 'Accès réservé à la modération.' });

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.get('/api/me', (req, res) => res.json({ user: req.session.user || null }));

app.post('/api/register', asyncRoute(async (req, res) => {
  const username = String(req.body.username || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) return res.status(400).json({ error: 'Pseudo : 3 à 24 caractères, lettres, chiffres ou _.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255) return res.status(400).json({ error: 'Adresse e-mail invalide.' });
  if (password.length < 10 || password.length > 200) return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 10 caractères.' });
  const hash = await bcrypt.hash(password, 12);
  try {
    const { rows } = await pool.query('INSERT INTO users(username,email,password_hash) VALUES($1,$2,$3) RETURNING id,username,role,created_at', [username,email,hash]);
    req.session.user = safeUser(rows[0]);
    res.status(201).json({ user: req.session.user });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Ce pseudo ou cet e-mail est déjà utilisé.' });
    throw e;
  }
}));

app.post('/api/login', asyncRoute(async (req, res) => {
  const login = String(req.body.login || '').trim();
  const password = String(req.body.password || '');
  const { rows } = await pool.query('SELECT * FROM users WHERE LOWER(username)=LOWER($1) OR email=$1 LIMIT 1', [login.toLowerCase()]);
  if (!rows[0] || !(await bcrypt.compare(password, rows[0].password_hash))) return res.status(401).json({ error: 'Identifiants incorrects.' });
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: 'Impossible d’ouvrir la session.' });
    req.session.user = safeUser(rows[0]);
    res.json({ user: req.session.user });
  });
}));
app.post('/api/logout', (req, res) => req.session.destroy(() => { res.clearCookie('board.sid'); res.json({ ok: true }); }));

app.get('/api/categories', asyncRoute(async (req, res) => {
  const { rows } = await pool.query(`SELECT c.*, COUNT(p.id)::int AS post_count FROM categories c LEFT JOIN posts p ON p.category_id=c.id GROUP BY c.id ORDER BY c.id`);
  res.json({ categories: rows });
}));
app.get('/api/posts', asyncRoute(async (req, res) => {
  const category = String(req.query.category || '');
  const search = String(req.query.q || '').trim().slice(0, 100);
  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 50);
  const values = [];
  let where = [];
  if (category) { values.push(category); where.push(`c.slug=$${values.length}`); }
  if (search) { values.push(`%${search}%`); where.push(`(p.title ILIKE $${values.length} OR p.body ILIKE $${values.length} OR u.username ILIKE $${values.length})`); }
  values.push(limit);
  const { rows } = await pool.query(`
    SELECT p.id,p.title,p.body,p.pinned,p.locked,p.created_at,p.updated_at,
      u.id AS author_id,u.username AS author,c.name AS category,c.slug AS category_slug,c.accent,
      COUNT(DISTINCT r.id)::int AS reply_count, MAX(r.created_at) AS last_reply
    FROM posts p JOIN users u ON u.id=p.user_id JOIN categories c ON c.id=p.category_id
    LEFT JOIN replies r ON r.post_id=p.id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    GROUP BY p.id,u.id,c.id ORDER BY p.pinned DESC, COALESCE(MAX(r.created_at),p.created_at) DESC LIMIT $${values.length}`, values);
  res.json({ posts: rows });
}));
app.get('/api/posts/:id', asyncRoute(async (req, res) => {
  const { rows } = await pool.query(`SELECT p.*,u.username AS author,c.name AS category,c.slug AS category_slug,c.accent FROM posts p JOIN users u ON u.id=p.user_id JOIN categories c ON c.id=p.category_id WHERE p.id=$1`, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Sujet introuvable.' });
  const replies = await pool.query('SELECT r.id,r.body,r.created_at,u.username AS author,u.id AS author_id FROM replies r JOIN users u ON u.id=r.user_id WHERE r.post_id=$1 ORDER BY r.created_at ASC', [req.params.id]);
  res.json({ post: rows[0], replies: replies.rows });
}));
app.post('/api/posts', requireAuth, asyncRoute(async (req, res) => {
  const title = String(req.body.title || '').trim(), body = String(req.body.body || '').trim(), slug = String(req.body.category || 'discussions');
  if (title.length < 4 || title.length > 140) return res.status(400).json({ error: 'Le titre doit faire entre 4 et 140 caractères.' });
  if (body.length < 10 || body.length > 10000) return res.status(400).json({ error: 'Le message doit faire entre 10 et 10 000 caractères.' });
  const cat = await pool.query('SELECT id FROM categories WHERE slug=$1', [slug]);
  if (!cat.rows[0]) return res.status(400).json({ error: 'Catégorie inconnue.' });
  const { rows } = await pool.query('INSERT INTO posts(user_id,category_id,title,body) VALUES($1,$2,$3,$4) RETURNING id', [req.session.user.id,cat.rows[0].id,title,body]);
  res.status(201).json({ id: rows[0].id });
}));
app.post('/api/posts/:id/replies', requireAuth, asyncRoute(async (req, res) => {
  const body = String(req.body.body || '').trim();
  if (body.length < 2 || body.length > 5000) return res.status(400).json({ error: 'La réponse doit faire entre 2 et 5 000 caractères.' });
  const post = await pool.query('SELECT locked FROM posts WHERE id=$1', [req.params.id]);
  if (!post.rows[0]) return res.status(404).json({ error: 'Sujet introuvable.' });
  if (post.rows[0].locked) return res.status(403).json({ error: 'Ce sujet est verrouillé.' });
  const { rows } = await pool.query('INSERT INTO replies(post_id,user_id,body) VALUES($1,$2,$3) RETURNING id', [req.params.id,req.session.user.id,body]);
  res.status(201).json({ id: rows[0].id });
}));
app.delete('/api/posts/:id', requireAuth, asyncRoute(async (req, res) => {
  const { rows } = await pool.query('SELECT user_id FROM posts WHERE id=$1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Sujet introuvable.' });
  if (Number(rows[0].user_id) !== Number(req.session.user.id) && req.session.user.role !== 'admin') return res.status(403).json({ error: 'Action non autorisée.' });
  await pool.query('DELETE FROM posts WHERE id=$1', [req.params.id]); res.json({ ok: true });
}));
app.post('/api/posts/:id/report', requireAuth, asyncRoute(async (req, res) => {
  const reason = String(req.body.reason || '').trim().slice(0,500);
  if (!reason) return res.status(400).json({ error: 'Précisez le motif du signalement.' });
  await pool.query('INSERT INTO reports(post_id,reporter_id,reason) VALUES($1,$2,$3)', [req.params.id,req.session.user.id,reason]);
  res.status(201).json({ ok: true });
}));
app.get('/api/admin/reports', requireAuth, requireAdmin, asyncRoute(async (req,res) => {
  const { rows } = await pool.query(`SELECT r.*,u.username AS reporter,p.title AS post_title FROM reports r JOIN users u ON u.id=r.reporter_id LEFT JOIN posts p ON p.id=r.post_id WHERE r.status='open' ORDER BY r.created_at ASC`);
  res.json({ reports: rows });
}));
app.patch('/api/admin/posts/:id', requireAuth, requireAdmin, asyncRoute(async (req,res) => {
  const allowed = {};
  if (typeof req.body.pinned === 'boolean') allowed.pinned = req.body.pinned;
  if (typeof req.body.locked === 'boolean') allowed.locked = req.body.locked;
  if (!Object.keys(allowed).length) return res.status(400).json({error:'Aucun changement valide.'});
  await pool.query('UPDATE posts SET pinned=COALESCE($2,pinned),locked=COALESCE($3,locked) WHERE id=$1', [req.params.id,allowed.pinned ?? null,allowed.locked ?? null]);
  res.json({ok:true});
}));
app.patch('/api/admin/reports/:id', requireAuth, requireAdmin, asyncRoute(async (req,res) => {
  const status = String(req.body.status || '');
  if (!['resolved','dismissed'].includes(status)) return res.status(400).json({error:'Statut invalide.'});
  await pool.query('UPDATE reports SET status=$1 WHERE id=$2', [status,req.params.id]); res.json({ok:true});
}));

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req,res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Erreur serveur. Réessayez plus tard.' });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Board prêt sur http://localhost:${port}`));