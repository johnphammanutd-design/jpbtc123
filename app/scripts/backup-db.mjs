// Sao lưu SQLite an toàn với WAL bằng API backup của better-sqlite3
// (copy file .db trần sẽ thiếu dữ liệu còn nằm trong file -wal).
// Dùng:  node scripts/backup-db.mjs [đường-dẫn-file-đích]   (mặc định $DATA_DIR/backup.db)
import Database from 'better-sqlite3';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
const src = path.join(DATA_DIR, 'kanban.db');
const dest = process.argv[2] || path.join(DATA_DIR, 'backup.db');

const db = new Database(src, { readonly: true });
await db.backup(dest);
db.close();
console.log(`Đã sao lưu ${src} -> ${dest}`);
