import 'dotenv/config';
import readline from 'node:readline/promises';
import {stdin as input, stdout as output} from 'node:process';
import bcrypt from 'bcryptjs';
import {pool,q} from './db.js';
const rl=readline.createInterface({input,output});
const username=(await rl.question('Admin username/email: ')).trim().toLowerCase();
const password=await rl.question('Admin password (min 12 chars): ');
rl.close();
if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username) && !/^[a-zA-Z0-9._-]{3,190}$/.test(username)) throw new Error('Invalid username');
if(password.length<12) throw new Error('Password must be at least 12 characters');
const hash=await bcrypt.hash(password,12);
await q(`INSERT INTO users(username,password_hash) VALUES($1,$2)
ON CONFLICT(username) DO UPDATE SET password_hash=EXCLUDED.password_hash,status='active',updated_at=NOW()`,[username,hash]);
console.log('Admin created/updated successfully.');
await pool.end();
