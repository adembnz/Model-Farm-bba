import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import express from 'express';
import session from 'express-session';
import pgSession from 'connect-pg-simple';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import multer from 'multer';
import sharp from 'sharp';
import bcrypt from 'bcryptjs';
import {z} from 'zod';
import {pool,q} from './db.js';
import {requireAuth,requireAdmin} from './middleware/auth.js';
import {verifyCsrf} from './middleware/security.js';

const app=express();
const PORT=Number(process.env.PORT||3000);
const ROOT=path.resolve(process.cwd());
const UPLOAD_DIR=path.resolve(ROOT,process.env.UPLOAD_DIR||'./uploads');
fs.mkdirSync(UPLOAD_DIR,{recursive:true});
if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
if(!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length<32) throw new Error('SESSION_SECRET must be at least 32 characters');

if(process.env.TRUST_PROXY==='1') app.set('trust proxy',1);
app.use(pinoHttp());
app.use(helmet({
  contentSecurityPolicy:{directives:{
    defaultSrc:["'self'"],baseUri:["'self'"],objectSrc:["'none'"],frameAncestors:["'none'"],
    scriptSrc:["'self'"], styleSrc:["'self'","'unsafe-inline'","https://fonts.googleapis.com"],
    fontSrc:["'self'","https://fonts.gstatic.com"], imgSrc:["'self'","data:"],
    frameSrc:["https://www.google.com"], connectSrc:["'self'"], formAction:["'self'"],
    upgradeInsecureRequests:process.env.NODE_ENV==='production'?[]:null
  }},
  referrerPolicy:{policy:'strict-origin-when-cross-origin'},
  crossOriginEmbedderPolicy:false
}));
const origin=process.env.CORS_ORIGIN||'http://localhost:3000';
app.use(cors({origin:(o,cb)=>!o||o===origin?cb(null,true):cb(new Error('CORS blocked')),credentials:true}));
app.use(express.json({limit:'64kb'}));
app.use(express.urlencoded({extended:false,limit:'32kb'}));

