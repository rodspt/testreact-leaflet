"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { MapContainer, TileLayer } from "react-leaflet";
import type { Feature, FeatureCollection, Geometry, Point } from "geojson";
import Supercluster from "supercluster";
import type { ClusterFeature, PointFeature } from "supercluster";
import L from "leaflet";
import { Toast } from "primereact/toast";
import { ProgressBar } from "primereact/progressbar";

const INITIAL_VIEW: L.LatLngExpression = [-14.235, -51.9253];
const INITIAL_ZOOM = 5;
const FETCH_LIMIT = 5000;
const YIELD_DELAY_MS = 25;
const CLUSTER_RADIUS = 60;
const CLUSTER_MAX_ZOOM = 18;

const TILE_LAYER = {
  url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution:
    "© <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> contributors"
};

type ClusterProperties = {
  id?: number;
  cluster?: boolean;
  cluster_id?: number;
  point_count?: number;
  point_count_abbreviated?: number;
};

type ClusterPointFeature = PointFeature<ClusterProperties>;
type ClusterOrPointFeature = ClusterFeature<ClusterProperties> | ClusterPointFeature;

type ApiResponse = {
  features: FeatureCollection<Geometry>;
  nextCursor?: string;
};

function geometryToLatLng(geometry: Geometry | null | undefined): L.LatLng | null {
  if (!geometry) {
    return null;
  }
  try {
    const layer = L.geoJSON(geometry);
    const bounds = layer.getBounds();
    if (!bounds.isValid()) {
      return null;
    }
    return bounds.getCenter();
  } catch (error) {
    console.error("Failed to compute geometry center", error);
    return null;
  }
}

function createClusterIcon(count: number): L.DivIcon {
  const size = 40;
  return L.divIcon({
    html: `<div style="display:flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;border-radius:50%;background:#2563eb;color:#fff;font-weight:600;font-size:13px;">${count}</div>`,
    className: "",
    iconSize: [size, size]
  });
}

