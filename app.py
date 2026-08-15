#!/usr/bin/env python3
import os, re, json, time, uuid, sqlite3, hashlib, secrets, mimetypes
from datetime import datetime, timezone, timedelta
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from email.parser import BytesParser
from email.policy import default

BASE=os.path.dirname(os.path.abspath(__file__))
DB=os.path.join(BASE,'milan.db'); UPLOADS=os.path.join(BASE,'uploads')
os.makedirs(UPLOADS,exist_ok=True)
HOST=os.environ.get('HOST','0.0.0.0'); PORT=int(os.environ.get('PORT','20047'))
SESSION_HOURS=168; PRESENCE_TTL=24*3600

def db():
 c=sqlite3.connect(DB,timeout=10); c.row_factory=sqlite3.Row; c.execute('PRAGMA foreign_keys=ON'); return c

def init_db():
 c=db(); c.executescript('''
 CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,username TEXT NOT NULL COLLATE NOCASE UNIQUE,password_hash TEXT NOT NULL,avatar_url TEXT DEFAULT '',created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS study_sessions(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,started_at INTEGER NOT NULL,ended_at INTEGER,duration INTEGER DEFAULT 0,status TEXT DEFAULT 'finished');
 CREATE TABLE IF NOT EXISTS daily_totals(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,day TEXT NOT NULL,seconds INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(user_id,day));
 CREATE TABLE IF NOT EXISTS friends(id INTEGER PRIMARY KEY AUTOINCREMENT,requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,addressee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,status TEXT NOT NULL DEFAULT 'pending',created_at INTEGER NOT NULL,UNIQUE(requester_id,addressee_id));
 CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY AUTOINCREMENT,sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,body TEXT NOT NULL,created_at INTEGER NOT NULL,read_at INTEGER);
 CREATE TABLE IF NOT EXISTS goals(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,title TEXT NOT NULL,done INTEGER DEFAULT 0,created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS tasks(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,title TEXT NOT NULL,subject TEXT DEFAULT '',done INTEGER DEFAULT 0,created_at INTEGER NOT NULL,completed_at INTEGER);
 CREATE TABLE IF NOT EXISTS presence(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,status TEXT NOT NULL DEFAULT 'paused',session_id INTEGER,seconds INTEGER NOT NULL DEFAULT 0,started_at INTEGER,updated_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS user_settings(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,notifications INTEGER NOT NULL DEFAULT 1,sounds INTEGER NOT NULL DEFAULT 1,neon INTEGER NOT NULL DEFAULT 1,mini_timer INTEGER NOT NULL DEFAULT 1,blocker INTEGER NOT NULL DEFAULT 0,blocked_apps TEXT NOT NULL DEFAULT '[]');
 '''); c.commit(); c.close()

def now(): return int(time.time())
def baghdad_day(ts=None):
 if ts is None: ts=now()
 return datetime.fromtimestamp(ts,timezone.utc).astimezone(timezone(timedelta(hours=3))).strftime('%Y-%m-%d')
def day_offset(n):
 d=datetime.fromisoformat(baghdad_day())-timedelta(days=n); return d.strftime('%Y-%m-%d')
def hash_password(pw,salt=None):
 salt=salt or secrets.token_hex(16); digest=hashlib.scrypt(pw.encode(),salt=bytes.fromhex(salt),n=16384,r=8,p=1); return salt+'$'+digest.hex()
def check_password(pw,stored):
 try:
  salt,digest=stored.split('$',1); return secrets.compare_digest(hash_password(pw,salt).split('$',1)[1],digest)
 except Exception:return False
def clean_username(v): return re.sub(r'[^A-Za-z0-9_.-]','',(v or '').strip().lower())[:24]
def user_public(r): return {'id':r['id'],'name':r['name'],'username':r['username'],'avatar':r['avatar_url'] or ''}
def token_for(uid):
 t=secrets.token_urlsafe(40); c=db(); c.execute('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)',(t,uid,now()+SESSION_HOURS*3600)); c.commit(); c.close(); return t
def current_user(h):
 m=re.search(r'(?:^|;\s*)milan_session=([^;]+)',h.headers.get('Cookie',''))
 if not m:return None
 c=db(); r=c.execute('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>?',(m.group(1),now())).fetchone(); c.close(); return r
