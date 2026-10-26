import { db } from './db.js';
import { boardOfCard, boardOfList, canSeeBoard, userById, fail } from './access.js';

const position = listId => db.prepare('SELECT COALESCE(MAX(position),0)+1024 AS n FROM cards WHERE list_id = ?').get(listId).n;
function labelMap(cardId, boardId) {
  return db.prepare('SELECT l.* FROM labels l JOIN card_labels cl ON cl.label_id=l.id WHERE cl.card_id=?').all(cardId).map(label => {
    if (label.board_id === boardId) return label.id;
    const existing = db.prepare('SELECT id FROM labels WHERE board_id=? AND name=? AND color=?').get(boardId, label.name, label.color);
    return existing?.id || db.prepare('INSERT INTO labels(board_id,name,color,position) VALUES (?,?,?,?)').run(boardId,label.name,label.color,label.position).lastInsertRowid;
  });
}
function fieldMap(cardId, boardId) {
  return db.prepare('SELECT f.*, v.value FROM card_field_values v JOIN board_fields f ON f.id=v.field_id WHERE v.card_id=?').all(cardId).map(field => {
    const existing = field.board_id === boardId ? field : db.prepare('SELECT id FROM board_fields WHERE board_id=? AND name=? AND type=? AND options=?').get(boardId,field.name,field.type,field.options);
    const id = existing?.id || db.prepare('INSERT INTO board_fields(board_id,name,type,options,position) VALUES (?,?,?,?,?)').run(boardId,field.name,field.type,field.options,field.position).lastInsertRowid;
    return {id,value:field.value};
  });
}
function validateMembers(cardId, boardId) {
  const members = db.prepare('SELECT user_id FROM card_members WHERE card_id=?').all(cardId);
  if (members.some(m => !canSeeBoard(userById(m.user_id),boardId))) fail(409,'Cấp quyền vào bảng đích cho người nhận việc trước, hoặc bỏ giữ thành viên khi sao chép');
  return members;
}
export const cloneCard = db.transaction((cardId, listId, options = {}) => {
  const source = db.prepare('SELECT * FROM cards WHERE id=?').get(cardId);
  if (!source || source.mirror_of) fail(400,'Hãy sao chép từ thẻ gốc');
  const boardId = boardOfList(listId);
  const members = options.members === false ? [] : validateMembers(cardId,boardId);
  const id = db.prepare(`INSERT INTO cards(list_id,title,description,start_date,due_date,due_time,recur,remind,cover,position,is_template,created_by,recur_anchor_day)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(listId,String(options.title || source.title).trim(),source.description,source.start_date,source.due_date,source.due_time,source.recur,source.remind,source.cover,position(listId),options.keep_template ? source.is_template : 0, options.actor_id || null,source.recur_anchor_day).lastInsertRowid;
  if (options.labels !== false) for (const label of labelMap(cardId,boardId)) db.prepare('INSERT INTO card_labels(card_id,label_id) VALUES (?,?)').run(id,label);
  for (const m of members) db.prepare('INSERT INTO card_members(card_id,user_id) VALUES (?,?)').run(id,m.user_id);
  if (options.fields !== false) for (const f of fieldMap(cardId,boardId)) db.prepare('INSERT INTO card_field_values(card_id,field_id,value) VALUES (?,?,?)').run(id,f.id,f.value);
  if (options.checklists !== false) {
    for (const group of db.prepare('SELECT * FROM checklist_groups WHERE card_id=? ORDER BY position').all(cardId)) {
      const gid = db.prepare('INSERT INTO checklist_groups(card_id,title,position) VALUES (?,?,?)').run(id,group.title,group.position).lastInsertRowid;
      for (const item of db.prepare('SELECT * FROM checklist_items WHERE group_id=? ORDER BY position').all(group.id)) {
        const uid = item.user_id && canSeeBoard(userById(item.user_id),boardId) ? item.user_id : null;
        db.prepare('INSERT INTO checklist_items(card_id,group_id,text,position,user_id,due_date,due_time) VALUES (?,?,?,?,?,?,?)').run(id,gid,item.text,item.position,uid,item.due_date,item.due_time);
      }
    }
  }
  if (options.attachments !== false) db.prepare('INSERT INTO attachments(card_id,url,name) SELECT ?,url,name FROM attachments WHERE card_id=?').run(id,cardId);
  return id;
});

export const moveCard = db.transaction((cardId, listId, newPosition) => {
  const oldBoard = boardOfCard(cardId), newBoard = boardOfList(listId);
  if (oldBoard !== newBoard) {
    validateMembers(cardId,newBoard);
    const labels = labelMap(cardId,newBoard), fields = fieldMap(cardId,newBoard);
    db.prepare('DELETE FROM card_labels WHERE card_id=?').run(cardId);
    for (const id of labels) db.prepare('INSERT INTO card_labels(card_id,label_id) VALUES (?,?)').run(cardId,id);
    db.prepare('DELETE FROM card_field_values WHERE card_id=?').run(cardId);
    for (const f of fields) db.prepare('INSERT INTO card_field_values(card_id,field_id,value) VALUES (?,?,?)').run(cardId,f.id,f.value);
    db.prepare('DELETE FROM due_rule_applied WHERE card_id=?').run(cardId);
    db.prepare("UPDATE cards SET reviewer_id=NULL, submitted_by=NULL, approval_state='in_progress', due_complete=0 WHERE id=?").run(cardId);
  }
  db.prepare('UPDATE cards SET list_id=?, position=? WHERE id=?').run(listId,newPosition ?? position(listId),cardId);
});
