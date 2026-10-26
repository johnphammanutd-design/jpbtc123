import { db } from './db.js';

export const boardOfList = id => db.prepare('SELECT board_id FROM lists WHERE id = ?').get(id)?.board_id;
export const boardOfCard = id => db.prepare('SELECT l.board_id FROM cards c JOIN lists l ON l.id = c.list_id WHERE c.id = ?').get(id)?.board_id;
export const userById = id => db.prepare('SELECT id, is_admin, disabled FROM users WHERE id = ?').get(id);
export const isLeader = userId => !!db.prepare("SELECT 1 FROM team_members WHERE user_id = ? AND role = 'leader'").get(userId);
export function boardRole(user, boardId) {
  if (!user || user.disabled || !db.prepare('SELECT 1 FROM boards WHERE id = ?').get(boardId)) return null;
  if (user.is_admin) return 'manager';
  if (db.prepare(`SELECT 1 FROM boards b JOIN team_members tm ON tm.team_id = b.team_id
      WHERE b.id = ? AND tm.user_id = ? AND tm.role = 'leader'`).get(boardId, user.id)) return 'manager';
  return db.prepare('SELECT role FROM board_members WHERE board_id = ? AND user_id = ?').get(boardId, user.id)?.role || null;
}
export const canSeeBoard = (user, boardId) => !!boardRole(user, boardId);
export const canManageBoard = (user, boardId) => boardRole(user, boardId) === 'manager';
export function canSeeCard(user, cardId) {
  const card=db.prepare('SELECT c.mirror_of,l.board_id FROM cards c JOIN lists l ON l.id=c.list_id WHERE c.id=?').get(cardId);
  return !!card && canSeeBoard(user,card.board_id) && (!card.mirror_of || canSeeBoard(user,boardOfCard(card.mirror_of)));
}
export function invalidateReview(cardId) {
  const card=db.prepare(`SELECT c.*,l.board_id,b.changes_list_id FROM cards c JOIN lists l ON l.id=c.list_id JOIN boards b ON b.id=l.board_id WHERE c.id=?`).get(cardId);
  if(!card || !['pending','approved'].includes(card.approval_state))return;
  db.prepare("UPDATE cards SET approval_state='in_progress',submitted_by=NULL,due_complete=0 WHERE id=? AND approval_state IN ('pending','approved')").run(cardId);
  const target=card.submitted_from_list_id || card.changes_list_id;
  if(target && target!==card.list_id && db.prepare('SELECT 1 FROM lists WHERE id=? AND board_id=? AND archived=0').get(target,card.board_id)) {
    const position=db.prepare('SELECT COALESCE(MAX(position),0)+1024 AS n FROM cards WHERE list_id=?').get(target).n;
    db.prepare('UPDATE cards SET list_id=?,position=? WHERE id=?').run(target,position,cardId);
  }
  db.prepare("INSERT INTO activity(board_id,card_id,type,data) VALUES (?,?,'review_reopened','{}')").run(card.board_id,cardId);
}
export function canReadUpload(user, url) {
  return db.prepare(`SELECT l.board_id FROM attachments a JOIN cards c ON c.id=a.card_id JOIN lists l ON l.id=c.list_id WHERE a.url=?
    UNION SELECT l.board_id FROM cards c JOIN lists l ON l.id=c.list_id WHERE c.cover=?
    UNION SELECT id AS board_id FROM boards WHERE background=?`).all(url,'url:'+url,'url:'+url).some(r=>canSeeBoard(user,r.board_id));
}
export function fail(status, message) { const error = new Error(message); error.status = status; throw error; }
export function requireBoard(user, boardId, manage = false) {
  if (!boardId || !db.prepare('SELECT 1 FROM boards WHERE id = ?').get(boardId)) fail(404, 'Bảng không tồn tại');
  if (!(manage ? canManageBoard(user, boardId) : canSeeBoard(user, boardId))) fail(403, manage ? 'Chỉ người quản lý bảng được phép' : 'Bạn chưa được cấp quyền vào bảng này');
}

