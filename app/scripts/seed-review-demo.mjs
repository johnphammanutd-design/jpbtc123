// Run only with a separate DATA_DIR. Demo credentials must never be used on production.
if(!process.env.DATA_DIR || !process.env.DATA_DIR.includes('demo')) throw new Error('Chỉ chạy với DATA_DIR riêng có tên chứa demo');
const {db,hashPassword,ensureBoardLabels}=await import('../src/db.js');
if(db.prepare('SELECT 1 FROM boards LIMIT 1').get()) throw new Error('Dùng cơ sở dữ liệu demo trống');
const user=(username,name)=>db.prepare('INSERT INTO users(username,name,password_hash) VALUES (?,?,?)').run(username,name,hashPassword('codex-demo-2026')).lastInsertRowid;
const leader=user('leader.demo','Leader Demo'),staff=user('staff.demo','Nhân viên Demo');
const team=db.prepare("INSERT INTO teams(name) VALUES ('Team thử nghiệm')").run().lastInsertRowid;
for(const [id,role] of [[leader,'leader'],[staff,'member']])db.prepare('INSERT INTO team_members(team_id,user_id,role) VALUES (?,?,?)').run(team,id,role);
const board=db.prepare("INSERT INTO boards(title,background,visibility,team_id) VALUES ('[DEMO] Quy trình giao việc và duyệt','ocean','private',?)").run(team).lastInsertRowid;
db.prepare("INSERT INTO board_members(board_id,user_id,role) VALUES (?,?,'member')").run(board,staff);
const lists=['Cần làm','Đang làm','Chờ duyệt','Hoàn thành'].map((title,i)=>db.prepare('INSERT INTO lists(board_id,title,position) VALUES (?,?,?)').run(board,title,(i+1)*1024).lastInsertRowid);
db.prepare('UPDATE boards SET review_list_id=?,done_list_id=?,changes_list_id=? WHERE id=?').run(lists[2],lists[3],lists[1],board);
const card=db.prepare(`INSERT INTO cards(list_id,title,description,due_date,due_time,start_date,recur,reviewer_id,created_by,position)
  VALUES (?,'Chuẩn bị nội dung video','**Mục tiêu:** hoàn thiện kịch bản và bàn giao kết quả.\n- Kiểm tra nội dung\n- Gửi file kết quả','2026-10-26','20:00','2026-10-25','monthly',?,?,1024)`).run(lists[1],leader,leader).lastInsertRowid;
db.prepare('INSERT INTO card_members(card_id,user_id) VALUES (?,?)').run(card,staff);
for(const [i,title,text] of [[1,'Biên tập','Kiểm tra kịch bản'],[2,'Bàn giao','Gửi file kết quả']]){
  const group=db.prepare('INSERT INTO checklist_groups(card_id,title,position) VALUES (?,?,?)').run(card,title,i*1024).lastInsertRowid;
  db.prepare("INSERT INTO checklist_items(card_id,group_id,text,user_id,due_date,due_time,position) VALUES (?,?,?,?,'2026-10-26','18:00',1024)").run(card,group,text,staff);
}
ensureBoardLabels(board);
const label=db.prepare('SELECT id FROM labels WHERE board_id=? ORDER BY position LIMIT 1').get(board).id;
db.prepare("UPDATE labels SET name='Cần kiểm tra',color='#eb5a46' WHERE id=?").run(label);db.prepare('INSERT INTO card_labels(card_id,label_id) VALUES (?,?)').run(card,label);
const field=db.prepare("INSERT INTO board_fields(board_id,name,type) VALUES (?,'Đã đối chiếu','checkbox')").run(board).lastInsertRowid;db.prepare("INSERT INTO card_field_values(card_id,field_id,value) VALUES (?,?,'1')").run(card,field);
db.prepare("INSERT INTO comments(card_id,user_id,text) VALUES (?,?,'Dữ liệu thử để kiểm tra giao diện; không phải công việc thật.')").run(card,staff);
const pending=db.prepare("INSERT INTO cards(list_id,title,reviewer_id,submitted_by,approval_state,created_by,position) VALUES (?,'Leader gửi báo cáo tuần',1,?,'pending',1,1024)").run(lists[2],leader).lastInsertRowid;
db.prepare('INSERT INTO card_members(card_id,user_id) VALUES (?,?)').run(pending,leader);
db.prepare("INSERT INTO card_reviews(card_id,user_id,action,note) VALUES (?,?,'submit','Báo cáo thử nghiệm')").run(pending,leader);
console.log('Đã tạo bảng demo và hai vai trò leader/staff.');db.close();
