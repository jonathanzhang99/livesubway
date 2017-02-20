"use strict";

const SPEED = 60;
const DURATION = 30;
const TOTAL_FRAMERATE = SPEED * DURATION;
const INTERVAL = 1000 / SPEED;
const SAMPLE_POINTS = 20;

const SERVER_DELAY = 30;
const ACTIVE_CARS = {

};

const DB_NAME = "LIVESUBWAY_DB";
const DB_ROUTES_STORE = "ROUTES_STORE";
const DB_STOPS_STORE = "STOPS_STORE";

const LEAFLET_TYLE_LAYER = "http://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png";
const LEAFLET_ATTRIBUTION = `&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy;` +
  `<a href="http://cartodb.com/attributions">CartoDB</a>`;

const LEAFLET_ZOOM = 13;
const LEAFLET_MAX_ZOOM = 20;
const LEAFLET_CENTER = [40.758896, -73.985130];
const LEAFLET_MAP_BOUND = [
  [40.440957, -74.380673],
  [40.938094, -73.676237]
];

const SUBWAY_ICON = `<i class="fa fa-dot-circle-o" aria-hidden="true" style="visibility:hidden;"></i>`;

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

// _________________________________________
// START OF ANIMATION SEGMENT


//TODO: Does not need to be hardcoded but will remain
//      as such until a later date
const ActiveTrains = {
  "1": [],
  "2": [],
  "3": [],
  "4": [],
  "5": [],
  "6": [],
  "B": [],
  "D": [],
  "F": [],
  "M": [],
  "A": [],
  "C": [],
  "E": [],
  "G": [],
  "J": [],
  "Z": [],
  "L": [],
  "N": [],
  "Q": [],
  "R": [],
  "S": [],
  "7": [],
  "SIR": [],
};

// Finds the distance between two indices on the geojson line.
// Adds up the individual segments until the end segment.
// All units are in miles
const findDistance = (startindex, endindex, coordmap) => {
  let dist = 0;
  while (startindex !== endindex){
    dist += turf.along(coordmap[startindex], coordmap[++startindex], "miles");
  }
  return dist;
};

// Calculates the speed of the train required to get 
// from <startindex:int> to <endindex:int> along the specific line
// within SERVER_DELAY seconds.
const calcSpeed = (startindex, endindex, coordmap) => {
  return findDistance(startindex, endindex, coordmap)/SERVER_DELAY;
 };

// Creates a train at the starting location of the
// given <line:string> in <delay:int> seconds.
// <train_data:Object>: {
//  id:               trip_id, (unique)
//  line:             string,
//  speed:            int,
//  current_location: [coord]
// }
const initTrain = (delay, train_data) => {
  setTimeout(delay, () => {
    train_data
    ActiveTrains[train_data.line].push(train_data);

  });
};

const delTrain = (delay, train_data) => {
  setTimeout(delay, () => {
    delete ActiveTrains[train_data.line][train_data.id];
  });
};

// <subwayTrainSched:Object>: {
//  subwayTrain: Object
// }
// subwayTrain: {
//  line:           string,
//  train_id:       trip_id,
//  initialized:    bool,
//  deleted:        bool,
//  action_time:    Time
//   
// }
// const update = subwayTrainSched => {
//   subwayTrainSched.forEach(subwayTrain => {
//     if (!subwayTrain.initialized){
//       initTrain( subwayTrain);
//     }
//   });


// };

const animateTrains = (map, subwayCars) => {
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

  // const start = Date.now();

  // let then = start;
  // let counter = 0;

  // const animate = () => {
  //   if (counter / INTERVAL < (SPEED * DURATION) - 1) {
  //     const now = Date.now();
  //     const elapsed = now - then;

  //     then = now;

  //     points.forEach((point, i) => {
  //       const animSteps = allAnimSteps[i];

  //       point.geometry.coordinates = animSteps[Math.round(elapsed / INTERVAL)];
  //     });

  //     map.getSource("subwayCars").setData({
  //       type: "FeatureCollection",
  //       features: points,
  //     });

  //     counter += elapsed;

  //     requestAnimationFrame(animate);
  //   } else {
  //     const animTime = ((Date.now() - start) / 1000).toString();

  //     console.log(`Time elapsed for animation: ${animTime}`);
  //   }
  // };

  // animate();
};
// _________________________________________
// END OF ANIMATION SEGMENT

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

    const linesLayer = new L.geoJson(routesData).addTo(map);

    linesLayer.setStyle((feature) => {
      return {
        "weight": 3,
        "opacity": feature.properties.route_id === "2" ? 1 : 0, 
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
      return stopVal.name.toLowerCase().indexOf("2 av") === -1;
    }).map(([_, stopVal]) => stopVal);

    const stopNames = stops.map(stopVal => stopVal.name);

    const subwayMarkers = stops.map(stopVal => {
      const stopMarker = L.divIcon({
        html: SUBWAY_ICON
      });

      return L.marker(stopVal.coordinates, {
        icon: stopMarker
      });
    });

    L.layerGroup(subwayMarkers).addTo(map);

    subwayMarkers.forEach((marker, index) => {
      marker.bindPopup(`<strong>${stopNames[index]}</strong>`);
      marker.on("mouseover", e => {
        marker.openPopup();
      });
    });

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
    };

    openRequest.onsuccess = (e) => {
      console.log("Success!");

      this.db = e.target.result;
    };

    openRequest.onerror = (e) => {
      console.log("Error");
      console.dir(e);
    };
  }

  addRoutes(routes) {

  }
}

document.addEventListener("DOMContentLoaded", () => {
  const map = L.map("subwaymap").setView(LEAFLET_CENTER, LEAFLET_ZOOM);

  map.options.minZoom = LEAFLET_ZOOM - 1;
  map.options.maxZoom = LEAFLET_MAX_ZOOM;

  L.tileLayer(LEAFLET_TYLE_LAYER, {
    attribution: LEAFLET_ATTRIBUTION,
    minZoom: LEAFLET_ZOOM - 1,
    maxZoom: LEAFLET_MAX_ZOOM
  }).addTo(map);

  const bounds = L.latLngBounds(LEAFLET_MAP_BOUND);

  map.on("drag", () => {
    map.panInsideBounds(bounds, {
      animate: false
    });
  });

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
    animateTrains(map, subwayCars);
  });
});