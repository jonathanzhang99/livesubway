
function log(msg) {
  console.log(msg);
}

function renderCars(map, subwayCars) {
  const speed = 60;
  const duration = 30;
  const totalFrames = speed * duration;
  const points = [];
  const allAnimSteps = [];
  $.each(subwayCars, (index, subwayCar) => {
    const line = {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: subwayCar.path,
      },
    };

    const distance = turf.lineDistance(line, 'miles');
    const distanceTraveled = subwayCar.progress * distance;
    const remainingDistance = distance - distanceTraveled;
    const animSteps = [];
    const animSpeed = speed * subwayCar.remaining_time;
    const animFrames = speed * Math.min(duration, subwayCar.remaining_time);
    const point = turf.along(line, distanceTraveled, 'miles');

    points.push(point);

    for (let i = 0; i < animFrames; i += 1) {
      const step = (i / animSpeed) * remainingDistance;
      const segment = turf.along(line, distanceTraveled + step, 'miles');
      animSteps.push(segment.geometry.coordinates);
    }

    if (animFrames < totalFrames) {
      for (let i = animFrames; i < totalFrames; i += 1) {
        const segment = turf.along(line, distance, 'miles');
        animSteps.push(segment.geometry.coordinates);
      }
    }

    allAnimSteps.push(animSteps);
  });

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
    map.addLayer({
      id: 'subwayCars',
      type: 'circle',
      source: 'subwayCars',
      paint: {
        'circle-radius': 4,
        'circle-color': '#000000',
      },
    });
  }

  const interval = 1000 / speed;
  const start = Date.now();
  let then = start;
  let counter = 0;

  function animate() {
    if (counter / interval < (speed * duration) - 1) {
      requestAnimationFrame(animate);

      const now = Date.now();
      const elapsed = now - then;
      then = now;

      for (let i = 0; i < points.length; i += 1) {
        const point = points[i];
        const animSteps = allAnimSteps[i];
        point.geometry.coordinates = animSteps[Math.round(counter / interval)];
      }

      map.getSource('subwayCars').setData({
        type: 'FeatureCollection',
        features: points,
      });

      counter += elapsed;
    } else {
      const end = Date.now();
      const animTime = ((end - start) / 1000).toString();
      log(`Time elapsed for animation: ${animTime}`);
    }
  }

  animate();
}

$(document).ready(() => {
  mapboxgl.accessToken = 'pk.eyJ1Ijoiam9uYXRoYW56aGFuZzk5IiwiYSI6ImNpdjQzMGZjazAwMmsydHJpbW03ZTN4cnEifQ.HD9WQRZXTUG6ygjZ8VWxTg';
  const map = new mapboxgl.Map({
    container: 'subwaymap',
    style: 'mapbox://styles/mapbox/light-v9',
    center: [-73.983393, 40.788552],
    dragRotate: false,
    zoom: 10.84,
  });

  map.on('load', () => {
    const socket = io.connect('localhost:5000');

    const routeIDsList = [
      'route-1..N03R',
      'route-5..S03R',
      'route-A..N04R',
      'route-N..N20R',
      'route-D..N05R',
      'route-B..N46R',
    ];

    $.when((
      $.getJSON('/map_json', (mapData) => {
        /**
         * This is used because we have a second loop
         * that only adds layers for the chosen routes:
         * we're only displaying a few for performance reasons
         * until we can optimize the rendering.
         */
        const tempColorMap = {};

        $.each(mapData, (mapKey, mapVal) => {
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

        $.each(routeIDsList, (index, key) => {
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

        $.getJSON('/stops_json', (stopData) => {
          const stopsFeatureData = $.map(stopData, (stopVal) => {
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
      socket.on('feed', (subwayCars) => {
        renderCars(map, subwayCars);
      });
    }).then(() => {
      socket.emit('get_feed');
    });

    const popup = new mapboxgl.Popup({
      closeButton: false,
      closeOnClick: false,
    });

    map.on('mousemove', (e) => {
      const features = map.queryRenderedFeatures(e.point, { layers: ['stops'] });
      map.getCanvas().style.cursor = (features.length) ? 'pointer' : '';
      if (!features.length) {
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
