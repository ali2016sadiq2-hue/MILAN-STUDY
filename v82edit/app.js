const $=id=>document.getElementById(id);
let me=null,timer={seconds:0,running:false,startedAt:0,base:0},tickTimer=null,liveTimer=null,taskTimer=null;
async function api(url,o={}){const r=await fetch(url,{credentials:'include',headers:{'Content-Type':'application/json',...(o.headers||{})},...o});const d=await r.json().catch(()=>({ok:false,error:'SERVER'}));if(!r.ok)throw d;return d}
function fmt(s){s=Math.max(0,Math.floor(s||0));return [Math.floor(s/3600),Math.floor(s/60)%60,s%60].map(x=>String(x).padStart(2,'0')).join(':')}
function shortTime(s){s=Math.floor(s||0);if(s<60)return `${s} ث`;if(s<3600)return `${Math.floor(s/60)} د`;return `${Math.floor(s/3600)} س ${Math.floor(s/60)%60} د`}
function arabic(n){return String(Math.round(n||0)).replace(/\d/g,d=>'٠١٢٣٤٥٦٧٨٩'[d])}
function hms(s){return `${arabic(Math.floor((s||0)/3600))} س ${arabic(Math.floor((s||0)/60)%60)} د`}
function notify(t){const x=$('toast');if(!x)return;x.textContent=t;x.classList.add('show');clearTimeout(notify.t);notify.t=setTimeout(()=>x.classList.remove('show'),2200)}
function openModal(id){$(id)?.classList.add('show');if(id==='friendsModal')loadFriends();if(id==='accountModal')loadProfile();if(id==='liveModal')loadLive(true)}
function closeModal(id){$(id)?.classList.remove('show')}
document.querySelectorAll('[data-close]').forEach(x=>x.onclick=()=>closeModal(x.dataset.close));
function avatar(a){return a||'assets/profile.svg'}
async function loadMe(){try{me=(await api('/api/me')).user;renderIdentity()}catch(e){showAuth()}}
function renderIdentity(){if(!me)return;const n=$('profileName'),u=$('profileUsername'),a=document.querySelector('.account-avatar');if(n)n.value=me.name;if(u)u.value=me.username;if(a)a.src=avatar(me.avatar)}
function showAuth(){const m=document.createElement('div');m.className='modal show';m.id='authModal';m.innerHTML=`<div class="modal-card auth-card"><h3>MILAN STUDY</h3><p class="modal-sub">سجّل دخولك حتى تبقى جلساتك وأصدقاؤك ومهامك محفوظة.</p><div class="auth-tabs"><button id="loginTab" class="selected">دخول</button><button id="registerTab">إنشاء حساب</button></div><div id="authForm"></div></div>`;document.body.appendChild(m);renderAuth('login')}
function renderAuth(mode){const f=$('authForm');f.innerHTML=mode==='login'?`<label>Username<input id="authUser" autocomplete="username"></label><label>كلمة المرور<input id="authPass" type="password"></label><button class="save-profile" id="authGo">دخول</button><p class="auth-error" id="authErr"></p>`:`<label>الاسم الكامل<input id="authName"></label><label>Username<input id="authUser"></label><label>كلمة المرور<input id="authPass" type="password"></label><button class="save-profile" id="authGo">إنشاء الحساب</button><p class="auth-error" id="authErr"></p>`;$('loginTab').classList.toggle('selected',mode==='login');$('registerTab').classList.toggle('selected',mode==='register');$('loginTab').onclick=()=>renderAuth('login');$('registerTab').onclick=()=>renderAuth('register');$('authGo').onclick=async()=>{try{const b=mode==='login'?{username:$('authUser').value,password:$('authPass').value}:{name:$('authName').value,username:$('authUser').value,password:$('authPass').value};const r=await api(mode==='login'?'/api/login':'/api/register',{method:'POST',body:JSON.stringify(b)});me=r.user;$('authModal').remove();renderIdentity();boot()}catch(e){$('authErr').textContent=e.error==='USERNAME_TAKEN'?'هذا اليوزر مستخدم بالفعل':e.error==='LOGIN_FAILED'?'بيانات الدخول غير صحيحة':'تحقق من البيانات وكلمة المرور (6 أحرف على الأقل)'}}}
function currentSeconds(){return timer.running?timer.base+Math.floor((Date.now()-timer.startedAt)/1000):timer.seconds}
function updateTimer(){const sec=currentSeconds();if($('timer'))$('timer').textContent=fmt(sec);if($('timerStatus'))$('timerStatus').textContent=timer.running?'جلسة مستمرة الآن':(sec?'استراحة — الوقت محفوظ':'جاهز للبدء؟');const hero=$('heroStart');if(hero)hero.innerHTML=timer.running?'الدراسة مستمرة <span>●</span>':(sec?'استئناف التركيز <span>▶</span>':'بدء التركيز <span>◎</span>');const ring=$('focusRing');if(ring)ring.classList.toggle('running',timer.running)}
async function syncSession(){try{const r=await api('/api/study/current');timer.seconds=r.seconds||0;timer.running=r.status==='studying';timer.base=timer.seconds;timer.startedAt=Date.now();clearInterval(tickTimer);if(timer.running)tickTimer=setInterval(updateTimer,1000);updateTimer()}catch(e){}}
async function start(){try{if(timer.running)return;const r=await api('/api/study/start',{method:'POST',body:'{}'});timer.seconds=r.seconds||0;timer.base=timer.seconds;timer.startedAt=Date.now();timer.running=true;clearInterval(tickTimer);tickTimer=setInterval(updateTimer,1000);updateTimer();await loadStats();await loadLive();notify(timer.seconds?'تم استئناف جلسة التركيز':'بدأت جلسة التركيز ✦')}catch(e){notify('تعذر بدء المؤقت')}}
async function pause(){try{const r=await api('/api/study/pause',{method:'POST',body:'{}'});timer.seconds=r.seconds||0;timer.running=false;clearInterval(tickTimer);updateTimer();await Promise.all([loadStats(),loadLive()]);notify('استراحة — بقيت في ترتيب يدرسون الآن')}catch(e){notify('لا توجد جلسة جارية')}}
async function reset(){try{const r=await api('/api/study/reset',{method:'POST',body:'{}'});timer={seconds:0,running:false,startedAt:0,base:0};clearInterval(tickTimer);updateTimer();await Promise.all([loadStats(),loadLive()]);notify(`تمت إعادة المؤقت وحفظ ${fmt(r.saved||0)} في سجل الدراسة`)}catch(e){notify('تعذر إعادة المؤقت')}}
$('startBtn')?.addEventListener('click',start);$('heroStart')?.addEventListener('click',start);$('pauseBtn')?.addEventListener('click',pause);$('resetBtn')?.addEventListener('click',reset);
async function loadStats(){try{const r=await api('/api/stats');if($('weekStat'))$('weekStat').textContent=hms(r.week);if($('todayStat'))$('todayStat').textContent=hms(r.today);if($('rankStat'))$('rankStat').textContent='#'+r.rank;if($('modalTodayStat'))$('modalTodayStat').textContent=hms(r.today);if($('modalWeekStat'))$('modalWeekStat').textContent=hms(r.week);if($('modalTotalStat'))$('modalTotalStat').textContent=hms(r.total||r.all_time||0);if($('modalRankStat'))$('modalRankStat').textContent='#'+r.rank;if($('todayCount'))$('todayCount').textContent=arabic(r.session_count||0);renderBars(r)}catch(e){}}
function renderBars(r){const el=$('fakeBars');if(!el)return;const rows=(r.days||[]).slice(-7);const vals=rows.map(x=>Number(x.seconds)||0);const max=Math.max(1,...vals);el.innerHTML=(rows.length?rows:[]).map((x,i)=>{const pct=Math.max(8,Math.round((Number(x.seconds)||0)/max*100));const d=new Date(x.day+'T12:00:00');const label=new Intl.DateTimeFormat('ar-IQ',{weekday:'short'}).format(d);return `<div class="bar-col"><span style="height:${pct}%" title="${hms(x.seconds)}"></span><small>${label}</small></div>`}).join('')||`<div class="chart-empty">ابدأ الدراسة ليظهر نشاطك هنا</div>`}
async function loadLive(modal=false){try{const all=(await api('/api/live')).students||[],five=all.slice(0,5);const card=s=>`<button class="live-person ${s.status==='paused'?'is-paused':''}" data-open-user="${s.username}"><span class="person-avatar"><img src="${avatar(s.avatar)}"><i class="${s.status}"></i></span><b>${s.name}</b><small>${s.status==='paused'?'استراحة':'يدرس الآن'} · ${fmt(s.seconds)}</small></button>`;if($('liveCards'))$('liveCards').innerHTML=five.map((s,i)=>`<button class="live-card ${s.status==='paused'?'paused-card':''}" data-open-user="${escapeHtml(s.username)}"><span class="live-rank">${i+1}</span><img src="${avatar(s.avatar)}"><div class="live-person-main"><b>${escapeHtml(s.name)}</b><small>@${escapeHtml(s.username)}</small></div><div class="live-time"><strong>${fmt(s.seconds)}</strong><span class="status-pill ${s.status}">${s.status==='paused'?'متوقف':'يدرس الآن'}</span></div></button>`).join('')||`<div class="no-friends">لا يوجد طلاب في القائمة الآن.</div>`;if($('livePreview')){$('livePreview').innerHTML=`<div class="live-strip">${five.map(card).join('')}</div>`}document.querySelectorAll('[data-open-user]').forEach(b=>b.onclick=()=>openStudent(b.dataset.openUser));if(modal&&$('liveList')){$('liveList').innerHTML=all.map((s,i)=>`<button class="student-row" data-live-user="${s.username}"><span class="rank-badge">${i+1}</span><img src="${avatar(s.avatar)}"><span class="student-info"><b>${s.name}</b><small>@${s.username}</small></span><span class="student-time"><strong>${fmt(s.seconds)}</strong><small class="${s.status}">${s.status==='paused'?'متوقف مؤقتاً':'يدرس الآن'}</small></span></button>`).join('')||`<div class="no-friends">لا يوجد طلاب في القائمة.</div>`;document.querySelectorAll('[data-live-user]').forEach(b=>b.onclick=()=>openStudent(b.dataset.liveUser))}}catch(e){}}
async function openStudent(username){
 try{
  const r=await api('/api/user-stats?username='+encodeURIComponent(username));
  const state=r.friend_state||'none';
  let action='';
  if(r.user.username===me.username) action='<button class="save-profile" data-student-close>إغلاق</button>';
  else if(state==='friends') action='<div class="student-actions"><button class="save-profile" data-student-chat>💬 مراسلة</button><span class="friend-ok">✓ صديق</span></div>';
  else if(state==='outgoing') action='<span class="friend-pending">⏳ طلب صداقة مرسل</span>';
  else if(state==='incoming') action='<button class="save-profile" data-student-friends>👥 لديك طلب صداقة منه</button>';
  else action='<button class="save-profile" data-student-add>＋ إضافة صديق</button>';
  $('friendStatsBody').innerHTML=`<div class="friend-profile"><img src="${avatar(r.user.avatar)}"><div><h3>${escapeHtml(r.user.name)}</h3><small>@${escapeHtml(r.user.username)}</small><span class="${r.presence.status}">${r.presence.status==='studying'?'يدرس الآن':r.presence.status==='paused'?'استراحة':'غير متصل'}</span></div></div><div class="stats-big-grid"><div><small>اليوم</small><strong>${hms(r.today)}</strong></div><div><small>هذا الأسبوع</small><strong>${hms(r.week)}</strong></div><div><small>الإجمالي</small><strong>${hms(r.total)}</strong></div><div><small>الجلسة الحالية</small><strong>${fmt(r.presence.seconds)}</strong></div></div>${action}`;
  openModal('friendStatsModal');
  $('friendStatsBody').querySelector('[data-student-close]')?.addEventListener('click',()=>closeModal('friendStatsModal'));
  $('friendStatsBody').querySelector('[data-student-chat]')?.addEventListener('click',()=>{openChat(r.user.username);closeModal('friendStatsModal')});
  $('friendStatsBody').querySelector('[data-student-add]')?.addEventListener('click',()=>addFriendFromProfile(r.user.username));
  $('friendStatsBody').querySelector('[data-student-friends]')?.addEventListener('click',()=>{closeModal('friendStatsModal');openModal('friendsModal');loadFriends()});
 }catch(e){notify('تعذر تحميل بيانات الطالب')}
}
async function addFriendFromProfile(username){try{await api('/api/friends/add',{method:'POST',body:JSON.stringify({query:username})});await loadFriends();notify('تم إرسال طلب الصداقة ✓')}catch(e){notify(e.error==='ALREADY_EXISTS'?'الطلب أو الصداقة موجودة بالفعل':'تعذر إرسال الطلب')}}
async function loadFriends(){try{const [f,req]=await Promise.all([api('/api/friends'),api('/api/requests')]);const accepted=f.friends||[];const badge=$('friendBadge');if(badge){const n=req.requests.length;badge.textContent=arabic(n);badge.classList.toggle('has',n>0)}let html='';if(req.requests.length)html+=`<h4 class="list-title">طلبات الصداقة <span>${arabic(req.requests.length)}</span></h4>`+req.requests.map(x=>`<div class="friend-row request-row"><img src="${avatar(x.user.avatar)}"><div><b>${x.user.name}</b><small>@${x.user.username}</small><em>طلب صداقة جديد</em></div><button class="mini-btn" data-accept="${x.id}">قبول</button><button class="mini-btn ghost" data-reject="${x.id}">رفض</button></div>`).join('');html+=`<h4 class="list-title">أصدقائي <span>${arabic(accepted.length)}</span></h4>`+(accepted.map(x=>`<div class="friend-row rich"><img src="${avatar(x.user.avatar)}"><div class="friend-main"><b>${x.user.name}</b><small>@${x.user.username}</small><em class="${x.user.presence.status}">${x.user.presence.status==='studying'?'يدرس الآن':x.user.presence.status==='paused'?'استراحة':'غير متصل'}</em></div><div class="friend-time"><strong>${fmt(x.user.presence.seconds)}</strong><small>اليوم ${shortTime(x.user.today)}</small></div><button class="mini-btn" data-msg-user="${x.user.username}">مراسلة</button><button class="mini-btn ghost" data-friend-stats="${x.user.username}">إحصائيات</button></div>`).join('')||`<div class="no-friends">لا توجد أصدقاء مقبولون بعد. عندما يقبل الطرف الآخر الطلب ستظهر الصداقة هنا تلقائياً.</div>`);$('friendsList').innerHTML=html;document.querySelectorAll('[data-accept]').forEach(b=>b.onclick=()=>respondFriend(b.dataset.accept,'accept'));document.querySelectorAll('[data-reject]').forEach(b=>b.onclick=()=>respondFriend(b.dataset.reject,'reject'));document.querySelectorAll('[data-msg-user]').forEach(b=>b.onclick=()=>openChat(b.dataset.msgUser));document.querySelectorAll('[data-friend-stats]').forEach(b=>b.onclick=()=>openFriendStats(b.dataset.friendStats))}catch(e){notify('تعذر تحميل قائمة الأصدقاء')}}
async function respondFriend(id,action){try{await api('/api/friends/respond',{method:'POST',body:JSON.stringify({id:Number(id),action})});await loadFriends();notify(action==='accept'?'تم قبول الصداقة ✓ وأضيف إلى قائمة أصدقائك':'تم رفض الطلب')}catch(e){notify('تعذر تحديث الطلب')}}
$('addFriendBtn')?.addEventListener('click',async()=>{try{const q=$('friendQuery').value.trim();if(!q)return notify('اكتب اليوزر أو الاسم الكامل');await api('/api/friends/add',{method:'POST',body:JSON.stringify({query:q})});$('friendQuery').value='';notify('تم إرسال طلب الصداقة ✓');loadFriends()}catch(e){notify(e.error==='USER_NOT_FOUND'?'لم يتم العثور على الحساب':e.error==='ALREADY_EXISTS'?'الطلب أو الصداقة موجودة بالفعل':'تعذر الإضافة')}});
async function openFriendStats(username){await openStudent(username)}
async function loadProfile(){if(!me)return;renderIdentity();$('avatarPicker').innerHTML=`<div class="studio-upload"><label class="upload-btn">▧ اختيار صورة من الاستديو<input id="avatarFile" type="file" accept="image/*" hidden></label><small>اختر صورة من معرض/استديو الجهاز — لا نستخدم الكاميرا.</small></div>`;$('avatarFile').onchange=async e=>{const file=e.target.files[0];if(!file)return;const fd=new FormData();fd.append('avatar',file);const r=await fetch('/api/profile/avatar',{method:'PUT',body:fd,credentials:'include'});const d=await r.json();if(d.ok){me.avatar=d.avatar;renderIdentity();notify('تم تحديث صورة الحساب ✓')}else notify('تعذر رفع الصورة')}}
$('saveProfile')?.addEventListener('click',async()=>{try{await api('/api/profile',{method:'POST',body:JSON.stringify({name:$('profileName').value,username:$('profileUsername').value})});me=(await api('/api/me')).user;closeModal('accountModal');notify('تم حفظ الحساب ✓')}catch(e){notify(e.error==='USERNAME_TAKEN'?'اليوزر مستخدم بالفعل':'تعذر حفظ الحساب')}});
let activeTaskFilter='all';
async function loadTasks(){try{const r=await api('/api/tasks'),tasks=r.tasks||[],done=tasks.filter(x=>x.done).length,total=tasks.length,remaining=total-done,pct=total?Math.round(done/total*100):0;if($('taskDoneCount'))$('taskDoneCount').textContent=arabic(done);if($('taskTotalCount'))$('taskTotalCount').textContent=arabic(total);if($('taskRemainingCount'))$('taskRemainingCount').textContent=arabic(remaining);if($('taskPercent'))$('taskPercent').textContent=pct+'%';if($('taskPercent'))$('taskPercent').parentElement.style.setProperty('--task-pct',(pct*3.6));if($('taskCountLabel'))$('taskCountLabel').textContent=`${arabic(total)} مهام`;if($('taskProgressHint'))$('taskProgressHint').textContent=total===0?'ابدأ بمهمتك الأولى!':done===total?'ممتاز! أنجزت كل مهامك!':'أنت على الطريق الصحيح!';if($('goalProgressFill'))$('goalProgressFill').style.width=pct+'%';if($('goalProgressText'))$('goalProgressText').textContent=`${arabic(done)} من ${arabic(total)} مهام منجزة`;let visible=tasks;if(activeTaskFilter==='study')visible=tasks.filter(t=>(t.subject||'').match(/رياض|كيمي|فيز|أحياء|دراس|إنج|قراءة/i));if(activeTaskFilter==='projects')visible=tasks.filter(t=>(t.subject||'').match(/مشروع|project/i));if(activeTaskFilter==='personal')visible=tasks.filter(t=>!t.subject);if($('tasksList'))$('tasksList').innerHTML=visible.map((t,i)=>`<article class="task-item ${t.done?'done':''}"><div class="task-main"><button class="task-check" data-task-toggle="${t.id}">${t.done?'✓':''}</button><div class="task-copy"><b>${escapeHtml(t.title)}</b>${t.done?`<span class="task-done-text">تم إنجاز المهمة ✓</span>`:`<span>${t.subject?escapeHtml(t.subject):'مهمة دراسية'}</span>`}</div></div><div class="task-meta">${t.subject?`<em>${escapeHtml(t.subject)}</em>`:''}<small>${t.done?'✓ مكتملة':'⏱ غير مكتملة'}</small></div><button class="task-menu" data-task-delete="${t.id}">⋮</button></article>`).join('')||`<div class="tasks-empty card"><div>✦</div><b>لا توجد مهام هنا</b><span>أضف أول مهمة وابدأ يومك الدراسي بخطوة صغيرة.</span></div>`;document.querySelectorAll('[data-task-toggle]').forEach(b=>b.onclick=async()=>{await api('/api/tasks/toggle',{method:'POST',body:JSON.stringify({id:Number(b.dataset.taskToggle)})});loadTasks()});document.querySelectorAll('[data-task-delete]').forEach(b=>b.onclick=async()=>{await api('/api/tasks/delete',{method:'POST',body:JSON.stringify({id:Number(b.dataset.taskDelete)})});loadTasks()})}catch(e){notify('تعذر تحميل المهام')}}
function escapeHtml(s){return String(s||'').replace(/[&<>'"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m]))}
$('addTaskBtn')?.addEventListener('click',async()=>{const title=$('taskTitle').value.trim(),subject=$('taskSubject').value.trim();if(!title)return notify('اكتب اسم المهمة أولاً');try{await api('/api/tasks/add',{method:'POST',body:JSON.stringify({title,subject})});$('taskTitle').value='';$('taskSubject').value='';await loadTasks();notify('تمت إضافة المهمة ✓')}catch(e){notify('تعذر إضافة المهمة')}});
function openTasks(){$('tasksPage').hidden=false;document.body.classList.add('tasks-mode');$('bottomNav')?.classList.add('is-hidden');window.scrollTo({top:0,behavior:'instant'});loadTasks()}
function closeTasks(){if(!$('tasksPage'))return;$('tasksPage').hidden=true;document.body.classList.remove('tasks-mode');$('bottomNav')?.classList.remove('is-hidden');window.scrollTo({top:0,behavior:'smooth'})}
$('openTasks')?.addEventListener('click',openTasks);$('closeTasks')?.addEventListener('click',closeTasks);document.querySelectorAll('[data-task-filter]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('[data-task-filter]').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');activeTaskFilter=b.dataset.taskFilter;loadTasks()}));$('floatingAddTask')?.addEventListener('click',()=>document.getElementById('taskTitle')?.focus());$('viewAllLive')?.addEventListener('click',()=>{loadLive(true);openModal('liveModal')});
$('openAccountCard')?.addEventListener('click',()=>openModal('accountModal'));$('openLiveCard')?.addEventListener('click',()=>openModal('liveModal'));
document.querySelectorAll('.bottom-nav button').forEach(b=>b.onclick=()=>{
 document.querySelectorAll('.bottom-nav button').forEach(x=>x.classList.remove('active'));
 b.classList.add('active');
 const tab=b.dataset.tab;
 if(tab==='home'){closeTasks();window.scrollTo({top:0,behavior:'smooth'})}
 if(tab==='friends'){closeTasks();openModal('friendsModal');loadFriends()}
 if(tab==='focus'){closeTasks();$('focusRing')?.scrollIntoView({behavior:'smooth',block:'center'})}
 if(tab==='stats'){closeTasks();loadStats();openModal('statsModal')}
 if(tab==='account'){closeTasks();openModal('accountModal')}
});
async function boot(){await Promise.all([syncSession(),loadStats(),loadLive(),loadFriends(),loadTasks()]);clearInterval(liveTimer);liveTimer=setInterval(()=>{loadLive();loadStats();loadFriends()},5000);clearInterval(taskTimer);taskTimer=setInterval(()=>{if($('tasksPage')&&!$('tasksPage').hidden)loadTasks()},10000)}

