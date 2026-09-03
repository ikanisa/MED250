import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

// Executes the real SQLite schema and queries, not mocked query answers.
export function memoryD1() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  const directory = new URL('../../db/d1/migrations/', import.meta.url);
  for (const name of readdirSync(directory).filter(name => name.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL(name,directory),'utf8'));
  function prepared(sql, values=[]) {
    return {
      bind(...bindings) { return prepared(sql,bindings); },
      async first() { return sqlite.prepare(sql).get(...values) ?? null; },
      async all() { return {success:true,results:sqlite.prepare(sql).all(...values),meta:{}}; },
      async run() { return this.execute(); },
      execute() { const result=sqlite.prepare(sql).run(...values); return {success:true,results:[],meta:{changes:Number(result.changes)}}; },
    };
  }
  const db={prepare:prepared,async batch(statements) {
    sqlite.exec('BEGIN');
    try { const results=statements.map(statement=>statement.execute());sqlite.exec('COMMIT');return results; }
    catch(error) { sqlite.exec('ROLLBACK');throw error; }
  }};
  return {db,sqlite,one:(sql,...values)=>sqlite.prepare(sql).get(...values),all:(sql,...values)=>sqlite.prepare(sql).all(...values),
    run:(sql,...values)=>sqlite.prepare(sql).run(...values),close:()=>sqlite.close()};
}
