import { db } from './db.js';
import { boardOfCard, boardOfList, canSeeBoard, canSeeCard, canManageBoard, requireBoard, userById, isLeader, invalidateReview, fail } from './access.js';
import { cloneCard, moveCard } from './card-data.js';
import { validDate, validTime, dueInstant } from './dates.js';

const next = (table, column, id) => db.prepare(`SELECT COALESCE(MAX(position),0)+1024 AS n FROM ${table} WHERE ${column}=?`).get(id).n;
const activeUsers = () => db.prepare('SELECT id,name,username,is_admin FROM users WHERE disabled=0 ORDER BY is_admin,name').all();
function checkAssignee(actor, cardId, id, previous = null) {
  if (id !== null && !canSeeBoard(userById(id),boardOfCard(cardId))) fail(400,'Người nhận việc chưa được cấp quyền vào bảng');
  if (id!==previous && !canManageBoard(actor,boardOfCard(cardId)) && (id!==actor.id || (previous && previous!==actor.id))) fail(403,'Chỉ quản lý được giao việc cho người khác');
}
function validateItemDate(b) {
  if (b.due_date && !validDate(b.due_date)) fail(400,'Ngày việc con không hợp lệ');
  if (b.due_time && !validTime(b.due_time)) fail(400,'Giờ việc con không hợp lệ');
}
function reviewers(card, submitter) {
  const assigned=db.prepare('SELECT user_id FROM card_members WHERE card_id=?').all(card.id).map(r=>r.user_id);
  const needsDirector=isLeader(submitter) || assigned.some(isLeader);
  return activeUsers().filter(u=>u.id!==submitter && !assigned.includes(u.id) && canManageBoard(u,boardOfCard(card.id)) && (!needsDirector || u.is_admin));
}

