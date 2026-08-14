import mysql, { type ResultSetHeader } from "mysql2/promise";
import { assertIndexedWindowPlan, type ExplainRow } from "./lib/database-query-plan-audit";

const REPRESENTATIVE_FEE_ROWS = 5_000;

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required for the query-plan audit.");

  const connection = await mysql.createConnection(databaseUrl);
  await connection.beginTransaction();
  try {
    const openId = `query-plan-audit-${Date.now()}`;
    const [userResult] = await connection.execute<ResultSetHeader>(
      "INSERT INTO users (`openId`, `name`, `email`, `role`, `locale`) VALUES (?, 'Query Plan Audit', NULL, 'admin', 'en')",
      [openId],
    );
    await connection.query("SET SESSION cte_max_recursion_depth = 6000");
    await connection.execute(
      `INSERT INTO success_fees
        (user_id, employer_name, job_title, monthly_salary, currency, fee_percent,
         monthly_fee_amount, status, start_date, created_at, updated_at)
       WITH RECURSIVE seq(n) AS (
         SELECT 1
         UNION ALL
         SELECT n + 1 FROM seq WHERE n < ?
       )
       SELECT ?, CONCAT('Plan Employer ', n), CONCAT('Plan Role ', n), 8000, 'USD', 5,
              40000,
              CASE MOD(n, 4)
                WHEN 0 THEN 'active'
                WHEN 1 THEN 'pending_verification'
                WHEN 2 THEN 'paused'
                ELSE 'ended'
              END,
              TIMESTAMPADD(DAY, -30, CURRENT_TIMESTAMP),
              TIMESTAMPADD(SECOND, -n, CURRENT_TIMESTAMP),
              TIMESTAMPADD(SECOND, -n, CURRENT_TIMESTAMP)
       FROM seq`,
      [REPRESENTATIVE_FEE_ROWS, userResult.insertId],
    );

    const [allRows] = await connection.query<ExplainRow[]>(
      `EXPLAIN SELECT sf.id
       FROM success_fees sf
       ORDER BY sf.created_at DESC, sf.id DESC
       LIMIT 100 OFFSET 0`,
    );
    const [activeRows] = await connection.query<ExplainRow[]>(
      `EXPLAIN SELECT sf.id
       FROM success_fees sf
       WHERE sf.status = 'active'
       ORDER BY sf.created_at DESC, sf.id DESC
       LIMIT 100 OFFSET 0`,
    );

    const audit = {
      representativeRows: REPRESENTATIVE_FEE_ROWS,
      plans: [
        assertIndexedWindowPlan("all success fees", allRows, "success_fees_created_id_idx"),
        assertIndexedWindowPlan("active success fees", activeRows, "success_fees_status_created_id_idx"),
      ],
    };
    console.log(JSON.stringify(audit, null, 2));
  } finally {
    await connection.rollback();
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Database query-plan audit failed.");
  process.exit(1);
});
