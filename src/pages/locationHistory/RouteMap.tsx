import { useEffect, useState, type FormEvent } from "react";
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap } from "react-leaflet";
import L, { type LatLngTuple } from "leaflet";
import "leaflet/dist/leaflet.css";

import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

// Fix Leaflet's default marker icons under Vite
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

export interface Coords {
  lat: number;
  lng: number;
}

export interface RouteData {
  path: LatLngTuple[];
  distanceKm: number;
  durationMin: number;
}

export interface NominatimResult {
  lat: string;
  lon: string;
}

export interface OsrmResponse {
  code: string;
  routes: {
    distance: number;
    duration: number;
    geometry: { coordinates: [number, number][] };
  }[];
}

const OLC_ALPHABET = "23456789CFGHJMPQRVWX";

export function decodeFullPlusCode(code: string): Coords | null {
  const cleaned = code.replace("+", "").toUpperCase();
  if (cleaned.length < 8) return null;
  let lat = -90.0;
  let lng = -180.0;
  let latRes = 20.0;
  let lngRes = 20.0;
  for (let i = 0; i < Math.min(10, cleaned.length); i += 2) {
    const latVal = OLC_ALPHABET.indexOf(cleaned[i]);
    const lngVal = OLC_ALPHABET.indexOf(cleaned[i + 1]);
    if (latVal === -1 || lngVal === -1) return null;
    latRes /= 20.0;
    lngRes /= 20.0;
    lat += latVal * latRes * 20.0;
    lng += lngVal * lngRes * 20.0;
  }
  return { lat: +(lat + latRes * 10.0).toFixed(6), lng: +(lng + lngRes * 10.0).toFixed(6) };
}

export function decodeShortPlusCode(shortCode: string, refLat = 17.442, refLng = 78.384): Coords | null {
  const latBlock = Math.floor((refLat + 90.0) / 20.0);
  const latSub = Math.floor(((refLat + 90.0) % 20.0) / 1.0);
  const lngBlock = Math.floor((refLng + 180.0) / 20.0);
  const lngSub = Math.floor(((refLng + 180.0) % 20.0) / 1.0);
  if (latBlock < 0 || latBlock >= 20 || lngBlock < 0 || lngBlock >= 20) return null;
  const prefix = "" + OLC_ALPHABET[latBlock] + OLC_ALPHABET[lngBlock] + OLC_ALPHABET[latSub] + OLC_ALPHABET[lngSub];
  return decodeFullPlusCode(prefix + shortCode);
}

