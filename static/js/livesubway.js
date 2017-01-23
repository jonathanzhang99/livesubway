"use strict";

const SPEED = 60;
const DURATION = 30;
const TOTAL_FRAMERATE = SPEED * DURATION;
const INTERVAL = 1000 / SPEED;
const SAMPLE_POINTS = 20;

const DB_NAME = "LIVESUBWAY_DB"
const DB_ROUTES_STORE = "ROUTES_STORE";
const DB_STOPS_STORE = "STOPS_STORE";

const LEAFLET_TYLE_LAYER = "http://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png";
const LEAFLET_ATTRIBUTION = `&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy;` +
                            `<a href="http://cartodb.com/attributions">CartoDB</a>`

const LEAFLET_CENTER = [40.758896, -73.985130];
const LEAFLET_ZOOM = 13;
const LEAFLET_MAX_ZOOM = 18;

const SUBWAY_ICON = `<i class="fa fa-subway" aria-hidden="true"></i>`

const MAPBOX = {
  container: "subwaymap",
  style: "mapbox://styles/mapbox/light-v9",
  center: [-73.983393, 40.788552],
  dragRotate: false,
  zoom: 10.84,
};

const LAYER = {
  id: "subwayCars",
  type: "circle",
  source: "subwayCars",
  paint: {
    "circle-radius": 4,
    "circle-color": "#000000",
  },
};

const STOP_ATTR = {
  id: "stops",
  type: "circle",
  source: "stops",
  paint: {
    "circle-radius": {
      stops: [
        [11, 3],
        [14, 4],
        [16, 5]
      ],
    },
    "circle-color": "#ff3300",
  },
};

const renderCars = (map, subwayCars) => {
  const lineTuple = subwayCars.map(subwayCar => {
    const line = {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: subwayCar.path,
      },
    };

    const distance = turf.lineDistance(line, "miles");
    const distanceTraveled = subwayCar.progress * distance;

    return [line, distance, distanceTraveled, subwayCar.remaining_time];
  });

  const points = lineTuple.map(x => {
    return turf.along(x[0], x[2], "miles");
  });

  const allAnimSteps = lineTuple.map(x => {
    const [line, d, dT, rT] = x;
    const remainingDistance = d - dT;
    const animSpeed = SPEED * rT;
    const animFrames = SPEED * Math.min(DURATION, rT);

    return [...Array(TOTAL_FRAMERATE).keys()].map((x, i) => {
      const distance = i < animFrames ? dT + (i / animSpeed) * remainingDistance : d;

      const segment = turf.along(line, distance, "miles");

      return segment.geometry.coordinates;
    });
  });

  const source = {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: points,
    },
  };

  if (map.getSource("subwayCars") === undefined) {
    map.addSource("subwayCars", source);
  } else {
    map.getSource("subwayCars").setData(source.data);
  }

  if (map.getLayer("subwayCars") === undefined) {
    map.addLayer(LAYER);
  }

  const start = Date.now();

  let then = start;
  let counter = 0;

  const animate = () => {
    if (counter / INTERVAL < (SPEED * DURATION) - 1) {
      const now = Date.now();
      const elapsed = now - then;

      then = now;

      points.forEach((point, i) => {
        const animSteps = allAnimSteps[i];

        point.geometry.coordinates = animSteps[Math.round(elapsed / INTERVAL)];
      });

      map.getSource("subwayCars").setData({
        type: "FeatureCollection",
        features: points,
      });

      counter += elapsed;

      requestAnimationFrame(animate);
    } else {
      const animTime = ((Date.now() - start) / 1000).toString();

      console.log(`Time elapsed for animation: ${animTime}`);
    }
  };

  animate();
};

const getJSON = (path, success, fail) => {
  const xmlhttp = new XMLHttpRequest();

  xmlhttp.onreadystatechange = () => {
    if (xmlhttp.readyState === XMLHttpRequest.DONE) {
      if (xmlhttp.status === 200) {
        success(JSON.parse(xmlhttp.responseText));
      } else {
        fail();
      }
    }
  };

  xmlhttp.open("GET", path, true);
  xmlhttp.send();
};