export default function MapView(): ReactElement {
  const toastRef = useRef<Toast | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const clusterLayerRef = useRef<L.LayerGroup | null>(null);
  const superclusterRef = useRef<Supercluster<ClusterProperties> | null>(null);
  const featureMapRef = useRef<Map<number, Feature<Geometry>>>(new Map());
  const pointsRef = useRef<ClusterPointFeature[]>([]);
  const nextFeatureIdRef = useRef(1);
  const boundsRef = useRef<L.LatLngBounds | null>(null);
  const cancelledRef = useRef(false);
  const shouldFitBoundsRef = useRef(true);

  const [mapReady, setMapReady] = useState(false);
  const [totalFetched, setTotalFetched] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

  const ensureClusterLayer = useCallback(() => {
    const map = mapRef.current;
    if (!map) {
      return null;
    }
    if (!clusterLayerRef.current) {
      const clusterLayer = L.layerGroup();
      clusterLayer.addTo(map);
      clusterLayerRef.current = clusterLayer;
    }
    return clusterLayerRef.current;
  }, []);

  const getSupercluster = useCallback(() => {
    if (!superclusterRef.current) {
      const instance = new Supercluster<ClusterProperties>({
        radius: CLUSTER_RADIUS,
        maxZoom: CLUSTER_MAX_ZOOM
      });
      if (pointsRef.current.length > 0) {
        instance.load(pointsRef.current);
      }
      superclusterRef.current = instance;
    }
    return superclusterRef.current;
  }, []);

  const renderClusters = useCallback(() => {
    const map = mapRef.current;
    const clusterLayer = ensureClusterLayer();
    const superclusterInstance = getSupercluster();
    if (!map || !clusterLayer || !superclusterInstance) {
      return;
    }

    clusterLayer.clearLayers();
    if (pointsRef.current.length === 0) {
      return;
    }

    const zoom = Math.round(map.getZoom());
    const bounds = map.getBounds();
    const clusters: ClusterOrPointFeature[] = superclusterInstance.getClusters(
      [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()],
      zoom
    ) as ClusterOrPointFeature[];

    clusters.forEach((cluster: ClusterOrPointFeature) => {
      const [lng, lat] = cluster.geometry.coordinates as [number, number];
      if (cluster.properties?.cluster) {
        const marker = L.marker([lat, lng], {
          icon: createClusterIcon(cluster.properties.point_count ?? 1)
        });
        const clusterId = cluster.properties.cluster_id;
        if (typeof clusterId === "number") {
          marker.on("click", () => {
            if (!pointsRef.current.length) {
              return;
            }

            let nextZoom = map.getZoom();
            try {
              nextZoom = Math.min(
                superclusterInstance.getClusterExpansionZoom(clusterId),
                CLUSTER_MAX_ZOOM
              );
            } catch (error) {
              console.warn("Failed to expand cluster", error);
              return;
            }

            map.flyTo([lat, lng], nextZoom);
          });
        }
        clusterLayer.addLayer(marker);
        return;
      }

      const id = cluster.properties?.id;
      if (!id) {
        return;
      }
      const feature = featureMapRef.current.get(id);
      if (!feature) {
        return;
      }
      clusterLayer.addLayer(L.geoJSON(feature));
    });

    if (shouldFitBoundsRef.current && boundsRef.current && boundsRef.current.isValid()) {
      map.fitBounds(boundsRef.current, { padding: [16, 16] });
      shouldFitBoundsRef.current = false;
    }
  }, [ensureClusterLayer, getSupercluster]);


  const addCollection = useCallback(
    (collection: FeatureCollection<Geometry>) => {
      if (!collection.features.length) {
        return;
      }

      const superclusterInstance = getSupercluster();
      if (!superclusterInstance) {
        return;
      }

      const newPoints: ClusterPointFeature[] = [];
      const nextBounds = L.latLngBounds([]);
      if (boundsRef.current && boundsRef.current.isValid()) {
        nextBounds.extend(boundsRef.current.getSouthWest());
        nextBounds.extend(boundsRef.current.getNorthEast());
      }

      collection.features.forEach((feature) => {
        const center = geometryToLatLng(feature.geometry);
        if (!center) {
          return;
        }

        const id = nextFeatureIdRef.current++;
        featureMapRef.current.set(id, feature);
        newPoints.push({
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [center.lng, center.lat]
          },
          properties: { id }
        });

        nextBounds.extend(center);
      });

      if (!newPoints.length) {
        return;
      }

      pointsRef.current = [...pointsRef.current, ...newPoints];
      boundsRef.current = nextBounds.isValid() ? nextBounds : boundsRef.current;
      superclusterInstance.load(pointsRef.current);

      if (mapReady) {
        renderClusters();
      }
    },
    [getSupercluster, mapReady, renderClusters]
  );

  useEffect(() => {
    cancelledRef.current = false;
    shouldFitBoundsRef.current = true;
    boundsRef.current = null;
    featureMapRef.current.clear();
    pointsRef.current = [];
    // Reset the shared Supercluster instance so a fresh one will be
    // created when needed (avoids keeping stale index/config).
    superclusterRef.current = null;
    nextFeatureIdRef.current = 1;
    setTotalFetched(0);
    setHasMore(true);

    let cursor: string | undefined;

    const load = async () => {
      setIsLoading(true);
      try {
        while (!cancelledRef.current) {
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
            break;
          }

          cursor = payload.nextCursor;
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
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelledRef.current = true;
    };
  }, [addCollection]);


  useEffect(() => {
    if (!mapReady) {
      return;
    }

    const map = mapRef.current;
    if (!map) {
      return;
    }

    const handleMove = () => {
      renderClusters();
    };

    map.on("moveend", handleMove);
    map.on("zoomend", handleMove);

    return () => {
      map.off("moveend", handleMove);
      map.off("zoomend", handleMove);
    };
  }, [mapReady, renderClusters]);

  useEffect(() => {
    if (mapReady) {
      renderClusters();
    }
  }, [mapReady, renderClusters]);

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
          <div className="mt-2 text-center text-sm text-surface-500">{progressLabel}</div>
        </div>
      )}
      <MapContainer
        center={INITIAL_VIEW}
        zoom={INITIAL_ZOOM}
        preferCanvas
        className="h-full w-full"
        ref={(instance) => {
          mapRef.current = instance;
          if (instance && !mapReady) {
            setMapReady(true);
          }
        }}
        whenReady={() => {
          setMapReady(true);
          renderClusters();
        }}
      >
        <TileLayer url={TILE_LAYER.url} attribution={TILE_LAYER.attribution} />
      </MapContainer>
    </div>
  );
}