// Resilient geocoding supporting Google Plus Codes, GPS coordinates, and Nominatim addresses
export async function geocode(rawQuery: string, refLat = 17.442, refLng = 78.384): Promise<Coords> {
  const query = (rawQuery || "").trim();
  if (!query) throw new Error("Please enter a location, Plus Code, or GPS coordinates.");

  // 1. Direct coordinate match: "17.442059, 78.384363" or "lat: 17.442059, lon: 78.384363"
  const coordMatch = query.match(/(?:lat[:=\s]*)?(-?\d+\.\d+)[,\s]+(?:lon[:=\s]*|lng[:=\s]*)?(-?\d+\.\d+)/i);
  if (coordMatch) {
    const lat = parseFloat(coordMatch[1]);
    const lng = parseFloat(coordMatch[2]);
    if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      return { lat, lng };
    }
  }

  // 2. Full Plus Code: e.g. "7J9WC9RM+PP5"
  const fullPlusMatch = query.match(/\b([23456789CFGHJMPQRVWX]{8}\+[23456789CFGHJMPQRVWX]{2,4})\b/i);
  if (fullPlusMatch) {
    const decoded = decodeFullPlusCode(fullPlusMatch[1]);
    if (decoded) return decoded;
  }

  // 3. Short Plus Code: e.g. "C9RM+PP5"
  const shortPlusMatch = query.match(/\b([23456789CFGHJMPQRVWX]{4,7}\+[23456789CFGHJMPQRVWX]{1,4})\b/i);
  if (shortPlusMatch) {
    const decoded = decodeShortPlusCode(shortPlusMatch[1], refLat, refLng);
    if (decoded) return decoded;
  }

  // 4. Address Geocoding via Nominatim with fallback relaxation
  const cleaned = query
    .replace(/\b[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{0,4}\b[,\s]*/gi, "")
    .trim();

  const candidates: string[] = [];
  if (cleaned) candidates.push(cleaned);

  // Without postal code
  const noPincode = cleaned.replace(/\b\d{5,6}\b/g, "").replace(/,\s*,/g, ",").trim();
  if (noPincode && !candidates.includes(noPincode)) candidates.push(noPincode);

  // Address parts relaxation
  const parts = cleaned.split(",").map(p => p.trim()).filter(Boolean);
  if (parts.length >= 3) {
    const relaxed1 = `${parts[0]}, ${parts[parts.length - 1]}`;
    if (!candidates.includes(relaxed1)) candidates.push(relaxed1);
    const relaxed2 = `${parts[1]}, ${parts[parts.length - 1]}`;
    if (!candidates.includes(relaxed2)) candidates.push(relaxed2);
    const relaxed3 = parts.slice(1).join(", ");
    if (!candidates.includes(relaxed3)) candidates.push(relaxed3);
  }

  for (const candidate of candidates) {
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(candidate)}`;
      const res = await fetch(url, {
        headers: {
          "Accept-Language": "en",
        },
      });
      if (res.ok) {
        const data: NominatimResult[] = await res.json();
        if (data && data.length > 0 && data[0].lat && data[0].lon) {
          return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
        }
      }
    } catch {
      // Continue to next candidate
    }
  }

  throw new Error(`Could not find "${query}". Please verify address or enter latitude, longitude directly.`);
}

// Free routing (OSRM public demo server): two points -> path + distance + time
export async function getRoute(a: Coords, b: Coords): Promise<RouteData> {
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  const data: OsrmResponse = await res.json();
  if (data.code !== "Ok") throw new Error("No route found");
  const route = data.routes[0];
  return {
    // GeoJSON is [lng, lat]; Leaflet wants [lat, lng]
    path: route.geometry.coordinates.map(([lng, lat]): LatLngTuple => [lat, lng]),
    distanceKm: route.distance / 1000,
    durationMin: route.duration / 60,
  };
}

// Multi-point routing (OSRM): coordinate sequence -> path + distance + time
export async function getMultiPointRoute(points: Coords[]): Promise<RouteData> {
  if (points.length < 2) throw new Error("At least two coordinates required for route calculation");
  // OSRM accepts coordinates as lon,lat;lon,lat;...
  const coordsParam = points.map((p) => `${p.lng},${p.lat}`).join(";");
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${coordsParam}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  const data: OsrmResponse = await res.json();
  if (data.code !== "Ok") throw new Error("No route found for points sequence");
  const route = data.routes[0];
  return {
    path: route.geometry.coordinates.map(([lng, lat]): LatLngTuple => [lat, lng]),
    distanceKm: route.distance / 1000,
    durationMin: route.duration / 60,
  };
}

// Zoom the map so the whole route is visible
export function FitBounds({ path }: { path: LatLngTuple[] }) {
  const map = useMap();
  useEffect(() => {
    if (path.length) map.fitBounds(path, { padding: [40, 40] });
  }, [path, map]);
  return null;
}

export interface RouteMapProps {
  initialFrom?: string;
  initialTo?: string;
  initialPoints?: { a: Coords; b: Coords } | null;
  height?: string | number;
  autoLoadOnMount?: boolean;
}

export default function RouteMap({
  initialFrom = "Hitech City, Hyderabad",
  initialTo = "Charminar, Hyderabad",
  initialPoints = null,
  height = "100%",
  autoLoadOnMount = false,
}: RouteMapProps) {
  const [from, setFrom] = useState<string>(initialFrom);
  const [to, setTo] = useState<string>(initialTo);
  const [points, setPoints] = useState<{ a: Coords; b: Coords } | null>(initialPoints);
  const [route, setRoute] = useState<RouteData | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    setFrom(initialFrom)
  }, [initialFrom])

  useEffect(() => {
    setTo(initialTo)
  }, [initialTo])

  const calculateRoute = async (startQuery: string, endQuery: string) => {
    setLoading(true);
    setError("");
    try {
      const a = await geocode(startQuery);
      const b = await geocode(endQuery);
      const r = await getRoute(a, b);
      setPoints({ a, b });
      setRoute(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong finding route");
    } finally {
      setLoading(false);
    }
  };

  const calculateRouteFromCoords = async (a: Coords, b: Coords) => {
    setLoading(true);
    setError("");
    try {
      const r = await getRoute(a, b);
      setPoints({ a, b });
      setRoute(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong finding route");
    } finally {
      setLoading(false);
    }
  };

  async function handleSearch(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!from.trim() || !to.trim()) {
      setError("Please enter both Start and Destination locations");
      return;
    }
    await calculateRoute(from, to);
  }

  // Auto-load initial route if requested or when initialPoints change
  useEffect(() => {
    if (initialPoints?.a && initialPoints?.b) {
      calculateRouteFromCoords(initialPoints.a, initialPoints.b);
    } else if (autoLoadOnMount && from && to) {
      calculateRoute(from, to);
    }
  }, [initialPoints]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: height, minHeight: 480, width: "100%", position: "relative" }}>
      <form
        onSubmit={handleSearch}
        style={{
          display: "flex",
          gap: 10,
          padding: "12px 16px",
          flexWrap: "wrap",
          alignItems: "center",
          background: "#ffffff",
          borderBottom: "1px solid #e2e8f0",
          zIndex: 10,
          boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 200 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#16a34a" }}>From:</span>
          <input
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            placeholder="From (point A)"
            style={{
              flex: 1,
              padding: "8px 12px",
              border: "1px solid #cbd5e1",
              borderRadius: 6,
              fontSize: 13,
              outline: "none",
            }}
          />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 200 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#dc2626" }}>To:</span>
          <input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="To (point B)"
            style={{
              flex: 1,
              padding: "8px 12px",
              border: "1px solid #cbd5e1",
              borderRadius: 6,
              fontSize: 13,
              outline: "none",
            }}
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          style={{
            padding: "8px 18px",
            background: loading ? "#94a3b8" : "#4f1fd1",
            color: "#ffffff",
            border: "none",
            borderRadius: 6,
            fontWeight: 700,
            fontSize: 13,
            cursor: loading ? "not-allowed" : "pointer",
            boxShadow: "0 2px 6px rgba(79, 31, 209, 0.3)",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {loading ? "Finding route…" : "Show route"}
        </button>

        {route && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              background: "#f3e8ff",
              color: "#4f1fd1",
              padding: "6px 14px",
              borderRadius: 6,
              fontWeight: 700,
              fontSize: 13,
              border: "1px solid #d8b4fe",
            }}
          >
            <span>🛣️ {route.distanceKm.toFixed(1)} km</span>
            <span>⏱️ {Math.round(route.durationMin)} min</span>
          </div>
        )}

        {error && (
          <span style={{ color: "#dc2626", fontSize: 13, fontWeight: 600 }}>
            {error}
          </span>
        )}
      </form>

      <div style={{ flex: 1, width: "100%", position: "relative", minHeight: 400 }}>
        <MapContainer
          center={[17.385, 78.4867]}
          zoom={12}
          style={{ height: "100%", width: "100%", position: "absolute", inset: 0 }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {route && points && (
            <>
              {/* Dotted purple path: tiny dash + round caps + thick weight = row of dots */}
              <Polyline
                positions={route.path}
                pathOptions={{
                  color: "#4f1fd1",
                  weight: 9,
                  dashArray: "1 14",
                  lineCap: "round",
                }}
              />
              <Marker position={[points.a.lat, points.a.lng]}>
                <Popup>
                  <div style={{ padding: 4 }}>
                    <strong style={{ color: "#16a34a" }}>Start (Point A)</strong>
                    <div>{from}</div>
                    <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
                      [{points.a.lat.toFixed(5)}, {points.a.lng.toFixed(5)}]
                    </div>
                  </div>
                </Popup>
              </Marker>
              <Marker position={[points.b.lat, points.b.lng]}>
                <Popup>
                  <div style={{ padding: 4 }}>
                    <strong style={{ color: "#dc2626" }}>Destination (Point B)</strong>
                    <div>{to}</div>
                    <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
                      [{points.b.lat.toFixed(5)}, {points.b.lng.toFixed(5)}]
                    </div>
                  </div>
                </Popup>
              </Marker>
              <FitBounds path={route.path} />
            </>
          )}
        </MapContainer>
      </div>
    </div>
  );
}

