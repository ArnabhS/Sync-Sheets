import dotenv from 'dotenv';

dotenv.config();

function parseMysqlUrl(url: string): { host: string; port: number; user: string; password: string; database: string } | null {
  try {
    const u = new URL(url);
    if (!u.protocol.startsWith('mysql')) return null;
    const db = u.pathname.replace(/^\//, '').replace(/\?.*$/, '') || 'sheets_sync';
    return {
      host: u.hostname,
      port: u.port ? parseInt(u.port, 10) : 3306,
      user: decodeURIComponent(u.username || 'root'),
      password: decodeURIComponent(u.password || ''),
      database: decodeURIComponent(db),
    };
  } catch {
    return null;
  }
}

const mysqlUrlRaw = (process.env.MYSQL_URL || process.env.DATABASE_URL || '').trim();
const mysqlUrl = mysqlUrlRaw || null;
const mysqlFromUrl = mysqlUrl ? parseMysqlUrl(mysqlUrl) : null;

export const env = {
  port: parseInt(process.env.PORT ?? '4000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  mysql: {
    /** Cloud SQL connection URL (e.g. PlanetScale, Railway, Aiven). Takes precedence over host/port/user/password. */
    url: mysqlUrl ?? null,
    /** Enable SSL for cloud providers (set to 1 or true when using MYSQL_URL) */
    ssl: /^(1|true|yes)$/i.test(process.env.MYSQL_SSL ?? ''),
    host: mysqlFromUrl?.host ?? process.env.MYSQL_HOST ?? 'localhost',
    port: mysqlFromUrl?.port ?? parseInt(process.env.MYSQL_PORT ?? '3306', 10),
    user: mysqlFromUrl?.user ?? process.env.MYSQL_USER ?? 'root',
    password: mysqlFromUrl?.password ?? process.env.MYSQL_PASSWORD ?? '',
    database: mysqlFromUrl?.database ?? process.env.MYSQL_DATABASE ?? 'sheets_sync',
  },
  google: {
    credentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS ?? './service-account.json',
  },
  sync: {
    sheetPollIntervalSec: parseInt(process.env.SHEET_POLL_INTERVAL ?? '10', 10),
    dbPollIntervalSec: parseInt(process.env.DB_POLL_INTERVAL ?? '10', 10),
  },
  wsPath: process.env.WS_PATH ?? '/ws',
} as const;
