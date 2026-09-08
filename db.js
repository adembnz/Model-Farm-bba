import 'dotenv/config';
import pg from 'pg';
const {Pool}=pg;
export const pool=new Pool({connectionString:process.env.DATABASE_URL, max:10, ssl:process.env.NODE_ENV==='production'?{rejectUnauthorized:false}:undefined});
pool.on('error',err=>console.error('Unexpected PostgreSQL pool error',err));
export const q=(text,params)=>pool.query(text,params);
