// Read-only by default. --apply is required to migrate and apply an explicit access plan.
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
const args=process.argv.slice(2),dataDir=process.env.DATA_DIR || path.resolve('data'),file=path.join(dataDir,'kanban.db');
const read=new Database(file,{readonly:true,fileMustExist:true});
const users=read.prepare('SELECT id,username,name,is_admin,disabled FROM users ORDER BY id').all();
const boards=read.prepare('SELECT id,title FROM boards WHERE closed=0 ORDER BY id').all();
if(args.includes('--inventory')) {console.log(JSON.stringify({users,boards},null,2));read.close();process.exit(0);}
const planPath=args.find(a=>!a.startsWith('--'));
if(!planPath)throw new Error('Cách dùng: DATA_DIR=... node scripts/configure-access.mjs plan.json [--apply], hoặc --inventory');
const plan=JSON.parse(fs.readFileSync(planPath,'utf8'));
if(!Array.isArray(plan.teams) || !Array.isArray(plan.boards))throw new Error('Cần mảng teams và boards');
const lookup=(username)=>{const user=users.find(u=>u.username.toLowerCase()===String(username).toLowerCase());if(!user || user.disabled)throw new Error('Tài khoản không tồn tại hoặc đã khóa: '+username);return user.id;};
const convertMembers=(members,roles)=>{
  if(!Array.isArray(members))throw new Error('Cần danh sách thành viên');
  const result=members.map(m=>{if(!roles.includes(m.role))throw new Error('Vai trò không hợp lệ');return {user_id:lookup(m.username),role:m.role};});
  if(new Set(result.map(m=>m.user_id)).size!==result.length)throw new Error('Thành viên bị lặp');return result;
};
const teams=plan.teams.map(t=>{const name=String(t.name || '').trim();if(!name)throw new Error('Tên team không được trống');return {name,members:convertMembers(t.members,['member','leader'])};});
if(new Set(teams.map(t=>t.name)).size!==teams.length)throw new Error('Tên team bị lặp');
const configured=plan.boards.map(b=>{
  if(!boards.some(row=>row.id===b.id))throw new Error('Bảng không tồn tại hoặc đã đóng: '+b.id);
  if(b.team && !teams.some(t=>t.name===b.team))throw new Error('Team của bảng chưa có trong kế hoạch');
  return {id:b.id,team:b.team || null,members:convertMembers(b.members,['member','manager'])};
});
if(new Set(configured.map(b=>b.id)).size!==configured.length)throw new Error('Bảng bị lặp');
const missing=boards.filter(b=>!configured.some(c=>c.id===b.id));if(missing.length)throw new Error('Cần cấp quyền rõ ràng cho tất cả bảng đang mở: '+missing.map(b=>b.id).join(', '));
read.close();
if(args.includes('--apply')) {
  // Migration happens only after the complete plan passes validation.
  const {db}=await import('../src/db.js');
  db.transaction(()=>{
    const ids=new Map();
    for(const team of teams) {
      db.prepare('INSERT OR IGNORE INTO teams(name) VALUES (?)').run(team.name);
      const id=db.prepare('SELECT id FROM teams WHERE name=?').get(team.name).id;ids.set(team.name,id);
      db.prepare('DELETE FROM team_members WHERE team_id=?').run(id);
      for(const m of team.members)db.prepare('INSERT INTO team_members(team_id,user_id,role) VALUES (?,?,?)').run(id,m.user_id,m.role);
    }
    for(const board of configured) {
      db.prepare("UPDATE boards SET team_id=?,visibility='private' WHERE id=?").run(board.team?ids.get(board.team):null,board.id);
      db.prepare('DELETE FROM board_members WHERE board_id=?').run(board.id);
      for(const m of board.members)db.prepare('INSERT INTO board_members(board_id,user_id,role) VALUES (?,?,?)').run(board.id,m.user_id,m.role);
    }
  })();db.close();
}
console.log(JSON.stringify({mode:args.includes('--apply')?'applied':'checked-read-only',teams:teams.length,boards:configured.length,grants:configured.reduce((n,b)=>n+b.members.length,0)}));
