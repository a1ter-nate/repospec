-- @id: sql:parnas-secret-leak
-- @name: Internal Database or Vendor Types Leaked in Public API
-- @rung: R1
-- @severity: warn
-- @statement: A business or application file exposes raw database, ORM, HTTP framework, or vendor SDK types (like PgPool, PrismaClient, Firestore, or AxiosResponse) in its public exports.
-- @why: When callers depend directly on database or vendor types, switching providers, upgrading SDKs, or writing fast unit tests forces changes across every file that imports this module.
-- @fix: Return plain domain objects or small interfaces from this file, and keep raw database/SDK types hidden inside the persistence or adapter module.
-- @benefit: Callers become simple to test without a real database or network, and future library or storage upgrades stay isolated to a single file.
-- @source: Parnas (1972) — On the Criteria To Be Used in Decomposing Systems into Modules | https://dl.acm.org/doi/10.1145/361598.361623
-- @source: Ousterhout (2018) — A Philosophy of Software Design (Information Hiding) | https://web.stanford.edu/~ouster/cgi-bin/book.php
-- @applicability: SELECT CASE WHEN (SELECT COUNT(*) FROM files WHERE is_test = 0) = 0 THEN 'No production files indexed' ELSE NULL END

SELECT
  COALESCE(symbol, key) AS subject,
  'This file exposes the internal type "' || COALESCE(symbol, '') || '" in its public API, coupling callers to a specific storage or vendor library.' AS detail,
  file,
  line
FROM facts
WHERE kind = 'secret_leak'
ORDER BY file ASC, line ASC;
