import { getDb } from "../server/db.js";

async function diagnose() {
  const db = await getDb();
  if (!db) { console.log("DB unavailable - check DATABASE_URL"); return; }
  
  const [sessions] = await db.execute("SELECT id, matchedCount, divergentCount, pendingCount FROM reconciliation_sessions ORDER BY id DESC LIMIT 1") as any;
  if (!sessions?.[0]) { console.log("Nenhuma sessão encontrada"); process.exit(0); }
  const s = sessions[0];
  console.log(`═══ SESSÃO #${s.id} ═══`);
  console.log(`Stored: matched=${s.matchedCount} divergent=${s.divergentCount} pending=${s.pendingCount}`);
  
  const [bankStats] = await db.execute(`SELECT matchStatus, COUNT(*) as cnt FROM bank_transactions WHERE sessionId = ${s.id} GROUP BY matchStatus ORDER BY cnt DESC`) as any;
  console.log(`\nbank_transactions por matchStatus:`);
  for (const r of bankStats) console.log(`  ${r.matchStatus ?? 'NULL'}: ${r.cnt}`);
  
  const [divStats] = await db.execute(`SELECT divergenceType, status, COUNT(*) as cnt FROM divergences WHERE sessionId = ${s.id} GROUP BY divergenceType, status ORDER BY cnt DESC`) as any;
  console.log(`\ndivergences por tipo/status:`);
  for (const r of divStats) console.log(`  ${r.divergenceType}/${r.status}: ${r.cnt}`);
  
  const [orphans] = await db.execute(`
    SELECT bt.bankName, bt.type, CAST(bt.amount AS CHAR) as amt, bt.matchStatus, SUBSTRING(bt.description,1,60) as d
    FROM bank_transactions bt WHERE bt.sessionId = ${s.id}
    AND bt.matchStatus NOT IN ('matched', 'manual')
    AND bt.id NOT IN (SELECT COALESCE(bankTransactionId, 0) FROM divergences WHERE sessionId = ${s.id})
    LIMIT 15
  `) as any;
  console.log(`\nÓRFÃOS (divergent SEM divergência):`);
  for (const r of orphans) console.log(`  [${r.bankName}] ${r.type} R$${r.amt} ${r.d}`);
  
  const [oc] = await db.execute(`
    SELECT COUNT(*) as cnt FROM bank_transactions bt WHERE bt.sessionId = ${s.id}
    AND bt.matchStatus NOT IN ('matched', 'manual')
    AND bt.id NOT IN (SELECT COALESCE(bankTransactionId, 0) FROM divergences WHERE sessionId = ${s.id})
  `) as any;
  console.log(`  TOTAL ÓRFÃOS: ${oc[0].cnt}`);
  
  process.exit(0);
}
diagnose().catch(e => { console.error(e.message); process.exit(1); });
