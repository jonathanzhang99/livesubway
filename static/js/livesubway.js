const SPEED = 60;
const DURATION = 30;
const TOTALFRAMES = SPEED * DURATION;
const INTERVAL = 1000 / SPEED;
const START = Date.now();

const MAPBOX = {
  container: 'subwaymap',
  style: 'mapbox://styles/mapbox/light-v9',
  center: [-73.983393, 40.788552],
  dragRotate: false,
  zoom: 10.84,
};

const LAYER = {
  id: 'subwayCars',
  type: 'circle',
  source: 'subwayCars',
  paint: {
    'circle-radius': 4,
    'circle-color': '#000000',
  },
};

const ROUTEIDS = [
  'route-1..N03R',
  'route-5..S03R',
  'route-A..N04R',
  'route-N..N20R',
  'route-D..N05R',
  'route-B..N46R',
];

function renderCars(map, subwayCars) {
  const lineTuple = subwayCars.map(subwayCar => {
    const line = {
      type : 'Feature',
      geometry : {
        type : 'LineString',
        coordinates : subwayCar.path,
      },
    };

    const distance = turf.lineDistance(line, 'miles');
    const distanceTraveled = subwayCar.progress * distance;

    return [line, distance, distanceTraveled, subwayCar.remaining_time];
  });

  const points = lineTuple.map(x => {
    return turf.along(x[0], x[2], 'miles');
  });

  const allAnimSteps = lineTuple.map(x => {
    const [line, d, dT, rT] = x;
    const remainingDistance = d - dT;
    const animSpeed = SPEED * rT;
    const animFrames = SPEED * Math.min(DURATION, rT);

    return [...Array(TOTALFRAMES).keys()].map((x, i) => {
      const distance = i < animFrames ? dT + (i / animSpeed) * remainingDistance : d;

      const segment = turf.along(line, distance, 'miles');

      return segment.geometry.coordinates;
    });
  }).reduce((x, y) => x.concat(y));

  const source = {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: points,
    },
  };

  if (map.getSource('subwayCars') === undefined) {
    map.addSource('subwayCars', source);
  } else {
    map.getSource('subwayCars').setData(source.data);
  }

  if (map.getLayer('subwayCars') === undefined) {
    map.addLayer(LAYER);
  }

  let counter = 0;

  function animate() {
    if (counter / INTERVAL < (SPEED * DURATION) - 1) {
      requestAnimationFrame(animate);

      const elapsed = Date.now() - START;

      points.forEach((point, i) => {
        const animSteps = allAnimSteps[i];

        point.geometry.coordinates = animSteps[Math.round(counter / INTERVAL)];
      });

      map.getSource('subwayCars').setData({
        type: 'FeatureCollection',
        features: points,
      });

      counter += elapsed;
    } else {
      const animTime = ((Date.now() - START) / 1000).toString();

      console.log(`Time elapssed for animation: ${animTime}`);
    }
  }

  animate();
}

$(document).ready(() => {
  mapboxgl.accessToken = ACCESSTOKEN;

  const map = new mapboxgl.Map(MAPBOX);

  map.on('load', () => {
    const socket = io.connect('localhost:5000');

    $.when((
      $.getJSON('/map_json', mapData => {
        /**
         * This is used because we have a second loop
         * that only adds layers for the chosen routes:
         * we're only displaying a few for performance reasons
         * until we can optimize the rendering.
         */
        const tempColorMap = {};

        Object.entries(mapData).forEach(([mapKey, mapVal]) => {
          const routeID = 'route-'.concat(mapKey);

          tempColorMap[routeID] = mapVal.color;

          map.addSource(routeID, {
            type: 'geojson',
            data: {
              type: 'Feature',
              properties: {
                color: mapVal.color,
              },
              geometry: {
                type: 'LineString',
                coordinates: mapVal.points,
              },
            },
          });
        });

        ROUTEIDS.forEach((key, index) => {
          map.addLayer({
            id: key,
            type: 'line',
            source: key,
            layout: {
              'line-join': 'round',
              'line-cap': 'round',
            },
            paint: {
              'line-color': tempColorMap[key],
              'line-width': 3,
            },
          });
        });

        $.getJSON('/stops_json', stopData => {
          const stopsFeatureData = Object.entries(stopData).map(([_, stopVal]) => {
            const name = stopVal.name;
            const coordinates = stopVal.coordinates.join(', ');
            const descriptionHTML = `<strong>${name}</strong><br><p>${coordinates}</p>`;

            const stopSource = {
              type: 'Feature',
              properties: {
                description: descriptionHTML,
              },
              geometry: {
                type: 'Point',
                coordinates: stopVal.coordinates,
              },
            };

            return stopSource;
          });

          map.addSource('stops', {
            type: 'geojson',
            data: {
              type: 'FeatureCollection',
              features: stopsFeatureData,
            },
          });

          map.addLayer({
            id: 'stops',
            type: 'circle',
            source: 'stops',
            paint: {
              'circle-radius': {
                stops: [[11, 3], [14, 4], [16, 5]],
              },
              'circle-color': '#ff3300',
            },
          });
        });
      })
    )).then(() => {
      socket.on('feed', subwayCars => {
        console.log(subwayCars);
        // renderCars(map, subwayCars);
      });
    }).then(() => {
      socket.emit('get_feed');
    });

    const popup = new mapboxgl.Popup({
      closeButton: false,
      closeOnClick: false,
    });

    map.on('mousemove', e => {
      const features = map.queryRenderedFeatures(e.point, { layers : ['stops'] });

      map.getCanvas().style.cursor = (features.length) ? 'pointer' : '';

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
});