def json_body(h):
 n=int(h.headers.get('Content-Length','0') or 0); return json.loads(h.rfile.read(n).decode('utf-8') or '{}')
def public_presence(c,uid):
 p=c.execute('SELECT * FROM presence WHERE user_id=?',(uid,)).fetchone()
 if not p:return {'status':'offline','seconds':0}
 sec=p['seconds']+(max(0,now()-p['started_at']) if p['status']=='studying' and p['started_at'] else 0)
 return {'status':p['status'],'seconds':max(0,sec),'session_id':p['session_id']}
def upsert_presence(c,uid,status,seconds=0,session_id=None,started_at=None):
 c.execute('''INSERT INTO presence(user_id,status,session_id,seconds,started_at,updated_at) VALUES(?,?,?,?,?,?)
 ON CONFLICT(user_id) DO UPDATE SET status=excluded.status,session_id=excluded.session_id,seconds=excluded.seconds,started_at=excluded.started_at,updated_at=excluded.updated_at''',(uid,status,session_id,seconds,started_at,now()))

def add_daily(c,uid,seconds,day=None):
 if seconds<=0:return
 day=day or baghdad_day(); c.execute('''INSERT INTO daily_totals(user_id,day,seconds) VALUES(?,?,?) ON CONFLICT(user_id,day) DO UPDATE SET seconds=seconds+excluded.seconds''',(uid,day,seconds))

def finalize_session(c,s,save=True):
 sec=s['duration']+(max(0,now()-s['started_at']) if s['status']=='running' else 0)
 c.execute("UPDATE study_sessions SET status='finished',ended_at=?,duration=? WHERE id=?",(now(),sec,s['id']))
 if save:add_daily(c,s['user_id'],sec)
 return sec

