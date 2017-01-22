"use strict";

const SPEED = 60;
const DURATION = 30;
const TOTALFRAMES = SPEED * DURATION;
const INTERVAL = 1000 / SPEED;

const DB_NAME = "LIVESUBWAY_DB"
const DB_ROUTES_STORE = "ROUTES_STORE";
const DB_STOPS_STORE = "STOPS_STORE";

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

const ROUTEIDS = [
  "route-1..N03R",
  "route-5..S03R",
  "route-A..N04R",
  "route-N..N20R",
  "route-D..N05R",
  "route-B..N46R",
];

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

    return [...Array(TOTALFRAMES).keys()].map((x, i) => {
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

        point.geometry.coordinates = animSteps[Math.round(counter / INTERVAL)];
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
        success(xmlhttp.responseText);
      } else {
        fail();
      }
    }
  };

  xmlhttp.open("GET", path, true);
  xmlhttp.send();
};

const fetchMap = (fetcher, map, finish) => {
  const renderRoutes = (strMapData, cb) => {
    const mapData = JSON.parse(strMapData);
    const colorMap = Object.entries(mapData).reduce((acc, [mapKey, mapVal]) => {
      const routeID = "route-".concat(mapKey);

      acc[routeID] = mapVal.color;

      map.addSource(routeID, {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {
            color: mapVal.color,
          },
          geometry: {
            type: "LineString",
            coordinates: mapVal.points,
          },
        },
      });

      return acc;
    }, {});

    ROUTEIDS.forEach(key => {
      map.addLayer({
        id: key,
        type: "line",
        source: key,
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-color": colorMap[key],
          "line-width": 3,
        },
      });
    });

    cb;
  };

  const renderStops = (strStopsData, cb) => {
    const stopData = JSON.parse(strStopsData);

    const stopsFeatureData = Object.entries(stopData).map(([_, stopVal]) => {
      const name = stopVal.name;
      const coordinates = stopVal.coordinates.join(", ");
      const descriptionHTML = `<strong>${name}</strong><br><p>${coordinates}</p>`;

      const stopSource = {
        type: "Feature",
        properties: {
          description: descriptionHTML,
        },
        geometry: {
          type: "Point",
          coordinates: stopVal.coordinates,
        },
      };

      return stopSource;
    });

    map.addSource("stops", {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: stopsFeatureData,
      },
    });

    map.addLayer(STOP_ATTR);

    cb();
  };

  const routePromise = new Promise((resolve, reject) => {
    fetcher("/map_json", (mapData) => {
      renderRoutes(mapData, resolve);
    }, reject());
  });

  const stopPromise = new Promise((resolve, reject) => {
    fetcher("/stops_json", (stopData) => {
      renderStops(stopData, resolve);
    }, reject());
  });

  Promise.all([routePromise, stopPromise])
    .then(() => {
      finish();
    }).catch(() => {});
};

class MapDB {
  constructor() {
    const openRequest = indexedDB.open(DB_NAME, 1);

    openRequest.onupgradeneeded = function(e) {
      console.log("Upgrading...");

      const db = e.target.result;

      [DB_ROUTES_STORE, DB_STOPS_STORE].filter(x => !db.objectStoreNames.contains(x)).forEach(x => {
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
}



window.onload = () => {
  mapboxgl.accessToken = ACCESSTOKEN;

  const map = new mapboxgl.Map(MAPBOX);

  map.on("load", () => {
    const indexedDB = window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB;

    const socket = io.connect("localhost:5000");

    if (!indexedDB) {
      fetchMap(getJSON, map, () => {
        socket.emit("get_feed");
      });
    } else {

    }

    socket.emit("get_feed");

    socket.on("feed", subwayCars => {
      renderCars(map, subwayCars);
    });

    const popup = new mapboxgl.Popup({
      closeButton: false,
      closeOnClick: false,
    });

    map.on("mousemove", e => {
      const features = map.queryRenderedFeatures(e.point, { layers : ["stops"] });

      map.getCanvas().style.cursor = (features.length) ? "pointer" : "";

      if (features.length === 0) {
        popup.remove();

        return;
      }

      const feature = features[0];

      popup.setLngLat(feature.geometry.coordinates)
        .setHTML(feature.properties.description)
        .addTo(map);
    });
  });
};