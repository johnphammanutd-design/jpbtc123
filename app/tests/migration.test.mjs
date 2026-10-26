import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import Database from 'better-sqlite3';

test('existing users, grants, completed work and checklist survive repeat migration',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kanban-legacy-'));
  try {
    const legacy=new Database(path.join(dir,'kanban.db'));
    legacy.exec(`
      CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT UNIQUE,name TEXT,password_hash TEXT,is_admin INTEGER DEFAULT 0,disabled INTEGER DEFAULT 0,created_at TEXT DEFAULT (datetime('now')));
      CREATE TABLE boards(id INTEGER PRIMARY KEY,title TEXT,position REAL DEFAULT 0,visibility TEXT DEFAULT 'workspace',closed INTEGER DEFAULT 0,created_at TEXT DEFAULT (datetime('now')));
      CREATE TABLE lists(id INTEGER PRIMARY KEY,board_id INTEGER,title TEXT,position REAL DEFAULT 0);
      CREATE TABLE cards(id INTEGER PRIMARY KEY,list_id INTEGER,title TEXT,description TEXT DEFAULT '',assignee_id INTEGER,labels TEXT DEFAULT '[]',due_date TEXT DEFAULT '',position REAL DEFAULT 0,created_at TEXT DEFAULT (datetime('now')),due_complete INTEGER DEFAULT 0);
      CREATE TABLE checklist_items(id INTEGER PRIMARY KEY,card_id INTEGER,text TEXT,checked INTEGER DEFAULT 0,position REAL DEFAULT 0);
      CREATE TABLE comments(id INTEGER PRIMARY KEY,card_id INTEGER,user_id INTEGER,text TEXT,created_at TEXT DEFAULT (datetime('now')));
      CREATE TABLE board_members(board_id INTEGER,user_id INTEGER,PRIMARY KEY(board_id,user_id));
      INSERT INTO users(id,username,name,password_hash,is_admin) VALUES (1,'director','Giám đốc','existing-hash',1),(2,'employee','Nhân viên','employee-hash',0);
      INSERT INTO boards(id,title,visibility) VALUES (1,'Bảng đang vận hành','private');
      INSERT INTO board_members VALUES (1,2);
      INSERT INTO lists(id,board_id,title) VALUES (1,1,'Công việc');
      INSERT INTO cards(id,list_id,title,due_complete) VALUES (1,1,'Việc cũ đã hoàn thành',1);
      INSERT INTO checklist_items(id,card_id,text,checked) VALUES (1,1,'Giữ nguyên việc con',1);
    `);legacy.close();
    const planPath=path.join(dir,'plan.json');fs.writeFileSync(planPath,JSON.stringify({teams:[{name:'Team thực tế',members:[{username:'employee',role:'leader'}]}],boards:[{id:1,team:'Team thực tế',members:[{username:'employee',role:'manager'}]}]}));
    const script=new URL('../scripts/configure-access.mjs',import.meta.url);
    const digest=()=>createHash('sha256').update(fs.readFileSync(path.join(dir,'kanban.db'))).digest('hex');
    const before=digest(),env={...process.env,NODE_ENV:'test',DATA_DIR:dir};
    const checked=JSON.parse(execFileSync(process.execPath,[fileURLToPath(script),planPath],{env,encoding:'utf8'}));
    assert.equal(checked.mode,'checked-read-only');assert.equal(digest(),before);
    const dbUrl=new URL('../src/db.js',import.meta.url).href;
    const accessUrl=new URL('../src/access.js',import.meta.url).href;
    const code=`const {db}=await import(${JSON.stringify(dbUrl)});const {boardRole}=await import(${JSON.stringify(accessUrl)});console.log(JSON.stringify({hash:db.prepare('SELECT password_hash FROM users WHERE id=1').get().password_hash,card:db.prepare('SELECT title,due_complete,approval_state FROM cards WHERE id=1').get(),groups:db.prepare('SELECT COUNT(*) AS n FROM checklist_groups').get().n,item:db.prepare('SELECT text,checked,group_id FROM checklist_items WHERE id=1').get(),role:boardRole({id:2,is_admin:0},1),violations:db.prepare('PRAGMA foreign_key_check').all()}));db.close();`;
    for(let i=0;i<2;i++) {
      const result=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',code],{env:{...process.env,NODE_ENV:'test',DATA_DIR:dir},encoding:'utf8'}));
      assert.equal(result.hash,'existing-hash');assert.equal(result.card.due_complete,1);assert.equal(result.card.approval_state,'approved');assert.equal(result.groups,1);assert.equal(result.item.checked,1);assert.ok(result.item.group_id);assert.equal(result.role,'member');assert.deepEqual(result.violations,[]);
    }
    const applied=JSON.parse(execFileSync(process.execPath,[fileURLToPath(script),planPath,'--apply'],{env,encoding:'utf8'}));assert.equal(applied.mode,'applied');
    const verify=new Database(path.join(dir,'kanban.db'),{readonly:true});assert.equal(verify.prepare('SELECT role FROM board_members WHERE board_id=1 AND user_id=2').get().role,'manager');assert.equal(verify.prepare('SELECT role FROM team_members WHERE user_id=2').get().role,'leader');verify.close();
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