export function registerWorkRoutes(app, {auth, adminOnly, notifyBoard, logActivity, pushNotification, broadcast, completeCard, cardRecipientIds}) {
  app.get('/api/overview',auth,(req,res)=>{
    const boards=db.prepare('SELECT * FROM boards WHERE closed=0').all().filter(b=>canSeeBoard(req.user,b.id));
    const allowed=new Set(boards.map(b=>b.id));
    const cards=db.prepare(`SELECT c.*,l.board_id,l.title AS list_title,b.title AS board_title,b.team_id,t.name AS team_name
      FROM cards c JOIN lists l ON l.id=c.list_id JOIN boards b ON b.id=l.board_id LEFT JOIN teams t ON t.id=b.team_id
      WHERE c.archived=0 AND l.archived=0 AND b.closed=0 AND c.is_template=0 AND c.mirror_of IS NULL`).all().filter(c=>allowed.has(c.board_id));
    const stats=rows=>({total:rows.length,done:rows.filter(c=>c.due_complete).length,pending:rows.filter(c=>c.approval_state==='pending').length,changes_requested:rows.filter(c=>c.approval_state==='changes_requested').length,overdue:rows.filter(c=>!c.due_complete && dueInstant(c.due_date,c.due_time)<Date.now()).length});
    const keys=[...new Set(boards.map(b=>b.team_id || 0))];
    res.json({stats:{boards:boards.length,...stats(cards)},teams:keys.map(id=>({id,name:id?db.prepare('SELECT name FROM teams WHERE id=?').get(id)?.name:'Chưa gắn team',...stats(cards.filter(c=>(c.team_id || 0)===id))})),cards:cards.map(c=>({id:c.id,title:c.title,board_id:c.board_id,board_title:c.board_title,list_title:c.list_title,due_date:c.due_date,due_time:c.due_time,due_complete:c.due_complete,approval_state:c.approval_state,reviewer_id:c.reviewer_id}))});
  });
  app.patch('/api/fields/:id',auth,(req,res)=>{
    const field=db.prepare('SELECT * FROM board_fields WHERE id=?').get(req.params.id),body=req.body || {},name=String(body.name ?? field.name).trim().slice(0,30);
    if(!name)fail(400,'Cần tên trường');if(body.type && body.type!==field.type)fail(400,'Tạo trường mới nếu cần đổi kiểu dữ liệu');
    const options=body.options===undefined?JSON.parse(field.options):body.options;
    if(!Array.isArray(options) || options.length>20 || options.some(v=>typeof v!=='string' || !v.trim() || v.length>100))fail(400,'Danh sách lựa chọn không hợp lệ');
    if(field.type==='select' && db.prepare("SELECT DISTINCT value FROM card_field_values WHERE field_id=? AND value!=''").all(field.id).some(v=>!options.includes(v.value)))fail(409,'Lựa chọn đang được dùng trên thẻ; điều chỉnh thẻ trước khi xóa lựa chọn');
    db.prepare('UPDATE board_fields SET name=?,options=? WHERE id=?').run(name,JSON.stringify([...new Set(options)]),field.id);notifyBoard(field.board_id);res.json({ok:true});
  });
  app.get('/api/boards/:id/export.json',auth,(req,res)=>{
    const id=Number(req.params.id),snapshot={format:'company-kanban-board',version:1,exported_at:new Date().toISOString(),board:db.prepare('SELECT * FROM boards WHERE id=?').get(id)};
    for(const table of ['lists','labels','board_members','board_fields','automation_rules','auto_schedules','due_rules','card_buttons'])snapshot[table]=db.prepare(`SELECT * FROM ${table} WHERE board_id=?`).all(id);
    snapshot.cards=db.prepare('SELECT c.* FROM cards c JOIN lists l ON l.id=c.list_id WHERE l.board_id=?').all(id).filter(c=>canSeeCard(req.user,c.id));
    const allowed=new Set(snapshot.cards.map(c=>c.id));
    for(const table of ['checklist_groups','checklist_items','comments','attachments','card_labels','card_members','card_field_values','card_reviews','card_votes'])snapshot[table]=db.prepare(`SELECT child.* FROM ${table} child JOIN cards c ON c.id=child.card_id JOIN lists l ON l.id=c.list_id WHERE l.board_id=?`).all(id).filter(row=>allowed.has(row.card_id));
    snapshot.activity=db.prepare('SELECT * FROM activity WHERE board_id=?').all(id).filter(row=>!row.card_id || canSeeCard(req.user,row.card_id));
    snapshot.comment_reactions=db.prepare('SELECT r.*,cm.card_id FROM comment_reactions r JOIN comments cm ON cm.id=r.comment_id JOIN cards c ON c.id=cm.card_id JOIN lists l ON l.id=c.list_id WHERE l.board_id=?').all(id).filter(row=>allowed.has(row.card_id));
    res.set('Content-Disposition',`attachment; filename="board-${id}.json"`);res.json(snapshot);
  });
  app.get('/api/teams',auth,(req,res)=>{
    const teams=db.prepare('SELECT * FROM teams ORDER BY name').all().filter(t=>req.user.is_admin || db.prepare('SELECT 1 FROM team_members WHERE team_id=? AND user_id=?').get(t.id,req.user.id));
    res.json({teams:teams.map(t=>({...t,members:db.prepare('SELECT tm.user_id,tm.role,u.name FROM team_members tm JOIN users u ON u.id=tm.user_id WHERE tm.team_id=?').all(t.id)}))});
  });
  app.post('/api/teams',auth,adminOnly,(req,res)=>{
    const name=String(req.body?.name || '').trim();if(!name) fail(400,'Cần tên team');
    if(db.prepare('SELECT 1 FROM teams WHERE name=?').get(name)) fail(409,'Tên team đã tồn tại');
    res.json({id:db.prepare('INSERT INTO teams(name) VALUES (?)').run(name).lastInsertRowid});
  });
  app.patch('/api/teams/:id',auth,adminOnly,(req,res)=>{
    const name=String(req.body?.name || '').trim();if(!name) fail(400,'Cần tên team');
    db.prepare('UPDATE teams SET name=? WHERE id=?').run(name,req.params.id);res.json({ok:true});
  });
  app.put('/api/teams/:id/members',auth,adminOnly,(req,res)=>{
    const members=req.body?.members;
    if(!Array.isArray(members) || !members.every(m=>userById(Number(m.user_id)) && ['member','leader'].includes(m.role))) fail(400,'Thành viên hoặc vai trò team không hợp lệ');
    if(!db.prepare('SELECT 1 FROM teams WHERE id=?').get(req.params.id)) fail(404,'Team không tồn tại');
    db.transaction(()=>{
      db.prepare('DELETE FROM team_members WHERE team_id=?').run(req.params.id);
      for(const m of members) db.prepare('INSERT OR IGNORE INTO team_members(team_id,user_id,role) VALUES (?,?,?)').run(req.params.id,Number(m.user_id),m.role);
    })();broadcast(null,{type:'boards-changed'});res.json({ok:true});
  });
  app.put('/api/boards/:id/team',auth,adminOnly,(req,res)=>{
    const team=req.body?.team_id ? Number(req.body.team_id) : null;
    if(team && !db.prepare('SELECT 1 FROM teams WHERE id=?').get(team)) fail(400,'Team không tồn tại');
    db.prepare('UPDATE boards SET team_id=? WHERE id=?').run(team,req.params.id);notifyBoard(Number(req.params.id));broadcast(null,{type:'boards-changed'});res.json({ok:true});
  });
  app.put('/api/boards/:id/workflow',auth,(req,res)=>{
    const id=Number(req.params.id),values=[];
    for(const field of ['review_list_id','done_list_id','changes_list_id']) {
      const value=req.body?.[field]?Number(req.body[field]):null;
      if(value && !db.prepare('SELECT 1 FROM lists WHERE id=? AND board_id=? AND archived=0').get(value,id))fail(400,'Cột quy trình phải thuộc bảng đang hoạt động');
      values.push(value);
    }
    db.prepare('UPDATE boards SET review_list_id=?,done_list_id=?,changes_list_id=? WHERE id=?').run(...values,id);notifyBoard(id);res.json({ok:true});
  });

  app.get('/api/cards/:id/review',auth,(req,res)=>{
    const card=db.prepare('SELECT * FROM cards WHERE id=?').get(req.params.id);
    const performer=db.prepare('SELECT user_id FROM card_members WHERE card_id=? ORDER BY user_id LIMIT 1').get(card.id)?.user_id || card.created_by || req.user.id;
    const candidates=reviewers(card,card.submitted_by || performer);
    res.json({can_submit:!!db.prepare('SELECT 1 FROM card_members WHERE card_id=? AND user_id=?').get(card.id,req.user.id) || card.created_by===req.user.id, state:card.approval_state,reviewer_id:card.reviewer_id,submitted_by:card.submitted_by,candidates,events:db.prepare('SELECT r.*,u.name AS author FROM card_reviews r LEFT JOIN users u ON u.id=r.user_id WHERE r.card_id=? ORDER BY r.id').all(card.id)});
  });
  app.put('/api/cards/:id/reviewer',auth,(req,res)=>{
    const card=db.prepare('SELECT * FROM cards WHERE id=?').get(req.params.id);
    requireBoard(req.user,boardOfCard(card.id),true);
    const id=Number(req.body?.reviewer_id);
    // Final validation also happens at submission and decision time.
    if(!canManageBoard(userById(id),boardOfCard(card.id))) fail(400,'Người duyệt cần quyền quản lý bảng');
    const members=db.prepare('SELECT user_id FROM card_members WHERE card_id=?').all(card.id).map(m=>m.user_id);
    if(members.includes(id) || (members.some(isLeader) && !userById(id).is_admin)) fail(400,'Người thực hiện không tự duyệt; việc của leader cần giám đốc duyệt');
    db.prepare('UPDATE cards SET reviewer_id=? WHERE id=?').run(id,card.id);notifyBoard(boardOfCard(card.id));res.json({ok:true});
  });
  app.post('/api/cards/:id/review',auth,(req,res)=>{
    const card=db.prepare('SELECT c.*,l.archived AS list_archived,b.closed FROM cards c JOIN lists l ON l.id=c.list_id JOIN boards b ON b.id=l.board_id WHERE c.id=?').get(req.params.id);
    if(card.archived || card.list_archived || card.closed || card.is_template) fail(409,'Chỉ duyệt công việc đang hoạt động');
    const action=String(req.body?.action || ''),note=String(req.body?.note || '').trim().slice(0,4000),boardId=boardOfCard(card.id);
    if(action==='submit') {
      if(card.due_complete || card.approval_state==='pending') fail(409,'Thẻ đã hoàn thành hoặc đang chờ duyệt');
      const assigned=db.prepare('SELECT 1 FROM card_members WHERE card_id=? AND user_id=?').get(card.id,req.user.id);
      if(!assigned && card.created_by!==req.user.id) fail(403,'Chỉ người thực hiện công việc được gửi duyệt');
      const eligible=reviewers(card,req.user.id);
      const reviewer=eligible.find(u=>u.id===card.reviewer_id) || (!card.reviewer_id && eligible[0]);
      if(!reviewer) fail(409,'Cần quản lý chỉ định người duyệt hợp lệ; việc của leader cần giám đốc duyệt');
      db.prepare("UPDATE cards SET approval_state='pending',submitted_by=?,reviewer_id=?,due_complete=0,submitted_from_list_id=? WHERE id=?").run(req.user.id,reviewer.id,card.list_id,card.id);
      const list=db.prepare('SELECT review_list_id AS id FROM boards WHERE id=?').get(boardId)?.id;
      if(list && !db.prepare('SELECT archived FROM lists WHERE id=?').get(list)?.archived)moveCard(card.id,list);
      pushNotification(reviewer.id,req.user.id,'review_requested',boardId,card.id,{title:card.title});
    } else if(['approve','request_changes'].includes(action)) {
      if(card.approval_state!=='pending') fail(409,'Thẻ chưa ở bước chờ duyệt');
      if(card.submitted_by===req.user.id || !reviewers(card,card.submitted_by).some(u=>u.id===req.user.id) || (!req.user.is_admin && card.reviewer_id!==req.user.id)) fail(403,'Bạn không phải người duyệt hợp lệ của công việc này');
      if(action==='request_changes' && !note) fail(400,'Ghi rõ nội dung cần sửa');
      db.transaction(()=>{
        db.prepare('UPDATE cards SET approval_state=?,due_complete=0 WHERE id=?').run(action==='approve'?'approved':'changes_requested',card.id);
        if(action==='approve') completeCard(card.id,true);
        const config=db.prepare('SELECT * FROM boards WHERE id=?').get(boardId);
        const repeating=action==='approve' && card.recur && card.due_date;
        const list=action==='request_changes'?config.changes_list_id:repeating?(card.submitted_from_list_id || config.changes_list_id):config.done_list_id;
        if(list && db.prepare('SELECT 1 FROM lists WHERE id=? AND board_id=? AND archived=0').get(list,boardId))moveCard(card.id,list);
      })();
      pushNotification(card.submitted_by,req.user.id,action==='approve'?'review_approved':'review_changes',boardId,card.id,{title:card.title,note});
    } else fail(400,'Thao tác duyệt không hợp lệ');
    db.prepare('INSERT INTO card_reviews(card_id,user_id,action,note) VALUES (?,?,?,?)').run(card.id,req.user.id,action,note);
    logActivity(boardId,card.id,req.user.id,'review_'+action,{note});notifyBoard(boardId);res.json({ok:true,card:db.prepare('SELECT * FROM cards WHERE id=?').get(card.id)});
  });

  app.post('/api/cards/:id/checklists',auth,(req,res)=>{
    const cardId=Number(req.params.id),title=String(req.body?.title || 'Checklist').trim();
    if(!title) fail(400,'Cần tên checklist');
    invalidateReview(cardId);
    const id=db.prepare('INSERT INTO checklist_groups(card_id,title,position) VALUES (?,?,?)').run(cardId,title,next('checklist_groups','card_id',cardId)).lastInsertRowid;
    notifyBoard(boardOfCard(cardId));res.json({id});
  });
  app.patch('/api/checklists/:id',auth,(req,res)=>{
    const group=db.prepare('SELECT * FROM checklist_groups WHERE id=?').get(req.params.id),title=String(req.body?.title || '').trim();
    if(!title) fail(400,'Cần tên checklist');if(group.title!==title)invalidateReview(group.card_id);db.prepare('UPDATE checklist_groups SET title=? WHERE id=?').run(title,group.id);notifyBoard(boardOfCard(group.card_id));res.json({ok:true});
  });
  app.delete('/api/checklists/:id',auth,(req,res)=>{
    const group=db.prepare('SELECT * FROM checklist_groups WHERE id=?').get(req.params.id);invalidateReview(group.card_id);db.prepare('DELETE FROM checklist_groups WHERE id=?').run(group.id);notifyBoard(boardOfCard(group.card_id));res.json({ok:true});
  });
  app.post('/api/cards/:id/checklist',auth,(req,res)=>{
    const cardId=Number(req.params.id),b=req.body || {},text=String(b.text || '').trim();if(!text) fail(400,'Thiếu nội dung việc con');validateItemDate(b);
    let group=b.group_id ? db.prepare('SELECT * FROM checklist_groups WHERE id=? AND card_id=?').get(Number(b.group_id),cardId) : db.prepare('SELECT * FROM checklist_groups WHERE card_id=? ORDER BY position LIMIT 1').get(cardId);
    if(b.group_id && !group) fail(400,'Checklist không thuộc thẻ');
    if(!group) group={id:db.prepare("INSERT INTO checklist_groups(card_id,title,position) VALUES (?,'Checklist',1024)").run(cardId).lastInsertRowid};
    const uid=b.user_id ? Number(b.user_id) : null;checkAssignee(req.user,cardId,uid);
    invalidateReview(cardId);
    const id=db.prepare('INSERT INTO checklist_items(card_id,group_id,text,position,user_id,due_date,due_time,checked) VALUES (?,?,?,?,?,?,?,?)').run(cardId,group.id,text,next('checklist_items','card_id',cardId),uid,b.due_date || '',b.due_time || '',b.checked?1:0).lastInsertRowid;
    notifyBoard(boardOfCard(cardId));res.json({id});
  });
  app.patch('/api/checklist/:id',auth,(req,res)=>{
    const item=db.prepare('SELECT * FROM checklist_items WHERE id=?').get(req.params.id),b=req.body || {};validateItemDate(b);
    if(b.text!==undefined && !String(b.text).trim()) fail(400,'Nội dung việc con không được trống');
    const sets=[],values=[];
    for(const f of ['text','due_date','due_time']) if(b[f]!==undefined) {sets.push(f+'=?');values.push(String(b[f]).trim());}
    if(b.checked!==undefined) {sets.push('checked=?');values.push(b.checked?1:0);}
    if(b.user_id!==undefined) {const uid=b.user_id?Number(b.user_id):null;checkAssignee(req.user,item.card_id,uid,item.user_id);sets.push('user_id=?');values.push(uid);}
    if(b.group_id!==undefined) {if(!db.prepare('SELECT 1 FROM checklist_groups WHERE id=? AND card_id=?').get(Number(b.group_id),item.card_id)) fail(400,'Checklist không thuộc thẻ');sets.push('group_id=?');values.push(Number(b.group_id));}
    if(Object.entries(b).some(([key,value])=>['text','checked','user_id','group_id','due_date','due_time'].includes(key) && (key==='checked' ? Number(!!value)!==Number(item.checked) : String(value ?? '')!==String(item[key] ?? ''))))invalidateReview(item.card_id);
    if(sets.length) db.prepare('UPDATE checklist_items SET '+sets.join(',')+' WHERE id=?').run(...values,item.id);
    notifyBoard(boardOfCard(item.card_id));res.json({ok:true});
  });
  app.delete('/api/checklist/:id',auth,(req,res)=>{
    const item=db.prepare('SELECT * FROM checklist_items WHERE id=?').get(req.params.id);invalidateReview(item.card_id);db.prepare('DELETE FROM checklist_items WHERE id=?').run(item.id);notifyBoard(boardOfCard(item.card_id));res.json({ok:true});
  });
  app.post('/api/checklist/:id/convert',auth,(req,res)=>{
    const item=db.prepare('SELECT * FROM checklist_items WHERE id=?').get(req.params.id),src=db.prepare('SELECT * FROM cards WHERE id=?').get(item.card_id);
    const id=db.transaction(()=>{
      const id=db.prepare('INSERT INTO cards(list_id,title,due_date,due_time,position,created_by) VALUES (?,?,?,?,?,?)').run(src.list_id,item.text,item.due_date,item.due_time,next('cards','list_id',src.list_id),req.user.id).lastInsertRowid;
      if(item.user_id) db.prepare('INSERT INTO card_members(card_id,user_id) VALUES (?,?)').run(id,item.user_id);
      db.prepare('DELETE FROM checklist_items WHERE id=?').run(item.id);return id;
    })();invalidateReview(item.card_id);logActivity(boardOfCard(id),id,req.user.id,'card_created',{title:item.text});notifyBoard(boardOfCard(id));res.json({id});
  });

  app.get('/api/cards/:id/comments',auth,(req,res)=>{
    const comments=db.prepare('SELECT cm.*,u.name AS author FROM comments cm LEFT JOIN users u ON u.id=cm.user_id WHERE cm.card_id=? ORDER BY cm.id').all(req.params.id).map(cm=>({...cm,reactions:db.prepare('SELECT emoji,COUNT(*) AS count,MAX(user_id=?) AS mine FROM comment_reactions WHERE comment_id=? GROUP BY emoji').all(req.user.id,cm.id)}));res.json({comments});
  });
  app.post('/api/cards/:id/comments',auth,(req,res)=>{
    const text=String(req.body?.text || '').trim();if(!text) fail(400,'Bình luận trống');
    const cardId=Number(req.params.id),boardId=boardOfCard(cardId),title=db.prepare('SELECT title FROM cards WHERE id=?').get(cardId).title;
    const id=db.prepare('INSERT INTO comments(card_id,user_id,text) VALUES (?,?,?)').run(cardId,req.user.id,text).lastInsertRowid;
    logActivity(boardId,cardId,req.user.id,'comment_added',{text:text.slice(0,80)});
    const recipients=new Set(cardRecipientIds(cardId));
    const mentioned=new Set();for(const name of [...text.matchAll(/@([a-z0-9._-]+)/gi)].map(m=>m[1].toLowerCase())) {const user=db.prepare('SELECT id FROM users WHERE lower(username)=? AND disabled=0').get(name);if(user) {recipients.add(user.id);mentioned.add(user.id);}}
    for(const uid of recipients) pushNotification(uid,req.user.id,mentioned.has(uid)?'mention':'comment',boardId,cardId,{title,text:text.slice(0,80)});
    notifyBoard(boardId);broadcast(boardId,{type:'comments-changed',cardId});res.json({id});
  });
  app.patch('/api/comments/:id',auth,(req,res)=>{
    const cm=db.prepare('SELECT * FROM comments WHERE id=?').get(req.params.id);
    if(cm.user_id!==req.user.id) fail(403,'Chỉ tác giả được sửa bình luận');
    const text=String(req.body?.text || '').trim();if(!text) fail(400,'Bình luận trống');
    db.prepare("UPDATE comments SET text=?,edited_at=datetime('now') WHERE id=?").run(text,cm.id);notifyBoard(boardOfCard(cm.card_id));broadcast(boardOfCard(cm.card_id),{type:'comments-changed',cardId:cm.card_id});res.json({ok:true});
  });
  app.delete('/api/comments/:id',auth,(req,res)=>{
    const cm=db.prepare('SELECT * FROM comments WHERE id=?').get(req.params.id);
    if(cm.user_id!==req.user.id && !canManageBoard(req.user,boardOfCard(cm.card_id))) fail(403,'Chỉ tác giả hoặc quản lý được xóa bình luận');
    db.prepare('DELETE FROM comments WHERE id=?').run(cm.id);notifyBoard(boardOfCard(cm.card_id));broadcast(boardOfCard(cm.card_id),{type:'comments-changed',cardId:cm.card_id});res.json({ok:true});
  });
  app.post('/api/comments/:id/reactions',auth,(req,res)=>{
    const emoji=req.body?.emoji;if(!['👍','✅','❤️','👀','🎉'].includes(emoji)) fail(400,'Biểu tượng không hợp lệ');
    const cm=db.prepare('SELECT * FROM comments WHERE id=?').get(req.params.id);
    const removed=db.prepare('DELETE FROM comment_reactions WHERE comment_id=? AND user_id=? AND emoji=?').run(cm.id,req.user.id,emoji).changes;
    if(!removed) db.prepare('INSERT INTO comment_reactions(comment_id,user_id,emoji) VALUES (?,?,?)').run(cm.id,req.user.id,emoji);
    broadcast(boardOfCard(cm.card_id),{type:'comments-changed',cardId:cm.card_id});res.json({ok:true});
  });

  app.post('/api/lists/:id/copy',auth,(req,res)=>{
    const src=db.prepare('SELECT * FROM lists WHERE id=?').get(req.params.id),boardId=Number(req.body?.board_id || src.board_id);requireBoard(req.user,boardId,true);
    const id=db.transaction(()=>{
      const id=db.prepare('INSERT INTO lists(board_id,title,position,color,wip_limit) VALUES (?,?,?,?,?)').run(boardId,String(req.body?.title || src.title+' (bản sao)'),next('lists','board_id',boardId),src.color,src.wip_limit).lastInsertRowid;
      for(const c of db.prepare('SELECT * FROM cards WHERE list_id=? AND archived=0 ORDER BY position').all(src.id)) {if(!canSeeCard(req.user,c.id))continue;if(c.mirror_of)db.prepare('INSERT INTO cards(list_id,title,position,mirror_of) VALUES (?,?,?,?)').run(id,c.title,next('cards','list_id',id),c.mirror_of);else cloneCard(c.id,id,{actor_id:req.user.id,keep_template:true});}return id;
    })();notifyBoard(boardId);res.json({id});
  });
  app.post('/api/lists/:id/move-cards',auth,(req,res)=>{
    const src=Number(req.params.id),dst=Number(req.body?.list_id);if(src===dst) fail(400,'Chọn cột đích khác');
    requireBoard(req.user,boardOfList(dst),true);
    const cards=db.prepare('SELECT id FROM cards WHERE list_id=? AND archived=0 ORDER BY position').all(src);
    db.transaction(()=>{for(const c of cards) moveCard(c.id,dst);})();notifyBoard(boardOfList(src));notifyBoard(boardOfList(dst));res.json({ok:true,count:cards.length});
  });
  app.post('/api/lists/:id/archive-cards',auth,(req,res)=>{
    const result=db.prepare('UPDATE cards SET archived=1 WHERE list_id=? AND archived=0').run(req.params.id);notifyBoard(boardOfList(Number(req.params.id)));res.json({ok:true,count:result.changes});
  });
  app.post('/api/lists/:id/watch',auth,(req,res)=>{
    const id=Number(req.params.id),removed=db.prepare('DELETE FROM list_watchers WHERE list_id=? AND user_id=?').run(id,req.user.id).changes;
    if(!removed) db.prepare('INSERT INTO list_watchers(list_id,user_id) VALUES (?,?)').run(id,req.user.id);res.json({watching:!removed});
  });
}