/* MILAN FINAL — real private chat UI */
let chatUser=null, chatTimer=null;
async function openChat(username){
  try{
    const r=await api('/api/user-stats?username='+encodeURIComponent(username));
    chatUser=r.user;
    $('chatPage').hidden=false;
    document.body.classList.add('chat-mode');
    $('bottomNav')?.classList.add('is-hidden');
    $('chatName').textContent=chatUser.name;
    $('chatAvatar').src=avatar(chatUser.avatar);
    setChatStatus(r.presence);
    await loadChatMessages();
    clearInterval(chatTimer); chatTimer=setInterval(loadChatMessages,3000);
    $('chatInput')?.focus();
  }catch(e){notify(e.error==='NOT_FRIEND'?'المراسلة متاحة بعد قبول الصداقة':'تعذر فتح المحادثة')}
}
function setChatStatus(p){
  const el=$('chatStatus'); if(!el)return;
  el.textContent=p?.status==='studying'?'يدرس الآن':p?.status==='paused'?'استراحة':'غير متصل';
  el.style.color=p?.status==='studying'?'#7ad46e':p?.status==='paused'?'#d5c47c':'#9ab59a';
}
async function loadChatMessages(){
  if(!chatUser)return;
  try{
    const r=await api('/api/messages?user='+encodeURIComponent(chatUser.username));
    const box=$('chatMessages');
    const msgs=r.messages||[];
    box.innerHTML=msgs.length?msgs.map(m=>{
      const mine=Number(m.sender_id)===Number(me.id);
      const t=new Date((m.created_at||0)*1000).toLocaleTimeString('ar-IQ',{hour:'numeric',minute:'2-digit'});
      return `<article class="chat-bubble ${mine?'mine':'theirs'}"><div>${escapeHtml(m.body)}</div><div class="chat-meta"><span>${t}</span>${mine?`<span class="chat-check">${m.read_at?'✓✓':'✓'}</span>`:''}</div></article>`;
    }).join(''):`<div class="chat-empty"><div class="chat-empty-icon">♡</div><b>ابدأ المحادثة</b><p>أرسل أول رسالة إلى ${escapeHtml(chatUser.name)}.</p></div>`;
    box.scrollTop=box.scrollHeight;
    setChatStatus((await api('/api/user-stats?username='+encodeURIComponent(chatUser.username))).presence);
    await api('/api/messages/read',{method:'POST',body:JSON.stringify({username:chatUser.username})}).catch(()=>{});
  }catch(e){ if(e.error==='NOT_FRIEND') closeChat(); }
}
async function sendChat(){
  if(!chatUser)return;
  const input=$('chatInput'),body=input.value.trim();
  if(!body)return;
  try{
    await api('/api/messages/send',{method:'POST',body:JSON.stringify({username:chatUser.username,body})});
    input.value=''; await loadChatMessages();
  }catch(e){notify(e.error==='NOT_FRIEND'?'هذه المحادثة تحتاج صداقة مقبولة':'تعذر إرسال الرسالة')}
}
function closeChat(){
  clearInterval(chatTimer);chatTimer=null;chatUser=null;
  $('chatPage').hidden=true;document.body.classList.remove('chat-mode');$('bottomNav')?.classList.remove('is-hidden');
}
$('chatBack')?.addEventListener('click',closeChat);
$('chatSend')?.addEventListener('click',sendChat);
$('chatInput')?.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendChat()}});
$('chatEmoji')?.addEventListener('click',()=>{const i=$('chatInput');i.value+=(i.value?' ':'')+'😊';i.focus()});
$('chatAttach')?.addEventListener('click',()=>{ $('chatFile')?.click() });
$('chatFile')?.addEventListener('change',e=>{const f=e.target.files?.[0];if(f){$('chatInput').value+=($('chatInput').value?' ':'')+'📎 '+f.name;notify('تمت إضافة اسم الملف إلى الرسالة');e.target.value=''}});
$('chatCall')?.addEventListener('click',()=>notify('الاتصال الصوتي سيكون متاحاً في المرحلة القادمة'));
$('chatVideo')?.addEventListener('click',()=>notify('مكالمة الفيديو ستكون متاحة في المرحلة القادمة'));
$('chatMore')?.addEventListener('click',()=>notify('خيارات المحادثة: إحصائيات، حالة الصديق، والعودة'));
$('prevDay')?.addEventListener('click',()=>changeDate(-1));
$('nextDay')?.addEventListener('click',()=>changeDate(1));
let viewDate=new Date();
function changeDate(delta){viewDate.setDate(viewDate.getDate()+delta);const el=$('dateText');if(el)el.textContent=new Intl.DateTimeFormat('ar-IQ',{weekday:'long',year:'numeric',month:'numeric',day:'numeric'}).format(viewDate);}

