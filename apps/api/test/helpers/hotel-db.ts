// Deterministic Drizzle-shaped repository fixture. This tests route races and
// persistence boundaries, not PostgreSQL locking; real-DB UAT remains required.
import { getTableColumns, getTableName } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
export function hotelDatabaseFixture() {
  const tables: Record<string, any[]> = { hotel_quotes: [], hotel_attempts: [] };
  const dialect = new PgDialect();
  function match(table: any, row: any, condition: any) {
    if (!condition) return true;
    const { sql, params } = dialect.sqlToQuery(condition);
    const fields = Object.entries(getTableColumns(table));
    const tests = [...sql.matchAll(/"[^"]+"\."([^"]+)"\s*(=|<=|<)\s*\$(\d+)/g)];
    const nulls = [...sql.matchAll(/"[^"]+"\."([^"]+)"\s+is null/gi)];
    if (nulls.some(([,column]) => { const key=fields.find(([,col]:any)=>col.name===column)?.[0]; return row[key!] != null; })) return false;
    return tests.every(([, column, op, n]) => {
      const key = fields.find(([, col]: any) => col.name === column)?.[0];
      const a = row[key!], b = params[Number(n) - 1];
      const av = a instanceof Date ? a.toISOString() : a, bv = b instanceof Date ? b.toISOString() : b;
      return op === '=' ? av === bv : op === '<' ? av < bv : av <= bv;
    });
  }
  const db: any = {
    select: () => ({ from: (table: any) => {
      const query = (condition: any, join = false) => {
        const chain: any = { orderBy: () => chain, limit: async (n: number) => tables[getTableName(table)].filter(row => match(table,row,condition)).slice(0,n).map(r => join ? { attempt: structuredClone(r), quote: structuredClone(tables.hotel_quotes.find(q=>q.id===r.quoteId)) } : structuredClone(r)) };
        return chain;
      };
      return { where: (condition: any) => query(condition), innerJoin: () => ({ where: (condition: any) => query(condition,true) }) };
    } }),
    insert: (table: any) => ({ values: (value: any) => {
      const name = getTableName(table);
      let ignore = false;
      const execute = async () => {
        if (!tables[name]) return [];
        const duplicate = name === 'hotel_attempts' && tables[name].some(r => r.quoteId === value.quoteId || r.tenantId === value.tenantId && r.providerBookingId === value.providerBookingId || r.tenantId === value.tenantId && r.userId === value.userId && r.idempotencyKey === value.idempotencyKey);
        if (duplicate) { if (ignore) return []; throw new Error('Unique constraint'); }
        const row = { checks: 0, nextCheckAt: new Date(), createdAt: new Date(), updatedAt: new Date(), ...value };
        tables[name].push(row); return [row];
      };
      const chain: any = { onConflictDoNothing() { ignore = true; return chain; }, returning: execute, then: (yes: any, no: any) => execute().then(yes, no) };
      return chain;
    } }),
    update: (table: any) => ({ set: (values: any) => ({ where: (condition: any) => {
      const execute = async () => { const rows = tables[getTableName(table)].filter(r => match(table, r, condition)); rows.forEach(r => Object.assign(r, values)); return rows; };
      return { returning: execute, then: (yes: any, no: any) => execute().then(yes,no) };
    } }) }),
  };
  return { db, tables };
}
