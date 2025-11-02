"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { MapContainer, TileLayer } from "react-leaflet";
import type { FeatureCollection, Geometry } from "geojson";
import L from "leaflet";
import { Toast } from "primereact/toast";
import { ProgressBar } from "primereact/progressbar";

const INITIAL_VIEW: L.LatLngExpression = [-14.235, -51.9253];
const INITIAL_ZOOM = 5;
const FETCH_LIMIT = 5000;
const YIELD_DELAY_MS = 25;

const TILE_LAYER = {
  url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution:
    "© <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors"
};

type ApiResponse = {
  features: FeatureCollection<Geometry>;
  nextCursor?: string;
};

export default function MapView(): ReactElement {
  const toastRef = useRef<Toast | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const geoJsonLayerRef = useRef<L.GeoJSON<Geometry> | null>(null);
  const queueRef = useRef<FeatureCollection<Geometry>[]>([]);
  const cancelledRef = useRef(false);
  const shouldFitBoundsRef = useRef(true);

  const [totalFetched, setTotalFetched] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

  const ensureLayer = useCallback(() => {
    if (!mapRef.current) {
      return null;
    }

    if (!geoJsonLayerRef.current) {
      const layer = L.geoJSON(undefined, { pane: "overlayPane" });
      layer.addTo(mapRef.current);
      geoJsonLayerRef.current = layer as L.GeoJSON<Geometry>;
    }

    return geoJsonLayerRef.current;
  }, []);

  const applyQueue = useCallback(() => {
    const layer = ensureLayer();
    if (!layer) {
      return;
    }

    while (queueRef.current.length > 0) {
      const collection = queueRef.current.shift();
      if (!collection) {
        continue;
      }

      layer.addData(collection);

      if (shouldFitBoundsRef.current && mapRef.current) {
        const bounds = layer.getBounds();
        if (bounds.isValid()) {
          mapRef.current.fitBounds(bounds, { padding: [16, 16] });
          shouldFitBoundsRef.current = false;
        }
      }
    }
  }, [ensureLayer]);

  const addCollection = useCallback(
    (collection: FeatureCollection<Geometry>) => {
      const layer = ensureLayer();
      if (!layer) {
        queueRef.current.push(collection);
        return;
      }

      layer.addData(collection);

      if (shouldFitBoundsRef.current && mapRef.current) {
        const bounds = layer.getBounds();
        if (bounds.isValid()) {
          mapRef.current.fitBounds(bounds, { padding: [16, 16] });
          shouldFitBoundsRef.current = false;
        }
      }
    },
    [ensureLayer]
  );

  const fetchChunk = useCallback(
    async (cursor?: string) => {
      const params = new URLSearchParams({ limit: String(FETCH_LIMIT) });
      if (cursor) {
        params.set("cursor", cursor);
      }

      const response = await fetch(`/api/geojson?${params.toString()}`, {
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error(`Falha ao buscar dados (${response.status})`);
      }

      const payload: ApiResponse = await response.json();
      addCollection(payload.features);
      setTotalFetched((prev) => prev + payload.features.features.length);

      if (!payload.nextCursor) {
        setHasMore(false);
      }

      return payload.nextCursor;
    },
    [addCollection]
  );

  useEffect(() => {
    cancelledRef.current = false;
    shouldFitBoundsRef.current = true;
    let cursor: string | undefined;

    const load = async () => {
      setIsLoading(true);
      try {
        while (!cancelledRef.current) {
          const nextCursor = await fetchChunk(cursor);
          applyQueue();

          if (!nextCursor) {
            break;
          }

          cursor = nextCursor;
          await new Promise((resolve) => setTimeout(resolve, YIELD_DELAY_MS));
        }
      } catch (error) {
        console.error(error);
        toastRef.current?.show({
          severity: "error",
          summary: "Erro",
          detail: "Falha ao carregar os dados do mapa"
        });
      } finally {
        if (!cancelledRef.current) {
          applyQueue();
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelledRef.current = true;
    };
  }, [applyQueue, fetchChunk]);

  const progressLabel = useMemo(() => {
    const total = totalFetched.toLocaleString("pt-BR");
    if (isLoading && hasMore) {
      return `Carregando: ${total} registros carregados`;
    }
    if (!hasMore) {
      return `Concluído: ${total} registros carregados`;
    }
    return `Preparando dados: ${total} registros carregados`;
  }, [hasMore, isLoading, totalFetched]);

  const showProgress = isLoading || hasMore;

  return (
    <div className="relative h-full w-full">
      <Toast ref={toastRef} />
      {showProgress && (
        <div className="absolute left-1/2 top-4 z-[1000] w-full max-w-md -translate-x-1/2 px-4">
          <ProgressBar mode="indeterminate" />
          <div className="mt-2 text-center text-sm text-surface-500">
            {progressLabel}
          </div>
        </div>
      )}
      <MapContainer
        center={INITIAL_VIEW}
        zoom={INITIAL_ZOOM}
        preferCanvas
        className="h-full w-full"
        ref={(instance) => {
          mapRef.current = instance;
          ensureLayer();
          applyQueue();
        }}
      >
        <TileLayer url={TILE_LAYER.url} attribution={TILE_LAYER.attribution} />
      </MapContainer>
    </div>
  );
}