changeDate(0);loadMe().then(()=>{if(me)boot()});

/* MILAN V10 EXPERIENCE LAYER — interactive color, sounds, notifications, mini timer */
let userSettings={notifications:true,sounds:true,neon:true,mini_timer:true,blocker:false,blocked_apps:[]};
let deferredInstall=null;
function playTone(type='tap'){
  if(!userSettings.sounds)return;
  try{
    const C=window.AudioContext||window.webkitAudioContext;if(!C)return;const ctx=new C();
    const o=ctx.createOscillator(),g=ctx.createGain();o.connect(g);g.connect(ctx.destination);
    const map={tap:[420,.035],start:[620,.09],pause:[320,.07],done:[760,.12],notify:[520,.08]};
    const [freq,dur]=map[type]||map.tap;o.frequency.value=freq;o.type='sine';g.gain.setValueAtTime(.0001,ctx.currentTime);g.gain.exponentialRampToValueAtTime(.045,ctx.currentTime+.01);g.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+dur);o.start();o.stop(ctx.currentTime+dur+.02);
  }catch(e){}
}
async function loadSettings(){try{const r=await api('/api/settings');userSettings=r.settings||userSettings;applyExperience();renderSettings();}catch(e){}}
function applyExperience(){document.body.classList.toggle('neon-mode',!!userSettings.neon);document.body.classList.toggle('blocker-active',!!userSettings.blocker);}
function renderSettings(){
  ['Notifications','Sounds','Neon','Mini'].forEach(k=>{const el=$('set'+k);if(el)el.checked=!!userSettings[{Notifications:'notifications',Sounds:'sounds',Neon:'neon',Mini:'mini_timer'}[k]]});
  const bl=$('setBlocker');if(bl)bl.checked=!!userSettings.blocker;
  document.querySelectorAll('#blockedApps button').forEach(b=>b.classList.toggle('selected',(userSettings.blocked_apps||[]).includes(b.dataset.app)));
}
async function saveSettings(){
  const blocked=[...document.querySelectorAll('#blockedApps button.selected')].map(b=>b.dataset.app);
  try{const r=await api('/api/settings',{method:'POST',body:JSON.stringify({notifications:$('setNotifications')?.checked,sounds:$('setSounds')?.checked,neon:$('setNeon')?.checked,mini_timer:$('setMini')?.checked,blocker:$('setBlocker')?.checked,blocked_apps:blocked})});userSettings=r.settings||userSettings;applyExperience();notify('تم حفظ الإعدادات ✦');playTone('done');}catch(e){notify('تعذر حفظ الإعدادات')}}