const fetchMap = (fetcher, map, routes, finish) => {
  const renderRoutes = (routesData, cb) => {
    console.log(routesData)
    const linesLayer = new L.geoJson(routesData).addTo(map);

    linesLayer.setStyle((feature) => {
      return {
        "weight": 3,
        "opacity": 1,
        "color": SUBWAY_COLORS[feature.properties.route_id]
      };
    });

    cb();
  };

  const routePromise = new Promise((resolve, reject) => {
    fetcher("/map_geojson", (stopData) => {
      renderRoutes(stopData, resolve);
    }, reject);
  });

  const renderStops = (stopData, cb) => {
    const stops = Object.entries(stopData).filter(([_, stopVal]) => {
      return stopVal.name.toLowerCase().indexOf("2 av") === -1
    }).map(([_, stopVal]) => stopVal);

    const stopNames = stops.map(stopVal => stopVal.name);

    const subwayMarkerBorder = stops.map(stopVal => {
      return L.circleMarker(stopVal.coordinates,{
        color: "#D3D7D6",
        opacity: 0.7,
        fill: false,
        radius: 9,
        weight: 1.5
      })
    });

    const subwayMarkers = stops.map(stopVal => {
      const stopMarker = L.divIcon({html: SUBWAY_ICON});

      return L.marker(stopVal.coordinates, {icon: stopMarker});
    });

    const markers = subwayMarkers.concat(subwayMarkerBorder);

    L.layerGroup(markers).addTo(map);

    subwayMarkers.forEach((marker, index) => {
      marker.on('mouseover', e => {
        //open popup;
        var popup = L.popup()
         .setLatLng(e.latlng)
         .setContent(`<strong>${stopNames[index]}</strong>`)
         .openOn(map);
      });
    })

    cb();
  };

  const stopPromise = new Promise((resolve, reject) => {
    fetcher("/stops_json", (stopData) => {
      renderStops(stopData, resolve);
    }, reject);
  });

  Promise.all([routePromise, stopPromise])
    .then(() => {
      finish();
    }).catch(() => {});
};

class MapDB {
  constructor() {
    const storesPath = [DB_ROUTES_STORE, DB_STOPS_STORE];

    const openRequest = indexedDB.open(DB_NAME, 1);

    openRequest.onupgradeneeded = function(e) {
      console.log("Upgrading...");

      const db = e.target.result;

      storesPath.filter(x => db.objectStoreNames.contains(x)).forEach(x => {
        db.createObjectStore(DB_ROUTES_STORE);
      });
    }

    openRequest.onsuccess = function(e) {
      console.log("Success!");

      this.db = e.target.result;
    }

    openRequest.onerror = function(e) {
      console.log("Error");
      console.dir(e);
    }
  }

  addRoutes(routes) {

  }
}

document.addEventListener("DOMContentLoaded", () => {
  const map = L.map('subwaymap').setView(LEAFLET_CENTER, LEAFLET_ZOOM);

  map.options.minZoom = LEAFLET_ZOOM;
  map.options.maxZoom = LEAFLET_MAX_ZOOM;

  const CartoDB_DarkMatter = L.tileLayer(LEAFLET_TYLE_LAYER, {
    attribution: LEAFLET_ATTRIBUTION,
    minZoom: LEAFLET_ZOOM,
    maxZoom: LEAFLET_MAX_ZOOM
  }).addTo(map);


  const indexedDB = window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB;

  const socket = io.connect("localhost:5000");

  // if (!indexedDB) {
    fetchMap(getJSON, map, SUBWAY_ROUTES, () => {
      socket.emit("get_feed");
    });
  // } else {
  //   new MapDB();
  // }

  socket.emit("get_feed");

  socket.on("feed", subwayCars => {
    renderCars(map, subwayCars);
  });

  const popup = new mapboxgl.Popup({
    closeButton: false,
    closeOnClick: false,
  });
});