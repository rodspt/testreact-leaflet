import { Pool } from "pg";

type DbConfig = {
  connectionString?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  ssl?: boolean;
};

const {
  PG_CONNECTION_STRING,
  PGHOST,
  PGPORT,
  PGUSER,
  PGPASSWORD,
  PGDATABASE,
  PGSSL
} = process.env as Record<string, string | undefined>;

const baseConfig: DbConfig = PG_CONNECTION_STRING
  ? { connectionString: PG_CONNECTION_STRING }
  : {
      host: PGHOST ?? "192.168.0.25",
      port: PGPORT ? Number(PGPORT) : 5431,
      user: PGUSER ?? "postgres",
      password: PGPASSWORD ?? "postgres",
      database: PGDATABASE ?? "postgres",
      ssl: PGSSL ? PGSSL === "true" : false
    };

export const pool = new Pool(baseConfig);

export async function withClient<T>(fn: (client: import("pg").PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