async function openSettings(){await loadSettings();openModal('settingsModal')}
$('openSettings')?.addEventListener('click',openSettings);
$('saveSettings')?.addEventListener('click',saveSettings);
document.querySelectorAll('#blockedApps button').forEach(b=>b.addEventListener('click',()=>{b.classList.toggle('selected');playTone('tap')}));
$('openStatsQuick')?.addEventListener('click',()=>{loadStats();openModal('statsModal')});
$('lastSessionStart')?.addEventListener('click',start);

async function ensureNotifications(){
  if(!userSettings.notifications || !('Notification' in window))return false;
  try{if(Notification.permission==='default')await Notification.requestPermission();return Notification.permission==='granted'}catch(e){return false}
}
function sendStudyNotification(title,body){
  if(!userSettings.notifications||!('Notification' in window)||Notification.permission!=='granted')return;
  try{new Notification(title,{body,icon:'assets/profile.svg',tag:'milan-study'})}catch(e){}
}
function updateMini(){
  const el=$('miniTimer');if(!el)return;
  const sec=currentSeconds();$('miniTimerText').textContent=fmt(sec);$('miniTimerState').textContent=timer.running?'جلسة مستمرة':'استراحة — الوقت محفوظ';
  $('miniResume').textContent=timer.running?'Ⅱ':'▶';el.classList.toggle('paused',!timer.running);
}
function showMini(){if(!userSettings.mini_timer)return;const el=$('miniTimer');if(el){el.hidden=false;updateMini()}}
function hideMini(){const el=$('miniTimer');if(el)el.hidden=true}
$('miniResume')?.addEventListener('click',()=>{playTone(timer.running?'pause':'start');timer.running?pause():start();updateMini()});
$('miniExpand')?.addEventListener('click',()=>{hideMini();window.scrollTo({top:0,behavior:'smooth'});$('focusRing')?.scrollIntoView({behavior:'smooth',block:'center'})});
async function launchMiniWindow(){
  if(!timer.running&&timer.seconds===0)return notify('ابدأ جلسة التركيز أولاً');
  if(document.pictureInPictureEnabled && $('miniVideo')){try{await $('miniVideo').requestPictureInPicture();return}catch(e){}}
  const w=window.open(location.href,'milanMini','width=380,height=300,resizable=yes');
  if(w)notify('تم فتح نافذة صغيرة للمؤقت');else notify('اضغط على السماح بالنوافذ المنبثقة لفتح المؤقت المصغر');
}
$('launchMiniTimer')?.addEventListener('click',launchMiniWindow);