// One gate covers every resource route, including uploads and nested IDs.
export function authorizeResource(req, res, next) {
  try {
    const p = decodeURIComponent(req.path).toLowerCase().replace(/\/+$/,'') || '/', b = req.body || {}, mutation = !['GET','HEAD','OPTIONS'].includes(req.method);
    // Express accepts case variations/trailing slashes; guard the same canonical path.
    // Reject alternate numeric spellings before SQLite/Number can coerce them to another ID.
    const parts=p.split('/');
    const checkId=value=>{if(!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value)<1)fail(400,'Mã dữ liệu không hợp lệ');};
    if(['boards','cards','lists','labels','fields','rules','schedules','due-rules','buttons','checklist','checklists','comments','attachments','teams'].includes(parts[1]) && parts[2]!==undefined)checkId(parts[2]);
    if(parts[1]==='cards' && ['field','apply-button'].includes(parts[3]) && parts[4]!==undefined)checkId(parts[4]);
    if(parts[1]==='ai' && parts[2]==='card' && parts[3]!==undefined)checkId(parts[3]);
    let boardId;
    let manage = false;
    let m;
    if ((m = p.match(/^\/boards\/(\d+)(?:\/|$)/))) {
      boardId = Number(m[1]);
      manage = mutation && !/\/(star|watch)$/.test(p);
    } else if ((m = p.match(/^\/cards\/(\d+)(?:\/|$)/)) || (m = p.match(/^\/ai\/card\/(\d+)$/))) {
      boardId = boardOfCard(Number(m[1]));
      const card = db.prepare('SELECT mirror_of FROM cards WHERE id = ?').get(Number(m[1]));
      if (card?.mirror_of && !(req.method === 'DELETE' && /^\/cards\/\d+$/.test(p))) {
        requireBoard(req.user, boardOfCard(card.mirror_of));
        if (mutation) fail(409, 'Mở thẻ gốc để chỉnh sửa thẻ đối xứng');
      }
    } else if ((m = p.match(/^\/lists\/(\d+)(?:\/|$)/))) {
      boardId = boardOfList(Number(m[1])); manage = mutation && !p.endsWith('/watch');
    } else if ((m = p.match(/^\/(labels|fields|rules|schedules|due-rules|buttons)\/(\d+)(?:\/|$)/))) {
      const table = { labels: 'labels', fields: 'board_fields', rules: 'automation_rules', schedules: 'auto_schedules', 'due-rules': 'due_rules', buttons: 'card_buttons' }[m[1]];
      boardId = db.prepare(`SELECT board_id FROM ${table} WHERE id = ?`).get(Number(m[2]))?.board_id;
      manage = mutation;
    } else if ((m = p.match(/^\/(checklist|checklists|comments|attachments)\/(\d+)(?:\/|$)/))) {
      const table = { checklist: 'checklist_items', checklists: 'checklist_groups', comments: 'comments', attachments: 'attachments' }[m[1]];
      const cardId = db.prepare(`SELECT card_id FROM ${table} WHERE id = ?`).get(Number(m[2]))?.card_id;
      boardId = cardId && boardOfCard(cardId);
    }
    if (m) requireBoard(req.user, boardId, manage);
    if (p === '/boards' && req.method === 'POST' && !req.user.is_admin && !isLeader(req.user.id)) fail(403, 'Chỉ giám đốc hoặc leader được tạo bảng');
    if (p === '/lists' && req.method === 'POST') requireBoard(req.user, Number(b.board_id), true);
    if (b.list_id !== undefined && (p.startsWith('/cards') || p.startsWith('/lists') || p.endsWith('/convert'))) {
      const list = db.prepare('SELECT board_id, archived FROM lists WHERE id = ?').get(Number(b.list_id));
      requireBoard(req.user, list?.board_id, p.startsWith('/lists'));
      if (list.archived || db.prepare('SELECT closed FROM boards WHERE id = ?').get(list.board_id).closed) fail(409, 'Cột hoặc bảng đích đã lưu trữ/đóng');
    }
    if (b.target_id !== undefined) {
      requireBoard(req.user, boardOfCard(Number(b.target_id)));
      if (boardOfCard(Number(b.target_id)) !== boardId) fail(400, 'Chỉ hợp nhất thẻ trong cùng bảng');
    }
    if (b.label_ids !== undefined) {
      if (!Array.isArray(b.label_ids) || b.label_ids.some(id => db.prepare('SELECT board_id FROM labels WHERE id = ?').get(id)?.board_id !== boardId)) fail(400, 'Nhãn không thuộc bảng');
    }
    if ((m = p.match(/^\/cards\/\d+\/field\/(\d+)$/)) && db.prepare('SELECT board_id FROM board_fields WHERE id = ?').get(Number(m[1]))?.board_id !== boardId) fail(400, 'Trường không thuộc bảng');
    if (b.user_ids !== undefined && /^\/cards\/\d+\/members$/.test(p)) {
      if (!Array.isArray(b.user_ids)) fail(400, 'Danh sách thành viên không hợp lệ');
      for (const id of b.user_ids) if (!canSeeBoard(userById(Number(id)), boardId)) fail(400, 'Người nhận việc cần được cấp quyền vào bảng trước');
      if (!canManageBoard(req.user, boardId)) {
        const cardId = Number(p.split('/')[2]);
        const before = db.prepare('SELECT user_id FROM card_members WHERE card_id = ?').all(cardId).map(x => x.user_id).filter(id => id !== req.user.id).sort();
        const after = [...new Set(b.user_ids.map(Number))].filter(id => id !== req.user.id).sort();
        if (JSON.stringify(before) !== JSON.stringify(after)) fail(403, 'Chỉ quản lý được giao việc cho người khác');
      }
    }
    if (b.actions && boardId) validateActions(b.actions, boardId);
    for (const value of [b.cover,b.background,b.actions?.cover]) {
      if (typeof value==='string' && value.startsWith('url:') && !canReadUpload(req.user,value.slice(4))) fail(403,'Bạn chưa có quyền sử dụng file ảnh này');
    }
    if (b.trigger_list_id && boardOfList(Number(b.trigger_list_id)) !== boardId) fail(400, 'Cột không thuộc bảng');
    if ((m = p.match(/\/apply-button\/(\d+)$/))) {
      const button = db.prepare('SELECT board_id, actions FROM card_buttons WHERE id = ?').get(Number(m[1]));
      if (!button || button.board_id !== boardId) fail(400, 'Nút không thuộc bảng');
      validateActions(JSON.parse(button.actions), boardId);
    }
    next();
  } catch (error) { res.status(error.status || 400).json({ error: error.message }); }
}

export function validateActions(a, boardId) {
  for (const id of [a.move_list_id, a.archive_done_list_id, a.sort?.list_id].filter(Boolean)) {
    if (boardOfList(Number(id)) !== boardId) fail(400, 'Cột tự động hóa không thuộc bảng');
  }
  if (a.label_id && db.prepare('SELECT board_id FROM labels WHERE id = ?').get(Number(a.label_id))?.board_id !== boardId) fail(400, 'Nhãn tự động hóa không thuộc bảng');
  if (a.member_id && !canSeeBoard(userById(Number(a.member_id)), boardId)) fail(400, 'Thành viên tự động hóa chưa được cấp quyền vào bảng');
}
