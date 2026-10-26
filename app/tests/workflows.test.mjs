import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import WebSocket from 'ws';

process.env.NODE_ENV='test';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'kanban-tests-'));
process.env.DATA_DIR=directory;
process.env.ADMIN_PASSWORD='test-admin-only-2026';
const {server,wss,scanDueNotifications,runDueRules,runScheduledAutomations}=await import('../src/server.js');
const {db}=await import('../src/db.js');
const {dueInstant,nextOccurrence,companyDate}=await import('../src/dates.js');
server.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${server.address().port}`;
const tokens={},ids={};let a,b,listsA,listsB,card,label,field,group,item,comment,attachment;
after(async()=>{for(const c of wss.clients)c.terminate();await new Promise(r=>wss.close(r));await new Promise(r=>server.close(r));db.close();fs.rmSync(directory,{recursive:true,force:true});});
async function call(user,url,method='GET',body,expected=200) {
  const res=await fetch(base+'/api'+url,{method,headers:{'Content-Type':'application/json',...(tokens[user]?{Authorization:'Bearer '+tokens[user]}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const text=await res.text();let data;try{data=JSON.parse(text);}catch{data=text;}
  assert.equal(res.status,expected,`${method} ${url}: ${text}`);return data;
}
async function newCard(user='admin',list=listsA[0].id,title='Công việc kiểm thử') {return (await call(user,'/cards','POST',{list_id:list,title})).id;}
test('date arithmetic uses company timezone and clamps month-end',()=>{
  assert.equal(companyDate(new Date('2026-10-25T18:00:00Z')),'2026-10-26');
  assert.equal(dueInstant('2026-10-26','12:00'),Date.parse('2026-10-26T05:00:00Z'));
  assert.equal(nextOccurrence('2026-01-31','monthly'),'2026-02-28');
  assert.equal(nextOccurrence('2026-02-28','monthly',31),'2026-03-31');
  assert.equal(nextOccurrence('2028-01-31','monthly'),'2028-02-29');
  assert.equal(nextOccurrence('2026-12-31','daily'),'2027-01-01');
});
test('dynamic teams, private boards and explicit employee grants',async()=>{
  tokens.admin=(await call('','/login','POST',{username:'admin',password:process.env.ADMIN_PASSWORD})).token;ids.admin=1;
  for(const name of ['leaderA','leaderA2','leaderB','staffA','staffB','outsider']) {
    ids[name]=(await call('admin','/users','POST',{username:name.toLowerCase(),name,password:'test-only-password'})).id;
    tokens[name]=(await call('','/login','POST',{username:name.toLowerCase(),password:'test-only-password'})).token;
  }
  const teams=[];for(let i=1;i<=4;i++)teams.push((await call('admin','/teams','POST',{name:'Team '+i})).id);
  assert.equal((await call('admin','/teams')).teams.length,4);
  await call('admin',`/teams/${teams[0]}/members`,'PUT',{members:[{user_id:ids.leaderA,role:'leader'},{user_id:ids.leaderA2,role:'leader'},{user_id:ids.staffA,role:'member'}]});
  await call('admin',`/teams/${teams[1]}/members`,'PUT',{members:[{user_id:ids.leaderB,role:'leader'}]});
  await call('staffA','/boards','POST',{title:'Không được tạo'},403);
  a=(await call('admin','/boards','POST',{title:'Bảng A'})).id;b=(await call('admin','/boards','POST',{title:'Bảng B'})).id;
  await call('admin',`/boards/${a}/team`,'PUT',{team_id:teams[0]});await call('admin',`/boards/${b}/team`,'PUT',{team_id:teams[1]});
  await call('staffA',`/boards/${a}`,'GET',undefined,403);
  await call('admin',`/boards/${a}/members`,'PUT',{members:[{user_id:ids.staffA,role:'member'}]});
  const board=await call('leaderA',`/boards/${a}`);listsA=board.lists;listsB=(await call('admin',`/boards/${b}`)).lists;
  assert.equal(board.board.role,'manager');assert.equal(board.board.visibility,'private');
  assert.equal((await call('staffA','/boards')).boards.length,1);assert.equal((await call('outsider','/boards')).boards.length,0);
  await call('staffA',`/boards/${a}/members`,'PUT',{user_ids:[ids.outsider]},403);
  await call('staffA','/lists','POST',{board_id:a,title:'Không được tạo'},403);
  card=await newCard();await call('leaderA',`/cards/${card}/members`,'PUT',{user_ids:[ids.staffA]});
  label=(await call('leaderA',`/boards/${a}/labels`,'POST',{name:'Cần duyệt',color:'#eb5a46'})).id;
  field=(await call('leaderA',`/boards/${a}/fields`,'POST',{name:'Đã kiểm tra',type:'checkbox'})).id;
  await call('staffA',`/cards/${card}/labels`,'PUT',{label_ids:[label]});await call('staffA',`/cards/${card}/field/${field}`,'PUT',{value:true});
  group=(await call('staffA',`/cards/${card}/checklists`,'POST',{title:'Biên tập'})).id;
  item=(await call('leaderA',`/cards/${card}/checklist`,'POST',{text:'Kiểm tra kịch bản',group_id:group,user_id:ids.staffA,due_date:'2026-10-26',due_time:'20:00'})).id;
  comment=(await call('staffA',`/cards/${card}/comments`,'POST',{text:'Bình luận kiểm thử'})).id;
  attachment=(await call('staffA',`/cards/${card}/attachments`,'POST',{url:'https://example.com/file.pdf',name:'Tài liệu'})).id;
});
test('all resource reads/writes and nested references enforce board access',async()=>{
  const encodedCard=String(card).split('').map(c=>'%'+c.charCodeAt(0).toString(16)).join('');
  await call('outsider',`/cards/${encodedCard}/comments`,'GET',undefined,403);
  await call('outsider',`/CARDS/${card}/COMMENTS/`,'GET',undefined,403);
  await call('outsider',`/cards/${card}.0/comments`,'GET',undefined,400);
  await call('outsider',`/cards/${card}e0/comments`,'GET',undefined,400);
  await call('staffA',`/CARDS/${card}/MEMBERS/`,'PUT',{user_ids:[ids.leaderA]},403);
  await call('outsider',`/boards/%${String(a).charCodeAt(0).toString(16)}`,'PATCH',{title:'Không được đổi'},403);
  for(const url of [`/boards/${a}`,`/boards/${a}/archived`,`/boards/${a}/activity`,`/boards/${a}/export.csv`,`/cards/${card}/comments`,`/cards/${card}/attachments`,`/cards/${card}/activity`,`/cards/${card}/locate`,`/cards/${card}/review`])await call('outsider',url,'GET',undefined,403);
  for(const [url,method,body] of [[`/cards/${card}`,'PATCH',{title:'X'}],[`/cards/${card}/copy`,'POST',{}],[`/cards/${card}/join`,'POST',{}],[`/cards/${card}/mirror`,'POST',{list_id:listsB[0].id}],[`/checklist/${item}`,'PATCH',{checked:true}],[`/comments/${comment}`,'PATCH',{text:'X'}],[`/attachments/${attachment}`,'DELETE',{}],[`/boards/${a}/copy`,'POST',{}],[`/boards/${a}/background`,'POST',{}],[`/ai/card/${card}`,'POST',{action:'summary'}]]) await call('outsider',url,method,body,403);
  await call('staffA',`/cards/${card}/members`,'PUT',{user_ids:[ids.staffA,ids.outsider]},400);
  await call('staffA',`/cards/${card}/members`,'PUT',{user_ids:[ids.leaderA]},403);
  const otherField=(await call('admin',`/boards/${b}/fields`,'POST',{name:'Khác',type:'text'})).id;
  await call('staffA',`/cards/${card}/field/${otherField}`,'PUT',{value:'X'},400);
  await call('staffA',`/cards/${card}`,'PATCH',{list_id:listsB[0].id},403);
  await call('outsider','/planner','PUT',{card_id:card,date:'2026-10-26'},403);
  const inbox=(await call('outsider','/inbox','POST',{text:'Inbox riêng'})).id;
  await call('outsider',`/inbox/${inbox}/convert`,'POST',{list_id:listsA[0].id},403);
  assert.equal((await call('outsider','/inbox')).items.length,1);
  assert.equal((await call('outsider','/search?q=kiểm')).cards.length,0);
});
test('formal review cannot be bypassed; changes and approval are audited',async()=>{
  await call('staffA',`/cards/${card}`,'PATCH',{due_complete:true},409);
  await call('leaderA',`/cards/${card}/reviewer`,'PUT',{reviewer_id:ids.leaderA});
  await call('staffA',`/cards/${card}/review`,'POST',{action:'submit'});
  assert.equal(db.prepare('SELECT list_id FROM cards WHERE id=?').get(card).list_id,listsA[2].id);
  await call('staffA',`/cards/${card}/review`,'POST',{action:'approve'},403);
  await call('leaderA2',`/cards/${card}/review`,'POST',{action:'approve'},403);
  await call('leaderA',`/cards/${card}/review`,'POST',{action:'request_changes'},400);
  await call('leaderA',`/cards/${card}/review`,'POST',{action:'request_changes',note:'Bổ sung kết quả'});
  await call('staffA',`/cards/${card}/review`,'POST',{action:'submit'});
  const approved=await call('leaderA',`/cards/${card}/review`,'POST',{action:'approve'});
  assert.equal(approved.card.due_complete,1);assert.equal(approved.card.approval_state,'approved');assert.equal(approved.card.list_id,listsA[3].id);
  assert.equal((await call('staffA',`/cards/${card}/review`)).events.length,4);
  const leaderCard=await newCard();await call('admin',`/cards/${leaderCard}/members`,'PUT',{user_ids:[ids.leaderA]});
  await call('leaderA2',`/cards/${leaderCard}/reviewer`,'PUT',{reviewer_id:ids.leaderA2},400);
  await call('leaderA',`/cards/${leaderCard}/review`,'POST',{action:'submit'});
  await call('leaderA2',`/cards/${leaderCard}/review`,'POST',{action:'approve'},403);
  const result=await call('admin',`/cards/${leaderCard}/review`,'POST',{action:'approve'});assert.equal(result.card.due_complete,1);
});
test('comments edit ownership and reaction toggles',async()=>{
  await call('leaderA',`/comments/${comment}`,'PATCH',{text:'Không được sửa của người khác'},403);
  await call('staffA',`/comments/${comment}`,'PATCH',{text:'Đã sửa'});
  await call('leaderA',`/comments/${comment}/reactions`,'POST',{emoji:'👍'});
  let cm=(await call('staffA',`/cards/${card}/comments`)).comments[0];assert.equal(cm.text,'Đã sửa');assert.ok(cm.edited_at);assert.equal(cm.reactions[0].count,1);
  await call('leaderA',`/comments/${comment}/reactions`,'POST',{emoji:'👍'});cm=(await call('staffA',`/cards/${card}/comments`)).comments[0];assert.equal(cm.reactions.length,0);
});
test('overview/export respect access and include supported board data without credentials',async()=>{
  const view=await call('staffA','/overview');assert.equal(view.stats.boards,1);assert.ok(view.cards.every(c=>c.board_id===a));
  assert.equal((await call('outsider','/overview')).stats.total,0);
  const snapshot=await call('leaderA',`/boards/${a}/export.json`);assert.equal(snapshot.format,'company-kanban-board');assert.ok(snapshot.checklist_groups.length);assert.ok(snapshot.card_reviews.length);assert.ok(!JSON.stringify(snapshot).includes('password_hash'));
  await call('outsider',`/boards/${a}/export.json`,'GET',undefined,403);
  await call('leaderA',`/fields/${field}`,'PATCH',{name:'Đã đối chiếu'});assert.equal(db.prepare('SELECT name FROM board_fields WHERE id=?').get(field).name,'Đã đối chiếu');
  await call('staffA',`/fields/${field}`,'PATCH',{name:'Không được đổi'},403);
});
test('copy keeps date/time, fields, attachments and checklist metadata; resets completion',async()=>{
  await call('leaderA',`/cards/${card}`,'PATCH',{start_date:'2026-10-20',due_date:'2026-10-26',due_time:'20:00',recur:'monthly',remind:'15m'});
  await call('staffA',`/checklist/${item}`,'PATCH',{checked:true});
  const copied=(await call('staffA',`/cards/${card}/copy`,'POST',{title:'Bản sao đầy đủ',list_id:listsA[1].id})).id;
  const c=db.prepare('SELECT * FROM cards WHERE id=?').get(copied);assert.equal(c.due_time,'20:00');assert.equal(c.start_date,'2026-10-20');assert.equal(c.recur,'monthly');assert.equal(c.remind,'15m');assert.equal(c.due_complete,0);assert.equal(c.is_template,0);
  assert.equal(db.prepare('SELECT value FROM card_field_values WHERE card_id=?').get(copied).value,'1');assert.equal(db.prepare('SELECT COUNT(*) AS n FROM attachments WHERE card_id=?').get(copied).n,1);
  const ci=db.prepare('SELECT * FROM checklist_items WHERE card_id=?').get(copied);assert.equal(ci.checked,0);assert.equal(ci.user_id,ids.staffA);assert.equal(ci.due_time,'20:00');
  assert.equal(db.prepare('SELECT title FROM checklist_groups WHERE card_id=?').get(copied).title,'Biên tập');
  const before=db.prepare('SELECT COUNT(*) AS n FROM cards').get().n;
  await call('admin',`/cards/${card}/copy`,'POST',{list_id:listsB[0].id},409);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cards').get().n,before);
});
test('board copy preserves grants/roles, definitions and all automation families',async()=>{
  await call('leaderA',`/boards/${a}/rules`,'POST',{trigger_list_id:listsA[2].id,actions:{label_id:label,due_complete:true}});
  await call('leaderA',`/boards/${a}/schedules`,'POST',{cadence:'daily',actions:{sort:{list_id:listsA[0].id,by:'due'}}});
  await call('leaderA',`/boards/${a}/due-rules`,'POST',{trigger:'overdue',actions:{label_id:label}});
  await call('leaderA',`/boards/${a}/buttons`,'POST',{name:'Hoàn thành tự động',actions:{label_id:label,complete:true}});
  const copied=(await call('leaderA',`/boards/${a}/copy`,'POST',{})).id;
  const data=await call('staffA',`/boards/${copied}`);assert.equal(data.board.visibility,'private');assert.equal(data.boardMemberRoles.find(m=>m.user_id===ids.leaderA).role,'manager');
  assert.ok(data.fields.some(f=>f.name==='Đã đối chiếu'));assert.equal(data.rules.length,1);assert.equal(data.schedules.length,1);assert.equal(data.dueRules.length,1);assert.equal(data.cardButtons.length,1);
  await call('outsider',`/boards/${copied}`,'GET',undefined,403);
  const cid=await newCard();await call('staffA',`/cards/${cid}`,'PATCH',{list_id:listsA[2].id});assert.equal(db.prepare('SELECT due_complete FROM cards WHERE id=?').get(cid).due_complete,0);
  const button=(await call('leaderA',`/boards/${a}`)).cardButtons[0];await call('staffA',`/cards/${cid}/apply-button/${button.id}`,'POST',{},409);
  await call('leaderA',`/boards/${a}/rules`,'POST',{trigger_list_id:listsB[0].id,actions:{due_complete:true}},400);
});
test('cross-board move remaps labels/fields after destination access is granted',async()=>{
  await call('admin',`/boards/${b}/members`,'PUT',{members:[{user_id:ids.staffA,role:'member'}]});
  const copy=(await call('leaderA',`/cards/${card}/copy`,'POST',{})).id;
  await call('admin',`/cards/${copy}`,'PATCH',{list_id:listsB[0].id});
  const c=db.prepare('SELECT * FROM cards WHERE id=?').get(copy);assert.equal(c.list_id,listsB[0].id);assert.equal(c.due_time,'20:00');
  const labelRow=db.prepare('SELECT l.* FROM labels l JOIN card_labels cl ON cl.label_id=l.id WHERE cl.card_id=?').get(copy);assert.equal(labelRow.board_id,b);assert.equal(labelRow.name,'Cần duyệt');
  const fieldRow=db.prepare('SELECT f.*,v.value FROM board_fields f JOIN card_field_values v ON v.field_id=f.id WHERE v.card_id=?').get(copy);assert.equal(fieldRow.board_id,b);assert.equal(fieldRow.value,'1');
});
test('checklist conversion preserves assignee and due date/time',async()=>{
  const id=(await call('staffA',`/checklist/${item}/convert`,'POST',{})).id;
  const c=db.prepare('SELECT * FROM cards WHERE id=?').get(id);assert.equal(c.title,'Kiểm tra kịch bản');assert.equal(c.due_time,'20:00');assert.equal(c.due_complete,0);
  assert.equal(db.prepare('SELECT user_id FROM card_members WHERE card_id=?').get(id).user_id,ids.staffA);assert.equal(db.prepare('SELECT * FROM checklist_items WHERE id=?').get(item),undefined);
});
test('Planner includes due cards automatically and hides revoked or archived work',async()=>{
  const auto=(await call('staffA','/planner')).slots.find(s=>s.card_id===card);assert.equal(auto.automatic,true);assert.equal(auto.date,'2026-10-26');
  await call('staffA','/planner','PUT',{card_id:card,date:'2026-10-27'});let slots=(await call('staffA','/planner')).slots.filter(s=>s.card_id===card);assert.equal(slots.length,1);assert.equal(slots[0].date,'2026-10-27');
  const list=db.prepare('SELECT list_id FROM cards WHERE id=?').get(card).list_id;
  await call('leaderA',`/lists/${list}`,'PATCH',{archived:true});assert.ok(!(await call('staffA','/planner')).slots.some(s=>s.card_id===card));assert.ok(!(await call('staffA','/search?q=kiểm')).cards.some(c=>c.id===card));
  await call('leaderA',`/lists/${list}`,'PATCH',{archived:false});
});
test('precise reminders deduplicate and skip archived/closed/template work',async()=>{
  const id=await newCard();await call('leaderA',`/cards/${id}/members`,'PUT',{user_ids:[ids.staffA]});await call('staffA',`/cards/${id}`,'PATCH',{due_date:'2026-10-26',due_time:'12:00',remind:'5m'});
  const count=()=>db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE card_id=?').get(id).n;
  const initial=count();scanDueNotifications(new Date('2026-10-26T04:54:00Z'));assert.equal(count(),initial);
  scanDueNotifications(new Date('2026-10-26T04:55:00Z'));assert.equal(count(),initial+1);scanDueNotifications(new Date('2026-10-26T04:56:00Z'));assert.equal(count(),initial+1);
  await call('leaderA',`/lists/${listsA[0].id}`,'PATCH',{archived:true});scanDueNotifications(new Date('2026-10-26T06:00:00Z'));assert.equal(count(),initial+1);runDueRules();runScheduledAutomations();
  await call('leaderA',`/lists/${listsA[0].id}`,'PATCH',{archived:false});
  await call('staffA',`/cards/${id}`,'PATCH',{remind:'none'});scanDueNotifications(new Date('2026-10-26T06:00:00Z'));assert.equal(count(),initial+1);
});
test('approved recurring work starts a fresh review cycle and clears checklist/applied rules',async()=>{
  const id=await newCard();await call('leaderA',`/cards/${id}/members`,'PUT',{user_ids:[ids.staffA]});
  await call('staffA',`/cards/${id}`,'PATCH',{start_date:'2026-01-25',due_date:'2026-01-31',recur:'monthly'});
  const check=(await call('staffA',`/cards/${id}/checklist`,'POST',{text:'Đã xong',checked:true,due_date:'2026-01-30'})).id;
  await call('leaderA',`/cards/${id}/reviewer`,'PUT',{reviewer_id:ids.leaderA});await call('staffA',`/cards/${id}/review`,'POST',{action:'submit'});
  const approved=await call('leaderA',`/cards/${id}/review`,'POST',{action:'approve'});assert.equal(approved.card.due_date,'2026-02-28');assert.equal(approved.card.due_complete,0);assert.equal(approved.card.approval_state,'in_progress');assert.equal(db.prepare('SELECT checked FROM checklist_items WHERE id=?').get(check).checked,0);
  assert.equal(approved.card.start_date,'2026-02-22');assert.equal(db.prepare('SELECT due_date FROM checklist_items WHERE id=?').get(check).due_date,'2026-02-27');
  await call('staffA',`/cards/${id}/review`,'POST',{action:'submit'});const next=await call('leaderA',`/cards/${id}/review`,'POST',{action:'approve'});assert.equal(next.card.due_date,'2026-03-31');
});
test('list copy, move-all, archive-all and watch notifications preserve work',async()=>{
  const list=(await call('leaderA','/lists','POST',{board_id:a,title:'Cột kiểm thử hàng loạt'})).id;
  const first=await newCard('leaderA',list,'Thẻ trong cột');await call('staffA',`/lists/${list}/watch`,'POST',{});
  await call('leaderA',`/cards/${first}/comments`,'POST',{text:'Thông báo cho người theo dõi cột'});
  assert.ok(db.prepare("SELECT 1 FROM notifications WHERE user_id=? AND card_id=? AND type='comment'").get(ids.staffA,first));
  const copied=(await call('leaderA',`/lists/${list}/copy`,'POST',{title:'Cột bản sao'})).id;assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cards WHERE list_id=?').get(copied).n,1);
  await call('leaderA',`/lists/${copied}/move-cards`,'POST',{list_id:list});assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cards WHERE list_id=?').get(copied).n,0);
  await call('leaderA',`/lists/${list}/archive-cards`,'POST',{});assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cards WHERE list_id=? AND archived=0').get(list).n,0);
});
test('mirror never reveals source data to viewers without source permission',async()=>{
  await call('leaderA',`/cards/${card}`,'PATCH',{title:'Riêng-tư-gốc-không-lộ'});
  const mirror=(await call('admin',`/cards/${card}/mirror`,'POST',{list_id:listsB[0].id})).id;
  const allowed=await call('admin',`/boards/${b}`);assert.ok(allowed.cards.find(c=>c.id===mirror).source_label_ids.includes(label));
  const visible=await call('leaderB',`/boards/${b}`);assert.ok(!visible.cards.some(c=>c.id===mirror));
  assert.ok(!(await call('leaderB',`/boards/${b}/export.json`)).cards.some(c=>c.id===mirror));
  assert.ok(!(await call('leaderB',`/boards/${b}/activity`)).activity.some(e=>e.card_id===mirror));
  assert.equal((await call('leaderB','/search?q='+encodeURIComponent('Riêng-tư-gốc-không-lộ'))).cards.length,0);
  await call('leaderB','/planner','PUT',{card_id:mirror,date:'2026-10-26'},403);
  await call('leaderB',`/cards/${mirror}/comments`,'GET',undefined,403);
  await call('staffA',`/cards/${mirror}`,'PATCH',{title:'Không sửa bản đối xứng'},409);
});
test('merging is recoverable: source keeps its checklist, comments and attachments',async()=>{
  const source=(await call('leaderA',`/cards/${card}/copy`,'POST',{})).id,target=await newCard();
  await call('staffA',`/cards/${source}/comments`,'POST',{text:'Giữ bình luận gốc'});
  const before=db.prepare('SELECT COUNT(*) AS n FROM attachments WHERE card_id=?').get(source).n;
  await call('leaderA',`/cards/${source}/merge`,'POST',{target_id:target});
  assert.equal(db.prepare('SELECT archived FROM cards WHERE id=?').get(source).archived,1);
  assert.ok(db.prepare('SELECT 1 FROM comments WHERE card_id=?').get(source));assert.ok(db.prepare('SELECT 1 FROM comments WHERE card_id=?').get(target));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM attachments WHERE card_id=?').get(source).n,before);
  await call('leaderA',`/cards/${source}`,'PATCH',{archived:false});assert.ok(db.prepare('SELECT 1 FROM checklist_groups WHERE card_id=?').get(source));
});
test('unchanged checklist saves preserve pending review; real edits reopen it',async()=>{
  const id=await newCard();await call('leaderA',`/cards/${id}/members`,'PUT',{user_ids:[ids.staffA]});
  const ci=(await call('staffA',`/cards/${id}/checklist`,'POST',{text:'Nội dung ổn định'})).id;
  await call('staffA',`/cards/${id}/review`,'POST',{action:'submit'});
  await call('staffA',`/checklist/${ci}`,'PATCH',{text:'Nội dung ổn định',checked:false});
  assert.equal(db.prepare('SELECT approval_state FROM cards WHERE id=?').get(id).approval_state,'pending');
  await call('staffA',`/checklist/${ci}`,'PATCH',{checked:true});assert.equal(db.prepare('SELECT approval_state FROM cards WHERE id=?').get(id).approval_state,'in_progress');
});
test('private files require current access and revoked notifications disappear',async()=>{
  const response=await fetch(base+`/api/cards/${card}/upload?name=test.txt`,{method:'POST',headers:{Authorization:'Bearer '+tokens.staffA,'Content-Type':'application/octet-stream'},body:'test attachment'});assert.equal(response.status,200);const data=await response.json();
  assert.equal((await fetch(base+data.url)).status,401);assert.equal((await fetch(base+data.url,{headers:{Authorization:'Bearer '+tokens.outsider}})).status,403);assert.equal((await fetch(base+data.url,{headers:{Cookie:'kanban-session='+tokens.staffA}})).status,200);
  await call('admin',`/boards/${b}/members`,'PUT',{members:[{user_id:ids.outsider,role:'member'},{user_id:ids.staffA,role:'member'}]});
  const outsidersCard=await newCard('outsider',listsB[0].id);
  await call('outsider',`/cards/${outsidersCard}`,'PATCH',{cover:'url:'+data.url},403);
  await call('admin',`/boards/${a}/members`,'PUT',{members:[]});assert.equal((await fetch(base+data.url,{headers:{Cookie:'kanban-session='+tokens.staffA}})).status,403);
  assert.ok(!(await call('staffA','/notifications')).notifications.some(n=>n.board_id===a));assert.ok(!(await call('staffA','/planner')).slots.some(s=>s.board_id===a));
});
test('WebSocket cannot watch a board without access',async()=>{
  const authorized=new WebSocket(base.replace('http:','ws:')+'/ws?token='+tokens.leaderA),outsider=new WebSocket(base.replace('http:','ws:')+'/ws?token='+tokens.outsider);
  await Promise.all([once(authorized,'open'),once(outsider,'open')]);const seenA=[],seenO=[];authorized.on('message',v=>seenA.push(JSON.parse(v)));outsider.on('message',v=>seenO.push(JSON.parse(v)));
  for(const socket of [authorized,outsider])socket.send(JSON.stringify({type:'watch',boardId:a}));
  await new Promise(r=>setTimeout(r,30));await call('leaderA',`/boards/${a}`,'PATCH',{title:'Bảng A đã đổi tên'});await new Promise(r=>setTimeout(r,60));
  assert.ok(seenA.some(m=>m.type==='board-changed'));assert.ok(!seenO.some(m=>m.type==='board-changed'));authorized.terminate();outsider.terminate();
});