// Replace the original start/pause/reset effects without changing the API contract.
const _start=start,_pause=pause,_reset=reset;
start=async function(){playTone(timer.running?'tap':'start');await ensureNotifications();await _start();if(timer.running)sendStudyNotification('MILAN — جلسة التركيز بدأت','المؤقت مستمر. ارجع عندما تنتهي من جلستك.');updateMini();};
pause=async function(){playTone('pause');await _pause();updateMini();if(!timer.running)sendStudyNotification('MILAN — استراحة','جلسة الدراسة متوقفة مؤقتاً. يمكنك استئنافها متى شئت.');};
reset=async function(){playTone('done');await _reset();updateMini();};

// Keep home content alive and make the page feel less empty.
const _loadStats=loadStats;
loadStats=async function(){await _loadStats();try{const r=await api('/api/stats');if($('homeTodayActivity'))$('homeTodayActivity').textContent=hms(r.today);if($('homeSessionsActivity'))$('homeSessionsActivity').textContent=arabic(r.session_count||0);if($('homeLastSession'))$('homeLastSession').textContent=r.last_session?shortTime(r.last_session.duration||0):'—';if($('lastSessionTitle'))$('lastSessionTitle').textContent=r.last_session?'آخر جلسة دراسة':'جاهز لجلسة جديدة؟';if($('lastSessionMeta'))$('lastSessionMeta').textContent=r.last_session?`جلسة محفوظة • ${shortTime(r.last_session.duration||0)}`:'ابدأ الآن، وسنتذكر تقدمك تلقائياً.';}catch(e){}};