const PgStore=pgSession(session);
app.use(session({
  store:new PgStore({pool,tableName:'user_sessions',createTableIfMissing:true}),
  secret:process.env.SESSION_SECRET,
  resave:false,saveUninitialized:false,
  cookie:{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',maxAge:30*60*1000,path:'/'}
}));

const authLimiter=rateLimit({windowMs:15*60*1000,max:8,standardHeaders:true,legacyHeaders:false,message:{error:'Too many login attempts. Try again later.'}});
const bookingLimiter=rateLimit({windowMs:10*60*1000,max:10,standardHeaders:true,legacyHeaders:false,message:{error:'Too many booking requests. Try again later.'}});
const adminLimiter=rateLimit({windowMs:15*60*1000,max:300,standardHeaders:true,legacyHeaders:false});
app.use('/api/admin',adminLimiter);

const bookingSchema=z.object({
 fullName:z.string().trim().min(2).max(100),
 phone:z.string().trim().regex(/^[0-9+\s()\-]{8,20}$/),
 email:z.string().trim().email().max(254).optional().or(z.literal('')),
 visitors:z.coerce.number().int().min(1).max(1000),
 bookingType:z.string().trim().min(1).max(80),
 date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
 time:z.string().regex(/^\d{2}:\d{2}$/),
 message:z.string().trim().max(1000).optional().default('')
});

function validDateTime(date,time){
 const d=new Date(`${date}T${time}:00`);
 return Number.isFinite(d.getTime()) && /^\d{4}-\d{2}-\d{2}$/.test(date) && d.toISOString().slice(0,10)===date && time<'24:00';
}
async function audit(req,action,targetId=null,metadata=null){
 try{await q('INSERT INTO audit_logs(user_id,action,target_id,metadata) VALUES($1,$2,$3,$4)',[req.session?.userId||null,action,targetId,metadata]);}catch(e){req.log.error(e,'audit log failed');}
}

app.get('/api/health',async(req,res)=>{await q('SELECT 1');res.json({ok:true});});
app.get('/api/auth/csrf',(req,res)=>{if(!req.session.csrfToken)req.session.csrfToken=crypto.randomBytes(32).toString('hex');res.json({csrfToken:req.session.csrfToken});});
app.get('/api/images',async(req,res)=>{const r=await q('SELECT slot_key,storage_name FROM site_images');res.json({images:Object.fromEntries(r.rows.map(x=>[x.slot_key,`/uploads/${encodeURIComponent(x.storage_name)}`]))});});
app.get('/api/auth/me',async(req,res)=>{
 if(!req.session?.userId) return res.json({authenticated:false});
 const r=await q('SELECT id,username,role,status FROM users WHERE id=$1',[req.session.userId]);
 if(!r.rowCount || r.rows[0].status!=='active'){req.session.destroy(()=>{});return res.json({authenticated:false});}
 res.json({authenticated:true,user:r.rows[0]});
});
app.post('/api/auth/login',authLimiter,verifyCsrf,async(req,res)=>{
 const parsed=z.object({username:z.string().trim().min(3).max(190),password:z.string().min(1).max(200)}).safeParse(req.body);
 if(!parsed.success) return res.status(400).json({error:'Invalid credentials'});
 const r=await q('SELECT id,username,password_hash,role,status FROM users WHERE username=$1',[parsed.data.username.toLowerCase()]);
 const user=r.rows[0];
 if(!user || user.status!=='active' || !(await bcrypt.compare(parsed.data.password,user.password_hash))){
   await audit(req,'login_failed',null,{username:parsed.data.username.slice(0,190)}); return res.status(401).json({error:'Invalid credentials'});
 }
 await new Promise((resolve,reject)=>req.session.regenerate(e=>e?reject(e):resolve()));
 req.session.userId=user.id;req.session.role=user.role;req.session.csrfToken=crypto.randomBytes(32).toString('hex');
 await q('UPDATE users SET last_login=NOW() WHERE id=$1',[user.id]); await audit(req,'login_success',String(user.id));
 res.json({authenticated:true,user:{id:user.id,username:user.username,role:user.role},csrfToken:req.session.csrfToken});
});
app.post('/api/auth/logout',verifyCsrf,(req,res)=>req.session.destroy(e=>e?res.status(500).json({error:'Logout failed'}):res.json({ok:true})));

app.post('/api/bookings',bookingLimiter,async(req,res)=>{
 const parsed=bookingSchema.safeParse(req.body);
 if(!parsed.success) return res.status(400).json({error:'Please check the booking details.'});
 const b=parsed.data;
 if(!validDateTime(b.date,b.time)) return res.status(400).json({error:'Invalid date or time.'});
 if(new Date(`${b.date}T${b.time}:00`).getTime()<Date.now()-60000) return res.status(400).json({error:'Booking date/time must be in the future.'});
 const id=crypto.randomUUID();
 const conflict=await q(`SELECT 1 FROM bookings WHERE booking_date=$1 AND status IN ('pending','confirmed')
   AND (start_time <= $2 AND COALESCE(end_time,$2::time) >= $2) LIMIT 1`,[b.date,b.time]);
 if(conflict.rowCount) return res.status(409).json({error:'This time slot is already requested. Please choose another time.'});
 await q(`INSERT INTO bookings(id,customer_name,phone,email,booking_type,booking_date,start_time,number_of_people,message)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[id,b.fullName,b.phone,b.email||null,b.bookingType,b.date,b.time,b.visitors,b.message||null]);
 res.status(201).json({ok:true,id});
});

app.get('/api/admin/dashboard',requireAdmin,async(req,res)=>{
 const r=await q(`SELECT COUNT(*)::int total,
  COUNT(*) FILTER(WHERE status='pending')::int pending,
  COUNT(*) FILTER(WHERE status='confirmed')::int confirmed,
  COUNT(*) FILTER(WHERE status='cancelled')::int cancelled,
  COUNT(*) FILTER(WHERE booking_date>=CURRENT_DATE AND status IN ('pending','confirmed'))::int upcoming
  FROM bookings`);
 const recent=await q(`SELECT id,customer_name,phone,email,booking_type,booking_date,start_time,end_time,number_of_people,message,status,created_at,updated_at
   FROM bookings ORDER BY created_at DESC LIMIT 20`);
 res.json({stats:r.rows[0],recent:recent.rows});
});
app.get('/api/admin/bookings',requireAdmin,async(req,res)=>{
 const limit=Math.min(Math.max(Number(req.query.limit)||100,1),200);
 const search=String(req.query.search||'').trim().slice(0,100);
 const params=[];let where='';
 if(search){params.push(`%${search}%`);where=`WHERE customer_name ILIKE $1 OR phone ILIKE $1 OR booking_type ILIKE $1`;}
 params.push(limit);
 const r=await q(`SELECT id,customer_name,phone,email,booking_type,booking_date,start_time,end_time,number_of_people,message,status,created_at,updated_at
 FROM bookings ${where} ORDER BY created_at DESC LIMIT $${params.length}`,params);
 res.json({bookings:r.rows});
});
app.patch('/api/admin/bookings/:id',requireAdmin,verifyCsrf,async(req,res)=>{
 const parsed=z.object({status:z.enum(['pending','confirmed','cancelled','completed'])}).safeParse(req.body);
 if(!parsed.success)return res.status(400).json({error:'Invalid status'});
 const r=await q('UPDATE bookings SET status=$1,updated_at=NOW() WHERE id=$2 RETURNING id,status',[parsed.data.status,req.params.id]);
 if(!r.rowCount)return res.status(404).json({error:'Booking not found'});
 await audit(req,'booking_status_updated',req.params.id,{status:parsed.data.status});res.json(r.rows[0]);
});
app.delete('/api/admin/bookings/:id',requireAdmin,verifyCsrf,async(req,res)=>{
 const r=await q('DELETE FROM bookings WHERE id=$1 RETURNING id',[req.params.id]);
 if(!r.rowCount)return res.status(404).json({error:'Booking not found'});
 await audit(req,'booking_deleted',req.params.id);res.json({ok:true});
});

const upload=multer({
 storage:multer.memoryStorage(),limits:{fileSize:Number(process.env.MAX_UPLOAD_MB||8)*1024*1024,files:1},
 fileFilter:(req,file,cb)=>cb(null,['image/jpeg','image/png','image/webp'].includes(file.mimetype))
});
const slotKeys=new Set(['hero','about','service-nature','service-restaurant','service-hotel','service-zoo','service-sports','service-pool','activities-1','activities-2','activities-3','activities-4','gallery-1','gallery-2','gallery-3','gallery-4','gallery-5','gallery-6']);
app.get('/api/admin/images',requireAdmin,async(req,res)=>{
 const r=await q('SELECT slot_key,storage_name,mime_type,width,height,size_bytes FROM site_images ORDER BY slot_key');
 res.json({images:r.rows.map(x=>({...x,url:`/uploads/${encodeURIComponent(x.storage_name)}`}))});
});
app.post('/api/admin/images/:slot',requireAdmin,verifyCsrf,upload.single('image'),async(req,res)=>{
 const slot=req.params.slot;
 if(!slotKeys.has(slot))return res.status(400).json({error:'Invalid image slot'});
 if(!req.file)return res.status(400).json({error:'Only JPEG, PNG and WebP images are allowed.'});
 const meta=await sharp(req.file.buffer,{failOn:'error'}).metadata();
 if(!meta.width||!meta.height||meta.width>8000||meta.height>8000)return res.status(400).json({error:'Invalid image dimensions.'});
 const id=crypto.randomUUID();const storage=`${id}.webp`;const out=path.join(UPLOAD_DIR,storage);
 await sharp(req.file.buffer).rotate().resize({width:2400,height:2400,fit:'inside',withoutEnlargement:true}).webp({quality:82}).toFile(out);
 const stat=fs.statSync(out);
 const old=await q('SELECT storage_name FROM site_images WHERE slot_key=$1',[slot]);
 await q(`INSERT INTO site_images(slot_key,original_name,storage_name,mime_type,width,height,size_bytes)
 VALUES($1,$2,$3,'image/webp',$4,$5,$6)
 ON CONFLICT(slot_key) DO UPDATE SET original_name=EXCLUDED.original_name,storage_name=EXCLUDED.storage_name,mime_type='image/webp',width=EXCLUDED.width,height=EXCLUDED.height,size_bytes=EXCLUDED.size_bytes,updated_at=NOW()`,
 [slot,req.file.originalname.slice(0,255),storage,meta.width,meta.height,stat.size]);
 if(old.rowCount){try{fs.unlinkSync(path.join(UPLOAD_DIR,old.rows[0].storage_name))}catch{}}
 await audit(req,'image_uploaded',slot,{filename:storage});res.status(201).json({ok:true,url:`/uploads/${encodeURIComponent(storage)}`});
});
app.delete('/api/admin/images/:slot',requireAdmin,verifyCsrf,async(req,res)=>{
 const r=await q('DELETE FROM site_images WHERE slot_key=$1 RETURNING storage_name',[req.params.slot]);
 if(!r.rowCount)return res.json({ok:true});
 try{fs.unlinkSync(path.join(UPLOAD_DIR,r.rows[0].storage_name))}catch{}
 await audit(req,'image_deleted',req.params.slot);res.json({ok:true});
});

app.use('/uploads',express.static(UPLOAD_DIR,{fallthrough:false,maxAge:'7d',index:false,setHeaders:(res)=>{res.setHeader('X-Content-Type-Options','nosniff');}}));
app.use(express.static(ROOT,{index:'index.html',extensions:['html']}));
app.use((err,req,res,next)=>{req.log?.error(err);if(err instanceof multer.MulterError)return res.status(400).json({error:'Upload rejected.'});res.status(500).json({error:'Internal server error'});});
app.listen(PORT,()=>console.log(`Farm site running on http://localhost:${PORT}`));
