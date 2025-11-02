"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import { Card } from "primereact/card";
import { ProgressSpinner } from "primereact/progressspinner";

const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-screen items-center justify-center">
      <ProgressSpinner />
    </div>
  )
});

export default function Home() {
  const mapComponent = useMemo(() => <MapView />, []);

  return (
    <div className="min-h-screen bg-surface-ground p-4">
      <Card title="Mapa de Imóveis - SICAR" className="shadow-2">
        <div className="h-[80vh] w-full">{mapComponent}</div>
      </Card>
    </div>
  );
}