// Subtle button micro-interactions and sound feedback.
document.addEventListener('pointerdown',e=>{const b=e.target.closest('button');if(!b||b.id==='startBtn'||b.id==='pauseBtn'||b.id==='resetBtn')return;b.classList.add('pressing');setTimeout(()=>b.classList.remove('pressing'),180);});

// Visibility: notify the student and surface the mini state when returning. Browser security prevents an app from forcibly drawing over other apps.
document.addEventListener('visibilitychange',async()=>{
  if(document.hidden&&timer.running){showMini();sendStudyNotification('MILAN — المؤقت مستمر ⏱️',`درست ${fmt(currentSeconds())}. جلستك مستمرة في الخلفية.`);}
  if(!document.hidden){hideMini();await syncSession();updateMini();}
});

// Installable PWA support.
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstall=e;$('installHint')?.removeAttribute('hidden')});
$('installBtn')?.addEventListener('click',async()=>{if(!deferredInstall)return;deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;$('installHint')?.setAttribute('hidden','hidden')});
$('installClose')?.addEventListener('click',()=>$('installHint')?.setAttribute('hidden','hidden'));
if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});

// First load settings after the authenticated boot.
const _boot=boot;
boot=async function(){await _boot();await loadSettings();updateMini();};
// Rebind timer controls after the experience wrapper is installed.
$('startBtn')?.addEventListener('click',start);$('heroStart')?.addEventListener('click',start);$('pauseBtn')?.addEventListener('click',pause);$('resetBtn')?.addEventListener('click',reset);
