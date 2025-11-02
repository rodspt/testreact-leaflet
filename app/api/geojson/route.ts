import Cursor from "pg-cursor";
import { withClient } from "@/lib/db";
import { NextRequest } from "next/server";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { PoolClient } from "pg";

type SicarRow = {
  id: number;
  cod_imovel: string;
  geojson: Geometry;
};

type GeoJsonResponse = {
  features: FeatureCollection;
  nextCursor?: string;
};

const DEFAULT_LIMIT = 5000;
const MAX_LIMIT = 20000;
const MAX_RECORD_ID = 2000000;

type QueryContext = {
  cursorValue?: number;
};

function encodeCursor(value: number): string {
  return Buffer.from(String(value), "utf-8").toString("base64url");
}

function decodeCursor(value: string): number {
  return Number(Buffer.from(value, "base64url").toString("utf-8"));
}

function buildFeature(row: SicarRow): Feature {
  return {
    type: "Feature",
    id: row.id,
    properties: {
      id: row.id,
      cod_imovel: row.cod_imovel
    },
    geometry: row.geojson
  };
}

async function runQuery(client: PoolClient, limit: number, context: QueryContext) {
  const hasCursor = typeof context.cursorValue === "number";

  const sql = hasCursor
    ? `SELECT id, cod_imovel, geojson
         FROM dw.dm_sicar
         WHERE id > $1 
         ORDER BY id
         LIMIT $2`
    : `SELECT id, cod_imovel, geojson
         FROM dw.dm_sicar
         ORDER BY id
         LIMIT $1`;
         

  const params = hasCursor ? [context.cursorValue, limit] : [limit];

  const cursorQuery = client.query(new Cursor(sql, params));

  return new Promise<SicarRow[]>((resolve, reject) => {
    cursorQuery.read(limit, (err, rows) => {
      if (err) {
        cursorQuery.close(() => reject(err));
        return;
      }

      cursorQuery.close((closeErr) => {
        if (closeErr) {
          reject(closeErr);
          return;
        }
        resolve(rows as SicarRow[]);
      });
    });
  });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limitParam = searchParams.get("limit");
  const cursorParam = searchParams.get("cursor");

  const limit = Math.min(Math.max(Number(limitParam) || DEFAULT_LIMIT, 1), MAX_LIMIT);

  const context: QueryContext = {};
  if (cursorParam) {
    context.cursorValue = decodeCursor(cursorParam);
  }

  try {
    const rows = await withClient((client) => runQuery(client, limit, context));

    const features = rows.map(buildFeature);
    const lastRow = rows[rows.length - 1];

    const response: GeoJsonResponse = {
      features: {
        type: "FeatureCollection",
        features
      }
    };

    if (lastRow) {
      response.nextCursor = encodeCursor(lastRow.id);
    }

    return new Response(JSON.stringify(response), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    console.error("Error fetching geojson:", error);
    return new Response(JSON.stringify({ error: "Failed to fetch data" }), {
      status: 500,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
}