class Handler(BaseHTTPRequestHandler):
 protocol_version='HTTP/1.1'
 def log_message(self,*args):pass
 def send_json(self,obj,status=200,cookie=None):
  raw=json.dumps(obj,ensure_ascii=False).encode(); self.send_response(status); self.send_header('Content-Type','application/json; charset=utf-8'); self.send_header('Content-Length',str(len(raw))); self.send_header('Cache-Control','no-store'); self.send_header('Access-Control-Allow-Origin','*')
  if cookie:self.send_header('Set-Cookie',cookie)
  self.end_headers(); self.wfile.write(raw)
 def send_file(self,path,ctype=None):
  try:data=open(path,'rb').read()
  except FileNotFoundError:return self.send_error(404)
  self.send_response(200); self.send_header('Content-Type',ctype or mimetypes.guess_type(path)[0] or 'application/octet-stream'); self.send_header('Content-Length',str(len(data))); self.send_header('Cache-Control','no-cache'); self.end_headers(); self.wfile.write(data)
 def require(self):
  u=current_user(self)
  if not u:self.send_json({'ok':False,'error':'UNAUTHENTICATED'},401); return None
  return u
 def do_OPTIONS(self):
  self.send_response(204); self.send_header('Access-Control-Allow-Origin','*'); self.send_header('Access-Control-Allow-Headers','Content-Type'); self.send_header('Access-Control-Allow-Methods','GET,POST,PUT,OPTIONS'); self.end_headers()
 def do_GET(self):
  p=urlparse(self.path).path
  if p in ('/','/index.html'):return self.send_file(os.path.join(BASE,'index.html'),'text/html; charset=utf-8')
  if p in ('/styles.css','/app.js','/manifest.webmanifest','/sw.js'):return self.send_file(os.path.join(BASE,p[1:]))
  if p.startswith('/assets/'):
   rel=os.path.normpath(p.lstrip('/')); return self.send_file(os.path.join(BASE,rel)) if rel.startswith('assets/') and '..' not in rel else self.send_error(404)
  if p.startswith('/uploads/'):return self.send_file(os.path.join(UPLOADS,os.path.basename(p)))
  if p.startswith('/api/'):return self.api_get(p)
  return self.send_error(404)
 def do_POST(self):
  p=urlparse(self.path).path
  if p.startswith('/api/'):return self.api_post(p)
  return self.send_error(404)
 def do_PUT(self):
  p=urlparse(self.path).path
  if p.startswith('/api/'):return self.api_put(p)
  return self.send_error(404)
 def api_get(self,p):
  # Public auth endpoints
  if p=='/api/me':
   u=self.require()
   if not u:return
   return self.send_json({'ok':True,'user':user_public(u)})
  u=self.require()
  if not u:return
  c=db(); uid=u['id']
  if p=='/api/study/current':
   pr=public_presence(c,uid); self.send_json({'ok':True,**pr}); c.close(); return
  if p=='/api/settings':
   r=c.execute('SELECT * FROM user_settings WHERE user_id=?',(uid,)).fetchone()
   if not r:
    c.execute('INSERT OR IGNORE INTO user_settings(user_id) VALUES(?)',(uid,)); c.commit(); r=c.execute('SELECT * FROM user_settings WHERE user_id=?',(uid,)).fetchone()
   self.send_json({'ok':True,'settings':{'notifications':bool(r['notifications']),'sounds':bool(r['sounds']),'neon':bool(r['neon']),'mini_timer':bool(r['mini_timer']),'blocker':bool(r['blocker']),'blocked_apps':json.loads(r['blocked_apps'] or '[]')}}); c.close(); return
  if p=='/api/stats':
   total=c.execute("SELECT COALESCE(SUM(duration),0) x FROM study_sessions WHERE user_id=? AND status='finished'",(uid,)).fetchone()['x']
   session_count=c.execute('SELECT COUNT(*) n FROM study_sessions WHERE user_id=? AND date(started_at,\'unixepoch\',\'+3 hours\')=?',(uid,baghdad_day())).fetchone()['n']
   today=c.execute('SELECT COALESCE(SUM(seconds),0) x FROM daily_totals WHERE user_id=? AND day=?',(uid,baghdad_day())).fetchone()['x']
   pr=public_presence(c,uid); live_today=pr['seconds'] if pr['status'] in ('studying','paused') else 0
   week=0
   for i in range(7): week+=c.execute('SELECT COALESCE(SUM(seconds),0) x FROM daily_totals WHERE user_id=? AND day=?',(uid,day_offset(i))).fetchone()['x']
   rows=c.execute('SELECT day,seconds FROM daily_totals WHERE user_id=? ORDER BY day DESC LIMIT 60',(uid,)).fetchall()
   streak=0
   for i in range(60):
    if c.execute('SELECT COALESCE(SUM(seconds),0) x FROM daily_totals WHERE user_id=? AND day=?',(uid,day_offset(i))).fetchone()['x']>0:streak+=1
    else:break
   friends=c.execute('''SELECT CASE WHEN requester_id=? THEN addressee_id ELSE requester_id END fid FROM friends WHERE status='accepted' AND (requester_id=? OR addressee_id=?)''',(uid,uid,uid)).fetchall(); ids=[uid]+[r['fid'] for r in friends]
   totals={x:c.execute("SELECT COALESCE(SUM(duration),0) x FROM study_sessions WHERE user_id=? AND status='finished'",(x,)).fetchone()['x'] for x in ids}
   rank=1+sum(1 for x in totals.values() if x>totals[uid])
   last=c.execute("SELECT id,started_at,duration,status,ended_at FROM study_sessions WHERE user_id=? ORDER BY id DESC LIMIT 1",(uid,)).fetchone()
   last_data=dict(last) if last else None
   self.send_json({'ok':True,'today':today+live_today,'week':week+live_today,'total':total+live_today,'streak':streak,'rank':rank,'session_count':session_count,'days':[dict(r) for r in rows],'last_session':last_data}); c.close(); return
  if p=='/api/live':
   rows=c.execute('''SELECT u.id,u.name,u.username,u.avatar_url,p.status,p.seconds,p.started_at,p.updated_at FROM presence p JOIN users u ON u.id=p.user_id
    WHERE p.status IN ('studying','paused') AND p.updated_at>? ORDER BY CASE p.status WHEN 'studying' THEN 0 ELSE 1 END, (p.seconds + CASE WHEN p.status='studying' THEN ?-p.started_at ELSE 0 END) DESC LIMIT 50''',(now()-PRESENCE_TTL,now())).fetchall()
   out=[]
   for r in rows:
    sec=r['seconds']+(max(0,now()-r['started_at']) if r['status']=='studying' and r['started_at'] else 0); out.append({'id':r['id'],'name':r['name'],'username':r['username'],'avatar':r['avatar_url'] or '','status':r['status'],'seconds':sec})
   self.send_json({'ok':True,'students':out}); c.close(); return
  if p=='/api/friends':
   rows=c.execute('''SELECT f.id,f.status,f.requester_id,f.addressee_id,u.id uid,u.name,u.username,u.avatar_url
     FROM friends f JOIN users u ON u.id=CASE WHEN f.requester_id=? THEN f.addressee_id ELSE f.requester_id END
     WHERE (f.requester_id=? OR f.addressee_id=?) AND f.status='accepted' ORDER BY f.created_at DESC''',(uid,uid,uid)).fetchall(); out=[]
   for r in rows:
    st=c.execute("SELECT COALESCE(SUM(duration),0) x FROM study_sessions WHERE user_id=? AND status='finished'",(r['uid'],)).fetchone()['x']; pr=public_presence(c,r['uid']); today=c.execute('SELECT COALESCE(SUM(seconds),0) x FROM daily_totals WHERE user_id=? AND day=?',(r['uid'],baghdad_day())).fetchone()['x']+(pr['seconds'] if pr['status']=='studying' else 0)
    out.append({'id':r['id'],'status':'accepted','user':{'id':r['uid'],'name':r['name'],'username':r['username'],'avatar':r['avatar_url'] or '','total':st,'today':today,'presence':pr}})
   pending_sent=c.execute("SELECT COUNT(*) n FROM friends WHERE requester_id=? AND status='pending'",(uid,)).fetchone()['n']
   pending_received=c.execute("SELECT COUNT(*) n FROM friends WHERE addressee_id=? AND status='pending'",(uid,)).fetchone()['n']
   self.send_json({'ok':True,'friends':out,'pending_sent':pending_sent,'pending_received':pending_received}); c.close(); return
  if p=='/api/requests':
   rows=c.execute('SELECT f.id,u.id uid,u.name,u.username,u.avatar_url FROM friends f JOIN users u ON u.id=f.requester_id WHERE f.addressee_id=? AND f.status=\'pending\'',(uid,)).fetchall(); self.send_json({'ok':True,'requests':[{'id':r['id'],'user':{'id':r['uid'],'name':r['name'],'username':r['username'],'avatar':r['avatar_url'] or ''}} for r in rows]}); c.close(); return
  if p.startswith('/api/user-stats'):
   q=parse_qs(urlparse(self.path).query); username=clean_username(q.get('username',[''])[0]); target=c.execute('SELECT * FROM users WHERE username=? COLLATE NOCASE',(username,)).fetchone()
   if not target:self.send_json({'ok':False,'error':'USER_NOT_FOUND'},404);c.close();return
   rel=c.execute('SELECT status,requester_id,addressee_id FROM friends WHERE (requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?) ORDER BY id DESC LIMIT 1',(uid,target['id'],target['id'],uid)).fetchone()
   friend_state='none'
   if rel:
    if rel['status']=='accepted': friend_state='friends'
    elif rel['status']=='pending': friend_state='outgoing' if int(rel['requester_id'])==uid else 'incoming'
   total=c.execute("SELECT COALESCE(SUM(duration),0) x FROM study_sessions WHERE user_id=? AND status='finished'",(target['id'],)).fetchone()['x']; today=c.execute('SELECT COALESCE(SUM(seconds),0) x FROM daily_totals WHERE user_id=? AND day=?',(target['id'],baghdad_day())).fetchone()['x']; pr=public_presence(c,target['id']); today+=pr['seconds'] if pr['status'] in ('studying','paused') else 0
   week=sum(c.execute('SELECT COALESCE(SUM(seconds),0) x FROM daily_totals WHERE user_id=? AND day=?',(target['id'],day_offset(i))).fetchone()['x'] for i in range(7))+(pr['seconds'] if pr['status'] in ('studying','paused') else 0)
   self.send_json({'ok':True,'user':user_public(target),'today':today,'week':week,'total':total+ (pr['seconds'] if pr['status'] in ('studying','paused') else 0),'presence':pr,'friend_state':friend_state}); c.close(); return
  if p=='/api/conversations':
   sql="""SELECT u.id,u.name,u.username,u.avatar_url,MAX(m.created_at) last_at,
    (SELECT body FROM messages z WHERE ((z.sender_id=? AND z.receiver_id=u.id) OR (z.sender_id=u.id AND z.receiver_id=?)) ORDER BY z.id DESC LIMIT 1) last_body,
    COALESCE((SELECT COUNT(*) FROM messages z WHERE z.sender_id=u.id AND z.receiver_id=? AND z.read_at IS NULL),0) unread
    FROM users u JOIN messages m ON ((m.sender_id=? AND m.receiver_id=u.id) OR (m.sender_id=u.id AND m.receiver_id=?))
    WHERE u.id<>? GROUP BY u.id ORDER BY last_at DESC"""
   rows=c.execute(sql,(uid,uid,uid,uid,uid,uid)).fetchall()
   self.send_json({'ok':True,'conversations':[dict(r) for r in rows]}); c.close(); return
  if p=='/api/tasks':
   rows=c.execute('SELECT id,title,subject,done,created_at,completed_at FROM tasks WHERE user_id=? ORDER BY done ASC,id DESC',(uid,)).fetchall(); self.send_json({'ok':True,'tasks':[dict(r) for r in rows]}); c.close(); return
  if p=='/api/goals':
   rows=c.execute('SELECT id,title,done FROM goals WHERE user_id=? ORDER BY id DESC',(uid,)).fetchall(); self.send_json({'ok':True,'goals':[dict(r) for r in rows]}); c.close(); return
  if p.startswith('/api/messages'):
   q=parse_qs(urlparse(self.path).query); other=clean_username(q.get('user',[''])[0]); r=c.execute('SELECT id FROM users WHERE username=? COLLATE NOCASE',(other,)).fetchone()
   if not r:self.send_json({'ok':False,'error':'USER_NOT_FOUND'},404);c.close();return
   rel=c.execute('SELECT 1 FROM friends WHERE status=\'accepted\' AND ((requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?))',(uid,r['id'],r['id'],uid)).fetchone()
   if not rel and r['id']!=uid:self.send_json({'ok':False,'error':'NOT_FRIEND'},403);c.close();return
   rows=c.execute('SELECT m.*,u.username sender_username FROM messages m JOIN users u ON u.id=m.sender_id WHERE (sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?) ORDER BY m.id DESC LIMIT 200',(uid,r['id'],r['id'],uid)).fetchall(); self.send_json({'ok':True,'messages':[dict(x) for x in reversed(rows)]}); c.close(); return
  c.close(); self.send_json({'ok':False,'error':'NOT_FOUND'},404)
 def api_post(self,p):
  if p in ('/api/register','/api/login'):
   try:b=json_body(self)
   except:self.send_json({'ok':False,'error':'BAD_JSON'},400);return
   c=db()
   if p=='/api/register':
    name=(b.get('name') or '').strip()[:60]; username=clean_username(b.get('username')); pw=b.get('password') or ''
    if len(name)<2 or len(username)<3 or len(pw)<6:self.send_json({'ok':False,'error':'INVALID_DATA'},400);c.close();return
    try:c.execute('INSERT INTO users(name,username,password_hash,created_at) VALUES(?,?,?,?)',(name,username,hash_password(pw),now()));uid=c.execute('SELECT last_insert_rowid()').fetchone()[0];upsert_presence(c,uid,'paused',0,None,None);c.execute('INSERT OR IGNORE INTO user_settings(user_id) VALUES(?)',(uid,));c.commit()
    except sqlite3.IntegrityError:self.send_json({'ok':False,'error':'USERNAME_TAKEN'},409);c.close();return
   else:
    u=c.execute('SELECT * FROM users WHERE username=? COLLATE NOCASE',(clean_username(b.get('username')),)).fetchone()
    if not u or not check_password(b.get('password') or '',u['password_hash']):self.send_json({'ok':False,'error':'LOGIN_FAILED'},401);c.close();return
    uid=u['id']; c.execute('INSERT OR IGNORE INTO presence(user_id,status,seconds,updated_at) VALUES(?,?,?,?)',(uid,'paused',0,now())); c.execute('INSERT OR IGNORE INTO user_settings(user_id) VALUES(?)',(uid,)); c.commit()
   u=c.execute('SELECT * FROM users WHERE id=?',(uid,)).fetchone();c.close(); token=token_for(uid); self.send_json({'ok':True,'user':user_public(u)},cookie=f'milan_session={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={SESSION_HOURS*3600}');return
  u=self.require()
  if not u:return
  try:b=json_body(self)
  except:b={}
  c=db();uid=u['id']
  if p=='/api/study/start':
   pr=c.execute('SELECT * FROM presence WHERE user_id=?',(uid,)).fetchone()
   if pr and pr['status']=='studying': self.send_json({'ok':True,'status':'studying','seconds':public_presence(c,uid)['seconds']});c.close();return
   if pr and pr['status']=='paused' and pr['session_id']:
    s=c.execute('SELECT * FROM study_sessions WHERE id=? AND user_id=?',(pr['session_id'],uid)).fetchone()
    if s:
     c.execute("UPDATE study_sessions SET status='running',started_at=? WHERE id=?",(now(),s['id']));upsert_presence(c,uid,'studying',s['duration'],s['id'],now());c.commit();c.close();self.send_json({'ok':True,'status':'studying','seconds':s['duration']});return
   c.execute("INSERT INTO study_sessions(user_id,started_at,status,duration) VALUES(?,?,?,0)",(uid,now(),'running'));sid=c.execute('SELECT last_insert_rowid()').fetchone()[0];upsert_presence(c,uid,'studying',0,sid,now());c.commit();c.close();self.send_json({'ok':True,'status':'studying','seconds':0});return
  if p=='/api/study/pause':
   s=c.execute("SELECT * FROM study_sessions WHERE user_id=? AND status='running' ORDER BY id DESC LIMIT 1",(uid,)).fetchone()
   if not s:self.send_json({'ok':False,'error':'NO_RUNNING_SESSION'},400);c.close();return
   sec=s['duration']+max(0,now()-s['started_at']);c.execute("UPDATE study_sessions SET status='paused',duration=? WHERE id=?",(sec,s['id']));upsert_presence(c,uid,'paused',sec,s['id'],None);c.commit();c.close();self.send_json({'ok':True,'seconds':sec,'status':'paused'});return
  if p=='/api/study/resume':
   pr=c.execute('SELECT * FROM presence WHERE user_id=?',(uid,)).fetchone();s=c.execute('SELECT * FROM study_sessions WHERE id=? AND user_id=? AND status=\'paused\'',((pr['session_id'] if pr else 0),uid)).fetchone() if pr and pr['session_id'] else None
   if not s:self.send_json({'ok':False,'error':'NO_PAUSED_SESSION'},400);c.close();return
   c.execute("UPDATE study_sessions SET status='running',started_at=? WHERE id=?",(now(),s['id']));upsert_presence(c,uid,'studying',s['duration'],s['id'],now());c.commit();c.close();self.send_json({'ok':True,'seconds':s['duration'],'status':'studying'});return
  if p=='/api/study/reset':
   pr=c.execute('SELECT * FROM presence WHERE user_id=?',(uid,)).fetchone();saved=0
   if pr and pr['session_id']:
    s=c.execute('SELECT * FROM study_sessions WHERE id=? AND user_id=? AND status IN (\'running\',\'paused\')',(pr['session_id'],uid)).fetchone()
    if s:saved=finalize_session(c,s,True)
   upsert_presence(c,uid,'paused',0,None,None);c.execute('INSERT OR IGNORE INTO user_settings(user_id) VALUES(?)',(uid,));c.commit();c.close();self.send_json({'ok':True,'seconds':0,'saved':saved,'status':'paused'});return
  if p=='/api/friends/add':
   q=(b.get('query') or '').strip();target=c.execute('SELECT * FROM users WHERE username=? COLLATE NOCASE',(clean_username(q),)).fetchone() or c.execute('SELECT * FROM users WHERE name=?',(q,)).fetchone()
   if not target:self.send_json({'ok':False,'error':'USER_NOT_FOUND'},404);c.close();return
   if target['id']==uid:self.send_json({'ok':False,'error':'SELF'},400);c.close();return
   ex=c.execute('SELECT * FROM friends WHERE (requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?)',(uid,target['id'],target['id'],uid)).fetchone()
   if ex:self.send_json({'ok':False,'error':'ALREADY_EXISTS','status':ex['status']},409);c.close();return
   c.execute('INSERT INTO friends(requester_id,addressee_id,status,created_at) VALUES(?,?,?,?)',(uid,target['id'],'pending',now()));c.commit();c.close();self.send_json({'ok':True,'status':'pending','user':user_public(target)});return
  if p=='/api/friends/respond':
   fid=int(b.get('id',0)); action=b.get('action');f=c.execute('SELECT * FROM friends WHERE id=? AND addressee_id=?',(fid,uid)).fetchone()
   if not f:self.send_json({'ok':False,'error':'NOT_FOUND'},404);c.close();return
   if action=='accept':
    c.execute("UPDATE friends SET status='accepted' WHERE id=?",(fid,))
    # Collapse any accidental reverse pending request so both accounts resolve to one accepted friendship.
    c.execute("DELETE FROM friends WHERE status='pending' AND id<>? AND ((requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?))",(fid,uid,f['requester_id'],f['addressee_id'],uid))
   elif action=='reject':c.execute('DELETE FROM friends WHERE id=?',(fid,))
   else:self.send_json({'ok':False,'error':'BAD_ACTION'},400);c.close();return
   c.commit();c.close();self.send_json({'ok':True});return
  if p=='/api/messages/send':
   other=clean_username(b.get('username'));body=(b.get('body') or '').strip()[:1000];r=c.execute('SELECT id FROM users WHERE username=? COLLATE NOCASE',(other,)).fetchone()
   if not r or not body:self.send_json({'ok':False,'error':'INVALID'},400);c.close();return
   rel=c.execute('SELECT 1 FROM friends WHERE status=\'accepted\' AND ((requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?))',(uid,r['id'],r['id'],uid)).fetchone()
   if not rel and r['id']!=uid:self.send_json({'ok':False,'error':'NOT_FRIEND'},403);c.close();return
   c.execute('INSERT INTO messages(sender_id,receiver_id,body,created_at) VALUES(?,?,?,?)',(uid,r['id'],body,now()));c.commit();c.close();self.send_json({'ok':True});return
  if p=='/api/messages/read':
   other=clean_username(b.get('username'));r=c.execute('SELECT id FROM users WHERE username=? COLLATE NOCASE',(other,)).fetchone()
   if not r:self.send_json({'ok':False,'error':'USER_NOT_FOUND'},404);c.close();return
   c.execute('UPDATE messages SET read_at=? WHERE sender_id=? AND receiver_id=? AND read_at IS NULL',(now(),r['id'],uid));c.commit();c.close();self.send_json({'ok':True});return
  if p=='/api/tasks/add':
   title=(b.get('title') or '').strip()[:100]; subject=(b.get('subject') or '').strip()[:50]
   if not title:self.send_json({'ok':False,'error':'EMPTY'},400);c.close();return
   c.execute('INSERT INTO tasks(user_id,title,subject,created_at) VALUES(?,?,?,?)',(uid,title,subject,now()));c.commit();c.close();self.send_json({'ok':True});return
  if p=='/api/tasks/toggle':
   tid=int(b.get('id',0)); row=c.execute('SELECT done FROM tasks WHERE id=? AND user_id=?',(tid,uid)).fetchone()
   if not row:self.send_json({'ok':False,'error':'NOT_FOUND'},404);c.close();return
   done=0 if row['done'] else 1; c.execute('UPDATE tasks SET done=?,completed_at=? WHERE id=? AND user_id=?',(done,now() if done else None,tid,uid));c.commit();c.close();self.send_json({'ok':True,'done':done});return
  if p=='/api/tasks/delete':
   c.execute('DELETE FROM tasks WHERE id=? AND user_id=?',(int(b.get('id',0)),uid));c.commit();c.close();self.send_json({'ok':True});return
  if p=='/api/goals/add':
   title=(b.get('title') or '').strip()[:100]
   if not title:self.send_json({'ok':False,'error':'EMPTY'},400);c.close();return
   c.execute('INSERT INTO goals(user_id,title,created_at) VALUES(?,?,?)',(uid,title,now()));c.commit();c.close();self.send_json({'ok':True});return
  if p=='/api/goals/delete':c.execute('DELETE FROM goals WHERE id=? AND user_id=?',(int(b.get('id',0)),uid));c.commit();c.close();self.send_json({'ok':True});return
  if p=='/api/settings':
   vals={k:b.get(k) for k in ('notifications','sounds','neon','mini_timer','blocker') if k in b}
   apps=b.get('blocked_apps')
   if apps is not None:
    try: apps=json.dumps([str(x)[:60] for x in apps][:30],ensure_ascii=False)
    except: apps='[]'
   sets=[]; args=[]
   for k,v in vals.items(): sets.append(k+'=?'); args.append(1 if bool(v) else 0)
   if apps is not None: sets.append('blocked_apps=?'); args.append(apps)
   if sets:
    c.execute('INSERT OR IGNORE INTO user_settings(user_id) VALUES(?)',(uid,)); args.append(uid); c.execute('UPDATE user_settings SET '+','.join(sets)+' WHERE user_id=?',args); c.commit()
   r=c.execute('SELECT * FROM user_settings WHERE user_id=?',(uid,)).fetchone(); c.close(); self.send_json({'ok':True,'settings':{'notifications':bool(r['notifications']),'sounds':bool(r['sounds']),'neon':bool(r['neon']),'mini_timer':bool(r['mini_timer']),'blocker':bool(r['blocker']),'blocked_apps':json.loads(r['blocked_apps'] or '[]')}}); return
  if p=='/api/profile':
   name=(b.get('name') or '').strip()[:60];username=clean_username(b.get('username'))
   if len(name)<2 or len(username)<3:self.send_json({'ok':False,'error':'INVALID_DATA'},400);c.close();return
   try:c.execute('UPDATE users SET name=?,username=? WHERE id=?',(name,username,uid));c.commit()
   except sqlite3.IntegrityError:self.send_json({'ok':False,'error':'USERNAME_TAKEN'},409);c.close();return
   c.close();self.send_json({'ok':True});return
  c.close();self.send_json({'ok':False,'error':'NOT_FOUND'},404)
 def api_put(self,p):
  u=self.require()
  if not u:return
  if p!='/api/profile/avatar':return self.send_json({'ok':False,'error':'NOT_FOUND'},404)
  ctype=self.headers.get('Content-Type',''); length=int(self.headers.get('Content-Length','0') or 0)
  if 'multipart/form-data' not in ctype or length>5*1024*1024:return self.send_json({'ok':False,'error':'IMAGE_REQUIRED'},400)
  raw=self.rfile.read(length); msg=BytesParser(policy=default).parsebytes(b'Content-Type: '+ctype.encode()+b'\r\n\r\n'+raw);part=next((x for x in msg.iter_attachments() if x.get_filename()),None)
  if not part:return self.send_json({'ok':False,'error':'NO_FILE'},400)
  data=part.get_payload(decode=True) or b''; typ=part.get_content_type();ext={'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp','image/gif':'.gif'}.get(typ)
  if not ext:return self.send_json({'ok':False,'error':'IMAGE_ONLY'},400)
  name=uuid.uuid4().hex+ext;open(os.path.join(UPLOADS,name),'wb').write(data);url='/uploads/'+name;c=db();c.execute('UPDATE users SET avatar_url=? WHERE id=?',(url,u['id']));c.commit();c.close();self.send_json({'ok':True,'avatar':url})

init_db();print(f'MILAN STUDY listening on {HOST}:{PORT}');ThreadingHTTPServer((HOST,PORT),Handler).serve_forever()
